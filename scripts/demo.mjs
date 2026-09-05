import { writeFile, readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { BotClient } from "../packages/runtime/client.js";
import { runMatch } from "../packages/runtime/match.js";
import { stringifyReplay } from "../packages/sim/replay.js";
const bots = await Promise.all(
  [
    {
      id: "gpt-6-astra-ultra",
      model: "GPT-6 Astra · iterative development",
    },
    { id: "fable-5-6-max", model: "Fable 5.6 Max · local submission" },
  ].map(async (bot) => ({
    ...bot,
    source: await readFile(`packages/bots/${bot.id}.js`, "utf8"),
  })),
);
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
  "packages/viewer/public/demo-replay.json",
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
