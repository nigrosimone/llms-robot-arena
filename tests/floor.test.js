import test from "node:test";
import assert from "node:assert/strict";
import { Scene } from "three";
import { createMatch, step, sensorsFor, closeReplay } from "../packages/sim/index.js";
import { SPEC as S } from "../packages/sim/spec.js";
import { floorIndex, floorCapacity, addFloorLoad } from "../packages/sim/floor.js";
import { cellSnapshots, isHole } from "../packages/sim/terrain.js";
import { parseReplay, stringifyReplay } from "../packages/sim/replay.js";
import { samplePlayback } from "../packages/viewer/playback.js";
import { TerrainView } from "../packages/viewer/terrain.js";

const idle = [{ actions: { thrust: 0, turn: 0 } }, { actions: { thrust: 0, turn: 0 } }];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
function fixture(type = "floor") {
  const m = createMatch(0, false, ["a", "b"].map(id => ({ id, model: "fixture", codeSha256: id.repeat(64) })));
  m.cells = [{ id: "test-cell", type, x: 0.5, y: 0.5, size: 1,
    ...(type === "flame" ? { bursts: [{ warning: 870, start: 930, end: 1020 }] } : {}),
    ...(type === "collapse" ? { warningTick: 1200, collapseTick: 1380 } : {}) }];
  Object.assign(m.robots[0], { x: 0.5, y: 0.5, heading: 0 });
  Object.assign(m.robots[1], { x: -3.5, y: -3.5, heading: 0 });
  m.initialFrame = m.robots.flatMap(r => [r.x, r.y, r.heading, r.energy, 0, 0]);
  return m;
}
function advance(m, ticks) {
  while (m.tick < ticks) {
    assert.equal(m.result, null, "fixture ended before the intended tick");
    step(m, idle);
  }
}
const target = m => sensorsFor(m, 0).arena.cells.find(c => c.id === "test-cell");

test("weight accumulates exactly, announces at 12 seconds and opens at 15 seconds", () => {
  const m = fixture();
  assert.equal(target(m), undefined);
  advance(m, 360);
  near(target(m).integrity, 0.5);
  assert.equal(target(m).type, "floor");
  assert.equal(target(m).collapseIn, null);
  advance(m, 719);
  assert.ok(target(m).integrity > 0);
  step(m, idle);
  assert.equal(target(m).integrity, 0);
  assert.equal(target(m).collapseIn, 3);
  assert.equal(target(m).type, "collapse");
  advance(m, 900);
  assert.equal(m.result, null);
  step(m, idle);
  assert.equal(m.result.reason, "hole");
  assert.equal(m.result.winner, null);
  assert.equal(m.result.ticks, 901);
  assert.deepEqual(m.events.filter(e => e.cell === "test-cell").map(e => [e.type, e.tick]),
    [["collapse-warning", 720], ["collapse", 900], ["hole", 900]]);
  assert.ok(m.events.filter(e => e.type.startsWith("collapse")).every(e => e.cause === "weight"));
});

test("leaving preserves wear; returning resumes the load and leaving a warning never cancels collapse", () => {
  const m = fixture();
  advance(m, 360);
  m.robots[0].x = 2.5;
  advance(m, 480);
  near(target(m).integrity, 0.5);
  m.robots[0].x = 0.5;
  advance(m, 840);
  assert.equal(target(m).collapseIn, 3);
  // Both leave their announced tiles before either warning expires.
  m.robots[0].x = 2.5;
  m.robots[1].x = -5.5;
  advance(m, 1021);
  assert.equal(m.result, null);
  assert.equal(target(m).type, "hole");
  assert.equal(m.events.filter(e => e.cell === "test-cell" && e.type === "collapse").length, 1);
});

test("two robots double the load without an identity advantage or boundary multiplication", () => {
  const a = fixture(), b = fixture();
  for (const m of [a, b]) {
    Object.assign(m.robots[0], { x: 0.5, y: 0.1 });
    Object.assign(m.robots[1], { x: 0.5, y: 0.9 });
  }
  b.robots.reverse();
  advance(a, 360); advance(b, 360);
  assert.equal(target(a).collapseIn, 3);
  assert.deepEqual(a.floorWear, b.floorWear);
  assert.deepEqual(a.cells, b.cells);
  advance(a, 541);
  assert.equal(a.result.winner, null);
  assert.equal(a.result.reason, "hole");
  const boundary = fixture();
  Object.assign(boundary.robots[0], { x: 0, y: 0 });
  step(boundary, idle);
  assert.equal(Object.keys(boundary.floorWear).length, 2);
  assert.equal(boundary.floorWear[floorIndex({ x: 0, y: 0 })].load, 100);
  assert.equal(floorIndex({ x: 8, y: 8 }), 255);
  assert.equal(floorIndex({ x: -8, y: -8 }), 0);
});

test("flipped, recovering and depleted robots still load tiles and cannot escape an expired warning", () => {
  for (const status of ["active", "flipped", "recovering"]) {
    const m = fixture();
    Object.assign(m.robots[0], { status, statusTimer: 4, energy: 0 });
    step(m, idle);
    assert.equal(m.floorWear[136].load, 100);
    m.floorWear[136] = { load: floorCapacity(), warningTick: 0, collapseTick: 180 };
    m.tick = 180;
    Object.assign(m.robots[0], { x: 0.99, vx: 7, energy: 300 });
    step(m, [{ actions: { thrust: 1, turn: 0 } }, idle[1]]);
    assert.equal(m.result.reason, "hole");
    assert.equal(m.result.winner, 1);
    assert.equal(m.floorLoads.at(-2), -1);
  }
});

test("chargers and grates preserve their functional state during warnings and disappear when exhausted", () => {
  for (const type of ["recharge", "flame"]) {
    const m = fixture(type);
    advance(m, 720);
    assert.equal(target(m).type, type);
    assert.equal(target(m).state, type === "recharge" ? "ready" : "safe");
    assert.equal(target(m).collapseIn, 3);
    m.robots[0].x = 1.02;
    step(m, idle);
    Object.assign(m.robots[0], { vx: -7, heading: 0 });
    step(m, idle);
    if (type === "recharge") assert.ok(m.events.some(e => e.type === "recharge" && e.tick === 721));
    advance(m, 901);
    assert.equal(m.result.reason, "hole");
    assert.equal(target(m).type, "hole");
    assert.equal(m.events.some(e => ["recharge", "fire-damage"].includes(e.type) && e.tick >= 900), false);
    const view = new TerrainView(new Scene(), []);
    view.load(m.cells);
    view.draw(cellSnapshots(m.cells, 720, 8, {}, m.floorWear), 12);
    assert.equal(view.cells[0].surface.visible, true);
    assert.equal(view.cells[0].warning.visible, true);
    view.draw(cellSnapshots(m.cells, 900, 8, {}, m.floorWear), 15);
    assert.equal(view.cells[0].surface.visible, false);
    assert.equal(view.cells[0].warning.visible, false);
    view.clear();
  }
});

test("random and weight collapses use the first opening without exposing a future schedule", () => {
  for (const randomFirst of [false, true]) {
    const m = fixture("collapse");
    if (randomFirst) Object.assign(m.cells[0], { warningTick: 600, collapseTick: 780 });
    step(m, idle);
    const worn = target(m);
    assert.equal(worn.type, "floor");
    assert.equal(worn.collapseIn, null);
    assert.equal(worn.warningTick, undefined);
    assert.equal(worn.collapseTick, undefined);
    const view = new TerrainView(new Scene(), []);
    view.load(m.cells); view.draw(sensorsFor(m, 0).arena.cells, S.DT);
    assert.equal(view.cells[0].warning.visible, false);
    assert.equal(view.cells[0].borders[0].material.color.getHex(), 0x64737b);
    view.clear();
    while (!m.result) step(m, idle);
    const events = m.events.filter(e => e.cell === "test-cell" && e.type.startsWith("collapse"));
    assert.deepEqual(events.map(e => e.tick), randomFirst ? [600, 780] : [720, 900]);
    assert.ok(events.every(e => e.cause === (randomFirst ? "random" : "weight")));
    assert.doesNotThrow(() => parseReplay(stringifyReplay(closeReplay(m))));
  }
});

test("wear replays roundtrip exact loads and seek both ways without modifying recorded data", () => {
  const m = fixture();
  while (!m.result) step(m, idle);
  const replay = parseReplay(stringifyReplay(closeReplay(m))), saved = stringifyReplay(replay);
  assert.deepEqual(replay.floorLoads, m.floorLoads);
  for (const [time, type, integrity, collapseIn] of [[0, null, 1, null], [6, "floor", 0.5, null],
    [12, "collapse", 0, 3], [14, "collapse", 0, 1], [16, "hole", 0, null], [6, "floor", 0.5, null], [0, null, 1, null]]) {
    const sample = samplePlayback(replay, time).cells.find(c => c.id === "test-cell");
    assert.equal(sample?.type ?? null, type);
    if (sample) { near(sample.integrity, integrity); assert.equal(sample.collapseIn, collapseIn); }
  }
  assert.equal(stringifyReplay(replay), saved);
  for (const mutate of [r => r.floorLoads.pop(), r => { r.floorLoads[0] = 256; },
    r => { r.floorLoads[0] = 1.5; }, r => { r.floorLoads[0] = 0; },
    r => { r.floorLoads[1800] = 136; }, r => { r.events.find(e => e.type === "collapse").tick--; },
    r => { r.events.find(e => e.type === "collapse").cause = "random"; },
    r => { r.arenaCells.push({ ...r.arenaCells[0], id: "duplicate-position" }); }]) {
    const invalid = JSON.parse(saved); mutate(invalid);
    assert.throws(() => parseReplay(JSON.stringify(invalid)), /Invalid floor|Invalid collapse|Overlapping arena/);
  }
});

test("end-of-match animation cannot start an unprocessed weight warning or opening", () => {
  for (const ticks of [720, 900]) {
    const m = fixture();
    advance(m, ticks - 1);
    m.robots[1].x = -8.1;
    step(m, idle);
    const sample = samplePlayback(closeReplay(m), 30).cells.find(c => c.id === "test-cell");
    assert.equal(sample.type, ticks === 720 ? "floor" : "collapse");
    assert.equal(m.events.some(e => e.type === "collapse"), false);
  }
  const wear = {};
  addFloorLoad(wear, -1, 0);
  assert.deepEqual(wear, {});
  const cell = fixture().cells[0];
  wear[136] = { load: floorCapacity(), warningTick: 720, collapseTick: 900 };
  assert.equal(cellSnapshots([cell], 800, 0.1, {}, wear)[0].state, "warning");
  const outside = { ...cell, x: 7.5 };
  wear[floorIndex(outside)] = wear[136];
  assert.equal(cellSnapshots([outside], 800, 4, {}, wear)[0].state, "inactive");
  assert.equal(cellSnapshots([outside], 800, 4, {}, wear)[0].collapseIn, null);
  assert.equal(isHole(cell, 899, wear), false);
  assert.equal(isHole(cell, 900, wear), true);
});
