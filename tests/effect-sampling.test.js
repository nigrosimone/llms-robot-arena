import test from "node:test";
import assert from "node:assert/strict";
import { poseAt, robotHeat } from "../packages/renderer/effect-sampling.js";

const flame = Object.freeze({
  id: "flame-0", type: "flame", state: "flaming", x: 0.5, y: 0.5, size: 1,
});
const robot = Object.freeze({ x: 0.5, y: 0.5, energy: 100, status: 0 });
const fireEvents = Object.freeze([
  Object.freeze({ type: "fire-damage", robot: 0, tick: 59 }),
  Object.freeze({ type: "fire-damage", robot: 0, tick: 119 }),
]);

test("heat stays continuous between sparse fire events, including an empty battery", () => {
  assert.equal(robotHeat(robot, [flame], fireEvents, 0, 1.8), 1);
  assert.equal(robotHeat({ ...robot, energy: 0 }, [flame], [], 0, 1.8), 1);
  assert.equal(robotHeat({ ...robot, status: 1 }, [flame], [], 0, 1.8), 1);
  assert.equal(robotHeat({ ...robot, status: 2 }, [flame], [], 0, 1.8), 1);
  // The engine includes cell boundaries in fire containment.
  assert.equal(robotHeat({ ...robot, x: 0, y: 1 }, [flame], [], 0, 1.8), 1);
  assert.equal(robotHeat({ ...robot, x: -0.001 }, [flame], [], 0, 1.8), 0);
});

test("heat cools after leaving the grate and ignores other robots and future events", () => {
  const outside = Object.freeze({ ...robot, x: 2 });
  assert.equal(robotHeat(outside, [flame], fireEvents, 0, 0.9), 0);
  assert.equal(robotHeat(outside, [flame], fireEvents, 0, 1), 1);
  assert.ok(Math.abs(robotHeat(outside, [flame], fireEvents, 0, 1.175) - 0.5) < 1e-12);
  assert.equal(robotHeat(outside, [flame], fireEvents, 0, 1.4), 0);
  assert.equal(robotHeat(outside, [flame], fireEvents, 1, 1.1), 0);
  // An unsorted event list still selects the latest notification in the past.
  assert.ok(Math.abs(robotHeat(outside, [], [...fireEvents].reverse(), 0, 2.175) - 0.5) < 1e-12);
});

test("fallen robots and inactive, warning or extinguished grates do not sustain heat", () => {
  for (const flags of [{ out: true }, { ringOut: true }, { status: 3 }])
    assert.equal(robotHeat({ ...robot, ...flags }, [flame], fireEvents, 0, 1), 0);
  for (const state of ["inactive", "safe", "warning", "hole"])
    assert.equal(robotHeat(robot, [{ ...flame, state }], [], 0, 1), 0);
  assert.equal(robotHeat(robot, [{ ...flame, type: "hole" }], [], 0, 1), 0);
});

function replayWithRobots(count, ticks = 2) {
  const initialFrame = Object.freeze(Array.from({ length: count }, (_, i) =>
    [i * 10, i, 179 * Math.PI / 180, 300 - i, 0, 0]).flat());
  const frames = Object.freeze(Array.from({ length: ticks }, (_, tick) =>
    Array.from({ length: count }, (_, i) =>
      [i * 10 + tick + 1, i - tick - 1, -179 * Math.PI / 180, 290 - tick - i, tick === 0 ? 1 : 2, 0]).flat()).flat());
  return Object.freeze({ result: Object.freeze({ ticks }), initialFrame, frames });
}

test("poses interpolate the shortest heading arc and each robot's own replay stride", () => {
  for (const count of [2, 4]) {
    const replay = replayWithRobots(count);
    const before = JSON.stringify(replay);
    for (let i = 0; i < count; i++) {
      const half = poseAt(replay, i, 1 / 120);
      assert.equal(half.x, i * 10 + 0.5);
      assert.equal(half.y, i - 0.5);
      assert.ok(Math.abs(half.heading - Math.PI) < 1e-12);
      assert.equal(half.energy, 295 - i);
      assert.equal(half.status, 0);
      assert.equal(poseAt(replay, i, 1 / 60).status, 1);
      assert.equal(poseAt(replay, i, 1.5 / 60).x, i * 10 + 1.5);
    }
    assert.equal(JSON.stringify(replay), before);
  }
});

test("pose sampling clamps to recorded boundaries and supports typed replay frames", () => {
  const source = replayWithRobots(2, 123);
  const replay = { ...source, frames: new Float32Array(source.frames) };
  const framesBefore = new Float32Array(replay.frames);
  assert.deepEqual(poseAt(replay, 0, -3), {
    x: 0, y: 0, heading: source.initialFrame[2], energy: 300, status: 0,
  });
  const end = poseAt(replay, 1, 123 / 60);
  assert.equal(end.x, 133);
  assert.equal(end.y, -122);
  assert.equal(end.status, 2);
  assert.deepEqual(poseAt(replay, 1, 100), end);
  assert.deepEqual(replay.frames, framesBefore);
  assert.equal(poseAt(replay, -1, 0), null);
  assert.equal(poseAt(replay, 2, 0), null);
  const empty = { ...source, result: { ticks: 0 }, frames: new Float32Array() };
  assert.deepEqual(poseAt(empty, 0, 10), poseAt(empty, 0, 0));
});
