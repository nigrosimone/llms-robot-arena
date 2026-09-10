// The tournament panel as lit-html templates. A template says what the surface
// should look like for a given report; the library patches only the parts that
// changed, so a ranking that updates after every match does not rebuild its
// table. Values inside a binding are escaped by the library: nothing here needs
// escaping by hand.
import { html, svg, nothing } from "lit-html";
import { botName, botDetails } from "../bot-catalog.js";
import { STYLE_AXES, formatStyleValue, styleLabel, styleProfiles } from "../tournament/style.js";
import { INDEX_TERMS, compositeIndex } from "../tournament/composite.js";
import { iconTemplate } from "./icons.js";
import { clock } from "./format.js";

const header = (title, tag) =>
  html`<div class="ranking-header"><h2>${title}</h2><span class="tag">${tag}</span></div>`;

const rows = (headers, body) => html`<div class="table-scroll">
  <table>
    <thead>
      <tr>
        ${headers.map((label) => html`<th>${label}</th>`)}
      </tr>
    </thead>
    <tbody>
      ${body}
    </tbody>
  </table>
</div>`;

export const emptyRanking = (title, body) =>
  html`<div class="empty-ranking"><h2>${title}</h2><p>${body}</p></div>`;

export function rankingTemplate(report) {
  const format = report.format === "quick" ? "QUICK ROUNDS" : "ROUND ROBIN";
  return html`${header(
    report.published
      ? "Published standings"
      : report.status === "complete"
        ? "Final ranking"
        : "Provisional ranking",
    report.published
      ? `PUBLISHED · ${report.records.length} MATCHES · ${format}${
          report.generatedAt ? " · " + report.generatedAt.slice(0, 10) : ""
        }`
      : `${report.records.length} / ${report.totalMatches} MATCHES · ${format} · ${report.status.toUpperCase()}`,
  )}
  ${rows(
    ["#", "Controller", "Bradley–Terry", "95% CI", "Score %", "W / D / L", "Δ Flip",
     "Ring-out + / −", "Mean energy", "First contact", "Violations / match", "Timeouts"],
    report.ranking.map(
      (r, i) => html`<tr>
        <td class="rank-number">${String(i + 1).padStart(2, "0")}</td>
        <td><strong>${botName(r)}</strong><small>${botDetails(r)}</small></td>
        <td class="bt-score">${r.score.toFixed(1)}</td>
        <td class="mono">${r.ci?.map((n) => n.toFixed(1)).join(" – ") ?? "—"}</td>
        <td>${(r.winRate * 100).toFixed(1)}%</td>
        <td class="mono">${r.wins} / ${r.draws} / ${r.matches - r.wins - r.draws}</td>
        <td>${r.flipDifferential > 0 ? "+" : ""}${r.flipDifferential}</td>
        <td>${r.ringOutsInflicted} / ${r.ringOutsTaken}</td>
        <td>${r.meanEnergy.toFixed(1)}</td>
        <td>${r.meanFirstContactTick === null ? "—" : (r.meanFirstContactTick / 60).toFixed(1) + " s"}</td>
        <td>${r.violationsPerMatch.toFixed(2)}</td>
        <td>${r.timeouts}</td>
      </tr>`,
    ),
  )}`;
}

// One radar per controller: the axes are scaled against the rest of the roster,
// so the shape compares controllers instead of measuring them absolutely.
function radar(profile) {
  const point = (index, radius) => {
    const angle = (Math.PI * 2 * index) / STYLE_AXES.length - Math.PI / 2;
    return [60 + radius * Math.cos(angle), 60 + radius * Math.sin(angle)];
  };
  const ring = (radius) =>
    STYLE_AXES.map((_, i) => point(i, radius).map((n) => n.toFixed(1)).join(",")).join(" ");
  const shape = STYLE_AXES.map((axis, i) =>
    point(i, 12 + 34 * Math.min(1, Math.max(0, profile[axis.key])))
      .map((n) => n.toFixed(1))
      .join(","),
  ).join(" ");
  return html`<svg viewBox="-40 -8 200 142" role="img" aria-hidden="true">
    <polygon class="radar-grid" points=${ring(46)} />
    <polygon class="radar-grid" points=${ring(23)} />
    ${STYLE_AXES.map((_, i) => {
      const [x, y] = point(i, 46);
      return svg`<line class="radar-grid" x1="60" y1="60" x2=${x.toFixed(1)} y2=${y.toFixed(1)} />`;
    })}
    <polygon class="radar-shape" points=${shape} />
    ${STYLE_AXES.map((axis, i) => {
      const [x, y] = point(i, 54);
      // Left of the centre the text runs outwards to the left, right of it to the right.
      const anchor = x > 61 ? "start" : x < 59 ? "end" : "middle";
      const dx = anchor === "start" ? 4 : anchor === "end" ? -4 : 0;
      const dy = y > 61 ? 8 : y < 59 ? 0 : 3;
      return svg`<text class="radar-label" x=${(x + dx).toFixed(1)} y=${(y + dy).toFixed(1)}
        text-anchor=${anchor}>${axis.short ?? axis.label}</text>`;
    })}
  </svg>`;
}

export function styleTemplate(report) {
  const profiles = styleProfiles(report.ranking);
  if (!profiles) return nothing;
  return html`${header("Play style", "MEASURED OVER THE SAME MATCHES · SCALED ON THIS ROSTER")}
  <div class="style-cards">
    ${report.ranking.map(
      (r, i) => html`<article class="style-card">
        <header><strong>${botName(r)}</strong><span class="tag">${styleLabel(profiles[i])}</span></header>
        ${radar(profiles[i])}
        <dl>
          ${STYLE_AXES.map(
            (axis) => html`<div><dt>${axis.label}</dt><dd>${formatStyleValue(axis, r.style)}</dd></div>`,
          )}
        </dl>
      </article>`,
    )}
  </div>`;
}

// Results and source folded into one number. The ranking stays the ranking.
export function indexTemplate(report) {
  const index = compositeIndex(report);
  if (!index) return nothing;
  return html`${header("Craft index", "RESULTS AND SOURCE · NOT THE RANKING")}
  ${rows(
    ["Controller", "Craft index", ...INDEX_TERMS.map((term) => `${term.label} · ${Math.round(term.weight * 100)}%`)],
    report.ranking.map(
      (row, i) => html`<tr>
        <td><strong>${botName(row)}</strong></td>
        <td class="bt-score">${index[i].index.toFixed(1)}</td>
        ${INDEX_TERMS.map(
          (term) => html`<td class="mono">${
            index[i].terms[term.key] === null ? "—" : index[i].terms[term.key].toFixed(2)
          }</td>`,
        )}
      </tr>`,
    ),
  )}`;
}

// Static source measurements, published with the standings.
export function codeTemplate(report) {
  const order = new Map(report.ranking.map((row, i) => [row.id, i]));
  const measured = (report.bots ?? [])
    .filter((bot) => bot.code)
    .sort((x, y) => (order.get(x.id) ?? Infinity) - (order.get(y.id) ?? Infinity));
  if (!measured.length) return nothing;
  return html`${header("Implementation", "MEASURED FROM THE SUBMITTED SOURCE")}
  ${rows(
    ["Controller", "Language", "Lines", "Code", "Comments", "Functions", "Cyclomatic", "Max nesting", "Size"],
    measured.map(
      (bot) => html`<tr>
        <td><strong>${botName(bot)}</strong></td>
        <td>${bot.code.language}</td>
        ${["lines", "codeLines", "commentLines", "functions", "complexity", "maxDepth"].map(
          (key) => html`<td class="mono">${bot.code[key]}</td>`,
        )}
        <td class="mono">${(bot.code.bytes / 1024).toFixed(1)} kB</td>
      </tr>`,
    ),
  )}`;
}

// The watch handler is bound to its own row: no delegated listener, no index
// travelling through a data attribute.
export function matchesTemplate(report, watch) {
  if (!report.records.length) return nothing;
  return html`${header("Completed matches", "WATCH WHILE THE TOURNAMENT RUNS")}
  ${rows(
    ["#", "Round", "Match", "Seed / spawn", "Result", "Replay"],
    report.records
      .map(
        (r, i) => html`<tr>
          <td>${i + 1}</td>
          <td>${r.round}</td>
          <td>${botName(report.bots[r.a])} vs ${botName(report.bots[r.b])}</td>
          <td>${r.seed} / ${r.mirrored ? "Mirrored" : "Standard"}</td>
          <td>
            ${r.score === 0.5 ? "Draw" : botName(report.bots[r.score === 1 ? r.a : r.b]) + " wins"}
            <small>${r.reason} · ${clock(r.ticks / 60)}</small>
          </td>
          <td>
            <button class="button outline" @click=${() => watch(i)}>${iconTemplate("play")}Watch</button>
          </td>
        </tr>`,
      )
      .reverse(),
  )}`;
}
