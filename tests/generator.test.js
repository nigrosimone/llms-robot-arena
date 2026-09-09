import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRequest, inferModelProvider, parseCompletion, providerPresets, requestCompletion, resolveProvider,
} from "../packages/generator/providers.js";
import {
  botIdFromModel, buildInitialMessage, describeSeries, extractControllerSource, repairMessage,
} from "../packages/generator/prompt.js";
import { generateController } from "../packages/generator/generate.js";
import { catalogEntry, mergeCatalogEntry } from "../packages/generator/registry.js";
import { gateSource } from "../packages/generator/evaluate.js";

// The public minimal example from AGENTS.md; no bot implementation is read here.
const CONTROLLER = `export function tick(s, m) {
  const dx = s.opponent.x - s.self.x, dy = s.opponent.y - s.self.y;
  let err = Math.atan2(dy, dx) - s.self.heading;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  return { actions: { turn: Math.max(-1, Math.min(1, err * 1.5)), thrust: 0.5 }, memory: m };
}
`;
const reply = source => "Here it is:\n\n```js\n" + source + "```\n";
const verdict = (pass, name = "p99 tick time") => ({
  pass, eligible: pass, p99: 1,
  checks: [{ name: "Export tick · JS / TypeScript", pass: true }, { name, pass, detail: "too slow" }],
});

test("provider presets resolve endpoints, key variables and catalog vendors", () => {
  const provider = resolveProvider({ provider: "anthropic", env: { ANTHROPIC_API_KEY: " k " } });
  assert.deepEqual(
    [provider.api, provider.baseUrl, provider.apiKey], ["anthropic", "https://api.anthropic.com/v1", "k"],
  );
  assert.equal(resolveProvider({ provider: "ollama", env: {} }).apiKey, "");
  assert.equal(
    resolveProvider({ provider: "custom", baseUrl: "http://host/v1/", env: {} }).baseUrl, "http://host/v1",
  );
  assert.equal(
    resolveProvider({ provider: "openai", env: {}, requireKey: false }).maxTokensField,
    "max_completion_tokens",
  );
  assert.throws(() => resolveProvider({ provider: "openai", env: {} }), /OPENAI_API_KEY/);
  assert.throws(() => resolveProvider({ provider: "nope", env: {} }), /Unknown provider/);
  assert.throws(() => resolveProvider({ provider: "custom", env: {} }), /--base-url/);
  assert.equal(inferModelProvider(providerPresets.openrouter, "anthropic/claude-x"), "Anthropic");
  assert.equal(inferModelProvider({ label: "DeepSeek" }, "deepseek-chat"), "DeepSeek");
});

test("requests keep each wire format valid and never place a key in the body", () => {
  const openai = resolveProvider({ provider: "groq", env: { GROQ_API_KEY: "secret" } });
  const chat = buildRequest(openai, {
    model: "m", system: "sys", user: "task", temperature: 0.4, maxTokens: 900, reasoning: "high",
  });
  const chatBody = JSON.parse(chat.init.body);
  assert.equal(chat.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(chat.init.headers.authorization, "Bearer secret");
  assert.deepEqual(chatBody.messages.map(m => m.role), ["system", "user"]);
  assert.deepEqual(
    [chatBody.max_tokens, chatBody.temperature, chatBody.reasoning_effort], [900, 0.4, "high"],
  );
  assert.ok(!JSON.stringify(chatBody).includes("secret"));

  const anthropic = resolveProvider({ provider: "anthropic", env: { ANTHROPIC_API_KEY: "secret" } });
  const messages = buildRequest(anthropic, {
    model: "m", system: "sys", user: "task", temperature: 0.4, maxTokens: 900, reasoning: "max",
  });
  const body = JSON.parse(messages.init.body);
  assert.equal(messages.url, "https://api.anthropic.com/v1/messages");
  assert.equal(messages.init.headers["x-api-key"], "secret");
  assert.equal(body.system, "sys");
  assert.equal(body.thinking.budget_tokens, 24576);
  // Extended thinking fixes sampling and needs room beyond the reasoning budget.
  assert.equal(body.temperature, undefined);
  assert.ok(body.max_tokens > body.thinking.budget_tokens);
  assert.throws(() => buildRequest(anthropic, { model: "m", user: "t", reasoning: "turbo" }), /Unknown reasoning/);
  assert.throws(() => buildRequest(anthropic, { model: "", user: "t" }), /model name is required/);
});

test("replies are read from both formats and reasoning blocks are dropped", () => {
  const openai = resolveProvider({ provider: "groq", env: { GROQ_API_KEY: "k" } });
  assert.equal(
    parseCompletion(openai, { choices: [{ message: { content: "code" }, finish_reason: "stop" }] }).text, "code",
  );
  const anthropic = resolveProvider({ provider: "anthropic", env: { ANTHROPIC_API_KEY: "k" } });
  assert.equal(parseCompletion(anthropic, {
    content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "code" }],
    stop_reason: "end_turn",
  }).text, "code");
  assert.throws(() => parseCompletion(openai, { error: { message: "bad model" } }), /bad model/);
  assert.throws(() => parseCompletion(openai, { choices: [{ message: { content: " " } }] }), /no text/);
});

test("transient upstream failures are retried and permanent ones are reported", async () => {
  const provider = resolveProvider({ provider: "groq", env: { GROQ_API_KEY: "k" } });
  const responses = [
    { ok: false, status: 429, json: async () => ({ error: { message: "slow down" } }) },
    { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "code" } }] }) },
  ];
  const retries = [];
  const reply = await requestCompletion(provider, { model: "m", user: "task" }, {
    fetchImpl: async () => responses.shift(), wait: async () => {},
    onRetry: entry => retries.push(entry.reason),
  });
  assert.equal(reply.text, "code");
  assert.equal(retries.length, 1);
  await assert.rejects(requestCompletion(provider, { model: "m", user: "task" }, {
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "no" } }) }),
    wait: async () => {},
  }), /400/);
});

test("controller source is recovered from fenced, prefixed and bare replies", () => {
  assert.equal(extractControllerSource(reply(CONTROLLER)).trim(), CONTROLLER.trim());
  assert.equal(extractControllerSource(CONTROLLER).trim(), CONTROLLER.trim());
  assert.equal(
    extractControllerSource("```json\n{\"a\":1}\n```\n```js\n" + CONTROLLER + "```").trim(),
    CONTROLLER.trim(),
  );
  assert.throws(() => extractControllerSource("   "), /empty reply/);
  assert.throws(() => extractControllerSource("no code here"), /no tick/);
  assert.equal(botIdFromModel("Claude Opus 4.5", "max"), "claude-opus-4-5-max");
  assert.throws(() => botIdFromModel("***"), /--id/);
});

test("the first prompt carries the rules and the requested language", () => {
  const message = buildInitialMessage({ spec: "RULES BODY", language: "ts", brief: "prefer defence" });
  assert.ok(message.includes("RULES BODY"));
  assert.ok(message.includes("TypeScript"));
  assert.ok(message.includes("prefer defence"));
  assert.throws(() => buildInitialMessage({ spec: " " }), /empty/);
});

test("a one-shot run stops at the first conforming controller", async () => {
  const result = await generateController({
    spec: "RULES", complete: async () => reply(CONTROLLER), gate: async () => verdict(true),
  });
  assert.equal(result.source.trim(), CONTROLLER.trim());
  assert.deepEqual([result.provenance, result.requests], ["one-shot", 1]);
});

test("gate failures are fed back as repairs and relabel the run as iterative", async () => {
  const sent = [];
  const gates = [verdict(false, "Valid actions"), verdict(true)];
  const result = await generateController({
    spec: "RULES",
    complete: async ({ messages }) => {
      sent.push(messages.at(-1).content);
      return reply(CONTROLLER);
    },
    gate: async () => gates.shift(),
  });
  assert.equal(result.requests, 2);
  assert.equal(result.provenance, "iterative");
  assert.ok(sent[1].includes("Valid actions"));
  assert.equal(result.history.length, 2);
});

test("an exhausted attempt budget reports the last gate instead of writing a controller", async () => {
  await assert.rejects(generateController({
    spec: "RULES", attempts: 2, complete: async () => reply(CONTROLLER),
    gate: async () => verdict(false, "Valid actions"),
  }), /No conforming controller after 2 attempts[\s\S]*Valid actions/);
  await assert.rejects(generateController({
    spec: "RULES", attempts: 1, complete: async () => "I cannot help with that.",
    gate: async () => verdict(true),
  }), /no tick implementation/);
});

test("improvement rounds keep the best scoring controller and only report public outcomes", async () => {
  const sources = [reply("export function tick(a, b) { return 1; } // first"),
    reply("export function tick(a, b) { return 2; } // better"),
    reply("export function tick(a, b) { return 3; } // worse")];
  const scores = [0.4, 0.75, 0.1];
  const sent = [];
  const series = score => ({
    matches: 2, wins: score > 0.5 ? 2 : 0, draws: 0, losses: score > 0.5 ? 0 : 2,
    score, beatsOpponent: score > 0.5, violations: 0,
    records: [{
      seed: 0, mirrored: false, score, reason: "ring-out", ticks: 100,
      flips: [0, 1], energy: [50, 10], centerDistance: [1, 2], violations: [0, 0],
    }],
  });
  const result = await generateController({
    spec: "RULES", rounds: 2, opponentId: "Baseline",
    complete: async ({ messages }) => {
      sent.push(messages.at(-1).content);
      return sources.shift();
    },
    gate: async () => verdict(true),
    // The opponent implementation never reaches the generator: only match outcomes do.
    evaluate: async () => series(scores.shift()),
  });
  assert.ok(result.source.includes("better"));
  assert.equal(result.series.score, 0.75);
  assert.equal(result.provenance, "iterative");
  assert.ok(sent[1].includes("Result against Baseline"));
  assert.ok(sent.every(message => !message.includes("OPPONENT INTERNALS")));
  assert.equal(result.history.filter(entry => entry.series).length, 3);
});

test("series feedback stays within public match data", () => {
  const text = describeSeries({
    matches: 1, wins: 1, draws: 0, losses: 0, score: 1, beatsOpponent: true,
    records: [{
      seed: 3, mirrored: true, score: 1, reason: "flip", ticks: 42,
      flips: [0, 2], energy: [12.345, 0], centerDistance: [1.234, 5], violations: [0, 0],
    }],
  }, { opponentId: "Baseline" });
  assert.match(text, /seed 3 mirrored: win by flip after 42 ticks/);
  assert.match(text, /energy 12.3/);
  assert.ok(repairMessage(verdict(false, "Pure function")).includes("Pure function"));
});

test("registration updates a single catalog entry and rejects colliding paths", () => {
  const catalog = [
    { id: "a", model: "A", thinking: null, harness: null, provider: null, file: "packages/bots/a.js" },
    { id: "b", model: "B", thinking: null, harness: null, provider: null, file: "packages/bots/b.js" },
  ];
  const entry = catalogEntry({
    id: "c", model: "C Model", provider: "OpenAI", thinking: "high", harness: "Bot generator CLI",
    file: "packages/bots/c.js", provenance: "iterative",
  });
  const added = mergeCatalogEntry(catalog, entry);
  assert.equal(added.length, 3);
  assert.deepEqual(Object.keys(added[2]), ["id", "model", "thinking", "harness", "provider", "file", "provenance"]);
  const replaced = mergeCatalogEntry(added, { ...entry, model: "C Model 2" });
  assert.equal(replaced.length, 3);
  assert.equal(replaced[2].model, "C Model 2");
  assert.deepEqual(replaced.slice(0, 2), catalog);
  assert.throws(() => mergeCatalogEntry(catalog, { ...entry, file: "packages/bots/a.js" }), /belongs to bot "a"/);
  assert.throws(() => mergeCatalogEntry(catalog, { ...entry, file: "bots/c.js" }), /Catalog files/);
});

test("generated sources are admitted by the real conformity gate", async () => {
  const good = await gateSource(CONTROLLER, "fuel");
  assert.equal(good.eligible, true);
  const bad = await gateSource("export function tick() { return { actions: { thrust: NaN, turn: 0 } }; }\n", "fuel");
  assert.equal(bad.eligible, false);
  assert.ok(repairMessage(bad).includes("FAILED"));
});
