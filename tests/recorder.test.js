import test from "node:test";
import assert from "node:assert/strict";
import { eventCue } from "../packages/viewer/audio.js";
import {
  pickRecordingType,
  recordingFilename,
  introCard,
  matchOutcome,
} from "../packages/viewer/recorder.js";

const bots = [
  { id: "alpha", model: "Alpha One", provider: "OpenAI" },
  { id: "beta", model: "Beta Two", provider: "Anthropic" },
];
const replay = { seed: 7, mirrored: false, bots, result: { winner: 1, reason: "ring-out" } };

test("recording prefers mp4 and falls back to webm", () => {
  assert.equal(pickRecordingType(() => true).extension, "mp4");
  assert.equal(
    pickRecordingType((mime) => mime.startsWith("video/webm")).extension,
    "webm",
  );
  assert.equal(pickRecordingType(() => false), null);
});

test("a clip with sound asks for a container that carries an audio codec", () => {
  assert.equal(pickRecordingType(() => true, true).mime, "video/mp4;codecs=avc1.4d002a,mp4a.40.2");
  assert.equal(
    pickRecordingType((mime) => mime.includes("opus"), true).mime,
    "video/webm;codecs=vp9,opus",
  );
  // No container takes the audio track: the clip is still recorded, silent.
  assert.equal(pickRecordingType((mime) => mime === "video/mp4;codecs=avc1.4d002a", true).mime, "video/mp4;codecs=avc1.4d002a");
});

test("every replay event that deserves a sound maps to one cue", () => {
  assert.deepEqual(eventCue({ type: "impact", closingSpeed: 2.5 }), { cue: "impact", strength: 0.5 });
  assert.equal(eventCue({ type: "hole", robot: 0 }).cue, "fall");
  assert.equal(eventCue({ type: "collapse", cell: "floor-1" }).cue, "collapse");
  assert.equal(eventCue({ type: "violation", robot: 0 }), null);
});

test("the file name carries both controllers and the seed", () => {
  assert.equal(
    recordingFilename(replay, "mp4"),
    "llms-robot-arena-alpha-one-vs-beta-two-seed-7.mp4",
  );
  assert.equal(
    recordingFilename({ seed: 3, bots: [...bots, ...bots] }, "webm"),
    "llms-robot-arena-rumble-4-seed-3.webm",
  );
  assert.equal(recordingFilename(null, "webm"), "llms-robot-arena-match-seed-0.webm");
});

test("the intro card names every robot in roster order", () => {
  const card = introCard(replay);
  assert.equal(card.seed, "SEED 07");
  assert.deepEqual(
    card.robots.map((robot) => [robot.label, robot.name, robot.provider]),
    [
      ["ROBOT A", "Alpha One", "OpenAI"],
      ["ROBOT B", "Beta Two", "Anthropic"],
    ],
  );
  assert.notEqual(card.robots[0].color, card.robots[1].color);
  assert.equal(introCard({ ...replay, bots: [...bots, ...bots] }).title, "Royal rumble");
  assert.equal(introCard({ ...replay, mirrored: true }).seed, "SEED 07 · MIRRORED");
});

test("the outcome is the winner and the reason for it", () => {
  assert.deepEqual(matchOutcome(replay), { title: "Beta Two wins.", reason: "Ring-out" });
  assert.equal(
    matchOutcome({ ...replay, result: { winner: null, reason: "timeout" } }).title,
    "Draw.",
  );
  assert.equal(
    matchOutcome({
      ...replay,
      result: { winner: 0, reason: "timeout", decision: "center" },
    }).reason,
    "Timeout · closest to center",
  );
  assert.deepEqual(matchOutcome(null), { title: "", reason: "" });
});
