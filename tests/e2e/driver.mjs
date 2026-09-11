// End-to-end driver: the built site served from dist/, a local Chrome in new
// headless mode driven over the DevTools protocol. No dependency, no browser
// download; the GPU is used when the machine has one so the viewer runs as it
// does for a visitor.
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createViewerServer } from "../../packages/viewer/serve.js";

const CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const exists = (path) => access(path).then(() => true, () => false);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function findChrome() {
  for (const path of CANDIDATES) if (await exists(path)) return path;
  return null;
}

export async function startSite() {
  const server = createViewerServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

// One browser per suite; each test opens its own page.
export async function launchBrowser({ mobile = false } = {}) {
  const chrome = await findChrome();
  if (!chrome) throw Error("Chrome not found: set CHROME to its executable.");
  const profile = await mkdtemp(join(tmpdir(), "arena-e2e-"));
  const downloads = join(profile, "downloads");
  const port = 9300 + Math.floor(Math.random() * 500);
  const process_ = spawn(chrome, [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    ...(process.platform === "win32"
      ? ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
    "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    mobile ? "--window-size=412,915" : "--window-size=1400,1000", "about:blank",
  ], { stdio: "ignore" });
  let targets = [];
  for (let i = 0; i < 100 && !targets.some((t) => t.type === "page"); i++) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json(), () => []);
  }
  if (!targets.some((t) => t.type === "page")) throw Error("Chrome did not start.");
  const browser = {
    downloads,
    async page() {
      const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
      return openPage(created.webSocketDebuggerUrl, { mobile, downloads });
    },
    async close() {
      process_.kill();
      await sleep(300);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
  return browser;
}

async function openPage(wsUrl, { mobile, downloads }) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.exceptionThrown")
      logs.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
      logs.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, (msg) => (msg.error ? reject(Error(msg.error.message)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true }).catch(() => {});
  if (mobile) {
    await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  const page = {
    logs,
    send,
    async goto(url) {
      await send("Page.navigate", { url });
      await page.waitFor("document.readyState === 'complete' && !!document.querySelector('#app main, #app header')", 30000);
    },
    async eval(expression) {
      const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw Error(exceptionDetails.exception?.description ?? "evaluation failed");
      return result.value;
    },
    // The selector's text, or null when it is missing: most assertions read the page this way.
    text: (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`),
    hidden: (selector) => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.hidden : null; })()`),
    click: (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)}).click()`),
    set: (selector, value) => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); })()`),
    key: (code, down = true) => page.eval(`document.dispatchEvent(new KeyboardEvent(${JSON.stringify(down ? "keydown" : "keyup")}, { code: ${JSON.stringify(code)}, bubbles: true, cancelable: true }))`),
    async touch(selector, down = true) {
      const box = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await send("Input.dispatchTouchEvent", down ? { type: "touchStart", touchPoints: [box] } : { type: "touchEnd", touchPoints: [] });
    },
    wait: sleep,
    async waitFor(expression, timeout = 30000) {
      const start = Date.now();
      let last;
      while (Date.now() - start < timeout) {
        last = await page.eval(expression).catch(() => undefined);
        if (last) return last;
        await sleep(250);
      }
      throw Error(`Timed out waiting for ${expression}`);
    },
    async setFiles(selector, files) {
      const { root } = await send("DOM.getDocument", { depth: 1 });
      const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
      await send("DOM.setFileInputFiles", { nodeId, files });
    },
    async close() {
      ws.close();
    },
  };
  return page;
}
