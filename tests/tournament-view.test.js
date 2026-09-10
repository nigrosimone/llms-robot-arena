import test from "node:test";
import assert from "node:assert/strict";
import { nothing } from "lit-html";
import {
  rankingTemplate, styleTemplate, indexTemplate, codeTemplate, matchesTemplate,
} from "../packages/viewer/tournament-view.js";

// A lit template is data until something renders it, so it can be inspected
// here without a DOM: the text is what the bindings would put on the page, the
// handlers are the listeners the rows carry.
function collect(node, out = { text: "", handlers: [] }) {
  if (node == null || node === nothing) return out;
  if (typeof node === "function") {
    out.handlers.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return out;
  }
  if (node.strings && node.values) {
    node.strings.forEach((chunk, i) => {
      out.text += chunk;
      if (i < node.values.length) collect(node.values[i], out);
    });
    return out;
  }
  out.text += String(node);
  return out;
}

const style = () => ({
  closingShare: 0.4, approachSpeed: 0.6, facingShare: 0.6, proximityShare: 0.5,
  contactShare: 0.2, engagementRate: 7, wedgeShare: 0.66, speed: 1.2,
  turnRate: 0.6, idleShare: 0.2, edgeShare: 0.03, spendRate: 13, recharges: 4, burns: 0,
});
const code = () => ({
  language: "js", bytes: 2048, lines: 40, codeLines: 30, commentLines: 6,
  blankLines: 4, functions: 3, statements: 35, complexity: 12, maxDepth: 3,
});
const report = (overrides = {}) => ({
  format: "round-robin",
  status: "complete",
  totalMatches: 2,
  generatedAt: "2026-01-02T03:04:05.000Z",
  bots: [
    { id: "alpha", model: "Alpha 1", provider: "OpenAI", code: code() },
    { id: "beta", model: "Beta 2", provider: "Anthropic", code: code() },
  ],
  records: [
    { a: 0, b: 1, seed: 4, mirrored: false, score: 1, reason: "ring-out", ticks: 600, firstContact: 100, round: 1 },
    { a: 0, b: 1, seed: 7, mirrored: true, score: 0.5, reason: "timeout", ticks: 7200, firstContact: 60, round: 2 },
  ],
  ranking: [
    {
      id: "alpha", model: "Alpha 1", provider: "OpenAI", score: 120, ci: [100, 140],
      matches: 2, wins: 1, draws: 1, winRate: 0.75, flipDifferential: 1,
      ringOutsInflicted: 1, ringOutsTaken: 0, meanEnergy: 100, meanFirstContactTick: 120,
      violationsPerMatch: 0, timeouts: 0, style: style(),
    },
    {
      id: "beta", model: "Beta 2", provider: "Anthropic", score: 80, ci: [60, 100],
      matches: 2, wins: 0, draws: 1, winRate: 0.25, flipDifferential: -1,
      ringOutsInflicted: 0, ringOutsTaken: 1, meanEnergy: 90, meanFirstContactTick: null,
      violationsPerMatch: 0.5, timeouts: 1, style: style(),
    },
  ],
  ...overrides,
});

test("the ranking names the run it is showing and formats every column", () => {
  const { text } = collect(rankingTemplate(report()));
  assert.match(text, /Final ranking/);
  assert.match(text, /2 \/ 2 MATCHES · ROUND ROBIN · COMPLETE/);
  for (const value of ["Alpha 1", "Beta 2", "120.0", "100.0 – 140.0", "75.0", "1 / 1 / 0", "2.0 s", "0.50"])
    assert.ok(text.includes(value), value);
  // A controller that never made contact has no mean to show.
  assert.ok(text.includes("—"), "missing values stay a dash");
  const published = collect(rankingTemplate(report({ published: true }))).text;
  assert.match(published, /Published standings/);
  assert.match(published, /PUBLISHED · 2 MATCHES · ROUND ROBIN · 2026-01-02/);
  assert.match(collect(rankingTemplate(report({ status: "running" }))).text, /Provisional ranking/);
});

test("play style, craft index and source metrics appear only when they can be measured", () => {
  const full = report();
  assert.match(collect(styleTemplate(full)).text, /Play style/);
  assert.match(collect(indexTemplate(full)).text, /Craft index/);
  assert.match(collect(codeTemplate(full)).text, /Implementation/);
  const noStyle = report();
  delete noStyle.ranking[1].style;
  assert.equal(styleTemplate(noStyle), nothing);
  const noCode = report();
  noCode.bots = noCode.bots.map(({ code, ...bot }) => bot);
  assert.equal(indexTemplate(noCode), nothing);
  assert.equal(codeTemplate(noCode), nothing);
});

test("the completed matches are newest first and each row watches its own replay", () => {
  const watched = [];
  const full = report();
  const { text, handlers } = collect(matchesTemplate(full, (i) => watched.push(i)));
  assert.match(text, /Completed matches/);
  assert.ok(text.includes("Draw"), "a drawn match says so");
  assert.ok(text.includes("Alpha 1 wins"), "a decided match names the winner");
  assert.ok(text.includes("02:00"), "match time is mm:ss");
  assert.equal(handlers.length, full.records.length);
  handlers[0]();
  assert.deepEqual(watched, [full.records.length - 1], "the first row is the last match played");
  assert.equal(matchesTemplate(report({ records: [] }), () => {}), nothing);
});
