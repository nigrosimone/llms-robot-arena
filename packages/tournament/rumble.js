import { loadBots } from "../bot-catalog-node.js";
import { botName } from "../bot-catalog.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { parseArgs } from "node:util";
import { BotClient } from "../runtime/client.js";
import { runMatch } from "../runtime/match.js";
import { stringifyReplay } from "../sim/replay.js";

// Free-for-all: the whole roster spawns in one arena and the last robot
// standing wins. Controllers are unchanged, they still see one opponent.
const args = process.argv.slice(2);
try {
  const { values } = parseArgs({
    args,
    options: {
      bots: { type: "string" },
      out: { type: "string" },
      seed: { type: "string" },
      budget: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "node packages/tournament/rumble.js --seed 0 --out results/rumble.json\nAdd --bots match-bots.json to pick the roster. Rumbles are exhibitions: never ranked against duels.",
    );
    process.exit(0);
  }
  const seed = Number(values.seed ?? 0),
    budgetMode = values.budget ?? "fuel",
    out = resolve(values.out ?? "results/rumble.json");
  if (!Number.isInteger(seed) || seed < 0) throw Error("Seed must be a non-negative integer.");
  if (!["wall", "fuel"].includes(budgetMode)) throw Error("Invalid budget.");
  const bots = await loadBots(values.bots ?? null);
  const createClient = () =>
    new BotClient(new Worker(new URL("../runtime/node-worker.js", import.meta.url)));
  console.log(`Rumble: ${bots.length} controllers, seed ${seed}, ${budgetMode} budget.`);
  const replay = await runMatch({
    bots,
    seed,
    mode: "rumble",
    budgetMode,
    createClient,
    onProgress: (p) => process.stdout.write(`\r${(p * 100).toFixed(0)}%   `),
  });
  process.stdout.write("\r");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, stringifyReplay(replay));
  const standings = replay.result.standings ?? [];
  console.table(
    standings.map((robot, place) => ({
      place: place + 1,
      bot: botName(replay.bots[robot]),
      energy: replay.finalStates[robot].energy.toFixed(1),
      flips: replay.finalStates[robot].flipsTaken,
      status: replay.finalStates[robot].status,
    })),
  );
  console.log(
    `${replay.result.winner === null ? "Draw" : botName(replay.bots[replay.result.winner]) + " wins"} (${replay.result.reason}) after ${(replay.result.ticks / 60).toFixed(1)} s -> ${out}`,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
