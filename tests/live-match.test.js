import test from "node:test";
import assert from "node:assert/strict";
import { runLiveMatch, HUMAN_BOT } from "../packages/runtime/live-match.js";
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
