import test from "node:test";
import assert from "node:assert/strict";
import { exhibitionSchedule, runExhibition } from "../packages/tournament/exhibition.js";
import { renderCSV, renderReport } from "../packages/tournament/report.js";

test("quick schedules are repeatable, mirrored and balanced without repeat opponents", () => {
  for (let count = 2; count <= 16; count++) {
    const schedule = exhibitionSchedule(count);
    assert.deepEqual(schedule, exhibitionSchedule(count));
    const opponents = Array.from({ length: count }, () => new Set());
    for (let i = 0; i < schedule.matches.length; i += 2) {
      const a = schedule.matches[i], b = schedule.matches[i + 1];
      assert.deepEqual(b, { ...a, mirrored: true });
      assert.equal(a.mirrored, false);
      assert.ok(a.a < a.b && a.b < count);
      assert.ok(!opponents[a.a].has(a.b));
      opponents[a.a].add(a.b);
      opponents[a.b].add(a.a);
    }
    const played = opponents.map(set => set.size);
    assert.ok(Math.max(...played) - Math.min(...played) <= 1);
    assert.ok(Math.min(...played) >= 1);
    for (let round = 1; round <= schedule.rounds; round++) {
      const participants = schedule.matches.filter(m => m.round === round && !m.mirrored)
        .flatMap(m => [m.a, m.b]);
      assert.equal(new Set(participants).size, participants.length);
      assert.equal(participants.length, count - count % 2);
    }
  }
  assert.equal(exhibitionSchedule(6).matches.length, 18);
});

test("full round robin retains all 10 mirrored seeds for every pair", () => {
  for (const count of [2, 5, 6]) {
    const schedule = exhibitionSchedule(count, "round-robin");
    assert.equal(schedule.matches.length, count * (count - 1) / 2 * 20);
    for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) {
      const games = schedule.matches.filter(m => m.a === a && m.b === b);
      assert.equal(new Set(games.map(m => `${m.seed}/${m.mirrored}`)).size, 20);
    }
  }
  assert.throws(() => exhibitionSchedule(1));
  assert.throws(() => exhibitionSchedule(6, "unknown"));
});

const bots = ["a", "b", "c", "d"].map(id => ({ id, model: id, source: "public inert test fixture" }));
const replayFor = ({ bots, seed, mirrored }) => ({
  bots, seed, mirrored, result: { winner: mirrored ? 1 : 0, ticks: 60, reason: "timeout" },
  finalStates: [0, 1].map(() => ({ flipsTaken: 0, energy: 100, x: 0, y: 0 })),
  violations: [0, 0], events: [], frames: new Float32Array(12), arenaExtents: new Float32Array([8]),
});

test("each finished match streams a replay and cumulative ranking before the next match", async () => {
  const updates = [];
  let started = 0;
  const report = await runExhibition({ bots,
    onUpdate(update) { updates.push(update); },
    async matchRunner(options) {
      const last = updates.filter(u => u.type === "tournament-update").at(-1);
      assert.equal(last.report.records.length, started++);
      assert.equal(last.report.status, "running");
      options.onProgress(0.5);
      return replayFor(options);
    },
  });
  const completed = updates.filter(u => u.replay);
  assert.equal(completed.length, 12);
  assert.deepEqual(completed.map(u => u.report.records.length), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(completed[0].report.ranking.reduce((sum, r) => sum + r.matches, 0), 2);
  assert.equal(report.status, "complete");
  assert.equal(report.records.length, report.totalMatches);
  assert.equal(report.replicates, 0);
  assert.ok(report.ranking.every(r => r.ci === null && r.matches === 6));
  assert.ok(report.bots.every(b => !Object.hasOwn(b, "source") && /^[a-f0-9]{64}$/.test(b.codeSha256)));
  assert.doesNotThrow(() => renderCSV(report.ranking));
  assert.match(renderReport(report), /Quick rounds/);
  assert.match(renderReport({ ...completed[0].report, status: "cancelled" }), /\*\*Status:\*\* cancelled/);
});

test("execution errors leave earlier published results intact", async () => {
  let last, calls = 0;
  await assert.rejects(runExhibition({ bots,
    onUpdate(update) { if (update.report) last = update.report; },
    async matchRunner(options) {
      if (++calls === 2) throw Error("Interrupted");
      return replayFor(options);
    },
  }), /Interrupted/);
  assert.equal(last.records.length, 1);
  assert.equal(last.ranking.reduce((sum, r) => sum + r.matches, 0), 2);
});

test("full tournaments compute confidence intervals only after all mirrored seeds finish", async () => {
  const report = await runExhibition({ bots: bots.slice(0, 2), format: "round-robin",
    onUpdate(update) {
      if (update.report) assert.ok(update.report.ranking.every(r => r.ci === null));
    },
    async matchRunner(options) { return replayFor(options); },
  });
  assert.equal(report.records.length, 20);
  assert.equal(report.replicates, 1000);
  assert.ok(report.ranking.every(r => r.ci.length === 2 && r.ci.every(Number.isFinite)));
});
