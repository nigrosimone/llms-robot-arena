// The live server as an assistant and a browser use it: a session opened from
// the page, the contract and the opponents, the gate, a match, a series, a
// push the visitor accepts or rejects, and the limits.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadBots } from "../packages/bot-catalog-node.js";
import { createApp, readContract } from "../packages/server/app.js";
import { Sessions } from "../packages/server/sessions.js";
import { Pool, summarizeMatch } from "../packages/server/work.js";

let server, port, bots;
before(async () => {
  bots = await loadBots();
  server = await createApp({ origins: ["http://site"], sessions: new Sessions({ decisionSeconds: 2 }) });
  port = await server.listen(0);
});
after(() => server?.close());

const baseline = () => bots.find((b) => b.id === "Baseline").source;
const text = (result) => JSON.parse(result.content[0].text);

// The page's side of a session: the code, then whatever the server sends.
async function openSession() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  const events = [];
  const waiters = [];
  ws.onmessage = (m) => {
    const event = JSON.parse(String(m.data));
    events.push(event);
    for (const w of waiters.splice(0)) w();
  };
  // Each event is handed out once, in order.
  const taken = new Set();
  const next = (type) =>
    new Promise((resolve) => {
      const check = () => {
        const found = events.find((e) => e.type === type && !taken.has(e));
        if (found) {
          taken.add(found);
          resolve(found);
        } else waiters.push(check);
      };
      check();
    });
  const session = await next("session");
  return { ws, events, next, code: session.code, mcp: session.mcp };
}
async function connect() {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  return client;
}

test("a session opens with a code and the assistant reads the contract and the opponents", async () => {
  const page = await openSession();
  assert.match(page.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(page.mcp, `http://127.0.0.1:${port}/mcp`);
  const client = await connect();
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["gate", "match", "push", "series"]);
  const contract = await client.readResource({ uri: "arena://contract" });
  assert.equal(contract.contents[0].text, await readContract());
  assert.match(contract.contents[0].text, /## 9\. Bot contract/);
  assert.doesNotMatch(contract.contents[0].text, /^## Tournament CLI/m);
  const opponents = JSON.parse((await client.readResource({ uri: "arena://opponents" })).contents[0].text);
  assert.equal(opponents.length, bots.length);
  assert.ok(opponents.find((o) => o.id === "Baseline").reference);
  assert.ok(opponents.every((o) => !("source" in o) && !("file" in o)));
  const prompt = await client.getPrompt({ name: "write-controller", arguments: { session: page.code } });
  assert.match(prompt.messages[0].content.text, new RegExp(page.code));
  await client.close();
  page.ws.close();
});

test("the gate, a match and a series run the controller against black boxes", async () => {
  const page = await openSession();
  const client = await connect();
  const gate = text(await client.callTool({ name: "gate", arguments: { session: page.code, source: baseline() } }));
  assert.equal(gate.eligible, true);
  assert.ok(gate.checks.length > 3);
  const match = text(await client.callTool({
    name: "match", arguments: { session: page.code, source: baseline(), opponent: "Baseline", seed: 3, spawn: "mirror" },
  }));
  assert.equal(match.opponent, "Baseline");
  assert.equal(match.spawn, "mirror");
  assert.ok(["win", "loss", "draw"].includes(match.outcome));
  assert.ok(match.seconds > 0);
  assert.ok(match.events.every((e) => /you|opponent|impact|floor/.test(e)));
  const series = text(await client.callTool({
    name: "series", arguments: { session: page.code, source: baseline(), matches: 2 },
  }));
  assert.equal(series.matches, 2);
  assert.equal(series.wins + series.draws + series.losses, 2);
  assert.deepEqual(series.results.map((r) => r.spawn), ["normal", "mirror"]);
  const activity = page.events.filter((e) => e.type === "activity").map((e) => e.kind);
  assert.deepEqual(activity, ["gate", "match", "series"]);
  const unknown = await client.callTool({ name: "match", arguments: { session: page.code, source: baseline(), opponent: "nobody" } });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /Unknown opponent/);
  const broken = text(await client.callTool({ name: "gate", arguments: { session: page.code, source: "export function tick() { while (true) {} }" } }));
  assert.equal(broken.eligible, false);
  await client.close();
  page.ws.close();
});

test("a pushed controller reaches the page and waits for the visitor", async () => {
  const page = await openSession();
  const client = await connect();
  const pushed = client.callTool({ name: "push", arguments: { session: page.code, source: baseline(), name: "Tester", model: "Test model" } });
  const offer = await page.next("controller");
  assert.equal(offer.name, "Tester");
  assert.equal(offer.model, "Test model");
  assert.equal(offer.source, baseline());
  assert.equal(offer.gate.eligible, true);
  page.ws.send(JSON.stringify({ type: "decision", id: offer.id, accepted: true }));
  assert.equal(text(await pushed).decision, "accepted");
  const rejected = client.callTool({ name: "push", arguments: { session: page.code, source: baseline(), name: "Again" } });
  const second = await page.next("controller");
  assert.notEqual(second.id, offer.id);
  page.ws.send(JSON.stringify({ type: "decision", id: second.id, accepted: false }));
  assert.equal(text(await rejected).decision, "rejected");
  const ignored = text(await client.callTool({ name: "push", arguments: { session: page.code, source: baseline(), name: "Silent" } }));
  assert.equal(ignored.decision, "pending");
  const refused = await client.callTool({ name: "push", arguments: { session: page.code, source: "export function tick() { return 1; }", name: "Broken" } });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /Not sent: the gate refused it/);
  await client.close();
  page.ws.close();
});

test("an unknown session and a foreign origin are refused", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "gate", arguments: { session: "ZZZZZZ", source: baseline() } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unknown or expired session/);
  await client.close();
  const foreign = new WebSocket(`ws://127.0.0.1:${port}/session`, { headers: { origin: "http://evil" } });
  await new Promise((resolve) => {
    foreign.onerror = resolve;
    foreign.onclose = resolve;
  });
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
  assert.equal(health.ok, true);
  const get = await fetch(`http://127.0.0.1:${port}/mcp`);
  assert.equal(get.status, 405);
});

test("sessions expire, count per address and meter the calls", () => {
  let at = 0;
  const sessions = new Sessions({ idleMinutes: 30, perIp: 2, callsPerMinute: 3, matchesPerTenMinutes: 4, now: () => at });
  const a = sessions.open("1.1.1.1");
  sessions.open("1.1.1.1");
  assert.throws(() => sessions.open("1.1.1.1"), /Too many open sessions/);
  sessions.open("2.2.2.2");
  sessions.spend(a.code);
  sessions.spend(a.code, 2);
  assert.throws(() => sessions.spend(a.code, 3), /4 matches per ten minutes/);
  sessions.spend(a.code, 2);
  assert.throws(() => sessions.spend(a.code), /3 calls per minute/);
  at = 61_000;
  sessions.spend(a.code);
  at += 31 * 60_000;
  assert.equal(sessions.get(a.code), null);
  assert.throws(() => sessions.spend(a.code), /Unknown or expired session/);
  assert.equal(sessions.size, 2);
});

test("the pool runs a few jobs at a time and match summaries name nobody", async () => {
  const pool = new Pool(2);
  let running = 0, peak = 0;
  const job = () => pool.run(async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 10));
    running--;
  });
  await Promise.all([job(), job(), job(), job()]);
  assert.equal(peak, 2);
  const summary = summarizeMatch(
    {
      result: { winner: 1, reason: "timeout", ticks: 7200, decision: "center" },
      finalStates: [{ energy: 41.26, flipsTaken: 1 }, { energy: 60, flipsTaken: 0 }],
      violations: [0, 2],
      events: [
        { type: "collapse-warning", tick: 10, cell: "B2" },
        { type: "impact", tick: 120, closingSpeed: 2.5 },
        { type: "flip", tick: 600, robot: 0 },
        { type: "recharge", tick: 900, robot: 1, amount: 12 },
      ],
    },
    { seed: 4, mirrored: true, opponent: { id: "x", model: "Secret Model", provider: "Lab" } },
  );
  assert.equal(summary.outcome, "loss");
  assert.equal(summary.reason, "timeout (center)");
  assert.deepEqual(summary.energy, { you: 41.3, opponent: 60 });
  assert.deepEqual(summary.events, ["2.0s impact at 2.5 m/s", "10.0s you flip", "15.0s opponent recharged +12"]);
  assert.equal(summary.opponent, "Secret Model");
});
