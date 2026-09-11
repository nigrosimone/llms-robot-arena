// Generates one controller with a coding harness (Claude Code or Codex) run
// non-interactively in a copy of the repository that holds no other bot: the
// black-box policy becomes a property of the workspace, not a promise.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { SPEC_VERSION, ENGINE_VERSION } from "../sim/spec.js";

export const HARNESSES = {
  "claude-code": { label: "Claude Code", provider: "Anthropic", command: "claude", home: ".claude", credentials: ".credentials.json" },
  codex: { label: "Codex", provider: "OpenAI", command: "codex", home: ".codex", credentials: "auth.json" },
};
const HOME_DIR = homedir();
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");
export const slug = (text) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function renderPrompt(template, { id, name, provider }) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => ({ id, name, provider })[key]);
}

export function catalogEntry({ id, name, thinking, harness }) {
  const h = HARNESSES[harness];
  return { id, model: name, thinking, harness: h.label, provider: h.provider, file: `packages/bots/${id}.js`, provenance: "iterative" };
}

// The workspace catalog keeps Baseline (its source is the public minimal
// example) and the entry the agent has to fill.
export const workspaceCatalog = (catalog, entry) => [
  ...catalog.filter((bot) => bot.id === "Baseline"),
  entry,
];

// Arguments for a non-interactive session reading its prompt from stdin.
export function harnessArgs({ harness, model, thinking, maxCost }) {
  if (harness === "claude-code")
    return [
      "-p", "--model", model, "--effort", thinking,
      "--output-format", "stream-json", "--verbose", "--no-session-persistence",
      // Only the workspace settings: the operator's own CLAUDE.md never reaches the agent.
      "--setting-sources", "project",
      "--allowedTools", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "LS", "Bash(node *)", "Bash(npm *)",
      ...(maxCost ? ["--max-budget-usd", String(maxCost)] : []),
    ];
  if (harness === "codex")
    return [
      "exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write",
      "-m", model, "-c", `model_reasoning_effort=${JSON.stringify(thinking)}`,
      "-C", ".",
    ];
  throw Error(`Unknown harness "${harness}".`);
}

// Turns, tokens and (for Claude Code) the cost estimate, from the JSONL stream.
export function parseTranscript(harness, text) {
  const events = text.split("\n").flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
  const summary = { turns: 0, inputTokens: 0, outputTokens: 0, cost: null, durationMs: null };
  if (harness === "claude-code") {
    const result = events.findLast((e) => e.type === "result");
    if (result) {
      summary.turns = result.num_turns ?? 0;
      summary.cost = result.total_cost_usd ?? null;
      summary.durationMs = result.duration_ms ?? null;
      summary.inputTokens = (result.usage?.input_tokens ?? 0) + (result.usage?.cache_read_input_tokens ?? 0) + (result.usage?.cache_creation_input_tokens ?? 0);
      summary.outputTokens = result.usage?.output_tokens ?? 0;
    }
  } else {
    for (const e of events) {
      if (e.type === "turn.completed") {
        summary.turns++;
        summary.inputTokens += e.usage?.input_tokens ?? 0;
        summary.outputTokens += e.usage?.output_tokens ?? 0;
      }
    }
  }
  return summary;
}

const run = (file, args, { cwd, input, onLine, env, timeoutMs, capture } = {}) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
    let output = "", pending = "";
    const timer = timeoutMs && setTimeout(() => {
      child.kill();
      reject(Error(`Timed out after ${timeoutMs / 60000} minutes.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      capture?.(String(chunk));
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) onLine?.(line);
    });
    child.on("error", reject);
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolvePromise(output) : reject(Error(`${basename(file)} exited with code ${code}`));
    });
    if (input && typeof input.pipe === "function") input.pipe(child.stdin);
    else child.stdin.end(input ?? "");
  });

// npm shims on Windows are .cmd files that Node refuses to spawn directly:
// the JavaScript entry point behind them runs with the current node instead.
export async function resolveCommand(name) {
  const which = process.platform === "win32" ? "where" : "which";
  const found = (await run(which, [name]).catch(() => "")).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const direct = found.find((p) => (process.platform === "win32" ? /\.exe$/i.test(p) : !/\.(cmd|bat|ps1)$/i.test(p)));
  if (direct) return { file: direct, args: [] };
  // A shim sits next to the global node_modules of its npm prefix.
  const entries = { claude: "@anthropic-ai/claude-code/cli.js", codex: "@openai/codex/bin/codex.js" };
  for (const shim of [...found, process.execPath]) {
    const entry = join(dirname(shim), "node_modules", entries[name] ?? "");
    if (entries[name] && (await access(entry).then(() => true, () => false)))
      return { file: process.execPath, args: [entry] };
  }
  throw Error(`Cannot find the "${name}" command.`);
}

// A clean export of HEAD: no other controller, no results, no history.
export async function prepareWorkspace({ root, dir, entry, catalog, log = () => {} }) {
  await mkdir(dir, { recursive: true });
  // git archive streams straight into tar: no archive file, no colon in a
  // Windows path for GNU tar to mistake for a remote host.
  const archive = spawn("git", ["archive", "--format=tar", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
  archive.stdout.on("error", () => {});
  // The system tar on Windows understands its own paths; the MSYS one does not.
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe") : "tar";
  await run(tar, ["-x", "-f", "-", "-C", dir], { input: archive.stdout });
  for (const name of await readdir(join(dir, "packages/bots")))
    if (name !== "baseline.js") await rm(join(dir, "packages/bots", name));
  await writeFile(join(dir, "bots.json"), JSON.stringify(workspaceCatalog(catalog, entry), null, 2) + "\n");
  await writeFile(join(dir, `match-${entry.id}.json`), JSON.stringify([entry.id, "Baseline"], null, 2) + "\n");
  await rm(join(dir, "packages/viewer/public/standings.json"), { force: true });
  await rm(join(dir, "generations"), { recursive: true, force: true });
  log(`Workspace ${dir}: Baseline and the empty slot for ${entry.id}.`);
}

export async function linkNodeModules(root, dir) {
  await symlink(join(root, "node_modules"), join(dir, "node_modules"), "junction");
}

// The real session: the harness command, its prompt on stdin, the JSONL
// stream mirrored to the transcript as it arrives so a killed run keeps it.
export async function runHarness({ harness, model, thinking, maxCost, dir, prompt, transcript, timeoutMinutes, dryRun, log, mode = "docker", root }) {
  const args = harnessArgs({ harness, model, thinking, maxCost });
  const stream = {
    input: prompt,
    timeoutMs: timeoutMinutes * 60 * 1000,
    capture: (chunk) => appendFile(transcript, chunk),
    onLine: (line) => {
      const text = progressLine(harness, line);
      if (text) log(text);
    },
  };
  if (mode === "host") {
    const command = await resolveCommand(HARNESSES[harness].command);
    const version = (await run(command.file, [...command.args, "--version"]).catch(() => "")).trim();
    log(`${HARNESSES[harness].label} ${version}: ${basename(command.file)} ${[...command.args, ...args].join(" ")}`);
    if (dryRun) return { version, output: "" };
    await writeFile(transcript, "");
    return { version, output: await run(command.file, [...command.args, ...args], { cwd: dir, env: { CI: "1" }, ...stream }) };
  }
  // The container: a bare home with the copied credentials, the workspace at
  // /work, Linux dependencies installed inside it, and a name so a timeout can
  // remove it.
  const image = "llms-robot-arena-gen";
  if (!(await run("docker", ["image", "inspect", image]).then(() => true, () => false))) {
    log(`Building the ${image} image.`);
    await run("docker", ["build", "-t", image, join(root, "generations")]);
  }
  const home = join(HOME_DIR, HARNESSES[harness].home);
  const creds = await mkdtemp(join(tmpdir(), "llms-robot-arena-creds-"));
  const mounted = join(creds, HARNESSES[harness].home);
  await mkdir(mounted, { recursive: true });
  await cp(join(home, HARNESSES[harness].credentials), join(mounted, HARNESSES[harness].credentials));
  const name = `arena-gen-${basename(dir)}`;
  const dockerArgs = (interactive) => [
    "run", "--rm", ...(interactive ? ["-i", "--name", name] : []),
    "-v", `${dir}:/work`, "-v", `${mounted}:/root/${HARNESSES[harness].home}`, "-v", "llms-robot-arena-npm:/root/.npm",
    "-w", "/work", image,
  ];
  const command = HARNESSES[harness].command;
  const version = (await run("docker", [...dockerArgs(false), command, "--version"]).catch(() => "")).trim();
  log(`${HARNESSES[harness].label} ${version} in docker: ${command} ${args.join(" ")}`);
  try {
    if (dryRun) return { version, output: "" };
    log("Installing dependencies in the workspace.");
    await run("docker", [...dockerArgs(false), "npm", "ci", "--no-audit", "--no-fund"]);
    await writeFile(transcript, "");
    const output = await run("docker", [...dockerArgs(true), command, ...args], stream).catch(async (error) => {
      await run("docker", ["rm", "-f", name]).catch(() => {});
      throw error;
    });
    return { version, output };
  } finally {
    await rm(creds, { recursive: true, force: true });
  }
}

// Prepares the workspace, runs the session and registers what it produced.
export async function generateBot({
  root, harness, model, thinking, name, id = `${slug(name)}-${thinking}`,
  maxCost = null, dryRun = false, keep = false, timeoutMinutes = 180, mode = "docker",
  workspaceRoot = join(tmpdir(), "llms-robot-arena-gen"), log = console.log, session = runHarness,
}) {
  if (!HARNESSES[harness]) throw Error(`Unknown harness "${harness}".`);
  const catalog = JSON.parse(await readFile(join(root, "bots.json"), "utf8"));
  if (catalog.some((bot) => bot.id === id)) throw Error(`"${id}" is already in bots.json.`);
  const entry = catalogEntry({ id, name, thinking, harness });
  const template = await readFile(join(root, "prompts/bot-task.md"), "utf8");
  const prompt = renderPrompt(template, { id, name, provider: entry.provider });
  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  const started = new Date();
  const batch = `${id}-${started.toISOString().replace(/[-:]/g, "").slice(0, 15)}`;
  const dir = resolve(workspaceRoot, batch);
  await prepareWorkspace({ root, dir, entry, catalog, log });
  // On the host the Windows dependencies are reused; the container installs its own.
  if (mode === "host") await linkNodeModules(root, dir);
  await mkdir(join(root, "artifacts/generations"), { recursive: true });
  const transcript = join(root, "artifacts/generations", `${batch}.jsonl`);
  const { version, output } = await session({ harness, model, thinking, maxCost, dir, prompt, transcript, timeoutMinutes, dryRun, log, mode, root });
  if (dryRun) {
    log(`Dry run: the prompt is\n${prompt}`);
    if (!keep) await rm(dir, { recursive: true, force: true });
    return { dryRun: true, dir, prompt };
  }
  const source = await readFile(join(dir, entry.file), "utf8").catch(() => null);
  if (!source) throw Error(`The agent left no ${entry.file} in ${dir}.`);
  const summary = parseTranscript(harness, output);
  const manifest = {
    id, model: name, harnessModel: model, thinking, harness: HARNESSES[harness].label, harnessVersion: version,
    provenance: "iterative",
    isolation: mode === "docker"
      ? "docker container with a bare home and a repository copy without other controllers"
      : "repository copy without other controllers, on the operator machine (the operator CLAUDE.md reaches Claude Code)",
    promptSha256: sha256(template), agentsSha256: sha256(agents),
    specVersion: SPEC_VERSION, engineVersion: ENGINE_VERSION,
    startedAt: started.toISOString(), durationMs: Date.now() - started.getTime(),
    ...summary, codeSha256: sha256(source), transcript: `artifacts/generations/${batch}.jsonl`,
  };
  // Into the repository: the source, its catalog entry, the local results and the manifest.
  await writeFile(join(root, entry.file), source);
  // Re-read the catalog: another generation may have registered meanwhile.
  const current = JSON.parse(await readFile(join(root, "bots.json"), "utf8"));
  if (!current.some((bot) => bot.id === id))
    await writeFile(join(root, "bots.json"), JSON.stringify([...current, entry], null, 2) + "\n");
  await cp(join(dir, "results"), join(root, "results"), { recursive: true, force: false }).catch(() => {});
  await mkdir(join(root, "generations"), { recursive: true });
  await writeFile(join(root, "generations", `${id}.json`), JSON.stringify(manifest, null, 2) + "\n");
  if (!keep) await rm(dir, { recursive: true, force: true });
  return { manifest, entry, dir };
}

// One readable line per event, so a two hour session shows signs of life.
export function progressLine(harness, line) {
  try {
    const e = JSON.parse(line);
    if (harness === "claude-code") {
      if (e.type === "assistant")
        return (e.message?.content ?? [])
          .map((c) => (c.type === "text" ? c.text : c.type === "tool_use" ? `[${c.name}] ${JSON.stringify(c.input).slice(0, 160)}` : ""))
          .filter(Boolean).join("\n");
      if (e.type === "result") return `result: ${e.subtype}, ${e.num_turns} turns, $${e.total_cost_usd?.toFixed(2)}`;
      return "";
    }
    if (e.type === "item.completed") {
      const item = e.item ?? {};
      if (item.type === "agent_message") return item.text ?? "";
      if (item.type === "command_execution") return `[command] ${(item.command ?? "").slice(0, 160)}`;
      if (item.type === "file_change") return `[files] ${(item.changes ?? []).map((c) => c.path).join(", ")}`;
      return "";
    }
    if (e.type === "turn.completed") return `turn done, ${e.usage?.output_tokens ?? 0} output tokens`;
    if (e.type === "error") return `error: ${e.message}`;
    return "";
  } catch {
    return line;
  }
}
