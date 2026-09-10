import { build } from "esbuild";
import { mkdir, readFile, writeFile, cp, lstat, realpath, rm } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBots } from "../packages/bot-catalog-node.js";
import { renderSite } from "../packages/site/prerender.js";

const bots = await loadBots();
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
              bots.map(({ file, ...bot }) => ({
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
// Static pages, sitemap, robots and llms.txt for readers that never run the app.
const site = renderSite({
  index: await readFile(resolve(dist, "index.html"), "utf8"),
  bots,
  standings: await readFile(resolve(dist, "standings.json"), "utf8").then(JSON.parse, () => null),
  ...(process.env.SITE_URL ? { baseUrl: process.env.SITE_URL } : {}),
});
for (const [path, content] of site) {
  const file = resolve(dist, path);
  if (!file.startsWith(dist + sep)) throw new Error("Generated page outside the build output.");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}
console.log(`Build ready in dist/, ${site.size} static files. Start with: npm run viewer`);
