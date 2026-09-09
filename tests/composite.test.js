import test from "node:test";
import assert from "node:assert/strict";
import { compositeIndex, INDEX_TERMS } from "../packages/tournament/composite.js";

const code = { codeLines: 100, complexity: 40, functions: 4, maxDepth: 4 };
const report = {
  bots: [{ id: "a", code }, { id: "b", code: { ...code, codeLines: 400, complexity: 400, maxDepth: 12 } }],
  ranking: [
    { id: "a", score: 150, ci: [140, 160], violationsPerMatch: 0 },
    { id: "b", score: 50, ci: [10, 90], violationsPerMatch: 0 },
  ],
  records: [
    { a: 0, b: 1, score: 1, reason: "ring-out", firstContact: 100 },
    { a: 0, b: 1, score: 1, reason: "hole", firstContact: null },
  ],
};

test("scores the leader higher and keeps every term visible", () => {
  const [first, second] = compositeIndex(report);
  assert.equal(first.id, "a");
  assert.ok(first.index > second.index);
  assert.equal(first.terms.strength, 1);
  assert.equal(first.terms.reliability, 1);
  assert.deepEqual(Object.keys(first.terms), INDEX_TERMS.map((t) => t.key));
  assert.ok(first.index > 0 && first.index <= 100);
});

test("a loss without any contact counts against reliability", () => {
  const [, second] = compositeIndex(report);
  assert.equal(second.terms.reliability, 0.5);
});

test("violations count against reliability as well", () => {
  const [first] = compositeIndex({
    ...report,
    ranking: [{ ...report.ranking[0], violationsPerMatch: 0.25 }, report.ranking[1]],
  });
  assert.equal(first.terms.reliability, 0.75);
});

test("quick rounds without intervals drop the consistency term", () => {
  const [first] = compositeIndex({
    ...report,
    ranking: report.ranking.map((row) => ({ ...row, ci: null })),
  });
  assert.equal(first.terms.consistency, null);
  assert.equal(first.index, 100);
});

test("no source metrics means no index", () => {
  assert.equal(compositeIndex({ ...report, bots: [{ id: "a" }, { id: "b" }] }), null);
  assert.equal(compositeIndex({ ranking: [] }), null);
});
