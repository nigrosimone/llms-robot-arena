import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch as createEngineMatch,
  step,
  sensorsFor,
  closeReplay,
  digest,
  publicRobot,
} from "../packages/sim/index.js";
import { SPEC as S, halfExtent } from "../packages/sim/spec.js";
import { contact, resolveContact } from "../packages/sim/collision.js";
import { parseReplay, stringifyReplay } from "../packages/sim/replay.js";
const idle = () => [
  { actions: { thrust: 0, turn: 0 } },
  { actions: { thrust: 0, turn: 0 } },
];
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
// Isolate mechanics here; the terrain integration is covered in terrain.test.js.
const createMatch = (...args) => Object.assign(createEngineMatch(...args), { cells: [] });
test("spawn is seeded, swapping exchanges the exact poses; snapshots are independent", () => {
  const a = createMatch(4),
    b = createMatch(4, true);
  assert.deepEqual(a.robots[0], b.robots[1]);
  assert.deepEqual(a.robots[1], b.robots[0]);
  assert.deepEqual(a, createMatch(4));
  assert.notDeepEqual(a.robots, createMatch(5).robots);
  const s = sensorsFor(a, 0);
  s.self.energy = 7;
  assert.equal(a.robots[0].energy, S.ENERGY_MAX);
  assert.deepEqual(sensorsFor(a, 0).opponent, sensorsFor(a, 1).self);
});
test("arena follows the shrinking formula and reaches 3.8 m at the time limit", () => {
  assert.equal(halfExtent(60), 8);
  near(halfExtent(120), 3.8);
  assert.equal(halfExtent(200), 3);
});
test("semi-implicit integration uses the updated velocity", () => {
  const m = createMatch(0);
  Object.assign(m.robots[0], { x: 0, y: 0, heading: 0 });
  step(m, [{ actions: { thrust: 1, turn: 0 } }, idle()[1]]);
  near(m.robots[0].vx, 8 / 60);
  near(m.robots[0].x, 8 / 3600);
  near(m.robots[0].energy, S.ENERGY_MAX - 9 / 60 - 0.5 / 60);
});
test("lateral grip removes 85 percent after drag", () => {
  const m = createMatch(0);
  Object.assign(m.robots[0], { x: 0, y: 0, heading: 0, vy: 2 });
  step(m, idle());
  near(m.robots[0].vy, 2 * (1 - 1.6 / 60) * 0.15);
});
test("insufficient energy scales both commands by the same linear factor", () => {
  const m = createMatch(0);
  Object.assign(m.robots[0], { x: 0, y: 0, heading: 0, energy: 0.05 });
  step(m, [{ actions: { thrust: 1, turn: 1 } }, idle()[1]]);
  assert.equal(m.robots[0].energy, 0);
  near(m.robots[0].omega, (45 * 0.25) / S.ROBOT_INERTIA / 60);
  near(m.robots[0].x, (8 * 0.25) / 3600);
});
test("zero energy disables motors and never regenerates off a recharge cell", () => {
  const m = createMatch(0);
  m.robots[0].energy = 0;
  for (let i = 0; i < 600; i++)
    step(m, [{ actions: { thrust: 1, turn: 1 } }, idle()[1]]);
  assert.equal(m.robots[0].energy, 0);
  assert.equal(m.robots[0].vx, 0);
  assert.equal(m.robots[0].omega, 0);
  assert.equal(m.result, null);
});
test("idle energy decreases only by passive drain", () => {
  const m = createMatch(0);
  m.robots[0].energy = 50;
  for (let i = 0; i < 600; i++) step(m, idle());
  near(m.robots[0].energy, 50 - S.K_IDLE * 10);
});
test("all bots start with the larger energy reserve", () => {
  const m = createMatch(0);
  assert.equal(S.ENERGY_MAX, 300);
  assert.deepEqual(m.robots.map(r => r.energy), [300, 300]);
});
test("SAT rejects non-overlap, detects rotated overlap and separates symmetrically", () => {
  const m = createMatch(0);
  Object.assign(m.robots[0], { x: 0, y: 0, heading: 0 });
  Object.assign(m.robots[1], { x: 0.79, y: 0, heading: 0 });
  let c = contact(...m.robots);
  near(c.depth, 0.01);
  const center = (m.robots[0].x + m.robots[1].x) / 2;
  resolveContact(m.robots, 0, [], [null, null]);
  near((m.robots[0].x + m.robots[1].x) / 2, center);
  near(m.robots[1].x - m.robots[0].x, 0.8);
  m.robots[1].x = 1.1;
  assert.equal(contact(...m.robots), null);
  m.robots[1].x = 0.5;
  m.robots[1].heading = 0.4;
  assert.ok(contact(...m.robots));
});
function collision(heading = Math.PI) {
  const m = createMatch(0);
  Object.assign(m.robots[0], { x: 0, y: 0, heading: 0, vx: 5 });
  Object.assign(m.robots[1], {
    x: heading === Math.PI ? 0.79 : 0.69,
    y: 0,
    heading,
    vx: 0,
  });
  resolveContact(m.robots, 0, m.events, m.lastContacts);
  return m;
}
test("wedge versus wedge never flips and bounces at restitution 0.4", () => {
  const m = collision();
  assert.equal(m.robots[0].flipsTaken + m.robots[1].flipsTaken, 0);
  near(m.robots[1].vx - m.robots[0].vx, 2);
  near(m.robots[0].energy, S.ENERGY_MAX - 12.5);
  near(m.robots[1].energy, S.ENERGY_MAX - 12.5);
});
test("a side hit above threshold flips; recovering robot remains immune and can actuate", () => {
  const m = collision(Math.PI / 2);
  assert.equal(m.robots[1].flipsTaken, 1);
  assert.equal(m.robots[1].status, "flipped");
  const r = createMatch(0);
  Object.assign(r.robots[0], {
    x: 0,
    y: 0,
    heading: 0,
    status: "recovering",
    statusTimer: 1,
  });
  step(r, [{ actions: { thrust: 1, turn: 0 } }, idle()[1]]);
  assert.ok(r.robots[0].vx > 0);
  const n = createMatch(0);
  Object.assign(n.robots[0], { x: 0, y: 0, heading: 0, vx: 5 });
  Object.assign(n.robots[1], {
    x: 0.69,
    y: 0,
    heading: Math.PI / 2,
    status: "recovering",
    statusTimer: 1,
  });
  resolveContact(n.robots, 0, n.events, n.lastContacts);
  assert.equal(n.robots[1].flipsTaken, 0);
});
test("short run-up flips an exposed side or rear, but not a gentle shove or guarded front", () => {
  function charge(heading, gap) {
    const m = createMatch(0);
    const contactDistance = heading === Math.PI / 2 ? 0.7 : 0.8;
    Object.assign(m.robots[0], { x: -contactDistance - gap, y: 0, heading: 0 });
    Object.assign(m.robots[1], { x: 0, y: 0, heading });
    while (m.tick < 300 && !m.lastContacts[0])
      step(m, [{ actions: { thrust: 1, turn: 0 } }, idle()[1]]);
    assert.ok(m.lastContacts[0], "charge must reach the opponent from rest");
    return m;
  }
  const side = charge(Math.PI / 2, 1);
  const rear = charge(0, 1.5);
  for (const m of [side, rear]) {
    assert.equal(m.robots[1].flipsTaken, 1);
    const flip = m.events.find(e => e.type === "flip");
    assert.ok(flip.score >= 2.6 && flip.score < 3.2);
    assert.equal(flip.attacker, 0);
  }
  for (const m of [charge(Math.PI / 2, 0.3), charge(Math.PI, 1.5)])
    assert.deepEqual(m.robots.map(r => r.flipsTaken), [0, 0]);
});
test("flipped robot is pushable, motors locked, and righting needs 25 energy", () => {
  const m = createMatch(0);
  Object.assign(m.robots[0], { x: 0, y: 0, heading: 0, vx: 5 });
  Object.assign(m.robots[1], {
    x: 0.7,
    y: 0,
    heading: 0,
    status: "flipped",
    statusTimer: 4,
    energy: 0,
  });
  resolveContact(m.robots, 0, m.events, m.lastContacts);
  assert.ok(m.robots[1].vx > 0);
  const n = createMatch(0);
  Object.assign(n.robots[0], { energy: 24, status: "flipped", statusTimer: 0 });
  step(n, [{ actions: { thrust: 1, turn: 1 } }, idle()[1]]);
  assert.equal(n.robots[0].status, "flipped");
  assert.equal(n.robots[0].omega, 0);
  n.robots[0].energy = 25;
  step(n, idle());
  assert.equal(n.robots[0].status, "recovering");
  near(n.robots[0].statusTimer, 1);
});
test("ring-out has priority, simultaneous ring-out draws, 20 violations disqualify", () => {
  const m = createMatch(0);
  m.robots[0].x = 8.1;
  m.robots[1].flipsTaken = 2;
  step(m, idle());
  assert.equal(m.result.reason, "ring-out");
  assert.equal(m.result.winner, 1);
  const n = createMatch(0);
  n.robots[0].x = 8.1;
  n.robots[1].x = -8.1;
  step(n, idle());
  assert.equal(n.result.winner, null);
  const dq = createMatch(0);
  for (let i = 0; i < 20; i++)
    step(dq, [
      { actions: { thrust: 0, turn: 0 }, violations: ["exception"] },
      idle()[1],
    ]);
  assert.equal(dq.result.reason, "disqualification");
  assert.equal(dq.result.winner, 1);
});
test("guard clamps speeds, restores nonfinite state and records engine-only violation", () => {
  const m = createMatch(0);
  m.robots[0].vx = 100;
  m.robots[0].omega = 100;
  step(m, idle());
  assert.ok(Math.hypot(m.robots[0].vx, m.robots[0].vy) <= 7.00001);
  assert.ok(Math.abs(m.robots[0].omega) <= 4);
  const n = createMatch(0);
  const prev = { ...n.robots[0] };
  const outputs = idle();
  outputs[0].actions.thrust = Infinity;
  step(n, outputs);
  assert.equal(n.violations[0], 1);
  assert.equal(n.engineViolations, 0);
  assert.ok(
    Object.values(publicRobot(n.robots[0]))
      .filter((v) => typeof v === "number")
      .every(Number.isFinite),
  );
});
test("recorded replay is deterministic and JSON roundtrips float32 buffers", () => {
  function run() {
    const m = createMatch(7, false, [
      { id: "a", model: "fixture", codeSha256: digest("a") },
      { id: "b", model: "fixture", codeSha256: digest("b") },
    ]);
    for (const r of m.robots) {
      r.x = 0;
      r.y = r === m.robots[0] ? -2 : 2;
    }
    while (!m.result) step(m, idle());
    return closeReplay(m);
  }
  const a = run(),
    b = run();
  assert.equal(a.result.ticks, 901);
  assert.equal(a.result.reason, "hole");
  assert.equal(a.result.winner, null);
  assert.equal(stringifyReplay(a), stringifyReplay(b));
  assert.equal(a.stateHashes.length, 16);
  assert.deepEqual(parseReplay(stringifyReplay(a)).frames, a.frames);
  const invalid = JSON.parse(stringifyReplay(a));
  invalid.frames[0] = null;
  assert.throws(() => parseReplay(JSON.stringify(invalid)));
});
