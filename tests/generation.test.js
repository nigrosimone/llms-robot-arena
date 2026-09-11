import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateBot,
  harnessArgs,
  parseTranscript,
  progressLine,
  renderPrompt,
  catalogEntry,
  workspaceCatalog,
  sha256,
} from "../packages/generation/generate.js";

const catalog = [
  { id: "other-bot", model: "Other", thinking: "max", harness: "Codex", provider: "OpenAI", file: "packages/bots/other-bot.js", provenance: "iterative" },
  { id: "Baseline", model: "Baseline", thinking: null, harness: null, provider: null, file: "packages/bots/baseline.js", provenance: "reference" },
];

// A small repository with two controllers, committed so git archive has a HEAD.
async function repository() {
  const root = await mkdtemp(join(tmpdir(), "arena-gen-"));
  await mkdir(join(root, "packages/bots"), { recursive: true });
  await mkdir(join(root, "prompts"), { recursive: true });
  await mkdir(join(root, "node_modules"), { recursive: true });
  await writeFile(join(root, "packages/bots/baseline.js"), "export function tick() { return { actions: { thrust: 1, turn: 0 }, memory: null }; }\n");
  await writeFile(join(root, "packages/bots/other-bot.js"), "export function tick() { return { actions: { thrust: 0, turn: 1 }, memory: null }; }\n");
  await writeFile(join(root, "bots.json"), JSON.stringify(catalog, null, 2) + "\n");
  await writeFile(join(root, "prompts/bot-task.md"), "Implement `{{id}}` for {{name}} ({{provider}}).\n");
  await writeFile(join(root, "AGENTS.md"), "# rules\n");
  await writeFile(join(root, ".gitignore"), "node_modules\nresults\nartifacts\n");
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed");
  return root;
}

test("the workspace holds Baseline and the new slot only, and the result is registered", async () => {
  const root = await repository();
  const workspaceRoot = join(root, "workspaces");
  let seen;
  const session = async ({ dir, prompt, transcript }) => {
    seen = { prompt, bots: await readdir(join(dir, "packages/bots")), catalog: JSON.parse(await readFile(join(dir, "bots.json"), "utf8")) };
    seen.manifest = JSON.parse(await readFile(join(dir, "match-luna-max.json"), "utf8"));
    seen.tracked = await readdir(dir);
    await writeFile(join(dir, "packages/bots/luna-max.js"), "export function tick() { return { actions: { thrust: 1, turn: 1 }, memory: null }; }\n");
    await mkdir(join(dir, "results/luna-max/iteration-1"), { recursive: true });
    await writeFile(join(dir, "results/luna-max/iteration-1/RESULTS.md"), "# results\n");
    const output = [
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, output_tokens: 7 } }),
      "",
    ].join("\n");
    await writeFile(transcript, output);
    return { version: "codex-cli 0.154.0", output };
  };
  const { manifest, entry } = await generateBot({
    root, harness: "codex", model: "gpt-5.6-luna", thinking: "max", name: "Luna", workspaceRoot, session, log: () => {}, mode: "host",
  });
  assert.deepEqual(seen.bots, ["baseline.js"]);
  assert.deepEqual(seen.catalog.map((b) => b.id), ["Baseline", "luna-max"]);
  assert.deepEqual(seen.manifest, ["luna-max", "Baseline"]);
  assert.ok(!seen.tracked.includes(".git"), "no history in the workspace");
  assert.ok(seen.tracked.includes("node_modules"), "dependencies are linked");
  assert.equal(seen.prompt, "Implement `luna-max` for Luna (OpenAI).\n");
  assert.equal(entry.file, "packages/bots/luna-max.js");
  const registered = JSON.parse(await readFile(join(root, "bots.json"), "utf8"));
  assert.deepEqual(registered.map((b) => b.id), ["other-bot", "Baseline", "luna-max"]);
  assert.deepEqual(registered.at(-1), { ...entry, provenance: "iterative" });
  const source = await readFile(join(root, "packages/bots/luna-max.js"), "utf8");
  assert.equal(manifest.codeSha256, sha256(source));
  assert.equal(manifest.turns, 2);
  assert.equal(manifest.inputTokens, 30);
  assert.equal(manifest.harnessVersion, "codex-cli 0.154.0");
  assert.match(manifest.isolation, /operator machine/);
  assert.equal(manifest.promptSha256, sha256("Implement `{{id}}` for {{name}} ({{provider}}).\n"));
  assert.equal(await readFile(join(root, "results/luna-max/iteration-1/RESULTS.md"), "utf8"), "# results\n");
  assert.equal(JSON.parse(await readFile(join(root, "generations/luna-max.json"), "utf8")).id, "luna-max");
  assert.deepEqual(await readdir(workspaceRoot), [], "the workspace is removed");
  await assert.rejects(
    generateBot({ root, harness: "codex", model: "m", thinking: "max", name: "Luna", workspaceRoot, session }),
    /already in bots.json/,
  );
  await rm(root, { recursive: true, force: true });
});

test("a session that leaves no controller fails and registers nothing", async () => {
  const root = await repository();
  await assert.rejects(
    generateBot({
      root, harness: "claude-code", model: "m", thinking: "max", name: "Nothing",
      workspaceRoot: join(root, "w"), session: async () => ({ version: "", output: "" }), log: () => {},
    }),
    /left no packages\/bots\/nothing-max.js/,
  );
  assert.equal((await readdir(join(root, "packages/bots"))).includes("nothing-max.js"), false);
  assert.equal(JSON.parse(await readFile(join(root, "bots.json"), "utf8")).length, 2);
  await rm(root, { recursive: true, force: true });
});

test("harness commands, catalog entries and transcripts", () => {
  const claude = harnessArgs({ harness: "claude-code", model: "claude-opus-5", thinking: "max", maxCost: 15 });
  assert.ok(claude.includes("--effort") && claude.includes("--max-budget-usd") && claude.includes("stream-json"));
  assert.ok(claude.includes("Bash(node *)") && !claude.includes("--dangerously-skip-permissions"));
  const codex = harnessArgs({ harness: "codex", model: "gpt-5.5", thinking: "xhigh" });
  assert.deepEqual(codex.slice(0, 3), ["exec", "--json", "--skip-git-repo-check"]);
  assert.ok(codex.includes(`model_reasoning_effort="xhigh"`));
  assert.throws(() => harnessArgs({ harness: "cursor" }), /Unknown harness/);
  assert.deepEqual(catalogEntry({ id: "x-max", name: "X", thinking: "max", harness: "claude-code" }), {
    id: "x-max", model: "X", thinking: "max", harness: "Claude Code", provider: "Anthropic", file: "packages/bots/x-max.js", provenance: "iterative",
  });
  assert.deepEqual(workspaceCatalog(catalog, { id: "n" }).map((b) => b.id), ["Baseline", "n"]);
  assert.equal(renderPrompt("{{id}} {{name}} {{provider}}", { id: "a", name: "b", provider: "c" }), "a b c");
  const claudeTranscript = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
    JSON.stringify({ type: "result", subtype: "success", num_turns: 12, total_cost_usd: 3.5, duration_ms: 6000, usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 } }),
  ].join("\n");
  assert.deepEqual(parseTranscript("claude-code", claudeTranscript), { turns: 12, inputTokens: 150, outputTokens: 20, cost: 3.5, durationMs: 6000 });
  assert.equal(
    progressLine("claude-code", JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "a.js" } }] } })),
    `[Write] {"file_path":"a.js"}`,
  );
  assert.equal(progressLine("codex", JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "node x.js" } })), "[command] node x.js");
  assert.equal(progressLine("codex", "not json"), "not json");
});
