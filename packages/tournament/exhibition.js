import { botMetadata } from "../bot-catalog.js";
import { digest } from "../sim/index.js";
import { SPEC_VERSION, ENGINE_VERSION, mulberry32 } from "../sim/spec.js";
import { runMatch } from "../runtime/match.js";
import { matchRecord, rankTournament } from "./ranking.js";

// A fixed circle schedule gives each bot a different opponent each round.
// Odd rosters have one rotating bye per round; byes award no points.
export function exhibitionSchedule(count, format = "quick") {
  if (!Number.isInteger(count) || count < 2) throw Error("Select at least two controllers.");
  if (!["quick", "round-robin"].includes(format)) throw Error("Unknown tournament format.");
  const order = Array.from({ length: count }, (_, i) => i);
  const random = mulberry32(90317);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (count % 2) order.push(null);
  const rounds = format === "quick" ? Math.min(3, order.length - 1) : order.length - 1;
  const matches = [];
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < order.length / 2; i++) {
      const pair = [order[i], order[order.length - 1 - i]];
      if (pair.includes(null)) continue;
      const [a, b] = pair.sort((x, y) => x - y);
      const seeds = format === "quick" ? [round] : Array.from({ length: 10 }, (_, seed) => seed);
      for (const seed of seeds)
        for (const mirrored of [false, true])
          matches.push({ a, b, seed, mirrored, round: round + 1 });
    }
    order.splice(1, 0, order.pop());
  }
  return { format, rounds, matches };
}

// A match depends on the engine, the two sources, the seed and the spawn:
// a record played under the same key is the same record.
export const recordKey = (shaA, shaB, seed, mirrored) =>
  `${ENGINE_VERSION}:${shaA}:${shaB}:${seed}:${mirrored ? 1 : 0}`;

// `concurrency` matches run at once; `cache` (get/set by record key) skips the
// ones already played, so a new controller only costs its own pairs.
export async function runExhibition({ bots, format = "quick", gates = [], createClient,
  onUpdate = () => {}, matchRunner = runMatch, concurrency = 1, cache = null }) {
  const schedule = exhibitionSchedule(bots.length, format);
  const records = [];
  const metadata = bots.map(bot => ({ ...botMetadata(bot), codeSha256: digest(bot.source) }));
  const snapshot = (status = "running") => {
    // One seed per pairing cannot support a seed-bootstrap confidence interval.
    const replicates = status === "complete" && format === "round-robin" ? 1000 : 0;
    return {
      specVersion: SPEC_VERSION, engineVersion: ENGINE_VERSION,
      mode: "exhibition", budgetMode: "fuel", format, status,
      rounds: schedule.rounds, totalMatches: schedule.matches.length,
      replicates, bots: metadata, gates, records: [...records],
      ranking: rankTournament(metadata, records, replicates),
    };
  };
  onUpdate({ type: "tournament-update", report: snapshot() });
  const play = async (match) => {
    const { a, b, seed, mirrored, round } = match;
    const progress = (fraction = 0) => onUpdate({
      type: "progress", progress: (records.length + fraction) / schedule.matches.length,
      completed: records.length, total: schedule.matches.length,
      round, rounds: schedule.rounds, pairing: [metadata[a], metadata[b]],
    });
    const key = recordKey(metadata[a].codeSha256, metadata[b].codeSha256, seed, mirrored);
    const cached = cache?.get(key);
    if (cached) return { record: { ...cached, a, b, round }, replay: null };
    progress();
    const replay = await matchRunner({
      bots: [bots[a], bots[b]], seed, mirrored, mode: "exhibition",
      budgetMode: "fuel", createClient, onProgress: progress,
    });
    const { a: _a, b: _b, ...record } = matchRecord(replay, a, b);
    cache?.set(key, record);
    return { record: { ...record, a, b, round }, replay };
  };
  // Records keep the schedule order whatever finishes first.
  for (let i = 0; i < schedule.matches.length; i += concurrency) {
    const played = await Promise.all(schedule.matches.slice(i, i + concurrency).map(play));
    for (const { record, replay } of played) {
      records.push(record);
      onUpdate({ type: "tournament-update", replay, report: snapshot() });
    }
  }
  return snapshot("complete");
}
