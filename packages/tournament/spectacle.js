import { botName } from "../bot-catalog.js";
import { matchSettingsSearch } from "../viewer/match-link.js";

// What makes a match worth watching: flips first, then engagements. The index
// orders the two lexically, so one flip beats any number of engagements.
export function matchSpectacle(record) {
  const flips = (record.flips ?? []).reduce((sum, n) => sum + n, 0);
  const styles = (record.style ?? []).filter(Boolean);
  const rate = styles.length ? styles.reduce((sum, s) => sum + (s.engagementRate ?? 0), 0) / styles.length : 0;
  const engagements = Math.round((rate * record.ticks) / 3600);
  return { flips, engagements, index: flips * 1000 + engagements };
}

// The most spectacular matches of a report, with what is needed to simulate
// them again. A published report carries them precomputed, since its records
// have no style samples.
export function highlights(report, count = 5) {
  if (Array.isArray(report.highlights)) return report.highlights.slice(0, count);
  if (!Array.isArray(report.records) || !Array.isArray(report.bots)) return [];
  return report.records
    .flatMap((record, position) => {
      const a = report.bots[record.a], b = report.bots[record.b];
      if (!a || !b || !Array.isArray(record.flips)) return [];
      const { flips, engagements, index } = matchSpectacle(record);
      return [{
        position, index, flips, engagements,
        a: a.id, b: b.id, seed: record.seed, mirrored: record.mirrored,
        reason: record.reason, ticks: record.ticks,
        winner: record.score === 0.5 ? null : record.score === 1 ? a.id : b.id,
      }];
    })
    .filter((h) => h.index > 0)
    .sort((x, y) => y.index - x.index || x.position - y.position)
    .slice(0, count);
}

export const highlightLabel = (report, h) => {
  const bot = (id) => botName(report.bots.find((b) => b.id === id) ?? { model: id });
  return {
    match: `${bot(h.a)} vs ${bot(h.b)}`,
    result: h.winner === null ? "Draw" : `${bot(h.winner)} wins`,
    search: matchSettingsSearch({ a: h.a, b: h.b, seed: h.seed, mirrored: h.mirrored }),
  };
};
