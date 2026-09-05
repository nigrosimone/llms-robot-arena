import { loadBots } from "../bot-catalog-node.js";
import { botMetadata, botName } from "../bot-catalog.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { parseArgs } from "node:util";
import { BotClient } from "../runtime/client.js";
import { gateBot } from "../runtime/gate.js";
import { runMatch } from "../runtime/match.js";
import { matchRecord, rankTournament } from "./ranking.js";
import { stringifyReplay } from "../sim/replay.js";
import { renderReport, renderCSV } from "./report.js";
import { SPEC_VERSION, ENGINE_VERSION } from "../sim/spec.js";
import { digest } from "../sim/index.js";
const args = process.argv.slice(2);
try {
  const { values } = parseArgs({
    args,
    options: {
      bots: { type: "string" },
      out: { type: "string" },
      mode: { type: "string" },
      budget: { type: "string" },
      help: { type: "boolean" },
    },
  });
  const value = (name, fallback) => values[name.slice(2)] ?? fallback;
  if (args.includes("--help")) {
    console.log(
      "node packages/tournament/cli.js --bots match-bots.json --out results --mode one-shot --budget wall\nUse --budget fuel for deterministic diagnostic tournaments. Never combine rankings from different modes/budgets.",
    );
    process.exit(0);
  }
  const configPath = value("--bots", null),
    out = resolve(value("--out", "results")),
    mode = value("--mode", "one-shot"),
    budgetMode = value("--budget", "wall");
  if (
    !["one-shot", "iterative", "exhibition"].includes(mode) ||
    !["wall", "fuel"].includes(budgetMode)
  )
    throw Error("Invalid mode or budget.");
  const bots = await loadBots(configPath);
  const actualMode = configPath ? mode : "exhibition";
  const createClient = () =>
    new BotClient(
      new Worker(new URL("../runtime/node-worker.js", import.meta.url)),
    );
  const gates = [];
  for (const bot of bots) {
    const client = createClient();
    try {
      const gate = await gateBot(client, bot.source, budgetMode);
      gates.push({ id: bot.id, ...gate });
      console.log(
        `${botName(bot)}: ${budgetMode} admission ${gate.eligible ? "PASS" : "FAIL"}, full conformity ${gate.pass ? "PASS" : "FAIL"}, p99 ${gate.p99?.toFixed(3)} ms`,
      );
      if (!gate.eligible)
        throw Error(
          "Conformity gate failed: " + botName(bot) + "\n" + JSON.stringify(gate),
        );
    } finally {
      client.close();
    }
  }
  await mkdir(out, { recursive: true });
  const records = [],
    total = ((bots.length * (bots.length - 1)) / 2) * 20;
  for (let a = 0; a < bots.length; a++)
    for (let b = a + 1; b < bots.length; b++)
      for (let seed = 0; seed < 10; seed++)
        for (const mirrored of [false, true]) {
          const replay = await runMatch({
            bots: [bots[a], bots[b]],
            seed,
            mirrored,
            mode: actualMode,
            budgetMode,
            createClient,
          });
          const filename = `${a}-${b}-s${seed}-${mirrored ? "mirror" : "normal"}.json`;
          await writeFile(resolve(out, filename), stringifyReplay(replay));
          records.push({ ...matchRecord(replay, a, b), replay: filename });
          console.log(
            `${records.length}/${total}: ${botName(bots[a])} / ${botName(bots[b])} seed ${seed}${mirrored ? " M" : ""} → ${replay.result.winner === null ? "draw" : botName(replay.bots[replay.result.winner])} (${replay.result.reason})`,
          );
          await writeFile(
            resolve(out, "checkpoint.json"),
            JSON.stringify({ mode: actualMode, budgetMode, records }, null, 2),
          );
        }
  const ranking = rankTournament(bots, records),
    result = {
      specVersion: SPEC_VERSION,
      engineVersion: ENGINE_VERSION,
      mode: actualMode,
      budgetMode,
      replicates: 1000,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
      },
      bots: bots.map((b) => ({
        ...botMetadata(b),
        codeSha256: digest(b.source),
        file: basename(b.file),
      })),
      gates,
      records,
      ranking,
    };
  await writeFile(
    resolve(out, "ranking.json"),
    JSON.stringify(result, null, 2),
  );
  await writeFile(resolve(out, "ranking.csv"), renderCSV(ranking));
  await writeFile(resolve(out, "RESULTS.md"), renderReport(result));
  console.table(
    ranking.map((r) => ({
      bot: botName(r),
      BT: r.score.toFixed(1),
      CI95: r.ci.map((x) => x.toFixed(1)).join(" – "),
      score: (r.winRate * 100).toFixed(1) + "%",
    })),
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
