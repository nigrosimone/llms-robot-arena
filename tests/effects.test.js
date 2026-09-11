import test from "node:test";
import assert from "node:assert/strict";
import { Scene } from "three";
import { CombatEffects } from "../packages/renderer/effects.js";
import { samplePlayback } from "../packages/renderer/playback.js";

// Synthetic public replay data exercises the renderer without loading bots or
// changing the simulation. Each pose is [x, y, heading, energy, status, timer].
function replayFixture({ ticks = 300, count = 2, events = [], cells = [], pose } = {}) {
  const frame = tick => Array.from({ length: count }, (_, robot) =>
    pose?.(tick, robot) ?? [robot ? -3 : 0.5, robot ? -3 : 0.5, 0, 200, 0, 0]).flat();
  return Object.freeze({
    result: Object.freeze({ ticks }), energyMax: 300,
    initialFrame: Object.freeze(frame(0)),
    frames: new Float32Array(Array.from({ length: ticks }, (_, tick) => frame(tick + 1)).flat()),
    arenaExtents: new Float32Array(ticks).fill(8),
    events: Object.freeze(events.map(event => Object.freeze({ ...event }))),
    arenaCells: Object.freeze(cells.map(cell => Object.freeze({ ...cell }))),
  });
}

const flame = {
  id: "flame-0", type: "flame", x: 0.5, y: 0.5, size: 1,
  bursts: [{ warning: 60, start: 120, end: 210 }],
};
const charger = { id: "recharge-0", type: "recharge", x: 0.5, y: 0.5, size: 1 };
const recharge = { type: "recharge", tick: 59, robot: 0, cell: "recharge-0", amount: 60, readyTick: 539 };

function snapshot(effects) {
  const particles = field => ({
    position: [...field.position.array], color: [...field.color.array], size: [...field.size.array],
  });
  return {
    glow: particles(effects.glow), smoke: particles(effects.smoke),
    rings: effects.rings.filter(ring => ring.visible).map(ring => ({
      position: ring.position.toArray(), scale: ring.scale.toArray(),
      color: ring.material.color.toArray(), opacity: ring.material.opacity,
    })),
    lights: effects.lights.filter(light => light.intensity > 0).map(light => ({
      position: light.position.toArray(), color: light.color.toArray(), intensity: light.intensity,
    })),
  };
}
const active = field => [...field.size.array].filter(size => size > 0).length;
const drawAt = (effects, replay, time) => effects.draw(replay, samplePlayback(replay, time));

test("cinematic buffers reproduce the same frame after pause, forward seeks and rewind", () => {
  const replay = replayFixture({ cells: [charger, { ...flame, x: 2.5 }], events: [
    recharge,
    { type: "impact", tick: 62, x: 0.8, y: 0.5, closingSpeed: 4 },
    { type: "flip", tick: 65, robot: 1, axis: [0, 1] },
  ] });
  const before = structuredClone(replay);
  const effects = new CombatEffects(new Scene());
  drawAt(effects, replay, 1.2);
  const expected = snapshot(effects);
  assert.ok(active(effects.glow) > 0 && active(effects.smoke) > 0);
  for (const time of [1.2, 4, 0.25, 1.4, 3, 0]) {
    drawAt(effects, replay, time);
    drawAt(effects, replay, 1.2);
    assert.deepEqual(snapshot(effects), expected);
  }
  assert.deepEqual(replay, before);
});

test("recharge bursts follow recorded pickups, not proximity to a ready charger", () => {
  const effects = new CombatEffects(new Scene());
  const noPickup = replayFixture({ cells: [charger] });
  assert.equal(drawAt(effects, noPickup, 1.1)[0].charge, 0);
  assert.equal(active(effects.glow), 0);
  assert.equal(effects.rings.filter(ring => ring.visible).length, 0);
  const pickup = replayFixture({ cells: [charger], events: [recharge] });
  assert.equal(drawAt(effects, pickup, 0.99)[0].charge, 0);
  assert.equal(active(effects.glow), 0);
  const accents = drawAt(effects, pickup, 1.1);
  assert.ok(accents[0].charge > 0.8);
  assert.equal(accents[1].charge, 0);
  assert.ok(active(effects.glow) > 0);
  assert.ok(effects.rings.some(ring => ring.visible));
  assert.ok(effects.lights.some(light => light.intensity > 0));
});

test("continuous robot flames survive the gap between public damage notifications", () => {
  const replay = replayFixture({ cells: [flame], events: [
    { type: "fire-damage", tick: 120, robot: 0, cell: flame.id, amount: 0.5 },
    { type: "fire-damage", tick: 180, robot: 0, cell: flame.id, amount: 0.5 },
  ] });
  const effects = new CombatEffects(new Scene());
  for (const time of [2.4, 2.7, 2.95]) {
    const accents = drawAt(effects, replay, time);
    assert.equal(accents[0].heat, 1);
    assert.equal(accents[1].heat, 0);
    assert.ok(active(effects.glow) > 0);
    assert.ok(active(effects.smoke) > 0);
  }
  assert.equal(drawAt(effects, replay, 3.9)[0].heat, 0);
});

test("ignition does not invent robot fire trails from positions before the grate burned", () => {
  const onGrate = replayFixture({ cells: [flame] });
  const arrivesAtIgnition = replayFixture({ cells: [flame], pose: (tick, robot) =>
    robot ? [-3, -3, 0, 200, 0, 0] : [tick < 120 ? -2 : 0.5, 0.5, 0, 200, 0, 0] });
  const effects = new CombatEffects(new Scene());
  drawAt(effects, onGrate, 121 / 60);
  const expected = snapshot(effects);
  drawAt(effects, arrivesAtIgnition, 121 / 60);
  assert.deepEqual(snapshot(effects), expected);
});

test("a final pickup animates beyond the last recorded frame and then expires", () => {
  const replay = replayFixture({ ticks: 60, cells: [charger], events: [recharge] });
  const effects = new CombatEffects(new Scene());
  assert.ok(drawAt(effects, replay, 1.2)[0].charge > 0);
  assert.ok(active(effects.glow) > 0);
  const alive = snapshot(effects);
  drawAt(effects, replay, 1.5);
  assert.notDeepEqual(snapshot(effects), alive);
  const accents = drawAt(effects, replay, 3);
  assert.equal(accents[0].charge, 0);
  assert.equal(active(effects.glow), 0);
  assert.equal(active(effects.smoke), 0);
  assert.equal(effects.rings.filter(ring => ring.visible).length, 0);
  assert.equal(effects.lights.filter(light => light.intensity > 0).length, 0);
});

test("fire smoke dissipates after shutoff and the final frame without future ignitions", () => {
  const effects = new CombatEffects(new Scene());
  const extinguishes = replayFixture({ ticks: 420, cells: [flame] });
  assert.equal(drawAt(effects, extinguishes, 3.6)[0].heat, 0);
  assert.ok(active(effects.smoke) > 0, "existing smoke remains after the grate shuts off");
  drawAt(effects, extinguishes, 5.4);
  assert.equal(active(effects.glow), 0);
  assert.equal(active(effects.smoke), 0);

  const endsBurning = replayFixture({ ticks: 150, cells: [flame] });
  assert.ok(drawAt(effects, endsBurning, 2.6)[0].heat > 0);
  assert.ok(active(effects.smoke) > 0);
  assert.equal(drawAt(effects, endsBurning, 3)[0].heat, 0);
  drawAt(effects, endsBurning, 4.5);
  assert.equal(active(effects.glow), 0);
  assert.equal(active(effects.smoke), 0);
  assert.equal(effects.lights.filter(light => light.intensity > 0).length, 0);

  const endsBeforeIgnition = replayFixture({ ticks: 90, cells: [flame] });
  assert.equal(drawAt(effects, endsBeforeIgnition, 2.5)[0].heat, 0);
  assert.equal(active(effects.glow), 0);
  assert.equal(active(effects.smoke), 0);
});

test("large public event streams reuse finite particle, ring and light pools", () => {
  const events = Array.from({ length: 1200 }, (_, i) => ({
    type: i % 3 ? "impact" : "recharge", tick: 60 + Math.floor(i / 20),
    robot: i % 4, x: (i % 4) * 0.2, y: 0.5, closingSpeed: 6, amount: 60,
  }));
  const replay = replayFixture({ count: 4, events });
  const scene = new Scene(), effects = new CombatEffects(scene);
  const objects = [...scene.children];
  const glowBuffer = effects.glow.position.array;
  const smokeBuffer = effects.smoke.position.array;
  const glowCount = effects.glow.count, smokeCount = effects.smoke.count;
  for (const time of [1.1, 1.6, 2, 2.5, 1.25]) {
    drawAt(effects, replay, time);
    assert.deepEqual(scene.children, objects);
    assert.equal(effects.glow.position.array, glowBuffer);
    assert.equal(effects.smoke.position.array, smokeBuffer);
    assert.equal(effects.glow.particles.length, glowCount);
    assert.equal(effects.smoke.particles.length, smokeCount);
    assert.ok(active(effects.glow) <= glowCount);
    assert.ok(active(effects.smoke) <= smokeCount);
    assert.ok([...effects.glow.position.array, ...effects.glow.color.array,
      ...effects.smoke.position.array, ...effects.smoke.color.array].every(Number.isFinite));
  }
});
