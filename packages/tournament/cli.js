import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, basename, dirname } from "node:path";
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { parseArgs } from "node:util";
import { BotClient } from "../runtime/client.js";
import { gateBot } from "../runtime/gate.js";
import { runMatch } from "../runtime/match.js";
import { matchRecord, rankTournament } from "./ranking.js";
import { stringifyReplay } from "../sim/replay.js";
import { renderReport, renderCSV } from "./report.js";
import { SPEC_VERSION, ENGINE_VERSION } from "../sim/spec.js";
import { digest } from "../sim/index.js";
const args = process.argv.slice(2);
try {
  const { values } = parseArgs({
    args,
    options: {
      bots: { type: "string" },
      out: { type: "string" },
      mode: { type: "string" },
      budget: { type: "string" },
      help: { type: "boolean" },
    },
  });
  const value = (name, fallback) => values[name.slice(2)] ?? fallback;
  if (args.includes("--help")) {
    console.log(
      "npm run tournament -- --bots bots.json --out results --mode one-shot --budget wall\nUse --budget fuel for deterministic diagnostic tournaments. Never combine rankings from different modes/budgets.",
    );
    process.exit(0);
  }
  const configPath = value("--bots", null),
    out = resolve(value("--out", "results")),
    mode = value("--mode", "one-shot"),
    budgetMode = value("--budget", "wall");
  if (
    !["one-shot", "iterative", "exhibition"].includes(mode) ||
    !["wall", "fuel"].includes(budgetMode)
  )
    throw Error("Invalid mode or budget.");
  const definitions = configPath
    ? JSON.parse(await readFile(configPath, "utf8"))
    : [
        {
          id: "gpt-6-astra-ultra",
          model: "GPT-6 Astra · iterative development",
          file: "packages/bots/gpt-6-astra-ultra.js",
        },
        {
          id: "fable-5-6-max",
          model: "Fable 5.6 Max · local submission",
          file: "packages/bots/fable-5-6-max.js",
        },
        {
          id: "Baseline",
          model: "Reference baseline",
          file: "packages/bots/baseline.js",
        },
      ];
  const actualMode = configPath ? mode : "exhibition";
  if (!Array.isArray(definitions) || definitions.length < 2)
    throw Error("At least two bot definitions are required.");
  if (
    definitions.some(
      (b) =>
        !b ||
        typeof b.id !== "string" ||
        !b.id.trim() ||
        typeof b.model !== "string" ||
        !b.model.trim() ||
        typeof b.file !== "string" ||
        !b.file.trim(),
    )
  )
    throw Error("Each bot needs a non-empty id, model and file.");
  if (new Set(definitions.map((b) => b.id)).size !== definitions.length)
    throw Error("Bot IDs must be unique.");
  const bots = await Promise.all(
    definitions.map(async (b) => ({
      ...b,
      source: await readFile(
        resolve(
          configPath ? dirname(resolve(configPath)) : process.cwd(),
          b.file,
        ),
        "utf8",
      ),
    })),
  );
  const createClient = () =>
    new BotClient(
      new Worker(new URL("../runtime/node-worker.js", import.meta.url)),
    );
  const gates = [];
  for (const bot of bots) {
    const client = createClient();
    try {
      const gate = await gateBot(client, bot.source, budgetMode);
      gates.push({ id: bot.id, ...gate });
      console.log(
        `${bot.id}: gate ${gate.pass ? "PASS" : "FAIL"}, p99 ${gate.p99?.toFixed(3)} ms`,
      );
      if (!gate.pass)
        throw Error(
          "Conformity gate failed: " + bot.id + "\n" + JSON.stringify(gate),
        );
    } finally {
      client.close();
    }
  }
  await mkdir(out, { recursive: true });
  const records = [],
    total = ((bots.length * (bots.length - 1)) / 2) * 20;
  for (let a = 0; a < bots.length; a++)
    for (let b = a + 1; b < bots.length; b++)
      for (let seed = 0; seed < 10; seed++)
        for (const mirrored of [false, true]) {
          const replay = await runMatch({
            bots: [bots[a], bots[b]],
            seed,
            mirrored,
            mode: actualMode,
            budgetMode,
            createClient,
          });
          const filename = `${a}-${b}-s${seed}-${mirrored ? "mirror" : "normal"}.json`;
          await writeFile(resolve(out, filename), stringifyReplay(replay));
          records.push({ ...matchRecord(replay, a, b), replay: filename });
          console.log(
            `${records.length}/${total}: ${bots[a].id} / ${bots[b].id} seed ${seed}${mirrored ? " M" : ""} → ${replay.result.winner === null ? "draw" : replay.bots[replay.result.winner].id} (${replay.result.reason})`,
          );
          await writeFile(
            resolve(out, "checkpoint.json"),
            JSON.stringify({ mode: actualMode, budgetMode, records }, null, 2),
          );
        }
  const ranking = rankTournament(bots, records),
    result = {
      specVersion: SPEC_VERSION,
      engineVersion: ENGINE_VERSION,
      mode: actualMode,
      budgetMode,
      replicates: 1000,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
      },
      bots: bots.map((b) => ({
        id: b.id,
        model: b.model,
        codeSha256: digest(b.source),
        file: basename(b.file),
      })),
      gates,
      records,
      ranking,
    };
  await writeFile(
    resolve(out, "ranking.json"),
    JSON.stringify(result, null, 2),
  );
  await writeFile(resolve(out, "ranking.csv"), renderCSV(ranking));
  await writeFile(resolve(out, "RESULTS.md"), renderReport(result));
  console.table(
    ranking.map((r) => ({
      bot: r.id,
      BT: r.score.toFixed(1),
      CI95: r.ci.map((x) => x.toFixed(1)).join(" – "),
      score: (r.winRate * 100).toFixed(1) + "%",
    })),
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
