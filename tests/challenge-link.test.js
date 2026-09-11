import test from "node:test";
import assert from "node:assert/strict";
import {
  challengeFromReplay,
  encodeChallenge,
  decodeChallenge,
  readChallenge,
  challengeFragment,
} from "../packages/viewer/challenge-link.js";
import { runLiveMatch } from "../packages/runtime/live-match.js";
import { mulberry32 } from "../packages/sim/spec.js";

const inertClient = () => ({
  async request(message) {
    return message.type === "init" ? { ready: true } : { actions: { thrust: 0, turn: 0 }, memory: null, violations: [] };
  },
  close() {},
});
const bot = { id: "opponent", model: "Opponent", source: "export function tick() {}" };
const challenge = {
  engineVersion: "0.2.2-r2",
  seed: 123456789,
  mirrored: true,
  player: 0,
  botId: "opus-5-1-max",
  sha: "0123456789abcdef",
  inputs: [[0, 7], [12, 8], [13, 4], [400, 1]],
};

test("a challenge survives the trip through the fragment", async () => {
  const encoded = await encodeChallenge(challenge);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeChallenge(encoded), challenge);
  assert.equal(readChallenge(challengeFragment(encoded)), encoded);
  assert.equal(readChallenge("#other=1&m=" + encoded), encoded);
  assert.equal(readChallenge(""), null);
  assert.equal(readChallenge("#replay"), null);
  assert.deepEqual(await decodeChallenge(await encodeChallenge({ ...challenge, inputs: [] })), { ...challenge, inputs: [] });
});

test("a two minute drive with a change every few ticks stays around a kilobyte", async () => {
  const rng = mulberry32(9);
  const inputs = [];
  let code = 4;
  for (let tick = 0; tick < 7200; tick += 8 + Math.floor(rng() * 16)) {
    code = (code + 1 + Math.floor(rng() * 8)) % 9;
    inputs.push([tick, code]);
  }
  assert.ok(inputs.length > 400);
  const encoded = await encodeChallenge({ ...challenge, inputs });
  assert.ok(encoded.length < 1400, `${encoded.length} characters`);
  assert.deepEqual((await decodeChallenge(encoded)).inputs, inputs);
});

test("damaged or forged links are refused with one message", async () => {
  const encoded = await encodeChallenge(challenge);
  const forged = async (payload) => {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const deflated = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    return btoa(String.fromCharCode(...deflated)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const base = [1, "0.2.2-r2", 1, 0, 0, "bot", "0123456789abcdef", [0, 7, 5, 8]];
  const bad = [
    "",
    "not base64!",
    encoded.slice(0, -4) + "AAAA",
    await forged({ a: 1 }),
    await forged([2, ...base.slice(1)]),
    await forged([1, "0.2.2-r2", -1, 0, 0, "bot", "0123456789abcdef", [0, 7]]),
    await forged([1, "0.2.2-r2", 1, 2, 0, "bot", "0123456789abcdef", [0, 7]]),
    await forged([1, "0.2.2-r2", 1, 0, 0, "", "0123456789abcdef", [0, 7]]),
    await forged([1, "0.2.2-r2", 1, 0, 0, "bot", "xyz", [0, 7]]),
    await forged([1, "0.2.2-r2", 1, 0, 0, "bot", "0123456789abcdef", [0, 9]]),
    await forged([1, "0.2.2-r2", 1, 0, 0, "bot", "0123456789abcdef", [0, 7, 0, 8]]),
    await forged([1, "0.2.2-r2", 1, 0, 0, "bot", "0123456789abcdef", [7200, 7]]),
    await forged([1, "0.2.2-r2", 1, 0, 0, "bot", "0123456789abcdef", [0, 7, 1]]),
    await forged([1, "0.2.2-r2", 1, 0, 0, "bot", "0123456789abcdef", [0, -1]]),
  ];
  for (const text of bad) await assert.rejects(decodeChallenge(text), /challenge link is damaged/, text.slice(0, 40));
  assert.deepEqual(await decodeChallenge(await forged(base)), {
    engineVersion: "0.2.2-r2", seed: 1, mirrored: false, player: 0, botId: "bot", sha: "0123456789abcdef", inputs: [[0, 7], [5, 8]],
  });
});

test("a manual replay becomes a challenge, other replays do not", async () => {
  const replay = await runLiveMatch({
    bot,
    seed: 5,
    mirrored: true,
    createClient: inertClient,
    readInput: (tick) => ({ thrust: 1, turn: tick < 30 ? 1 : 0 }),
    pacer: async () => {},
  });
  const c = challengeFromReplay(replay);
  assert.equal(c.seed, 5);
  assert.equal(c.mirrored, true);
  assert.equal(c.player, 0);
  assert.equal(c.botId, "opponent");
  assert.equal(c.sha, replay.bots[1].codeSha256.slice(0, 16));
  assert.deepEqual(c.inputs, replay.inputs[0]);
  assert.deepEqual(await decodeChallenge(await encodeChallenge(c)), c);
  assert.throws(() => challengeFromReplay({ ...replay, mode: "exhibition" }), /manual duels/);
  assert.throws(() => challengeFromReplay({ ...replay, inputs: undefined }), /manual duels/);
});
