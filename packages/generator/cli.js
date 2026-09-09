import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { botCatalog } from "../bot-catalog.js";
import { projectRoot } from "../bot-catalog-node.js";
import { digest } from "../sim/index.js";
import { ENGINE_VERSION, SPEC_VERSION } from "../sim/spec.js";
import { generateController } from "./generate.js";
import { gateSource, loadOpponent, runSeries } from "./evaluate.js";
import { botIdFromModel, describeGate, describeSeries } from "./prompt.js";
import { catalogEntry, registerBot } from "./registry.js";
import {
  inferModelProvider, providerPresets, requestCompletion, resolveProvider,
} from "./providers.js";

const HELP = `Generate an arena controller with any hosted or local model.

  node packages/generator/cli.js --provider openrouter --model anthropic/claude-opus-4.5 \\
    --evaluate --rounds 2 --report artifacts/run.json

Model access
  --provider <name>       Endpoint preset (default openrouter). See --list-providers.
  --model <id>            Model identifier required by that endpoint.
  --base-url <url>        Override the endpoint (any OpenAI-compatible server).
  --api <openai|anthropic>Override the wire format for a custom endpoint.
  --api-key-env <NAME>    Environment variable holding the key (never pass keys as arguments).
  --reasoning <effort>    minimal | low | medium | high | max, when the model supports it.
  --temperature <n>       Sampling temperature; omitted by default.
  --max-tokens <n>        Reply token limit (default 16000).
  --retries <n>           Retries for 429/5xx and network errors (default 3).
  --timeout <ms>          Per-request timeout (default 600000).

Controller identity
  --id <bot-id>           Bot ID and file name; derived from the model name by default.
  --name <model>          Model name recorded in the catalog (default: --model).
  --model-provider <name> Vendor recorded in the catalog; inferred when omitted.
  --thinking <level>      Thinking level recorded in the catalog.
  --harness <name>        Coding harness recorded in the catalog.
  --provenance <label>    Override the detected provenance; keep the label truthful.
  --lang <js|ts>          Controller language (default js).
  --out <dir>             Output directory (default packages/bots).
  --force                 Overwrite an existing file or catalog entry.

Specification and iteration
  --spec <file>           Rules document sent to the model (default AGENTS.md).
  --brief <text>          Extra operator guidance appended to the task.
  --brief-file <file>     Read that guidance from a file.
  --attempts <n>          Generation attempts per stage, repairs included (default 3).
  --rounds <n>            Improvement rounds after the first conforming controller.
  --evaluate              Run the mirrored-seed series against --opponent.
  --opponent <id|file>    Opponent for the series (default Baseline).
  --seeds <n>             Seeds per series; 20 matches at the default 10.
  --stop-when-winning     Stop improving once the series is won.
  --budget <fuel|wall>    Gate and match budget (default fuel).
  --strict-gate           Require full conformity, timing included, not only admission.

Output
  --register              Add or update the entry in bots.json.
  --report <file>         Write a JSON run report.
  --json                  Print the report to stdout instead of a summary.
  --dry-run               Resolve the plan and exit without calling the model.
  --list-providers        Print the endpoint presets.
  --help                  Show this message.
`;

const options = {
  provider: { type: "string" }, model: { type: "string" }, "base-url": { type: "string" },
  api: { type: "string" }, "api-key-env": { type: "string" }, reasoning: { type: "string" },
  temperature: { type: "string" }, "max-tokens": { type: "string" }, retries: { type: "string" },
  timeout: { type: "string" }, id: { type: "string" }, name: { type: "string" },
  "model-provider": { type: "string" }, thinking: { type: "string" }, harness: { type: "string" },
  provenance: { type: "string" },
  lang: { type: "string" }, out: { type: "string" }, force: { type: "boolean" },
  spec: { type: "string" }, brief: { type: "string" }, "brief-file": { type: "string" },
  attempts: { type: "string" }, rounds: { type: "string" }, evaluate: { type: "boolean" },
  opponent: { type: "string" }, seeds: { type: "string" }, "stop-when-winning": { type: "boolean" },
  budget: { type: "string" }, "strict-gate": { type: "boolean" }, register: { type: "boolean" },
  report: { type: "string" }, json: { type: "boolean" }, "dry-run": { type: "boolean" },
  "list-providers": { type: "boolean" }, help: { type: "boolean" },
};

function number(value, name, { min = 0, integer = true } = {}) {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || (integer && !Number.isInteger(parsed)))
    throw new Error(`--${name} must be ${integer ? "an integer" : "a number"} of at least ${min}.`);
  return parsed;
}

async function main(argv) {
  const { values } = parseArgs({ args: argv, options });
  if (values.help) return void process.stdout.write(HELP);
  if (values["list-providers"]) {
    console.table(Object.fromEntries(Object.entries(providerPresets).map(([name, preset]) => [
      name, { api: preset.api, baseUrl: preset.baseUrl ?? "(--base-url required)", keyEnv: preset.keyEnv },
    ])));
    return;
  }
  if (!values.model?.trim()) throw new Error("--model is required. See --help.");
  const language = values.lang ?? "js";
  if (!["js", "ts"].includes(language)) throw new Error("--lang must be js or ts.");
  const budget = values.budget ?? "fuel";
  if (!["fuel", "wall"].includes(budget)) throw new Error("--budget must be fuel or wall.");

  const provider = resolveProvider({
    provider: values.provider ?? "openrouter", baseUrl: values["base-url"],
    apiKeyEnv: values["api-key-env"], api: values.api, requireKey: !values["dry-run"],
  });
  const model = values.model.trim(),
    displayName = values.name?.trim() || model,
    thinking = values.thinking?.trim() || null,
    harness = values.harness?.trim() || null,
    id = values.id?.trim() || botIdFromModel(displayName, thinking);
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error(`Invalid bot ID "${id}": use letters, digits, hyphens and underscores.`);
  const outDir = resolve(projectRoot, values.out ?? "packages/bots"),
    file = resolve(outDir, `${id}.${language}`),
    relativeFile = relative(projectRoot, file).split("\\").join("/");
  const existing = botCatalog.find(bot => bot.id === id || bot.file === relativeFile);
  if (existing && !values.force)
    throw new Error(`"${existing.id}" already occupies that ID or path. Choose --id or pass --force.`);
  if (!values.force && await stat(file).then(() => true, () => false))
    throw new Error(`${relativeFile} already exists. Choose --id or pass --force.`);

  const spec = await readFile(resolve(projectRoot, values.spec ?? "AGENTS.md"), "utf8"),
    brief = values["brief-file"]
      ? await readFile(resolve(projectRoot, values["brief-file"]), "utf8")
      : values.brief ?? "";
  const attempts = number(values.attempts, "attempts", { min: 1 }) ?? 3,
    rounds = number(values.rounds, "rounds") ?? 0,
    seeds = number(values.seeds, "seeds", { min: 1 }) ?? 10,
    maxTokens = number(values["max-tokens"], "max-tokens", { min: 1 }) ?? 16000,
    retries = number(values.retries, "retries") ?? 3,
    timeoutMs = number(values.timeout, "timeout", { min: 1000 }) ?? 600_000,
    temperature = number(values.temperature, "temperature", { integer: false }),
    withSeries = Boolean(values.evaluate) || rounds > 0,
    opponentId = values.opponent ?? "Baseline";
  const metadata = {
    id, model: displayName, thinking, harness,
    provider: values["model-provider"]?.trim() || inferModelProvider(provider, model),
  };
  if (values["dry-run"]) {
    console.log(JSON.stringify({
      endpoint: { provider: provider.name, api: provider.api, baseUrl: provider.baseUrl,
        keyEnv: provider.keyEnv, keyPresent: Boolean(provider.apiKey) },
      model, metadata, file: relativeFile, language, budget, attempts, rounds,
      evaluation: withSeries ? { opponent: opponentId, matches: seeds * 2 } : null,
      specCharacters: spec.length, briefCharacters: brief.length,
    }, null, 2));
    return;
  }
  if (values.register && !withSeries && !values.force)
    throw new Error("Registration requires --evaluate: a bot must be shown to beat Baseline.");

  const opponent = withSeries ? await loadOpponent(opponentId) : null;
  if (opponent?.id === id) throw new Error("A controller cannot be evaluated against itself.");
  const started = Date.now();
  const result = await generateController({
    spec, language, brief, attempts, rounds,
    requireFullConformity: Boolean(values["strict-gate"]),
    stopWhenWinning: Boolean(values["stop-when-winning"]),
    opponentId: opponent?.id ?? "the opponent",
    complete: ({ system, messages }) => requestCompletion(provider, {
      model, system, messages, temperature, maxTokens, reasoning: values.reasoning,
    }, {
      retries, timeoutMs,
      onRetry: ({ attempt, reason }) => console.error(`Retry ${attempt}: ${reason}`),
    }).then(reply => reply.text),
    gate: source => gateSource(source, budget),
    evaluate: opponent
      ? source => runSeries({
          bot: { ...metadata, source }, opponent, seeds,
          budgetMode: budget,
          onMatch: (record, index, total) => console.error(
            `  match ${index}/${total} seed ${record.seed}${record.mirrored ? " M" : ""} → ` +
            `${record.score === 1 ? "win" : record.score === 0 ? "loss" : "draw"} (${record.reason})`,
          ),
        })
      : null,
    log: entry => console.error(JSON.stringify(entry)),
  });
  const provenance = values.provenance?.trim() || result.provenance;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, result.source);
  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    specVersion: SPEC_VERSION, engineVersion: ENGINE_VERSION,
    endpoint: { provider: provider.name, api: provider.api, baseUrl: provider.baseUrl, model },
    bot: { ...metadata, provenance, file: relativeFile, codeSha256: digest(result.source) },
    budgetMode: budget, requests: result.requests,
    gate: result.gate,
    evaluation: opponent && {
      opponent: opponent.id, seeds, matches: result.series.matches,
      wins: result.series.wins, draws: result.series.draws, losses: result.series.losses,
      score: result.series.score, beatsOpponent: result.series.beatsOpponent,
      records: result.series.records,
    },
    history: result.history,
  };
  if (values.report) {
    const path = resolve(projectRoot, values.report);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(report, null, 2) + "\n");
  }
  let registered = false;
  if (values.register) {
    if (result.series && !result.series.beatsOpponent && !values.force)
      throw new Error(
        `Not registered: ${result.series.wins} wins against ${result.series.losses} losses does not beat ` +
        `${opponent.id}. The controller file was kept at ${relativeFile}.`,
      );
    await registerBot(catalogEntry({ ...metadata, file: relativeFile, provenance }));
    registered = true;
  }
  if (values.json) return void console.log(JSON.stringify({ ...report, registered }, null, 2));
  console.log([
    `Controller written to ${relativeFile} (${provenance}, ${result.requests} model ` +
      `request${result.requests === 1 ? "" : "s"}).`,
    describeGate(result.gate),
    result.series ? describeSeries(result.series, { opponentId: opponent.id }).split("\n")[1] : "",
    result.series
      ? `Minimum competitive requirement against ${opponent.id}: ${result.series.beatsOpponent ? "met" : "NOT met"}.`
      : "Not evaluated: run with --evaluate before registering.",
    registered ? "Registered in bots.json. Run npm run build to refresh the bundle." : "",
    values.report ? `Report written to ${values.report}.` : "",
  ].filter(Boolean).join("\n"));
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
