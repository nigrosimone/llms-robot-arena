import { build } from "esbuild";
import { mkdir, writeFile, cp, lstat, realpath, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBots } from "../packages/bot-catalog-node.js";

const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const dist = resolve(root, "dist");
// Only the generated directory directly inside this project may be removed.
if (dirname(dist) !== root) throw new Error("Invalid build output directory.");
const previous = await lstat(dist).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (previous?.isSymbolicLink())
  throw new Error("Build output must not be a symbolic link or junction.");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: {
    app: "packages/viewer/app.js",
    "bot-worker": "packages/runtime/bot-worker.js",
    "match-worker": "packages/runtime/match-worker.js",
  },
  bundle: true,
  format: "esm",
  splitting: true,
  outdir: dist,
  platform: "browser",
  target: "es2022",
  minify: true,
  logLevel: "info",
  plugins: [
    {
      name: "bot-catalog",
      setup(b) {
        b.onResolve({ filter: /^arena:bots$/ }, () => ({
          path: "bots",
          namespace: "bot-catalog",
        }));
        b.onLoad({ filter: /.*/, namespace: "bot-catalog" }, async () => ({
          contents:
            "export default " + JSON.stringify(
              (await loadBots()).map(({ file, ...bot }) => ({
                ...bot, extension: file.endsWith(".ts") ? "ts" : "js",
              })),
            ),
          loader: "js",
        }));
      },
    },
  ],
});
await cp(resolve(root, "packages/viewer/public"), dist, { recursive: true });
await writeFile(resolve(dist, "replays.json"), "[]\n");
console.log("Build ready in dist/. Start with: npm run viewer");
