import { writeFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { BotClient } from "../packages/runtime/client.js";
import { runMatch } from "../packages/runtime/match.js";
import { stringifyReplay } from "../packages/sim/replay.js";
import { loadBots } from "../packages/bot-catalog-node.js";
const bots = (await loadBots()).slice(0, 2);
const replay = await runMatch({
  bots,
  seed: 0,
  mode: "exhibition",
  budgetMode: "fuel",
  createClient: () =>
    new BotClient(
      new Worker(
        new URL("../packages/runtime/node-worker.js", import.meta.url),
      ),
    ),
});
await writeFile(
  new URL("../packages/viewer/public/demo-replay.json", import.meta.url),
  stringifyReplay(replay),
);
console.log(
  JSON.stringify({
    result: replay.result,
    events: replay.events.length,
    flips: replay.finalStates.map((r) => r.flipsTaken),
    violations: replay.violations,
    frames: replay.frames.length,
  }),
);
