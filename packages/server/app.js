// The live server: an MCP endpoint for assistants and a websocket for the
// browser, on fulmine. Sessions live in memory; nothing is stored.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import express from "fulmine.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadBots, projectRoot } from "../bot-catalog-node.js";
import { createMcpServer } from "./mcp.js";
import { Sessions } from "./sessions.js";
import { Work } from "./work.js";

export const DEFAULT_ORIGINS = [
  "https://llms-robot-arena.sndesign.it",
  "http://localhost:4200",
  "http://127.0.0.1:4200",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

// The contract is the part of AGENTS.md written for the agent: rules, bot
// contract, conformity tests and constants, up to the operating notes.
export async function readContract(root = projectRoot) {
  const text = await readFile(join(root, "AGENTS.md"), "utf8");
  const end = text.indexOf("\n# Operating and publishing the project");
  return end > 0 ? text.slice(0, end).trimEnd() + "\n" : text;
}

export async function createApp({
  origins = DEFAULT_ORIGINS,
  sessions = new Sessions(),
  work = new Work(),
  catalog = null,
  contract = null,
  standings = null,
  mcpPerMinute = 120,
  log = () => {},
} = {}) {
  catalog ??= await loadBots();
  contract ??= await readContract();
  standings ??= await readFile(join(projectRoot, "packages/viewer/public/standings.json"), "utf8").then(JSON.parse, () => null);
  const app = express();
  app.set("trust proxy", true);
  app.disable("etag");
  app.use(express.json({ limit: "1mb" }));
  // The websocket is meant for the site; a missing origin is a plain client.
  const allowed = (origin) => !origin || origins.includes(origin);
  const mcpCalls = new Map();
  const throttled = (ip) => {
    const at = Date.now();
    const calls = (mcpCalls.get(ip) ?? []).filter((t) => at - t < 60_000);
    calls.push(at);
    mcpCalls.set(ip, calls);
    return calls.length > mcpPerMinute;
  };

  app.get("/health", (req, res) => {
    res.json({ ok: true, sessions: sessions.size, controllers: catalog.length });
  });

  // Stateless MCP: one server and transport per request, JSON answers, the
  // fulmine request and response bridged to the web standard ones.
  app.post("/mcp", async (req, res) => {
    if (throttled(req.ip)) return res.status(429).json({ error: "Too many requests." });
    const server = createMcpServer({
      sessions,
      work,
      catalog,
      contract,
      standings,
      onActivity: (code, kind, summary) => log(`${code} ${kind}: ${summary}`),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers))
        if (typeof value === "string") headers.set(name, value);
      const request = new Request(`${req.protocol}://${req.get("host")}${req.originalUrl}`, {
        method: "POST",
        headers,
        body: JSON.stringify(req.body),
      });
      const response = await transport.handleRequest(request, { parsedBody: req.body });
      res.status(response.status);
      response.headers.forEach((value, name) => {
        if (name !== "content-length") res.set(name, value);
      });
      res.send(Buffer.from(await response.arrayBuffer()));
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  });
  app.all("/mcp", (req, res) => {
    res.set("allow", "POST").status(405).json({ error: "Only POST is supported." });
  });

  // The page opens one socket per session; the first message carries the code.
  app.ws("/session", {
    idleTimeout: 120,
    sendPingsAutomatically: true,
    maxPayloadLength: 16 * 1024,
    upgrade(req, res) {
      if (!allowed(req.headers.origin)) return res.sendStatus(403);
      try {
        req.session = sessions.open(req.ip);
      } catch (error) {
        return res.status(429).send(error.message);
      }
    },
    open(ws) {
      const session = ws.req.session;
      sessions.attach(session.code, ws);
      log(`${session.code} opened from ${ws.req.ip}`);
      ws.send(
        JSON.stringify({
          type: "session",
          code: session.code,
          mcp: `${ws.req.protocol}://${ws.req.get("host")}/mcp`,
          idleMinutes: sessions.idle / 60_000,
        }),
      );
    },
    message(ws, message) {
      let data;
      try {
        data = JSON.parse(Buffer.from(message).toString());
      } catch {
        return;
      }
      const code = ws.req.session.code;
      if (data?.type === "decision") sessions.decide(code, Number(data.id), data.accepted === true);
      else if (data?.type === "ping") sessions.get(code);
    },
    close(ws) {
      sessions.detach(ws.req.session.code, ws);
    },
  });

  const sweeper = setInterval(() => sessions.sweep(), 60_000);
  sweeper.unref();
  const listen = (port, host = "127.0.0.1") =>
    new Promise((resolve, reject) => {
      app.once("error", reject);
      app.listen(port, host, () => resolve(app.address().port));
    });
  const close = () => {
    clearInterval(sweeper);
    app.close();
  };
  return { app, listen, close, sessions };
}
