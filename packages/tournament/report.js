import { botName, botProvider } from "../bot-catalog.js";
import { styleLabel, styleProfiles } from "./style.js";
import { INDEX_TERMS, compositeIndex } from "./composite.js";
// Tournament reports with controller provenance and confidence intervals.
const fmt = (value, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";
const cell = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "&#124;")
    .replace(/[\r\n]+/g, " ");

export function renderCSV(ranking) {
  const columns = [
    "id",
    "model",
    "provider",
    "thinking",
    "harness",
    "provenance",
    "score",
    "ciLow",
    "ciHigh",
    "matches",
    "wins",
    "draws",
    "scoreRate",
    "winRate",
    "flipDifferential",
    "ringOutsInflicted",
    "ringOutsTaken",
    "meanEnergy",
    "meanFirstContactTick",
    "violationsPerMatch",
    "timeouts",
  ];
  const csvCell = (value) =>
    value == null
      ? ""
      : typeof value === "number"
        ? String(value)
        : '"' + String(value).replace(/"/g, '""') + '"';
  const rows = ranking.map((r) => ({
    ...r,
    ciLow: r.ci?.[0],
    ciHigh: r.ci?.[1],
    scoreRate: r.winRate,
    winRate: r.matches ? r.wins / r.matches : 0,
  }));
  return (
    [
      columns.join(","),
      ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(",")),
    ].join("\r\n") + "\r\n"
  );
}

// Play style over the same matches, next to the roster it was measured against.
export function renderStyleTable(ranking) {
  const profiles = styleProfiles(ranking);
  if (!profiles) return [];
  const pct = (value) => fmt(value * 100, 0) + "%";
  return [
    "| Controller | Profile | Contact | Closing | Wedge | Engagements / min | Speed | Turn rate | Edge time | Energy / s | Recharges |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...ranking.map((r, i) =>
      `| ${cell(botName(r))} | ${styleLabel(profiles[i])} | ${pct(r.style.contactShare)} | ${pct(r.style.closingShare)} | ${pct(r.style.wedgeShare)} | ${fmt(r.style.engagementRate, 1)} | ${fmt(r.style.speed, 2)} m/s | ${fmt(r.style.turnRate, 2)} rad/s | ${pct(r.style.edgeShare)} | ${fmt(r.style.spendRate, 1)} | ${fmt(r.style.recharges, 1)} |`,
    ),
  ];
}

// Static measurements of each submitted controller, when the run recorded them.
export function renderCodeTable(bots = [], ranking = []) {
  const order = new Map(ranking.map((row, i) => [row.id, i]));
  const rows = bots
    .filter((bot) => bot.code)
    .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  if (!rows.length) return [];
  return [
    "| Controller | Language | Lines | Code | Comments | Functions | Cyclomatic | Max nesting | Size |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((bot) =>
      `| ${cell(botName(bot))} | ${cell(bot.code.language)} | ${bot.code.lines} | ${bot.code.codeLines} | ${bot.code.commentLines} | ${bot.code.functions} | ${bot.code.complexity} | ${bot.code.maxDepth} | ${fmt(bot.code.bytes / 1024, 1)} kB |`,
    ),
  ];
}

// Results and source folded into one number, with its terms alongside.
export function renderIndexTable(report) {
  const rows = compositeIndex(report);
  if (!rows) return [];
  return [
    `| Controller | Craft index | ${INDEX_TERMS.map((t) => t.label).join(" | ")} |`,
    "|---|---|" + INDEX_TERMS.map(() => "---|").join(""),
    ...report.ranking.map((row, i) =>
      `| ${cell(botName(row))} | ${fmt(rows[i].index, 1)} | ${INDEX_TERMS.map((t) => fmt(rows[i].terms[t.key], 2)).join(" | ")} |`,
    ),
  ];
}

export function renderReport(report) {
  const { ranking, records, bots, mode, budgetMode } = report;
  const lines = [
    "# llms-robot-arena — results",
    "",
    `- **Mode:** ${cell(mode)}`,
    `- **Format:** ${report.format === "quick" ? `Quick rounds (${report.rounds} rounds, one seed per pairing, mirrored spawns)` : "Round robin (10 seeds per pair, mirrored spawns)"}`,
    `- **Status:** ${cell(report.status ?? "complete")}`,
    `- **Budget:** ${cell(budgetMode)}${budgetMode === "fuel" ? " (deterministic instructions, exhibition/diagnostic)" : " (2 ms per tick)"}`,
    `- **Spec / engine:** ${cell(report.specVersion)} / ${cell(report.engineVersion)}`,
    `- **Matches:** ${records.length}${report.totalMatches ? ` / ${report.totalMatches}` : ""}; **bootstrap:** ${report.replicates ? `${report.replicates} seed resamples, keeping mirrored spawns together` : "not computed"}.`,
    ...(report.format === "quick" ? ["- Quick rounds sample different opponents. Odd rosters have rotating byes without points. Seed-bootstrap intervals are unavailable with one seed per pairing."] : []),
    `- **Environment:** ${cell(report.environment?.node ?? "browser")} ${cell(report.environment?.platform ?? "")} ${cell(report.environment?.cpu ?? "")}`,
    "",
    "## Bradley–Terry ranking",
    "",
    "Mean strength = 100. Score percentage awards 0.5 for draws; win percentage counts wins only.",
    "",
    "| # | Controller | Strength | 95% CI | Score % | Win % | W / D / L |",
    "|---|---|---|---|---|---|---|",
  ];
  ranking.forEach((r, i) =>
    lines.push(
      `| ${i + 1} | ${cell(botName(r))} | ${fmt(r.score, 1)} | ${r.ci?.map((n) => fmt(n, 1)).join(" – ") ?? "—"} | ${fmt(r.winRate * 100, 1)} | ${fmt(r.matches ? (100 * r.wins) / r.matches : 0, 1)} | ${r.wins} / ${r.draws} / ${r.matches - r.wins - r.draws} |`,
    ),
  );
  lines.push(
    "",
    "## Metrics",
    "",
    "| Controller | Δ flips | Ring-outs + / − | Mean final energy | First contact (tick) | Violations / match | Timeouts |",
    "|---|---|---|---|---|---|---|",
  );
  ranking.forEach((r) =>
    lines.push(
      `| ${cell(botName(r))} | ${r.flipDifferential} | ${r.ringOutsInflicted} / ${r.ringOutsTaken} | ${fmt(r.meanEnergy, 1)} | ${fmt(r.meanFirstContactTick, 0)} | ${fmt(r.violationsPerMatch)} | ${r.timeouts} |`,
    ),
  );
  const style = renderStyleTable(ranking);
  if (style.length)
    lines.push(
      "",
      "## Play style",
      "",
      "Measured from the recorded frames of the same matches. The profile names the axis where a controller stands out most against this roster.",
      "",
      ...style,
    );
  const code = renderCodeTable(bots, ranking);
  if (code.length)
    lines.push(
      "",
      "## Implementation",
      "",
      "Measured from the submitted source: cyclomatic complexity counts branches and short-circuit operators, nesting counts functions and control statements.",
      "",
      ...code,
    );
  const index = renderIndexTable(report);
  if (index.length)
    lines.push("", "## Craft index", "", "Craft index. One number over results and source: a weighted geometric mean of strength (45%), reliability (20%), consistency (15%), efficiency (10%) and maintainability (10%). Every term is scaled 0 to 1, the first four against this roster and maintainability against ten branches per function and four levels of nesting. It is not the ranking: strength alone decides that.", "", ...index);
  lines.push(
    "",
    "## Controller provenance",
    "",
    "| Controller | Provider | Thinking | Harness | Development | ID | Code SHA-256 |",
    "|---|---|---|---|---|---|---|",
  );
  bots.forEach((b) =>
    lines.push(
      `| ${cell(botName(b))} | ${cell(botProvider(b))} | ${cell(b.thinking ?? "Not specified")} | ${cell(b.harness ?? "Not specified")} | ${cell(b.provenance ?? "Not specified")} | ${cell(b.id)} | ${cell(b.codeSha256 ?? "unavailable")} |`,
    ),
  );
  if (report.gates?.length) {
    lines.push(
      "",
      "## Conformity",
      "",
      `Admission uses the ${cell(budgetMode)} budget. Full conformity includes the 2 ms timing check; fuel admission treats that measurement as advisory.`,
      "",
      "| Controller | Admission | Full conformity | p99 (ms) |",
      "|---|---|---|---|",
    );
    report.gates.forEach((g) =>
      lines.push(
        `| ${cell(botName(bots.find(b => b.id === g.id) ?? g))} | ${(g.eligible ?? g.pass) ? "PASS" : "FAIL"} | ${g.pass ? "PASS" : "FAIL"} | ${fmt(g.p99, 3)} |`,
      ),
    );
  }
  lines.push(
    "",
    "These intervals describe these controllers and seeds. One-shot, iterative and exhibition results are separate. Development provenance is recorded for each controller.",
    "",
  );
  return lines.join("\n");
}
