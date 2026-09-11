// Generates one controller with Claude Code or Codex and registers it.
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { generateBot, HARNESSES } from "../packages/generation/generate.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const usage = `npm run generate -- --harness codex --model gpt-5.6-luna --thinking max --name "GPT-5.6 Luna"
Options: --id <catalog id> (default: name slug + thinking), --max-cost <usd> (Claude Code only),
         --timeout <minutes> (180), --dry-run (prepare the workspace, print the command), --keep (keep the workspace),
         --host (run the harness on this machine instead of the docker container)
Harnesses: ${Object.keys(HARNESSES).join(", ")}`;
try {
  const { values } = parseArgs({
    options: {
      harness: { type: "string" }, model: { type: "string" }, thinking: { type: "string" },
      name: { type: "string" }, id: { type: "string" }, "max-cost": { type: "string" },
      timeout: { type: "string" }, "dry-run": { type: "boolean" }, keep: { type: "boolean" }, host: { type: "boolean" }, help: { type: "boolean" },
    },
  });
  if (values.help || !values.harness || !values.model || !values.thinking || !values.name) {
    console.log(usage);
    process.exit(values.help ? 0 : 2);
  }
  const result = await generateBot({
    root, harness: values.harness, model: values.model, thinking: values.thinking, name: values.name,
    ...(values.id ? { id: values.id } : {}),
    maxCost: values["max-cost"] ? Number(values["max-cost"]) : null,
    timeoutMinutes: values.timeout ? Number(values.timeout) : 180,
    dryRun: Boolean(values["dry-run"]), keep: Boolean(values.keep), mode: values.host ? "host" : "docker",
  });
  if (result.dryRun) console.log(`Workspace ${values.keep ? "kept" : "removed"}: ${result.dir}`);
  else {
    const m = result.manifest;
    console.log(`Registered ${m.id}: ${m.turns} turns, ${(m.durationMs / 60000).toFixed(1)} min` +
      (m.cost != null ? `, $${m.cost.toFixed(2)}` : "") +
      `; against Baseline ${m.baseline.wins}/${m.baseline.draws}/${m.baseline.losses} (${(m.baseline.score * 100).toFixed(1)}%).`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
