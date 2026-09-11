import { botCatalog, botName, botProvider } from "../bot-catalog.js";
import { renderCodeTable, renderIndexTable, renderStyleTable } from "./report.js";
import { highlights, highlightLabel } from "./spectacle.js";
import { SITE } from "../site/content.js";

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

function styleSection(report) {
  const table = renderStyleTable(report.ranking);
  return table.length
    ? [
        "",
        "**Play style.** Measured from the recorded frames of the same matches. The profile names the axis where a controller stands out most against this roster.",
        "",
        ...table,
      ]
    : [];
}

function highlightSection(report) {
  const rows = highlights(report);
  return rows.length
    ? [
        "",
        "**Highlights.** The matches worth watching: total flips first, then engagements. Each link simulates the match again in the arena.",
        "",
        "| Match | Seed / spawn | Flips | Engagements | Result | Watch |",
        "|---|---|---|---|---|---|",
        ...rows.map((h) => {
          const { match, result, search } = highlightLabel(report, h);
          return `| ${cell(match)} | ${h.seed} / ${h.mirrored ? "mirrored" : "standard"} | ${h.flips} | ${h.engagements} | ${cell(result)}, ${cell(h.reason)} at ${Math.round(h.ticks / 60)} s | [simulate](${SITE.url}${search}) |`;
        }),
      ]
    : [];
}

function codeSection(report) {
  const table = renderCodeTable(report.bots, report.ranking);
  return table.length
    ? [
        "",
        "**Implementation.** Measured from the submitted source: cyclomatic complexity counts branches and short-circuit operators, nesting counts functions and control statements.",
        "",
        ...table,
      ]
    : [];
}

function indexSection(report) {
  const table = renderIndexTable(report);
  return table.length ? ["", "**Craft index.** One number over results and source: a weighted geometric mean of strength (45%), reliability (20%), consistency (15%), efficiency (10%) and maintainability (10%). Every term is scaled 0 to 1, the first four against this roster and maintainability against ten branches per function and four levels of nesting. It is not the ranking: strength alone decides that.", "", ...table] : [];
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
    ...styleSection(report),
    ...highlightSection(report),
    ...codeSection(report),
    ...indexSection(report),
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
