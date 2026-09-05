import test from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { botCatalog, validateBotDefinitions, botName, botProvider, botMetadata } from "../packages/bot-catalog.js";
import { resolveBotDefinitions, projectRoot } from "../packages/bot-catalog-node.js";
import { runMatch } from "../packages/runtime/match.js";
import { parseReplay, stringifyReplay } from "../packages/sim/replay.js";
import { rankTournament, matchRecord } from "../packages/tournament/ranking.js";
import { renderCSV, renderReport } from "../packages/tournament/report.js";

const pair = () => [
  { id: "alpha", model: "Alpha Model", provider: "OpenAI", thinking: "ultra", harness: "Codex", file: "packages/bots/alpha.js", provenance: "iterative" },
  { id: "beta", model: "Beta Model", provider: "Anthropic", thinking: "max", harness: "Claude Code", file: "packages/bots/beta.ts" },
];

test("registered files exist and ID selections resolve from any manifest directory without reading sources", async () => {
  const entries = resolveBotDefinitions(botCatalog.map(bot => bot.id), dirname(projectRoot));
  assert.equal(entries.length, botCatalog.length);
  for (const [i, entry] of entries.entries()) {
    assert.deepEqual(entry, { ...botCatalog[i], file: resolve(projectRoot, botCatalog[i].file) });
    assert.ok((await stat(entry.file)).isFile());
  }
});

test("catalog validation rejects duplicates, missing metadata and paths outside the bot directory", () => {
  assert.doesNotThrow(() => validateBotDefinitions(pair(), { catalog: true }));
  for (const mutate of [
    bots => { bots[1].id = bots[0].id; },
    bots => { bots[1].file = bots[0].file; },
    bots => { bots[0].model = " "; },
    bots => { delete bots[0].provider; },
    bots => { bots[0].provider = 42; },
    bots => { delete bots[0].thinking; },
    bots => { bots[0].thinking = 42; },
    bots => { delete bots[0].harness; },
    bots => { bots[0].harness = " "; },
    bots => { bots[0].file = "packages/bots/../private.js"; },
    bots => { bots[0].file = "packages/bots/alpha.js?raw"; },
  ]) {
    const bots = pair();
    mutate(bots);
    assert.throws(() => validateBotDefinitions(bots, { catalog: true }));
  }
});

test("manifests mix catalog IDs with custom definitions and retain legacy object support", () => {
  const external = resolve(projectRoot, "external-manifests");
  const custom = { id: "custom", model: "Custom Model", file: "./controller.ts" };
  const entries = resolveBotDefinitions([botCatalog[0].id, custom], external);
  assert.equal(entries[0].file, resolve(projectRoot, botCatalog[0].file));
  assert.equal(entries[1].file, resolve(external, "controller.ts"));
  assert.throws(() => resolveBotDefinitions(["missing-id", custom], external), /Unknown catalog bot/);
  assert.throws(() => resolveBotDefinitions([botCatalog[0].id, botCatalog[0].id]), /unique/);
  assert.throws(() => resolveBotDefinitions([custom, { ...custom, id: "empty", file: " " }]), /non-empty/);
});

test("display names use catalog metadata for legacy replays and recorded metadata for new replays", () => {
  const registered = botCatalog[0];
  const legacy = { id: registered.id, model: "Old display name" };
  assert.equal(botName(legacy), registered.model);
  assert.equal(botProvider(legacy), registered.provider);
  const recorded = { ...legacy, model: "Archived Model", provider: "Archived Provider" };
  assert.equal(botName(recorded), "Archived Model");
  assert.equal(botProvider(recorded), "Archived Provider");
  assert.equal(botName({ id: "opaque-slug" }), "Unnamed controller");
  assert.equal(botProvider({ id: "ref", model: "Reference", provider: null, provenance: "reference" }), "Reference controller");
});

async function inertMatch(bots) {
  let closed = 0;
  const replay = await runMatch({
    bots: bots.map(bot => ({ ...bot, source: "public inert test fixture" })),
    createClient: () => ({
      async request(message) {
        return message.type === "init" ? {} : {
          actions: { thrust: 0, turn: 0 }, memory: "null", violations: [],
        };
      },
      close() { closed++; },
    }),
  });
  assert.equal(closed, 2);
  return replay;
}

test("model, thinking, harness and provenance survive exports without changing physics or hashes", async () => {
  const bots = pair();
  const replay = await inertMatch(bots);
  const renamed = await inertMatch(bots.map(bot => ({ ...bot, model: "Renamed Model", provider: "Another Provider" })));
  assert.deepEqual(replay.frames, renamed.frames);
  assert.deepEqual(replay.stateHashes, renamed.stateHashes);
  assert.deepEqual(replay.result, renamed.result);
  const parsed = parseReplay(stringifyReplay(replay));
  for (const [i, bot] of parsed.bots.entries()) {
    assert.deepEqual(bot, { ...botMetadata(bots[i]), codeSha256: bot.codeSha256 });
    assert.match(bot.codeSha256, /^[a-f0-9]{64}$/);
  }
  const records = [matchRecord(parsed, 0, 1)];
  const ranking = rankTournament(parsed.bots, records, 10);
  for (const row of ranking) {
    const bot = bots.find(bot => bot.id === row.id);
    assert.equal(row.model, bot.model);
    assert.equal(row.provider, bot.provider);
    assert.equal(row.thinking, bot.thinking);
    assert.equal(row.harness, bot.harness);
  }
  const report = renderReport({
    bots: parsed.bots, ranking, records, gates: [{ id: "alpha", pass: true, p99: 0.1 }],
    mode: "exhibition", budgetMode: "fuel", replicates: 10,
  });
  assert.match(report, /Alpha Model \| OpenAI \| ultra \| Codex \| iterative \| alpha/);
  assert.match(report, /Alpha Model \| PASS/);
  const csv = renderCSV(ranking);
  assert.match(csv, /^id,model,provider,thinking,harness,provenance,/);
  assert.match(csv, /"Alpha Model","OpenAI","ultra","Codex","iterative"/);
  const legacy = JSON.parse(stringifyReplay(replay));
  legacy.bots.forEach(bot => { delete bot.provider; delete bot.provenance; delete bot.thinking; delete bot.harness; });
  assert.doesNotThrow(() => parseReplay(JSON.stringify(legacy)));
  legacy.bots[0].provider = { invalid: true };
  assert.throws(() => parseReplay(JSON.stringify(legacy)), /bot metadata/);
  for (const key of ["thinking", "harness"]) {
    const invalid = JSON.parse(stringifyReplay(replay));
    invalid.bots[0][key] = { invalid: true };
    assert.throws(() => parseReplay(JSON.stringify(invalid)), /bot metadata/);
  }
});
