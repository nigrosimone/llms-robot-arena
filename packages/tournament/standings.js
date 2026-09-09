import { botCatalog, botName, botProvider } from "../bot-catalog.js";

// Published standings: one static tournament, rendered for the README and
// reused by the Tournament page until the visitor runs their own.
export const STANDINGS_START = "<!-- standings:start -->";
export const STANDINGS_END = "<!-- standings:end -->";

const fmt = (value, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";
const cell = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "&#124;")
    .replace(/[\r\n]+/g, " ");

// Controllers outside the repository, and older reports without a path, keep
// their name without a link.
function sourceLink(report, bot) {
  const file =
    report.bots?.find((b) => b.id === bot.id)?.file ??
    botCatalog.find((b) => b.id === bot.id)?.file;
  return typeof file === "string" && /^[\w./-]+\.(js|ts)$/.test(file)
    ? `[${file.split("/").pop()}](${file})`
    : "—";
}

export function renderStandings(report) {
  const format = report.format === "quick"
    ? `Quick rounds (${report.rounds} round${report.rounds === 1 ? "" : "s"}, one seed per pairing, mirrored spawns)`
    : "Round robin (10 seeds per pair, mirrored spawns)";
  const date = (report.generatedAt ?? "").slice(0, 10);
  return [
    `${format} · ${report.records.length} matches · ${cell(report.budgetMode)} budget · spec ${cell(report.specVersion)} / engine ${cell(report.engineVersion)}${date ? ` · generated ${date}` : ""}.`,
    "",
    "| # | Controller | Provider | Thinking | Harness | Development | Source | Strength | 95% CI | Score % | W / D / L |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...report.ranking.map((r, i) =>
      `| ${i + 1} | ${cell(botName(r))} | ${cell(botProvider(r))} | ${cell(r.thinking ?? "—")} | ${cell(r.harness ?? "—")} | ${cell(r.provenance ?? "—")} | ${sourceLink(report, r)} | ${fmt(r.score)} | ${r.ci?.map((n) => fmt(n)).join(" – ") ?? "—"} | ${fmt(r.winRate * 100)} | ${r.wins} / ${r.draws} / ${r.matches - r.wins - r.draws} |`,
    ),
  ].join("\n");
}

// Only the marked block is rewritten; the rest of the document is untouched.
export function updateStandingsSection(document, markdown) {
  const start = document.indexOf(STANDINGS_START),
    end = document.indexOf(STANDINGS_END);
  if (start === -1 || end < start)
    throw new Error(`Missing ${STANDINGS_START} / ${STANDINGS_END} markers.`);
  return (
    document.slice(0, start + STANDINGS_START.length) +
    "\n\n" + markdown + "\n\n" +
    document.slice(end)
  );
}
