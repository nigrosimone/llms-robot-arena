import { build } from "esbuild";
import { mkdir, readFile, writeFile, cp, lstat, realpath, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
      name: "raw",
      setup(b) {
        b.onResolve({ filter: /\?raw$/ }, (a) => ({
          path: resolve(a.resolveDir, a.path.slice(0, -4)),
          namespace: "raw",
        }));
        b.onLoad({ filter: /.*/, namespace: "raw" }, async (a) => ({
          contents:
            "export default " + JSON.stringify(await readFile(a.path, "utf8")),
          loader: "js",
        }));
      },
    },
  ],
});
await cp(resolve(root, "packages/viewer/public"), dist, { recursive: true });
await writeFile(resolve(dist, "replays.json"), "[]\n");
console.log("Build ready in dist/. Start with: npm run viewer");
