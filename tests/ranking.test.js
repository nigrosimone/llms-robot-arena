import test from "node:test";
import assert from "node:assert/strict";
import {
  bradleyTerry,
  rankTournament,
} from "../packages/tournament/ranking.js";
test("symmetric outcomes have equal finite Bradley–Terry strengths", () => {
  const out = bradleyTerry(2, [
    { a: 0, b: 1, score: 1 },
    { a: 0, b: 1, score: 0 },
  ]);
  assert.deepEqual(out, [100, 100]);
  const separation = bradleyTerry(
    2,
    Array.from({ length: 20 }, () => ({ a: 0, b: 1, score: 1 })),
  );
  assert.ok(separation.every(Number.isFinite));
  assert.ok(separation[0] > separation[1]);
});
test("bootstrap is seeded, retains swapped seed clusters, and reports real metrics", () => {
  const bots = [{ id: "a" }, { id: "b" }];
  const records = Array.from({ length: 20 }, (_, i) => ({
    a: 0,
    b: 1,
    seed: i >> 1,
    mirrored: !!(i % 2),
    score: i % 2,
    reason: "timeout",
    flips: [0, 0],
    energy: [70, 80],
    violations: [0, 0],
    ringOuts: [0, 0],
    firstContact: 180,
  }));
  const result = rankTournament(bots, records);
  assert.deepEqual(result, rankTournament(bots, records));
  assert.equal(result[0].score, 100);
  assert.deepEqual(result[0].ci, [100, 100]);
  assert.equal(result[0].matches, 20);
  assert.equal(result[0].meanFirstContactTick, 180);
  assert.equal(result[0].timeouts, 20);
});
