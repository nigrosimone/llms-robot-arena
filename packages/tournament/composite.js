// A single index over results and source. Its weights are a judgement call, so
// every term is published next to it and the number is only comparable inside
// one run.
export const INDEX_TERMS = [
  { key: "strength", label: "Strength", weight: 0.45 },
  { key: "reliability", label: "Reliability", weight: 0.2 },
  { key: "consistency", label: "Consistency", weight: 0.15 },
  { key: "efficiency", label: "Efficiency", weight: 0.1 },
  { key: "maintainability", label: "Maintainability", weight: 0.1 },
];
const FLOOR = 0.05;
// Absolute references, not the roster: ten branches per function and four levels
// of nesting are the usual thresholds.
const REFERENCE_DENSITY = 10;
const REFERENCE_DEPTH = 4;
const clamp = (value) => Math.min(1, Math.max(0, value));
const ratio = (value, best) => (best > 0 ? clamp(value / best) : 0);

// A loss without a single contact is the controller driving itself out.
function selfEliminationRate(report, index) {
  const rows = report.records.filter((r) => r.a === index || r.b === index);
  if (!rows.length) return 0;
  const lost = rows.filter((r) => {
    const own = r.a === index ? r.score : 1 - r.score;
    return own === 0 && ["hole", "ring-out"].includes(r.reason) && r.firstContact === null;
  });
  return lost.length / rows.length;
}

export function compositeIndex(report) {
  const ranking = report.ranking ?? [];
  if (!ranking.length) return null;
  const code = new Map((report.bots ?? []).map((bot) => [bot.id, bot.code]));
  if (!ranking.every((row) => code.get(row.id))) return null;
  const raw = ranking.map((row, i) => {
    const index = (report.bots ?? []).findIndex((b) => b.id === row.id);
    const source = code.get(row.id);
    const density = source.complexity / Math.max(1, source.functions);
    return {
      score: row.score,
      // Strength earned per line of code, damped so a tiny controller does not
      // win on size alone.
      perLine: row.score / Math.log2(2 + source.codeLines),
      simplicity:
        (clamp(REFERENCE_DENSITY / density) +
          clamp(REFERENCE_DEPTH / Math.max(1, source.maxDepth))) / 2,
      reliability:
        (1 - clamp(selfEliminationRate(report, index < 0 ? i : index))) *
        (1 - clamp(row.violationsPerMatch ?? 0)),
      consistency: row.ci ? clamp(1 - (row.ci[1] - row.ci[0]) / (2 * row.score)) : null,
    };
  });
  const best = (key) => Math.max(...raw.map((r) => r[key]));
  return ranking.map((row, i) => {
    const terms = {
      strength: ratio(raw[i].score, best("score")),
      reliability: clamp(raw[i].reliability),
      consistency: raw[i].consistency,
      efficiency: ratio(raw[i].perLine, best("perLine")),
      maintainability: clamp(raw[i].simplicity),
    };
    const used = INDEX_TERMS.filter((term) => terms[term.key] !== null);
    const total = used.reduce((sum, term) => sum + term.weight, 0);
    const index = Math.exp(
      used.reduce(
        (sum, term) => sum + term.weight * Math.log(Math.max(FLOOR, terms[term.key])),
        0,
      ) / total,
    );
    return { id: row.id, index: 100 * index, terms };
  });
}
