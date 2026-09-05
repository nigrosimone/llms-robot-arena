import test from "node:test";
import assert from "node:assert/strict";
import { createMatch, step, sensorsFor, closeReplay, digest } from "../packages/sim/index.js";
import { SPEC as S, halfExtent } from "../packages/sim/spec.js";
import { cellSnapshots, flamePhase, crossesCell, isHole } from "../packages/sim/terrain.js";
import { stringifyReplay, parseReplay } from "../packages/sim/replay.js";
import { samplePlayback } from "../packages/viewer/playback.js";
import { deckGeometry, decalGeometry, TerrainView } from "../packages/viewer/terrain.js";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3, Scene } from "three";
const idle = () => [0, 1].map(() => ({ actions: { thrust: 0, turn: 0 } }));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const cell = type => ({ id: `${type}-0`, type, x: 0.5, y: 2.5, size: 1,
  ...(type === "collapse" ? { warningTick: 60, collapseTick: 240 } : {}),
  ...(type === "flame" ? { bursts: [{ warning: 60, start: 120, end: 210 }] } : {}) });
function fixture(type) {
  const m = createMatch(0, false, ["a", "b"].map(id => ({ id, model: "fixture", codeSha256: digest(id) })));
  m.cells = [cell(type)];
  Object.assign(m.robots[0], { x: -0.02, y: 2.5, heading: 0, vx: 7, energy: 100 });
  Object.assign(m.robots[1], { x: -4, y: -4, heading: 0 });
  return m;
}
test("terrain is reproducible, spawn-safe, separated and identical in mirrored matches", () => {
  const holeCounts = new Set();
  for (let seed = 0; seed < 1000; seed++) {
    const a = createMatch(seed), b = createMatch(seed, true);
    assert.deepEqual(a.cells, b.cells);
    assert.deepEqual(a.cells, createMatch(seed).cells);
    const holes = a.cells.filter(c => c.type === "hole");
    holeCounts.add(holes.length);
    assert.ok(holes.length === 2 || holes.length === 3);
    assert.equal(a.cells.filter(c => c.type === "recharge").length, 4);
    assert.equal(a.cells.filter(c => c.type === "flame").length, 4);
    assert.ok(a.cells.filter(c => c.type === "recharge" && Math.max(Math.abs(c.x), Math.abs(c.y)) <= 2.5).length >= 2);
    const initialCells = a.cells.filter(c => c.type !== "collapse");
    for (const c of initialCells) {
      assert.ok(Math.max(Math.abs(c.x), Math.abs(c.y)) >= 2.5);
      assert.ok(a.robots.every(r => Math.hypot(c.x - r.x, c.y - r.y) >= 2));
      assert.ok(initialCells.every(other => other === c || Math.max(Math.abs(c.x - other.x), Math.abs(c.y - other.y)) >= 2));
    }
    const collapses = a.cells.filter(c => c.type === "collapse");
    assert.equal(collapses.length, S.COLLAPSE_CELLS);
    assert.ok(collapses[0].warningTick >= 1200 && collapses[0].warningTick <= 1800);
    assert.equal(new Set(a.cells.map(c => `${c.x},${c.y}`)).size, a.cells.length);
    collapses.forEach((c, i) => {
      assert.equal(c.collapseTick - c.warningTick, 180);
      assert.ok(c.collapseTick < 7200);
      assert.ok(Math.max(Math.abs(c.x), Math.abs(c.y)) + 0.5 <= halfExtent(c.collapseTick / 60));
      if (i) assert.ok(c.warningTick - collapses[i - 1].warningTick >= 900 && c.warningTick - collapses[i - 1].warningTick <= 1500);
    });
  }
  assert.deepEqual([...holeCounts].sort(), [2, 3]);
  assert.notDeepEqual(createMatch(0).cells, createMatch(1).cells);
});
test("sensor cells are independent snapshots with countdowns and no hidden future schedule", () => {
  const m = fixture("flame");
  m.tick = 60;
  const s = sensorsFor(m, 0);
  assert.equal(s.arena.cells[0].state, "warning");
  assert.equal(s.arena.cells[0].timeUntilChange, 1);
  assert.equal(s.arena.cells[0].bursts, undefined);
  s.arena.cells[0].x = 100;
  assert.equal(m.cells[0].x, 0.5);
  assert.equal(cellSnapshots([{ ...cell("hole"), x: 7.5 }], 0, 3.8)[0].state, "inactive");
});
test("entering a blue cell charges once, caps energy and never rewards camping", () => {
  const m = fixture("recharge");
  step(m, idle());
  near(m.robots[0].energy, 160 - S.K_IDLE * S.DT);
  assert.equal(m.events.filter(e => e.type === "recharge").length, 1);
  assert.equal(sensorsFor(m, 0).arena.cells[0].state, "cooldown");
  m.robots[0].vx = 0;
  const start = m.robots[0].energy;
  for (let i = 0; i < 600; i++) step(m, idle());
  near(m.robots[0].energy, start - 10 * S.K_IDLE);
  assert.equal(m.events.filter(e => e.type === "recharge").length, 1);
  assert.equal(sensorsFor(m, 0).arena.cells[0].state, "ready");
  Object.assign(m.robots[0], { x: -0.02, vx: 7, energy: 290 });
  step(m, idle());
  assert.equal(m.robots[0].energy, S.ENERGY_MAX);
  assert.equal(m.events.filter(e => e.type === "recharge").length, 2);
});
test("simultaneous recharge entry shares the pickup without robot-index advantage", () => {
  function run(swapped) {
    const m = fixture("recharge");
    Object.assign(m.robots[0], { y: 2.12 });
    Object.assign(m.robots[1], { x: -0.02, y: 2.88, heading: 0, vx: 7, energy: 150 });
    if (swapped) m.robots.reverse();
    step(m, idle());
    return m;
  }
  const a = run(false), b = run(true);
  assert.equal(a.events.filter(e => e.type === "recharge").length, 2);
  near(a.robots[0].energy, 130 - S.K_IDLE * S.DT);
  near(a.robots[1].energy, 180 - S.K_IDLE * S.DT);
  assert.deepEqual(a.robots, b.robots.toReversed());
});
test("holes catch swept centers, end matches immediately, and share fall priority", () => {
  assert.ok(crossesCell(cell("hole"), { x: -1, y: 2.5 }, { x: 2, y: 2.5 }));
  assert.equal(crossesCell(cell("hole"), { x: -1, y: 3.1 }, { x: 2, y: 3.1 }), false);
  const m = fixture("hole");
  m.robots[1].flipsTaken = 2;
  step(m, idle());
  assert.equal(m.result.reason, "hole");
  assert.equal(m.result.winner, 1);
  assert.equal(m.events.find(e => e.type === "hole").cell, "hole-0");
  const n = fixture("hole");
  n.robots[1].x = -8.1;
  step(n, idle());
  assert.equal(n.result.winner, null);
});
test("grates telegraph flames and damage energy only while active, including flipped robots", () => {
  const m = fixture("flame");
  Object.assign(m.robots[0], { x: 0.5, vx: 0, status: "flipped", statusTimer: 4 });
  m.tick = 119;
  assert.equal(flamePhase(m.cells[0], 119).state, "warning");
  step(m, idle());
  near(m.robots[0].energy, 100 - S.K_IDLE * S.DT);
  const energy = m.robots[0].energy;
  step(m, idle());
  near(m.robots[0].energy, energy - (S.K_IDLE + S.FLAME_DAMAGE) * S.DT);
  assert.equal(m.events.filter(e => e.type === "fire-damage").length, 1);
  m.tick = 210;
  const coolEnergy = m.robots[0].energy;
  step(m, idle());
  near(m.robots[0].energy, coolEnergy - S.K_IDLE * S.DT);
  m.tick = 120;
  m.robots[0].energy = 0.01;
  step(m, idle());
  assert.equal(m.robots[0].energy, 0);
});
test("timeout compares flips, energy, then exact distance from the center", () => {
  function finish(a, b) {
    const m = createMatch(0);
    m.cells = [];
    m.tick = 7199;
    Object.assign(m.robots[0], { x: 1, y: 0, energy: 100 }, a);
    Object.assign(m.robots[1], { x: -2, y: 0, energy: 100 }, b);
    step(m, idle());
    return m.result;
  }
  assert.equal(finish().winner, 0);
  assert.equal(finish().decision, "center");
  assert.equal(finish({}, { energy: 101 }).winner, 1);
  assert.equal(finish({ flipsTaken: 1 }, {}).winner, 1);
  assert.equal(finish({}, { x: -1 }).winner, null);
});
test("terrain replays retain cells, cooldowns and falls when exporting and seeking", () => {
  const m = fixture("hole");
  step(m, idle());
  const replay = parseReplay(stringifyReplay(closeReplay(m)));
  assert.equal(replay.energyMax, 300);
  assert.deepEqual(replay.arenaCells, m.cells);
  const sample = samplePlayback(replay, 1 + S.DT);
  assert.equal(sample.states[0].hole, true);
  near(sample.states[0].x, replay.frames[0]);
  near(sample.states[0].z, -4.9);
  const invalid = JSON.parse(stringifyReplay(replay));
  invalid.arenaCells[0].x = null;
  assert.throws(() => parseReplay(JSON.stringify(invalid)), /Invalid arena cell/);
  const flame = fixture("flame");
  const synthetic = { ...replay, arenaCells: flame.cells, events: [], result: { ticks: 1, reason: "timeout", winner: null } };
  synthetic.arenaCells[0].bursts[0].start = 40;
  assert.throws(() => parseReplay(stringifyReplay(synthetic)), /Invalid flame schedule/);
});
test("replay seeking reconstructs recharge cooldown and each fire phase without mutation", () => {
  const m = fixture("recharge");
  step(m, idle());
  m.robots[0].vx = 0;
  for (let i = 0; i < 600; i++) step(m, idle());
  m.robots[1].x = -8.1;
  step(m, idle());
  const replay = parseReplay(stringifyReplay(closeReplay(m)));
  const before = stringifyReplay(replay);
  assert.equal(samplePlayback(replay, 0).cells[0].state, "ready");
  assert.equal(samplePlayback(replay, 1 / 60).cells[0].state, "cooldown");
  assert.equal(samplePlayback(replay, 8).cells[0].state, "ready");
  assert.equal(samplePlayback(replay, 2).cells[0].timeUntilChange, 6);
  assert.equal(stringifyReplay(replay), before);
  const flameReplay = { ...replay, arenaCells: [cell("flame")], events: [] };
  assert.equal(samplePlayback(flameReplay, 0).cells[0].state, "safe");
  assert.equal(samplePlayback(flameReplay, 1).cells[0].state, "warning");
  assert.equal(samplePlayback(flameReplay, 2).cells[0].state, "flaming");
  assert.equal(samplePlayback(flameReplay, 3.5).cells[0].state, "safe");
});
test("rendered holes are cut through each deck layer while nearby floor stays solid", () => {
  for (const [height, z] of [[0.48, -0.25], [0.035, 0.005], [0.25, -0.59]]) {
    const geometry = deckGeometry([cell("hole")], height, z);
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(geometry, material);
    const ray = new Raycaster(new Vector3(0.5, 2.5, 2), new Vector3(0, 0, -1));
    assert.equal(ray.intersectObject(mesh).length, 0);
    ray.ray.origin.set(1.5, 2.5, 2);
    assert.ok(ray.intersectObject(mesh).length > 0);
    geometry.dispose();
    material.dispose();
  }
});
test("future collapses are hidden until a full three-second warning, then become permanent holes", () => {
  const c = cell("collapse");
  assert.deepEqual(cellSnapshots([c], 59, 8), []);
  const warning = cellSnapshots([c], 60, 8)[0];
  assert.equal(warning.type, "collapse");
  assert.equal(warning.state, "warning");
  assert.equal(warning.timeUntilChange, 3);
  assert.equal(warning.collapseTick, undefined);
  near(cellSnapshots([c], 239, 8)[0].timeUntilChange, 1 / 60);
  for (const tick of [240, 241, 7199]) {
    const hole = cellSnapshots([c], tick, 8)[0];
    assert.equal(hole.id, c.id);
    assert.equal(hole.type, "hole");
    assert.equal(hole.state, "hole");
    assert.equal(hole.timeUntilChange, null);
  }
});
test("a warning tile stays solid; leaving before expiry is safe", () => {
  const m = fixture("collapse");
  Object.assign(m.robots[0], { x: 0.5, vx: 0 });
  while (m.tick < 239) step(m, idle());
  assert.equal(m.result, null);
  assert.equal(m.events.filter(e => e.type === "collapse-warning").length, 1);
  Object.assign(m.robots[0], { x: 0.99, vx: 7 });
  step(m, idle());
  assert.ok(m.robots[0].x > 1);
  step(m, idle());
  assert.equal(m.result, null);
  assert.equal(m.events.filter(e => e.type === "collapse").length, 1);
});
test("collapse drops a robot on expiry, including flipped/recovering robots and attempted escape", () => {
  for (const status of ["active", "flipped", "recovering"]) {
    const m = fixture("collapse");
    m.tick = 240;
    Object.assign(m.robots[0], { x: 0.99, vx: 7, status, statusTimer: 1 });
    step(m, [{ actions: { thrust: 1, turn: 0 } }, idle()[1]]);
    assert.equal(m.result.reason, "hole");
    assert.equal(m.result.winner, 1);
    assert.equal(m.events.filter(e => e.type === "collapse").length, 1);
    assert.equal(m.events.find(e => e.type === "hole").cell, "collapse-0");
  }
  const simultaneous = fixture("collapse");
  simultaneous.tick = 240;
  Object.assign(simultaneous.robots[0], { x: 0.5, y: 2.1, vx: 0 });
  Object.assign(simultaneous.robots[1], { x: 0.5, y: 2.9, vx: 0 });
  step(simultaneous, idle());
  assert.equal(simultaneous.result.winner, null);
});
test("collapse replays preserve warning, opening and falls across forward and backward seeks", () => {
  const m = fixture("collapse");
  Object.assign(m.robots[0], { x: 0.5, vx: 0 });
  while (!m.result) step(m, idle());
  const replay = parseReplay(stringifyReplay(closeReplay(m)));
  const before = stringifyReplay(replay);
  assert.deepEqual(replay.events.filter(e => e.type.startsWith("collapse")).map(e => [e.type, e.tick]),
    [["collapse-warning", 60], ["collapse", 240]]);
  assert.equal(samplePlayback(replay, 4).cells[0].type, "hole");
  assert.equal(samplePlayback(replay, 2).cells[0].state, "warning");
  assert.deepEqual(samplePlayback(replay, 0).cells, []);
  assert.equal(samplePlayback(replay, 5).states[0].hole, true);
  assert.equal(stringifyReplay(replay), before);
  const invalid = JSON.parse(before);
  invalid.arenaCells[0].collapseTick--;
  assert.throws(() => parseReplay(JSON.stringify(invalid)), /Invalid collapse schedule/);
  const invalidEvent = JSON.parse(before);
  invalidEvent.events.find(e => e.type === "collapse").cell = "unknown";
  assert.throws(() => parseReplay(JSON.stringify(invalidEvent)), /Invalid collapse event/);
  const earlyFall = JSON.parse(before);
  earlyFall.events = [{ type: "hole", robot: 0, tick: 239, cell: "collapse-0" }];
  assert.throws(() => parseReplay(JSON.stringify(earlyFall)), /Invalid terrain event/);
});
test("collapse rendering hides future markers and restores solid floor on rewind", () => {
  const c = cell("collapse");
  const view = new TerrainView(new Scene(), []);
  view.load([c]);
  for (const tick of [0, 60, 239, 240, 239, 0]) {
    const snapshots = cellSnapshots([c], tick, 8);
    view.draw(snapshots, tick / 60);
    assert.equal(view.cells[0].group.visible, tick >= 60);
    assert.equal(view.cells[0].warning.visible, tick >= 60 && tick < 240);
    const geometry = deckGeometry([c].filter(cell => isHole(cell, tick)), 0.48, -0.25);
    const material = new MeshBasicMaterial();
    const ray = new Raycaster(new Vector3(c.x, c.y, 2), new Vector3(0, 0, -1));
    assert.equal(ray.intersectObject(new Mesh(geometry, material)).length > 0, tick < 240);
    geometry.dispose();
    material.dispose();
  }
  view.clear();
});
test("0.2.0 terrain replays retain their original terrain without invented collapses", () => {
  const m = fixture("hole");
  step(m, idle());
  const legacy = { ...closeReplay(m), specVersion: "0.2.0-draft", engineVersion: "0.2.0-r1" };
  const replay = parseReplay(stringifyReplay(legacy));
  assert.equal(replay.energyMax, 300);
  assert.deepEqual(replay.arenaCells, m.cells);
  legacy.arenaCells.push(cell("collapse"));
  assert.throws(() => parseReplay(stringifyReplay(legacy)), /Invalid arena cell/);
});
test("central floor markings disappear over a collapsed tile and return on rewind", () => {
  const c = { ...cell("collapse"), y: 0.5 };
  const material = new MeshBasicMaterial();
  for (const tick of [0, 240, 0]) {
    const geometry = decalGeometry([c].filter(cell => isHole(cell, tick)));
    const mesh = new Mesh(geometry, material);
    const ray = new Raycaster(new Vector3(c.x, c.y, 2), new Vector3(0, 0, -1));
    assert.equal(ray.intersectObject(mesh).length > 0, tick < 240);
    ray.ray.origin.set(-0.5, -0.5, 2);
    assert.ok(ray.intersectObject(mesh).length > 0);
    geometry.dispose();
  }
  material.dispose();
});
test("ending a match at a scheduled transition does not play an unprocessed collapse", () => {
  for (const ticks of [60, 240]) {
    const m = fixture("collapse");
    Object.assign(m.robots[0], { x: 0.5, vx: 0 });
    while (m.tick < ticks - 1) step(m, idle());
    m.robots[1].x = -8.1;
    step(m, idle());
    const sample = samplePlayback(closeReplay(m), ticks / 60 + 1);
    assert.equal(sample.terrainTick, ticks - 1);
    assert.equal(sample.cells.some(c => c.id === "collapse-0" && c.type === "hole"), false);
    assert.equal(m.events.some(e => e.type === "collapse"), false);
  }
});
