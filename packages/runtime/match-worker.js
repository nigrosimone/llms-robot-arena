import { botName } from "../bot-catalog.js";
import { BotClient } from "./client.js";
import { runMatch } from "./match.js";
import { gateBot } from "./gate.js";
import { matchRecord, rankTournament } from "../tournament/ranking.js";
import { digest } from "../sim/index.js";
import { SPEC_VERSION, ENGINE_VERSION } from "../sim/spec.js";
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
      const gates = [],
        records = [],
        total = ((data.bots.length * (data.bots.length - 1)) / 2) * 20;
      for (const bot of data.bots) {
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
      for (let a = 0; a < data.bots.length; a++)
        for (let b = a + 1; b < data.bots.length; b++)
          for (let seed = 0; seed < 10; seed++)
            for (const mirrored of [false, true]) {
              const replay = await runMatch({
                bots: [data.bots[a], data.bots[b]],
                seed,
                mirrored,
                mode: "exhibition",
                budgetMode: "fuel",
                createClient,
              });
              records.push(matchRecord(replay, a, b));
              self.postMessage({
                type: "progress",
                progress: records.length / total,
                completed: records.length,
                total,
              });
            }
      const ranking = rankTournament(data.bots, records);
      self.postMessage({
        type: "tournament",
        report: {
          specVersion: SPEC_VERSION,
          engineVersion: ENGINE_VERSION,
          gates,
          mode: "exhibition",
          budgetMode: "fuel",
          replicates: 1000,
          records,
          ranking,
          bots: data.bots.map(({ source, ...b }) => ({
            ...b,
            codeSha256: digest(source),
          })),
        },
      });
    }
  } catch (e) {
    self.postMessage({ type: "error", message: e.message });
  }
};
