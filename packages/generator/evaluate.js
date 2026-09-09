import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { botCatalog } from "../bot-catalog.js";
import { projectRoot } from "../bot-catalog-node.js";
import { BotClient } from "../runtime/client.js";
import { gateBot } from "../runtime/gate.js";
import { runMatch } from "../runtime/match.js";
import { matchRecord } from "../tournament/ranking.js";

export const createClient = () =>
  new BotClient(new Worker(new URL("../runtime/node-worker.js", import.meta.url)));

export async function gateSource(source, budgetMode = "fuel") {
  const client = createClient();
  try {
    return await gateBot(client, source, budgetMode);
  } finally {
    client.close();
  }
}

// Opponent sources are opaque inputs to the standard runner: loaded, never inspected,
// printed or forwarded to a model.
export async function loadOpponent(reference) {
  const entry = botCatalog.find(bot => bot.id === reference);
  const file = entry ? resolve(projectRoot, entry.file) : resolve(reference);
  const definition = entry ?? {
    id: basename(file).replace(/\.(js|ts)$/, ""),
    model: "Local controller", provider: null, file,
  };
  return { ...definition, file, source: await readFile(file, "utf8") };
}

// Standard protocol: 10 seeds with both spawn assignments, 20 matches per pair.
export async function runSeries({
  bot, opponent, seeds = 10, budgetMode = "fuel", mode = "iterative",
  onMatch = () => {}, createClient: clientFactory = createClient,
}) {
  const records = [];
  for (let seed = 0; seed < seeds; seed++)
    for (const mirrored of [false, true]) {
      const replay = await runMatch({
        bots: [bot, opponent], seed, mirrored, mode, budgetMode, createClient: clientFactory,
      });
      const record = matchRecord(replay, 0, 1);
      records.push(record);
      onMatch(record, records.length, seeds * 2);
    }
  const count = value => records.filter(record => record.score === value).length;
  const wins = count(1), losses = count(0), draws = count(0.5);
  const points = records.reduce((total, record) => total + record.score, 0);
  return {
    matches: records.length, wins, draws, losses,
    score: records.length ? points / records.length : 0,
    beatsOpponent: wins > losses,
    violations: records.reduce((total, record) => total + record.violations[0], 0),
    records,
  };
}
