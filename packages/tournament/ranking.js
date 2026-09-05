import { botMetadata } from "../bot-catalog.js";
import { mulberry32 } from "../sim/spec.js";
export function bradleyTerry(n, records) {
  const wins = Array(n).fill(0.5 * (n - 1)),
    games = Array.from({ length: n }, () => Array(n).fill(1));
  for (const r of records) {
    wins[r.a] += r.score;
    wins[r.b] += 1 - r.score;
    games[r.a][r.b]++;
    games[r.b][r.a]++;
  }
  let strength = Array(n).fill(1);
  for (let it = 0; it < 200; it++) {
    let next = strength.map(
      (_, i) =>
        wins[i] /
        strength.reduce(
          (sum, p, j) => sum + (i === j ? 0 : games[i][j] / (strength[i] + p)),
          0,
        ),
    );
    const mean = next.reduce((a, b) => a + b, 0) / n;
    next = next.map((p) => p / mean);
    const error = Math.max(...next.map((v, i) => Math.abs(v - strength[i])));
    strength = next;
    if (error < 1e-8) break;
  }
  return strength.map((s) => 100 * s);
}
export function rankTournament(bots, records, replicates = 1000) {
  const scores = bradleyTerry(bots.length, records),
    rng = mulberry32(90317),
    samples = bots.map(() => []);
  const pairs = [];
  for (let a = 0; a < bots.length; a++)
    for (let b = a + 1; b < bots.length; b++) {
      const pair = records.filter((r) => r.a === a && r.b === b),
        seeds = [...new Set(pair.map((r) => r.seed))];
      pairs.push(seeds.map((seed) => pair.filter((r) => r.seed === seed)));
    }
  for (let k = 0; k < replicates; k++) {
    const sample = [];
    for (const groups of pairs)
      for (let i = 0; i < groups.length; i++)
        sample.push(...groups[Math.floor(rng() * groups.length)]);
    bradleyTerry(bots.length, sample).forEach((v, i) => samples[i].push(v));
  }
  return bots
    .map((bot, i) => {
      const rows = records.filter((r) => r.a === i || r.b === i),
        side = (r) => (r.a === i ? 0 : 1),
        own = (r) => (r.a === i ? r.score : 1 - r.score);
      const sum = (fn) => rows.reduce((v, r) => v + fn(r), 0),
        mean = (fn) => (rows.length ? sum(fn) / rows.length : 0);
      const dist = samples[i].sort((a, b) => a - b);
      const first = rows.filter((r) => r.firstContact !== null);
      return {
        ...botMetadata(bot),
        score: scores[i],
        ci: [
          dist[Math.floor(replicates * 0.025)],
          dist[Math.min(replicates - 1, Math.floor(replicates * 0.975))],
        ],
        matches: rows.length,
        wins: sum((r) => (own(r) === 1 ? 1 : 0)),
        draws: sum((r) => (own(r) === 0.5 ? 1 : 0)),
        winRate: mean(own),
        flipDifferential: sum((r) => r.flips[1 - side(r)] - r.flips[side(r)]),
        ringOutsInflicted: sum((r) => r.ringOuts[1 - side(r)]),
        ringOutsTaken: sum((r) => r.ringOuts[side(r)]),
        meanEnergy: mean((r) => r.energy[side(r)]),
        meanFirstContactTick: first.length
          ? first.reduce((v, r) => v + r.firstContact, 0) / first.length
          : null,
        violationsPerMatch: mean((r) => r.violations[side(r)]),
        timeouts: sum((r) => (r.reason === "timeout" ? 1 : 0)),
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
export function matchRecord(replay, a, b) {
  return {
    a,
    b,
    seed: replay.seed,
    mirrored: replay.mirrored,
    score:
      replay.result.winner === null ? 0.5 : replay.result.winner === 0 ? 1 : 0,
    reason: replay.result.reason,
    ticks: replay.result.ticks,
    flips: replay.finalStates.map((r) => r.flipsTaken),
    energy: replay.finalStates.map((r) => r.energy),
    centerDistance: replay.finalStates.map((r) => Math.hypot(r.x, r.y)),
    decision: replay.result.decision ?? null,
    holeFalls: [0, 1].map(i => replay.events.filter(e => e.type === "hole" && e.robot === i).length),
    violations: replay.violations,
    ringOuts: [0, 1].map(
      (i) =>
        replay.events.filter((e) => e.type === "ring-out" && e.robot === i)
          .length,
    ),
    firstContact: replay.events.find((e) => e.type === "impact")?.tick ?? null,
  };
}
