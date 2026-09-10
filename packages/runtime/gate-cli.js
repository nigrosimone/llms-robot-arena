import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { BotClient } from "./client.js";
import { gateBot } from "./gate.js";
const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run gate -- controller.js");
  process.exit(1);
}
const client = new BotClient(
  new Worker(new URL("./node-worker.js", import.meta.url)),
);
try {
  const gate = await gateBot(client, await readFile(path, "utf8"), "wall");
  console.log(JSON.stringify(gate, null, 2));
  if (!gate.pass) process.exitCode = 1;
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  client.close();
}
