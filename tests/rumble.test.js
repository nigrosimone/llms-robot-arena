import test from "node:test";
import assert from "node:assert/strict";
import { createMatch as createEngineMatch, step, sensorsFor, closeReplay, digest } from "../packages/sim/index.js";
import { SPEC as S } from "../packages/sim/spec.js";
import { parseReplay, stringifyReplay } from "../packages/sim/replay.js";
import { samplePlayback } from "../packages/renderer/playback.js";

const refs = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: "bot-" + i,
    model: "fixture",
    codeSha256: digest("bot-" + i),
  }));
const createMatch = (n, seed = 0) =>
  Object.assign(createEngineMatch(seed, false, refs(n)), { cells: [] });
const idle = (n) => Array.from({ length: n }, () => ({ actions: { thrust: 0, turn: 0 } }));

test("a rumble spawns the whole roster on one circle, away from the center", () => {
  const m = createMatch(6);
  assert.equal(m.robots.length, 6);
  assert.equal(m.violations.length, 6);
  for (const r of m.robots) {
    const radius = Math.hypot(r.x, r.y);
    assert.ok(radius > 5.5 && radius < 8, `spawn radius ${radius}`);
  }
  for (let i = 0; i < 6; i++)
    for (let j = i + 1; j < 6; j++)
      assert.ok(Math.hypot(m.robots[i].x - m.robots[j].x, m.robots[i].y - m.robots[j].y) > 1.5);
});

test("the closest live rival is reported as the opponent, eliminated robots are skipped", () => {
  const m = createMatch(4);
  Object.assign(m.robots[0], { x: 0, y: 0 });
  Object.assign(m.robots[1], { x: 1, y: 0 });
  Object.assign(m.robots[2], { x: 3, y: 0 });
  Object.assign(m.robots[3], { x: 6, y: 0 });
  assert.equal(sensorsFor(m, 0).opponent.x, 1);
  assert.equal(sensorsFor(m, 0).opponents.length, 3);
  m.robots[1].status = "out";
  assert.equal(sensorsFor(m, 0).opponent.x, 3);
});

test("a fall eliminates one robot and the rumble continues to the last standing", () => {
  const m = createMatch(3);
  m.robots[0].x = 8.1;
  step(m, idle(3));
  assert.equal(m.result, null);
  assert.equal(m.robots[0].status, "out");
  assert.deepEqual(
    m.events.filter((e) => e.type === "eliminated").map((e) => [e.robot, e.reason]),
    [[0, "ring-out"]],
  );
  m.robots[1].flipsTaken = S.FLIPS_TO_LOSE;
  step(m, idle(3));
  assert.equal(m.result.winner, 2);
  assert.equal(m.result.reason, "flips");
  assert.deepEqual(m.result.standings, [2, 1, 0]);
});

test("an eliminated robot stops moving, stops colliding and keeps a frozen frame", () => {
  const m = createMatch(3);
  m.robots[0].x = 8.1;
  step(m, idle(3));
  const parked = { ...m.robots[0] };
  Object.assign(m.robots[1], { x: parked.x, y: parked.y, heading: 0 });
  const drive = idle(3);
  drive[0] = { actions: { thrust: 1, turn: 1 } };
  step(m, drive);
  assert.equal(m.robots[0].x, parked.x);
  assert.equal(m.robots[0].energy, parked.energy);
  assert.equal(m.frames.slice(-18)[4], 3, "packed status is out");
});

test("a rumble replay round trips and plays back one state per robot", () => {
  const m = createEngineMatch(11, false, refs(5));
  while (!m.result) step(m, idle(5));
  const replay = closeReplay(m, "rumble");
  const parsed = parseReplay(stringifyReplay(replay));
  assert.equal(parsed.bots.length, 5);
  assert.equal(parsed.frames.length, parsed.result.ticks * 30);
  assert.equal(parsed.result.standings.length, 5);
  const sample = samplePlayback(parsed, parsed.result.ticks / 120);
  assert.equal(sample.states.length, 5);
});

test("a duel is unchanged: it ends on the first fall, with no standings", () => {
  const m = createMatch(2);
  m.robots[0].x = 8.1;
  step(m, idle(2));
  assert.equal(m.result.winner, 1);
  assert.equal(m.result.reason, "ring-out");
  assert.equal(m.result.standings, undefined);
  assert.equal(m.robots[0].status, "active");
  assert.equal(sensorsFor(m, 0).opponents, undefined);
});
