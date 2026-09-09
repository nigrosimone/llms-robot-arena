// Runs the published standings tournament and writes the static results used by
// the Tournament page and the README.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { parseArgs } from "node:util";
import { loadBots } from "../packages/bot-catalog-node.js";
import { botName } from "../packages/bot-catalog.js";
import { BotClient } from "../packages/runtime/client.js";
import { gateBot } from "../packages/runtime/gate.js";
import { runExhibition } from "../packages/tournament/exhibition.js";
import { renderStandings, updateStandingsSection } from "../packages/tournament/standings.js";

const root = fileURLToPath(new URL("../", import.meta.url));
try {
  const { values } = parseArgs({
    options: {
      bots: { type: "string" },
      format: { type: "string" },
      out: { type: "string" },
      readme: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "npm run standings -- --format round-robin --out packages/viewer/public/standings.json --readme README.md\nUse --format quick for a short run, --bots match-bots.json to pick the roster, --readme none to keep the README unchanged.",
    );
    process.exit(0);
  }
  const format = values.format ?? "round-robin";
  if (!["quick", "round-robin"].includes(format))
    throw Error("Format must be quick or round-robin.");
  const out = resolve(root, values.out ?? "packages/viewer/public/standings.json");
  const readme = values.readme === "none" ? null : resolve(root, values.readme ?? "README.md");
  const bots = await loadBots(values.bots ?? null);
  const createClient = () =>
    new BotClient(new Worker(new URL("../packages/runtime/node-worker.js", import.meta.url)));
  const gates = [];
  for (const bot of bots) {
    const client = createClient();
    try {
      const gate = await gateBot(client, bot.source, "fuel");
      gates.push({ id: bot.id, ...gate });
      console.log(
        `${botName(bot)}: admission ${gate.eligible ? "PASS" : "FAIL"}, full conformity ${gate.pass ? "PASS" : "FAIL"}, p99 ${gate.p99?.toFixed(3)} ms`,
      );
      if (!gate.eligible) throw Error("Conformity gate failed: " + botName(bot));
    } finally {
      client.close();
    }
  }
  const started = Date.now();
  const report = await runExhibition({
    bots, format, gates, createClient,
    onUpdate: (update) => {
      if (update.type !== "progress") return;
      const [a, b] = update.pairing;
      process.stdout.write(
        `\r${update.completed}/${update.total} · round ${update.round}/${update.rounds} · ${botName(a)} vs ${botName(b)}          `,
      );
    },
  });
  process.stdout.write("\r");
  // Source paths let the README link each controller; roster files outside the
  // project are published without a path.
  const files = new Map(bots.map((bot) => {
    const path = relative(root, bot.file).split(sep).join("/");
    return [bot.id, path.startsWith("..") ? null : path];
  }));
  const published = {
    ...report,
    bots: report.bots.map((bot) => ({ ...bot, file: files.get(bot.id) ?? null })),
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model,
    },
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(published) + "\n");
  const markdown = renderStandings(published);
  if (readme)
    await writeFile(readme, updateStandingsSection(await readFile(readme, "utf8"), markdown));
  console.log(markdown);
  console.log(
    `\n${report.records.length} matches in ${((Date.now() - started) / 60000).toFixed(1)} min -> ${out}${readme ? " and " + readme : ""}`,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
