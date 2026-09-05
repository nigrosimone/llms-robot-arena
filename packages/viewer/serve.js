// Static application and replay server using Node built-ins.
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../../", import.meta.url));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".md": "text/markdown",
  ".ts": "text/plain",
  ".zip": "application/zip",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
};
function safePath(base, relative) {
  const target = resolve(base, relative);
  return target.startsWith(base + sep) ? target : null;
}

export function createViewerServer({
  dist = resolve(root, "dist"),
  replays = resolve(root, "results"),
} = {}) {
  return createServer(async (req, res) => {
    function send(status, body, type = "text/plain; charset=utf-8") {
      res.writeHead(status, {
        "content-type": type,
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    }
    if (!["GET", "HEAD"].includes(req.method))
      return send(405, "Method not allowed");
    try {
      let path;
      try {
        path = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        );
      } catch {
        return send(400, "Invalid URL");
      }
      if (path === "/replays.json") {
        const entries = await readdir(replays, { withFileTypes: true }).catch(
          (error) => {
            if (error.code === "ENOENT") return [];
            throw error;
          },
        );
        const names = entries
          .filter(
            (e) =>
              e.isFile() &&
              e.name.endsWith(".json") &&
              !["ranking.json", "checkpoint.json", "results.json"].includes(
                e.name,
              ),
          )
          .map((e) => e.name)
          .sort();
        return send(
          200,
          JSON.stringify(names),
          "application/json; charset=utf-8",
        );
      }
      const isReplay = path.startsWith("/replays/");
      const relative = isReplay
        ? path.slice(9)
        : path === "/"
          ? "index.html"
          : path.slice(1);
      const file = safePath(isReplay ? replays : dist, relative);
      if (!file || path.includes("\0")) return send(403, "Forbidden");
      if (!(await stat(file)).isFile()) return send(404, "Not found");
      send(
        200,
        await readFile(file),
        types[extname(file)] || "application/octet-stream",
      );
    } catch (error) {
      send(
        error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : 500,
        "File unavailable",
      );
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: "8080" },
      replays: { type: "string", default: resolve(root, "results") },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log("npm run viewer -- --port 8080 --replays results");
  } else {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Invalid port.");
    await stat(resolve(root, "dist/app.js")).catch(() => {
      throw new Error("Build missing: run npm run build or npm start.");
    });
    const server = createViewerServer({ replays: resolve(values.replays) });
    server.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    server.listen(port, "127.0.0.1", () =>
      console.log(`llms-robot-arena: http://127.0.0.1:${server.address().port}/`),
    );
  }
}
