// Rebuilds a manual match in Node from its input log and reports whether the
// state hashes match. Takes an exported replay (compared hash by hash) or a
// challenge link (rebuilt and summarized, there is nothing to compare).
import { readFile, stat } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { loadBots } from "../packages/bot-catalog-node.js";
import { botName } from "../packages/bot-catalog.js";
import { BotClient } from "../packages/runtime/client.js";
import { resimulateLiveMatch } from "../packages/runtime/live-match.js";
import { parseReplay } from "../packages/sim/replay.js";
import { digest } from "../packages/sim/index.js";
import { ENGINE_VERSION } from "../packages/sim/spec.js";
import {
  SHA_PREFIX,
  challengeFromReplay,
  decodeChallenge,
  readChallenge,
} from "../packages/viewer/challenge-link.js";

const usage = "Usage: npm run verify -- <replay.json | challenge link>";
const [target] = process.argv.slice(2);
if (!target) {
  console.error(usage);
  process.exit(2);
}
const createClient = () =>
  new BotClient(new Worker(new URL("../packages/runtime/node-worker.js", import.meta.url)));
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const isFile = await stat(target).then((s) => s.isFile(), () => false);
let replay = null, challenge;
if (isFile) {
  replay = parseReplay(await readFile(target, "utf8"));
  challenge = challengeFromReplay(replay);
} else {
  const encoded = readChallenge(target.includes("#") ? target.slice(target.indexOf("#")) : "#m=" + target);
  if (!encoded) fail("Not a replay file or a challenge link. " + usage);
  challenge = await decodeChallenge(encoded);
}

const bots = await loadBots();
const bot = bots.find((b) => b.id === challenge.botId);
if (!bot) fail(`Unknown controller "${challenge.botId}".`);
const sha = digest(bot.source);
if (challenge.engineVersion !== ENGINE_VERSION)
  fail(`Recorded with engine ${challenge.engineVersion}, this checkout runs ${ENGINE_VERSION}.`);
if (replay ? sha !== replay.bots[1 - challenge.player].codeSha256 : sha.slice(0, SHA_PREFIX) !== challenge.sha)
  fail(`${botName(bot)} was updated after this match was played.`);

const inputs = [];
inputs[challenge.player] = challenge.inputs;
const rebuilt = await resimulateLiveMatch({
  bot,
  seed: challenge.seed,
  mirrored: challenge.mirrored,
  player: challenge.player,
  inputs,
  createClient,
});
const winner = rebuilt.result.winner === null ? "draw" : rebuilt.result.winner === challenge.player ? "human wins" : `${botName(bot)} wins`;
console.log(`Seed ${challenge.seed}${challenge.mirrored ? " mirrored" : ""} vs ${botName(bot)}: ${winner} by ${rebuilt.result.reason} after ${rebuilt.result.ticks} ticks, ${challenge.inputs.length} input changes.`);
if (!replay) {
  console.log(`Final hash ${rebuilt.stateHashes.at(-1).hash}`);
  process.exit(0);
}
const mismatch = replay.stateHashes.findIndex(
  (h, i) => h.tick !== rebuilt.stateHashes[i]?.tick || h.hash !== rebuilt.stateHashes[i]?.hash,
);
if (mismatch >= 0 || replay.stateHashes.length !== rebuilt.stateHashes.length)
  fail(`MISMATCH at tick ${replay.stateHashes[mismatch]?.tick ?? "end"}: the replay was not produced by this engine, controller and input log.`);
console.log(`OK: ${replay.stateHashes.length} state hashes match.`);
