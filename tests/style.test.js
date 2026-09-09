import test from "node:test";
import assert from "node:assert/strict";
import { matchStyle, styleLabel, styleProfiles } from "../packages/tournament/style.js";

// One second of a duel: robot 0 drives at the stationary robot 1.
function replay({ robots = 2, ticks = 60, events = [] } = {}) {
  const frames = new Float32Array(ticks * robots * 6);
  for (let tick = 0; tick < ticks; tick++) {
    const at = (robot, values) =>
      values.forEach((v, k) => (frames[(tick * robots + robot) * 6 + k] = v));
    at(0, [-3 + (tick + 1) / 60, 0, 0, 300 - (tick + 1) * 0.05, 0, 0]);
    for (let i = 1; i < robots; i++) at(i, [2, 0, 0, 300, 0, 0]);
  }
  return {
    bots: Array.from({ length: robots }, (_, i) => ({ id: `bot-${i}` })),
    dt: 1 / 60,
    initialFrame: [-3, 0, 0, 300, 0, 0, ...Array.from({ length: robots - 1 }, () => [2, 0, 0, 300, 0, 0]).flat()],
    frames,
    arenaExtents: new Float32Array(ticks).fill(8),
    events,
    result: { ticks, winner: 0, reason: "ring-out" },
  };
}

test("measures movement, approach and energy from the frames", () => {
  const [a, b] = matchStyle(replay());
  assert.equal(a.speed, 1);
  assert.equal(a.closingShare, 1);
  assert.equal(b.closingShare, 0);
  assert.equal(a.facingShare, 1);
  assert.equal(b.facingShare, 0);
  assert.equal(a.proximityShare, 0);
  assert.equal(a.idleShare, 0);
  assert.equal(a.edgeShare, 0);
  assert.equal(a.turnRate, 0);
  assert.equal(a.spendRate, 3);
  assert.equal(b.spendRate, 0);
});

test("counts contacts, engagements and hazard events per robot", () => {
  const events = [
    { type: "impact", tick: 10, wedges: [true, false] },
    { type: "impact", tick: 50, wedges: [true, false] },
    { type: "recharge", tick: 20, robot: 1 },
    { type: "fire-damage", tick: 30, robot: 0 },
  ];
  const [a, b] = matchStyle(replay({ events }));
  assert.equal(a.contactShare, 0.0333);
  assert.equal(a.engagementRate, 120);
  assert.equal(a.wedgeShare, 1);
  assert.equal(b.wedgeShare, 0);
  assert.deepEqual([a.recharges, b.recharges], [0, 1]);
  assert.deepEqual([a.burns, b.burns], [1, 0]);
});

test("contacts one tick apart stay a single engagement", () => {
  const events = [10, 11, 12].map(tick => ({ type: "impact", tick, wedges: [true, false] }));
  assert.equal(matchStyle(replay({ events }))[0].engagementRate, 60);
});

test("only duels have a style", () => {
  assert.equal(matchStyle(replay({ robots: 3 })), null);
});

test("profiles scale each axis on the roster best", () => {
  const ranking = [
    { style: { closingShare: 0.5, proximityShare: 0.1, wedgeShare: 0.25, speed: 2, edgeShare: 0.1, spendRate: 10 } },
    { style: { closingShare: 1, proximityShare: 0.2, wedgeShare: 0.5, speed: 1, edgeShare: 0.2, spendRate: 20 } },
  ];
  const [first, second] = styleProfiles(ranking);
  assert.equal(first.aggression, 0.5);
  assert.equal(second.aggression, 1);
  assert.equal(first.mobility, 1);
  assert.equal(second.burn, 1);
  assert.equal(styleLabel(first), "Mobility");
  assert.equal(styleLabel(second), "Aggression");
});

test("a ranking without style has no profiles", () => {
  assert.equal(styleProfiles([{ style: null }]), null);
});
