import test from "node:test";
import assert from "node:assert/strict";
import {
  renderStandings,
  updateStandingsSection,
  STANDINGS_START,
  STANDINGS_END,
} from "../packages/tournament/standings.js";

const report = {
  format: "round-robin",
  rounds: 1,
  budgetMode: "fuel",
  specVersion: "0.2.2-draft",
  engineVersion: "0.2.2-r1",
  generatedAt: "2026-09-09T10:00:00.000Z",
  records: [{}, {}],
  bots: [{ id: "a", file: "packages/bots/model-a.js" }, { id: "b", file: null }],
  ranking: [
    { id: "a", model: "Model A", provider: "OpenAI", thinking: "ultra", harness: "Codex",
      provenance: "iterative", score: 120, ci: [110, 130],
      winRate: 0.75, matches: 2, wins: 1, draws: 1 },
    { id: "b", model: "Model B", provider: null, provenance: "reference", score: 80, ci: null,
      winRate: 0.25, matches: 2, wins: 0, draws: 1 },
  ],
};

test("renders the standings table", () => {
  const rows = renderStandings(report).split("\n");
  assert.match(rows[0], /Round robin \(10 seeds per pair, mirrored spawns\) · 2 matches/);
  assert.match(rows[0], /generated 2026-09-09\./);
  assert.equal(
    rows[4],
    "| 1 | Model A | OpenAI | ultra | Codex | iterative | [model-a.js](packages/bots/model-a.js) | 120.0 | 110.0 – 130.0 | 75.0 | 1 / 1 / 0 |",
  );
  assert.equal(
    rows[5],
    "| 2 | Model B | Reference controller | — | — | reference | — | 80.0 | — | 25.0 | 0 / 1 / 1 |",
  );
});

test("links catalog controllers without a published path", () => {
  const rows = renderStandings({
    ...report,
    bots: undefined,
    ranking: [{ ...report.ranking[0], id: "Baseline", model: "Baseline" }],
  }).split("\n");
  assert.match(rows[4], /\[baseline\.js\]\(packages\/bots\/baseline\.js\)/);
});

test("adds the play style table when the ranking carries style", () => {
  const style = {
    closingShare: 0.4, proximityShare: 0.3, wedgeShare: 0.6, engagementRate: 7.2,
    contactShare: 0.2, speed: 1.1, turnRate: 0.5, edgeShare: 0.1, spendRate: 12.5, recharges: 1.5,
  };
  const markdown = renderStandings({
    ...report,
    ranking: report.ranking.map((r) => ({ ...r, style })),
  });
  const rows = markdown.split("\n");
  assert.ok(markdown.includes("**Play style.**"));
  assert.equal(
    rows.at(-2),
    "| Model A | Aggression | 20% | 40% | 60% | 7.2 | 1.10 m/s | 0.50 rad/s | 10% | 12.5 | 1.5 |",
  );
});

test("quick rounds report their round count", () => {
  assert.match(renderStandings({ ...report, format: "quick" }), /Quick rounds \(1 round,/);
});

test("replaces only the marked section", () => {
  const document = `# Title\n\n${STANDINGS_START}\n\nold\n\n${STANDINGS_END}\n\nRest.\n`;
  const updated = updateStandingsSection(document, "new table");
  assert.equal(updated, `# Title\n\n${STANDINGS_START}\n\nnew table\n\n${STANDINGS_END}\n\nRest.\n`);
});

test("requires the markers", () => {
  assert.throws(() => updateStandingsSection("# Title\n", "table"), /Missing/);
});
