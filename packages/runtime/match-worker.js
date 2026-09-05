import { botName } from "../bot-catalog.js";
import { BotClient } from "./client.js";
import { runMatch } from "./match.js";
import { gateBot } from "./gate.js";
import { runExhibition } from "../tournament/exhibition.js";
const pool = new Set();
const createClient = () => {
  const c = new BotClient(
    new Worker(new URL("./bot-worker.js", import.meta.url), { type: "module" }),
  );
  pool.add(c);
  const close = c.close.bind(c);
  c.close = () => {
    close();
    pool.delete(c);
  };
  return c;
};
self.onmessage = async ({ data }) => {
  if (data.type === "cancel") {
    for (const c of pool) c.close();
    self.postMessage({ type: "cancelled" });
    return;
  }
  try {
    if (data.type === "match") {
      const replay = await runMatch({
        ...data,
        createClient,
        onProgress: (p) => self.postMessage({ type: "progress", progress: p }),
      });
      self.postMessage({ type: "replay", replay }, [
        replay.frames.buffer,
        replay.arenaExtents.buffer,
      ]);
    } else if (data.type === "gate") {
      const client = createClient();
      try {
        const gate = await gateBot(client, data.source);
        self.postMessage({ type: "gate", gate });
      } finally {
        client.close();
      }
    } else if (data.type === "tournament") {
      const gates = [];
      for (const bot of data.bots) {
        self.postMessage({ type: "progress", progress: 0,
          message: `Checking ${botName(bot)} (${gates.length + 1} / ${data.bots.length})…` });
        const client = createClient();
        try {
          const gate = await gateBot(client, bot.source);
          gates.push({ id: bot.id, ...gate });
          if (!gate.pass)
            throw new Error(
              botName(bot) + ": gate failed. Open Bot Lab for details.",
            );
        } finally {
          client.close();
        }
      }
      const report = await runExhibition({
        bots: data.bots, format: data.format, gates, createClient,
        onUpdate: update => self.postMessage(update, update.replay
          ? [update.replay.frames.buffer, update.replay.arenaExtents.buffer] : []),
      });
      self.postMessage({ type: "tournament", report });
    }
  } catch (e) {
    self.postMessage({ type: "error", message: e.message });
  }
};
