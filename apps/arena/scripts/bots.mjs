// The controllers and their sources as a static asset: the Angular builder has
// no equivalent of the esbuild plugin that inlines them today.
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBots } from "../../../packages/bot-catalog-node.js";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../public/bots.json");
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  JSON.stringify(
    (await loadBots()).map(({ file, ...bot }) => ({
      ...bot,
      extension: file.endsWith(".ts") ? "ts" : "js",
    })),
  ),
);
console.log("Wrote", out);
