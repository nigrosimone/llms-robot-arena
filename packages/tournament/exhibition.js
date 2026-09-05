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

export async function runExhibition({ bots, format = "quick", gates = [], createClient,
  onUpdate = () => {}, matchRunner = runMatch }) {
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
  for (const match of schedule.matches) {
    const { a, b, seed, mirrored, round } = match;
    const progress = (fraction = 0) => onUpdate({
      type: "progress", progress: (records.length + fraction) / schedule.matches.length,
      completed: records.length, total: schedule.matches.length,
      round, rounds: schedule.rounds, pairing: [metadata[a], metadata[b]],
    });
    progress();
    const replay = await matchRunner({
      bots: [bots[a], bots[b]], seed, mirrored, mode: "exhibition",
      budgetMode: "fuel", createClient, onProgress: progress,
    });
    records.push({ ...matchRecord(replay, a, b), round });
    onUpdate({ type: "tournament-update", replay, report: snapshot() });
  }
  return snapshot("complete");
}
