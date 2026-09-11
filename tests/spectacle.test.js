import test from "node:test";
import assert from "node:assert/strict";
import { matchSpectacle, highlights, highlightLabel } from "../packages/tournament/spectacle.js";

const record = (a, b, seed, { flips = [0, 0], rate = 0, ticks = 3600, score = 1, reason = "ring-out" } = {}) => ({
  a, b, seed, mirrored: false, score, reason, ticks, flips,
  style: [{ engagementRate: rate }, { engagementRate: rate }],
});
const bots = [{ id: "x", model: "X" }, { id: "y", model: "Y" }, { id: "z", model: "Z" }];

test("flips order first, engagements break the ties", () => {
  assert.deepEqual(matchSpectacle(record(0, 1, 0, { flips: [1, 1], rate: 6, ticks: 7200 })), { flips: 2, engagements: 12, index: 2012 });
  assert.deepEqual(matchSpectacle(record(0, 1, 0, { rate: 30, ticks: 7200 })), { flips: 0, engagements: 60, index: 60 });
  assert.deepEqual(matchSpectacle({ ticks: 600, flips: [0, 1] }), { flips: 1, engagements: 0, index: 1000 });
});

test("highlights rank the report and carry what a simulation needs", () => {
  const report = {
    bots,
    records: [
      record(0, 1, 3, { rate: 30, ticks: 7200 }),
      record(1, 2, 5, { flips: [0, 1], rate: 2, score: 0.5, reason: "timeout" }),
      record(0, 2, 7, { flips: [1, 1], rate: 1 }),
      record(0, 1, 9),
    ],
  };
  const rows = highlights(report);
  assert.deepEqual(rows.map((h) => [h.a, h.b, h.seed, h.flips, h.engagements]), [["x", "z", 7, 2, 1], ["y", "z", 5, 1, 2], ["x", "y", 3, 0, 60]]);
  assert.equal(rows[1].winner, null);
  assert.equal(rows[0].winner, "x");
  assert.deepEqual(highlightLabel(report, rows[0]), { match: "X vs Z", result: "X wins", search: "?a=x&b=z&seed=7&spawn=normal" });
  assert.deepEqual(highlights({ ...report, highlights: [{ a: "y", b: "z", seed: 1 }] }, 5), [{ a: "y", b: "z", seed: 1 }]);
  assert.deepEqual(highlights({ ranking: [] }), []);
  assert.deepEqual(highlights({ bots, records: [{ a: 0, b: 9, seed: 1, ticks: 60, flips: [1, 0] }] }), []);
});
