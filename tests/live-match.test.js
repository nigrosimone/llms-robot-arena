import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import {
  runLiveMatch,
  resimulateLiveMatch,
  encodeInput,
  decodeInput,
  replayInputs,
  HUMAN_BOT,
} from "../packages/runtime/live-match.js";
import { BotClient } from "../packages/runtime/client.js";
import { stringifyReplay, parseReplay } from "../packages/sim/replay.js";

const inertClient = () => ({
  requests: 0,
  async request(message) {
    this.requests++;
    return message.type === "init"
      ? { ready: true }
      : { actions: { thrust: 0, turn: 0 }, memory: null, violations: [] };
  },
  close() {
    this.closed = true;
  },
});
const bot = { id: "opponent", model: "Opponent", source: "public inert test fixture" };
const instant = async () => {};

test("a manual match streams every tick and closes an exportable replay", async () => {
  const ticks = [];
  let client;
  const replay = await runLiveMatch({
    bot,
    seed: 7,
    createClient: () => (client = inertClient()),
    readInput: () => ({ thrust: 1, turn: 0 }),
    onTick: (update) => ticks.push(update),
    pacer: instant,
  });
  const streamed = ticks.filter((u) => u.type === "live-tick");
  assert.equal(ticks[0].type, "live-start");
  assert.equal(replay.mode, "manual");
  assert.equal(replay.seed, 7);
  assert.equal(replay.result.ticks, streamed.length);
  assert.equal(replay.bots[0].id, HUMAN_BOT.id);
  assert.equal(replay.bots[1].id, "opponent");
  assert.equal(replay.runtime.control, "keyboard");
  // Full thrust from the spawn corner crosses the arena without any opposition.
  assert.ok(["ring-out", "hole"].includes(replay.result.reason));
  assert.equal(client.closed, true);
  assert.equal(client.requests, streamed.length + 1);
  // What the viewer receives frame by frame is what the closed replay contains.
  assert.deepEqual(
    [...new Float32Array(streamed.flatMap((u) => [...u.frame]))],
    [...replay.frames],
  );
  assert.deepEqual(
    [...new Float32Array(streamed.map((u) => u.extent))],
    [...replay.arenaExtents],
  );
  assert.deepEqual(
    streamed.flatMap((u) => u.events),
    replay.events,
  );
  // Driving over a fresh tile creates its floor cell: the stream must carry it,
  // or the viewer cannot show the floor wearing down under a manual match.
  assert.ok(streamed.some((u) => u.cells.length));
  assert.deepEqual(
    [...ticks[0].arenaCells, ...streamed.flatMap((u) => u.cells)],
    replay.arenaCells,
  );
  assert.doesNotThrow(() => parseReplay(stringifyReplay(replay)));
});

test("keyboard input reaches the engine on every tick", async () => {
  const positions = [];
  for (const thrust of [1, 0]) {
    const ticks = [];
    let reads = 0;
    await runLiveMatch({
      bot,
      createClient: inertClient,
      readInput: () => {
        reads++;
        return { thrust, turn: 0 };
      },
      onTick: (update) => update.type === "live-tick" && ticks.push(update),
      stopped: () => ticks.length >= 120,
      pacer: instant,
    });
    assert.equal(reads, ticks.length);
    positions.push(Math.hypot(ticks.at(-1).frame[0], ticks.at(-1).frame[1]));
  }
  assert.ok(positions[0] < positions[1] - 1);
});

test("leaving a manual match stops the loop without a replay", async () => {
  const ticks = [];
  const replay = await runLiveMatch({
    bot,
    createClient: inertClient,
    readInput: () => ({ thrust: 0, turn: 0 }),
    onTick: (update) => update.type === "live-tick" && ticks.push(update),
    stopped: () => ticks.length >= 10,
    pacer: instant,
  });
  assert.equal(replay, null);
  assert.equal(ticks.length, 10);
});

test("inputs are quantized to nine states and logged only when they change", async () => {
  const script = (tick) =>
    tick < 20 ? { thrust: 0.4, turn: -3 } : tick < 40 ? { thrust: 1, turn: NaN } : { thrust: 1, turn: 0 };
  const replay = await runLiveMatch({
    bot,
    createClient: inertClient,
    readInput: script,
    pacer: instant,
  });
  assert.deepEqual(replay.inputs, [[[0, 6], [20, 7]], null]);
  assert.deepEqual(decodeInput(6), { thrust: 1, turn: -1 });
  assert.equal(encodeInput(), 4);
  for (let code = 0; code < 9; code++) assert.equal(encodeInput(decodeInput(code)), code);
  const read = replayInputs(replay.inputs[0]);
  assert.deepEqual([read(0), read(19), read(20), read(500)].map(encodeInput), [6, 6, 7, 7]);
  assert.doesNotThrow(() => parseReplay(stringifyReplay(replay)));
});

test("a manual match is rebuilt hash for hash from its seed, controller and input log", async () => {
  const baseline = {
    id: "baseline",
    model: "Baseline",
    source: await readFile(new URL("../packages/bots/baseline.js", import.meta.url), "utf8"),
  };
  const createClient = () =>
    new BotClient(new Worker(new URL("../packages/runtime/node-worker.js", import.meta.url)));
  // A drive with a few turns, ending in the void: enough log entries and collisions.
  const script = (tick) => ({ thrust: 1, turn: tick < 45 ? 1 : tick < 90 ? -1 : 0 });
  const played = await runLiveMatch({ bot: baseline, seed: 11, createClient, readInput: script, pacer: instant });
  assert.ok(played.inputs[0].length >= 3);
  const rebuilt = await resimulateLiveMatch({
    bot: baseline,
    seed: 11,
    inputs: played.inputs,
    createClient,
  });
  assert.deepEqual(rebuilt.stateHashes, played.stateHashes);
  assert.deepEqual([...rebuilt.frames], [...played.frames]);
  assert.deepEqual(rebuilt.result, played.result);
  assert.deepEqual(rebuilt.inputs, played.inputs);
  assert.equal(rebuilt.runtime.control, "replayed");
});

test("the replay parser rejects a malformed input log", async () => {
  const replay = await runLiveMatch({
    bot,
    createClient: inertClient,
    readInput: () => ({ thrust: 1, turn: 0 }),
    pacer: instant,
  });
  const withInputs = (inputs) => stringifyReplay({ ...replay, inputs });
  assert.doesNotThrow(() => parseReplay(withInputs([[], null])));
  for (const inputs of [
    [[[0, 7]]],
    [[[0, 9]], null],
    [[[5, 7], [5, 4]], null],
    [[[replay.result.ticks, 7]], null],
    [[[0, 7, 1]], null],
    [[0, 7], null],
    "none",
  ])
    assert.throws(() => parseReplay(withInputs(inputs)), /input log/, JSON.stringify(inputs));
});
