import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseReplay, stringifyReplay } from "../packages/sim/replay.js";
import { samplePlayback } from "../packages/viewer/playback.js";

const demo = JSON.parse(
  await readFile(
    new URL("../packages/viewer/public/demo-replay.json", import.meta.url),
    "utf8",
  ),
);
test("seeking exact ticks and the final event tolerates seconds-to-ticks rounding", () => {
  for (const count of [123,246,7200]) {
    const replay={result:{ticks:count},initialFrame:Array(12).fill(0),frames:new Float32Array(count*12),arenaExtents:new Float32Array(count).fill(8),events:[{tick:count-1,type:'ring-out',robot:0}]};
    const end=samplePlayback(replay,count/60),before=samplePlayback(replay,(count-1)/60);
    assert.equal(end.tick,count);
    assert.equal(end.states[0].ringOut,true);
    assert.equal(before.tick,count-1);
    assert.equal(before.states[0].ringOut,false);
  }
});
test("replay imports validate supported rules and engine version pairs", () => {
  const legacy = {
    ...demo,
    energyMax: 100,
    arenaCells: [],
    initialFrame: [0, 0, 0, 100, 0, 0, 2, 0, 0, 100, 0, 0],
    frames: [0, 0, 0, 99, 0, 0, 2, 0, 0, 99, 0, 0],
    arenaExtents: [8],
    result: { winner: null, reason: "timeout", ticks: 1 },
    events: [],
    stateHashes: [],
  };
  for (const [specVersion, engineVersion] of [
    ["0.1.0-draft", "0.1.0-r1"],
    ["0.1.0-draft", "0.1.0-r2"],
    ["0.1.1-draft", "0.1.1-r1"],
  ])
    {
      const replay = parseReplay(JSON.stringify({ ...legacy, specVersion, engineVersion }));
      assert.ok(replay.frames instanceof Float32Array);
      assert.equal(samplePlayback(replay, 0).energyMax, 100);
      assert.deepEqual(replay.arenaCells, []);
    }
  assert.ok(parseReplay(JSON.stringify(demo)).frames instanceof Float32Array);
  assert.throws(
    () => parseReplay(JSON.stringify({ ...demo, specVersion: "0.1.0-draft", engineVersion: "0.1.1-r1" })),
    /Invalid replay version/,
  );
  const invalid = structuredClone(demo);
  invalid.initialFrame[4] = 9;
  assert.throws(() => parseReplay(JSON.stringify(invalid)), /Invalid robot state/);
  assert.throws(() => parseReplay("null"), /Invalid replay version or result/);
  assert.throws(
    () => parseReplay(JSON.stringify({ ...demo, bots: [null, null] })),
    /Missing bot metadata/,
  );
});
test("playback starts at the recorded spawn, interpolates and never alters its replay", () => {
  const replay = parseReplay(JSON.stringify(demo)),
    before = stringifyReplay(replay);
  const initial = samplePlayback(replay, 0),
    half = samplePlayback(replay, 1 / 120);
  assert.equal(initial.states[0].x, replay.initialFrame[0]);
  assert.equal(
    half.states[0].x,
    (replay.initialFrame[0] + replay.frames[0]) / 2,
  );
  samplePlayback(replay, 25);
  samplePlayback(replay, 0);
  samplePlayback(replay, 120);
  assert.equal(stringifyReplay(replay), before);
});
test("ring-out animation continues visually after the final recorded tick", () => {
  const frame = [8.1, 0, 0, 25, 0, 0, 0, 0, 0, 50, 0, 0];
  const replay = {
    result: { ticks: 1 },
    initialFrame: frame,
    frames: new Float32Array(frame),
    arenaExtents: new Float32Array([8]),
    events: [{ tick: 0, type: "ring-out", robot: 0 }],
  };
  const sample = samplePlayback(replay, 1 + 1 / 60);
  assert.equal(sample.time, 1 / 60);
  assert.ok(sample.states[0].x > 9);
  assert.ok(Math.abs(sample.states[0].z + 4.9) < 1e-12);
  assert.equal(sample.states[1].z, 0);
  assert.equal(sample.states[0].energy, 25);
});
test("flip and self-right use the recorded impact axis and smooth half-second animation", () => {
  const frame = [0, 0, 0, 25, 1, 4, 2, 2, 0, 50, 0, 0];
  const replay = {
    result: { ticks: 400 },
    initialFrame: frame,
    frames: new Float32Array(Array.from({ length: 400 }, () => frame).flat()),
    arenaExtents: new Float32Array(400).fill(8),
    events: [
      { tick: 0, type: "flip", robot: 0, axis: [1, 0] },
      { tick: 240, type: "recovery", robot: 0 },
    ],
  };
  assert.ok(
    Math.abs(
      samplePlayback(replay, 1 / 60 + 0.25).states[0].rotation - Math.PI / 2,
    ) < 1e-9,
  );
  assert.deepEqual(samplePlayback(replay, 1).states[0].axis, [1, 0]);
  assert.ok(
    Math.abs(
      samplePlayback(replay, 241 / 60 + 0.25).states[0].rotation - Math.PI / 2,
    ) < 1e-9,
  );
  assert.equal(samplePlayback(replay, 5).states[0].rotation, 0);
});
