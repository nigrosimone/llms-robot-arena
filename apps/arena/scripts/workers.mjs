// The Angular builder rewrites `new Worker(new URL(...))` in application code,
// but not inside a worker: the bot sandbox that match-worker.js spawns is
// invisible to it. Bundle that one with esbuild and ship it as an asset, where
// the untouched relative URL happens to resolve.
import { build } from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [resolve(here, "../../../packages/runtime/bot-worker.js")],
  outfile: resolve(here, "../public/bot-worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  logLevel: "info",
});
