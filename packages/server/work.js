// What an assistant may ask the server to run: the conformity gate, one
// match, a short series. Everything goes through the same sandbox and budget
// as a browser exhibition, a few at a time, with a clock on each job.
import { Worker } from "node:worker_threads";
import { BotClient } from "../runtime/client.js";
import { gateBot } from "../runtime/gate.js";
import { runMatch } from "../runtime/match.js";
import { botName } from "../bot-catalog.js";

export const SOURCE_LIMIT = 256 * 1024;
export const MAX_SERIES = 20;
const REASONS = {
  "ring-out": "ring-out",
  hole: "fell through a hole",
  flips: "flipped twice",
  disqualification: "disqualification",
  timeout: "timeout",
};

// A few jobs at a time; the rest wait in order.
export class Pool {
  constructor(size = 2) {
    this.size = size;
    this.active = 0;
    this.queue = [];
  }
  run(job) {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.next();
    });
  }
  next() {
    if (this.active >= this.size || !this.queue.length) return;
    const { job, resolve, reject } = this.queue.shift();
    this.active++;
    Promise.resolve()
      .then(job)
      .then(resolve, reject)
      .finally(() => {
        this.active--;
        this.next();
      });
  }
}

export function checkSource(source) {
  if (typeof source !== "string" || !source.trim()) throw new Error("The controller source is empty.");
  if (Buffer.byteLength(source) > SOURCE_LIMIT)
    throw new Error(`The controller source is larger than ${SOURCE_LIMIT / 1024} KiB.`);
  return source;
}

// Sensors, actions and events as the assistant reads them: its robot is
// "you", the other one "opponent", never a name it could look up.
const who = (index) => (index === 0 ? "you" : "opponent");
export function summarizeMatch(replay, { seed, mirrored, opponent }) {
  const { result, finalStates, violations } = replay;
  const notable = replay.events
    .filter((e) => {
      if (e.type === "impact") return (e.closingSpeed ?? 0) > 1;
      return !["collapse-warning"].includes(e.type);
    })
    .slice(0, 40)
    .map((e) => {
      const at = `${(e.tick / 60).toFixed(1)}s`;
      switch (e.type) {
        case "impact":
          return `${at} impact at ${(e.closingSpeed ?? 0).toFixed(1)} m/s`;
        case "collapse":
          return `${at} floor cell ${e.cell ?? ""} collapsed`;
        case "recharge":
          return `${at} ${who(e.robot)} recharged +${(e.amount ?? 0).toFixed(0)}`;
        case "violation":
          return `${at} ${who(e.robot)} violation: ${e.reason ?? ""}`;
        case "eliminated":
          return `${at} ${who(e.robot)} out (${e.reason ?? ""})`;
        default:
          return `${at} ${who(e.robot)} ${e.type.replace("-", " ")}`;
      }
    });
  return {
    opponent: botName(opponent),
    seed,
    spawn: mirrored ? "mirror" : "normal",
    outcome: result.winner === null ? "draw" : result.winner === 0 ? "win" : "loss",
    reason:
      (REASONS[result.reason] ?? result.reason) +
      (result.reason === "timeout" && result.decision ? ` (${result.decision})` : ""),
    seconds: Number((result.ticks / 60).toFixed(1)),
    energy: { you: round(finalStates[0]?.energy), opponent: round(finalStates[1]?.energy) },
    flipsTaken: { you: finalStates[0]?.flipsTaken ?? 0, opponent: finalStates[1]?.flipsTaken ?? 0 },
    violations: { you: violations[0] ?? 0, opponent: violations[1] ?? 0 },
    events: notable,
  };
}
const round = (n) => (typeof n === "number" ? Number(n.toFixed(1)) : null);

export class Work {
  constructor({ concurrency = 2, gateSeconds = 30, matchSeconds = 90 } = {}) {
    this.pool = new Pool(concurrency);
    this.gateSeconds = gateSeconds;
    this.matchSeconds = matchSeconds;
  }
  // Clients of a job are terminated when its clock runs out: the pending
  // request then fails and the job ends instead of holding the pool.
  timed(seconds, label, start) {
    const clients = [];
    const createClient = () => {
      const client = new BotClient(new Worker(new URL("../runtime/node-worker.js", import.meta.url)));
      clients.push(client);
      return client;
    };
    return this.pool.run(async () => {
      let timer;
      const clock = new Promise((_, reject) => {
        timer = setTimeout(() => {
          for (const c of clients) c.close();
          reject(new Error(`${label} took longer than ${seconds} seconds and was stopped.`));
        }, seconds * 1000);
      });
      try {
        return await Promise.race([start(createClient), clock]);
      } finally {
        clearTimeout(timer);
        for (const c of clients) c.close();
      }
    });
  }
  gate(source) {
    checkSource(source);
    return this.timed(this.gateSeconds, "The gate", async (createClient) => {
      const verdict = await gateBot(createClient(), source, "fuel");
      return {
        eligible: verdict.eligible,
        pass: verdict.pass,
        p99: verdict.p99 ?? null,
        checks: verdict.checks.map((c) => ({
          name: c.name,
          pass: c.pass,
          ...(c.required === false ? { required: false } : {}),
          ...(c.detail ? { detail: c.detail } : {}),
        })),
      };
    });
  }
  match({ source, bot, opponent, seed = 0, mirrored = false }) {
    checkSource(source);
    return this.timed(this.matchSeconds, "The match", async (createClient) => {
      const replay = await runMatch({
        bots: [{ ...bot, source }, opponent],
        seed,
        mirrored,
        mode: "iterative",
        createClient,
      });
      return summarizeMatch(replay, { seed, mirrored, opponent });
    });
  }
  // Seeds 1..n alternate the spawn, like a round robin does.
  async series({ source, bot, opponent, matches = 10 }) {
    const count = Math.max(1, Math.min(MAX_SERIES, Math.floor(matches)));
    const results = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        this.match({ source, bot, opponent, seed: i + 1, mirrored: i % 2 === 1 }),
      ),
    );
    const tally = (outcome) => results.filter((r) => r.outcome === outcome).length;
    return {
      opponent: botName(opponent),
      matches: count,
      wins: tally("win"),
      draws: tally("draw"),
      losses: tally("loss"),
      score: Number(((tally("win") + tally("draw") / 2) / count).toFixed(2)),
      results: results.map((r) => ({
        seed: r.seed,
        spawn: r.spawn,
        outcome: r.outcome,
        reason: r.reason,
        seconds: r.seconds,
      })),
    };
  }
}
