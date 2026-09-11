// The Angular builder bundles the match worker it sees in the app, not the bot
// worker that one spawns: esbuild puts it next to the app as a plain asset.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: { "bot-worker": "packages/runtime/bot-worker.js" },
  bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true,
  outdir: fileURLToPath(new URL("../public/", import.meta.url)),
  logLevel: "info",
});
