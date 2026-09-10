import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createViewerServer } from "../packages/viewer/serve.js";

test("local server serves the built app and replay list without exposing parent files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "arena-server-")),
    dist = join(root, "dist"),
    replays = join(root, "results");
  await mkdir(dist);
  await mkdir(replays);
  await writeFile(join(dist, "index.html"), "<html>Robot Arena</html>");
  await mkdir(join(dist, "rules"));
  await writeFile(join(dist, "rules", "index.html"), "<html>Rules</html>");
  await writeFile(join(replays, "match 1.json"), "{}");
  await writeFile(join(replays, "ranking.json"), "{}");
  await writeFile(join(root, "private.txt"), "private");
  const server = createViewerServer({ dist, replays });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(base)).text(), "<html>Robot Arena</html>");
  assert.deepEqual(await (await fetch(base + "/replays.json")).json(), [
    "match 1.json",
  ]);
  assert.equal((await fetch(base + "/replays/match%201.json")).status, 200);
  // Static pages are directories, the same way GitHub Pages serves them.
  assert.equal(await (await fetch(base + "/rules/")).text(), "<html>Rules</html>");
  const redirect = await fetch(base + "/rules", { redirect: "manual" });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), "/rules/");
  assert.equal((await fetch(base + "/%2e%2e%2fprivate.txt")).status, 403);
  assert.equal((await fetch(base + "/%E0%A4%A")).status, 400);
  assert.equal((await fetch(base, { method: "POST" })).status, 405);
  const head = await fetch(base, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});
