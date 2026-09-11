import test from "node:test";
import assert from "node:assert/strict";
import { clipTimeline, videoConfigs, audioConfigs } from "../packages/renderer/clip.js";

test("a clip is the intro card, one frame per tick and the verdict", () => {
  const t = clipTimeline(33.5, 60);
  assert.deepEqual(t, { intro: 240, match: 2011, outro: 180, total: 2431, step: 1e6 / 60 });
  assert.equal(clipTimeline(0, 30).match, 1);
});

test("encoder configurations prefer High profile on hardware and keep the clip size", () => {
  const configs = videoConfigs({ width: 1920, height: 1080, fps: 60 });
  assert.deepEqual(configs.map((c) => [c.codec, c.hardwareAcceleration]), [
    ["avc1.640028", "prefer-hardware"], ["avc1.640028", "no-preference"],
    ["avc1.4d002a", "prefer-hardware"], ["avc1.4d002a", "no-preference"],
  ]);
  assert.ok(configs.every((c) => c.width === 1920 && c.height === 1080 && c.framerate === 60 && c.avc.format === "avc"));
  assert.deepEqual(audioConfigs(48000).map((c) => c.codec), ["opus", "mp4a.40.2"]);
});
