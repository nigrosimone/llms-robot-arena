import { botName, botProvider } from "../bot-catalog.js";
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
    ciLow: r.ci[0],
    ciHigh: r.ci[1],
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

export function renderReport(report) {
  const { ranking, records, bots, mode, budgetMode } = report;
  const lines = [
    "# llms-robot-arena — results",
    "",
    `- **Mode:** ${cell(mode)}`,
    `- **Budget:** ${cell(budgetMode)}${budgetMode === "fuel" ? " (deterministic instructions, exhibition/diagnostic)" : " (2 ms per tick)"}`,
    `- **Spec / engine:** ${cell(report.specVersion)} / ${cell(report.engineVersion)}`,
    `- **Matches:** ${records.length}; **bootstrap:** ${report.replicates} seed resamples, keeping mirrored spawns together.`,
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
      `| ${i + 1} | ${cell(botName(r))} | ${fmt(r.score, 1)} | ${r.ci.map((n) => fmt(n, 1)).join(" – ")} | ${fmt(r.winRate * 100, 1)} | ${fmt(r.matches ? (100 * r.wins) / r.matches : 0, 1)} | ${r.wins} / ${r.draws} / ${r.matches - r.wins - r.draws} |`,
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
      "| Controller | Gate | p99 (ms) |",
      "|---|---|---|",
    );
    report.gates.forEach((g) =>
      lines.push(
        `| ${cell(botName(bots.find(b => b.id === g.id) ?? g))} | ${g.pass ? "PASS" : "FAIL"} | ${fmt(g.p99, 3)} |`,
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
