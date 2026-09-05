import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createMatch,
  sensorsFor,
  step,
  publicRobot,
} from "../packages/sim/index.js";
import {
  contact,
  corners,
  wedgeAngle,
  leverage,
} from "../packages/sim/collision.js";
import { SPEC, SPEC_VERSION, ENGINE_VERSION } from "../packages/sim/spec.js";
import { tick as baseline } from "../packages/bots/baseline.js";
import { renderReport, renderCSV } from "../packages/tournament/report.js";
import { rankTournament } from "../packages/tournament/ranking.js";

const robot = (x, y, heading) => ({ x, y, heading });
test("geometry covers dimensions, wedge sectors and non-contact inside broad phase", () => {
  const points = corners(robot(1, 2, 0));
  assert.deepEqual(
    points.map((p) => Number((p.x - 1).toFixed(9))).sort(),
    [-0.4, -0.4, 0.4, 0.4],
  );
  assert.deepEqual(
    points.map((p) => Number((p.y - 2).toFixed(9))).sort(),
    [-0.3, -0.3, 0.3, 0.3],
  );
  assert.equal(contact(robot(0, 0, 0), robot(0.9, 0, 0)), null);
  assert.ok(
    wedgeAngle(robot(0, 0, 0), { x: 1, y: Math.tan(0.6) }) <
      SPEC.WEDGE_HALF_ANGLE,
  );
  assert.ok(
    wedgeAngle(robot(0, 0, 0), { x: 1, y: Math.tan(0.62) }) >
      SPEC.WEDGE_HALF_ANGLE,
  );
  assert.deepEqual(
    [40, 90, 150].map((d) => leverage((d * Math.PI) / 180)),
    [0.6, 1, 0.85],
  );
});
test("canonical ordering preserves exact contact geometry when A/B swap", () => {
  for (const [a, b] of [
    [robot(0.1, -0.2, 0.3), robot(0.6, 0.3, 2)],
    [robot(0, 0, 0), robot(0.69, 0, Math.PI / 2)],
  ]) {
    const ab = contact(a, b),
      ba = contact(b, a);
    assert.ok(ab && ba);
    assert.deepEqual(ab.c, ba.c);
    assert.equal(ab.depth, ba.depth);
    assert.equal(ab.n.x, -ba.n.x);
    assert.equal(ab.n.y, -ba.n.y);
  }
});
test("mirrored baseline matches exchange robot states exactly, through all contacts", () => {
  for (const seed of [0, 7]) {
    const a = createMatch(seed),
      b = createMatch(seed, true);
    while (!a.result && !b.result) {
      for (const match of [a, b])
        step(
          match,
          [0, 1].map((i) => baseline(sensorsFor(match, i), null)),
        );
      assert.deepEqual(
        publicRobot(a.robots[0]),
        publicRobot(b.robots[1]),
        `seed ${seed}, tick ${a.tick}`,
      );
      assert.deepEqual(
        publicRobot(a.robots[1]),
        publicRobot(b.robots[0]),
        `seed ${seed}, tick ${a.tick}`,
      );
    }
    assert.equal(a.result.reason, b.result.reason);
    assert.equal(
      a.result.winner,
      b.result.winner === null ? null : 1 - b.result.winner,
    );
  }
});
test("public bot rules match engine constants and include the black-box policy", async () => {
  const prompt = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
  const table = prompt.match(/<!-- engine-constants -->\s*```json\s*(\{[\s\S]*?\})\s*```/)[1];
  assert.deepEqual(JSON.parse(table), SPEC);
  assert.ok(prompt.includes(`**Rules version:** \`${SPEC_VERSION}\``));
  assert.ok(prompt.includes(`**Engine:** \`${ENGINE_VERSION}\``));
  assert.deepEqual([...prompt.matchAll(/^## (\d+)\./gm)].map(match => +match[1]), [3, 4, 5, 6, 7, 8, 9, 15]);
  assert.ok(!prompt.includes("export function tick(s, memory)"));
  assert.ok(!/gpt-6-astra-ultra|fable-5-6-max/.test(prompt));
  assert.ok(prompt.includes("Every other bot implementation is a black box."));
});
test("Markdown report uses computed rankings, draws, provenance and metrics", () => {
  const bots = [
    { id: "A|<test>", model: "local", codeSha256: "a".repeat(64) },
    { id: "B", model: "local", codeSha256: "b".repeat(64) },
  ];
  const records = [
    {
      a: 0,
      b: 1,
      seed: 0,
      mirrored: false,
      score: 0.5,
      reason: "timeout",
      flips: [0, 0],
      energy: [30, 30],
      violations: [0, 0],
      ringOuts: [0, 0],
      firstContact: null,
    },
  ];
  const ranking = rankTournament(bots, records, 10);
  const text = renderReport({
    specVersion: "0.1.0-draft",
    engineVersion: "0.1.0-r2",
    mode: "exhibition",
    budgetMode: "fuel",
    replicates: 10,
    bots,
    records,
    ranking,
  });
  assert.match(text, /A&#124;&lt;test&gt;/);
  assert.match(text, /50\.0 \| 0\.0 \| 0 \/ 1 \/ 0/);
  assert.match(text, /\*\*Mode:\*\* exhibition/);
  assert.ok(text.includes(bots[0].codeSha256));
  const csv = renderCSV([{ ...ranking[0], id: 'A,"quoted"' }]);
  assert.ok(csv.includes('"A,""quoted"""'));
  assert.match(csv, /scoreRate,winRate/);
});
