import test from "node:test";
import assert from "node:assert/strict";
import { codeMetrics } from "../packages/tournament/code-metrics.js";

const source = `// What this controller does.
export function tick(sensors) { // trailing note
  let x = 0;
  if (sensors.energy > 10 && sensors.opponent) x = 1;
  else x = 2;
  for (let i = 0; i < 3; i++) x += i;
  return { thrust: x, turn: 0 };
}
`;

test("counts branches, functions and nesting", () => {
  const code = codeMetrics(source);
  assert.equal(code.complexity, 4);
  assert.equal(code.functions, 1);
  assert.equal(code.maxDepth, 2);
});

test("separates comment-only lines from trailing notes", () => {
  const code = codeMetrics(source);
  assert.equal(code.lines, 9);
  assert.equal(code.commentLines, 2);
  assert.equal(code.blankLines, 1);
  assert.equal(code.codeLines, 7);
});

test("counts a comment block once per line", () => {
  const code = codeMetrics("/* one\n   two */\nexport const tick = () => ({ thrust: 0, turn: 0 });\n");
  assert.equal(code.commentLines, 2);
  assert.equal(code.codeLines, 1);
  assert.equal(code.functions, 1);
});

test("reads TypeScript sources", () => {
  const code = codeMetrics("export const tick = (s: { energy: number }) => ({ thrust: s.energy ? 1 : 0, turn: 0 });\n", "bot.ts");
  assert.equal(code.language, "ts");
  assert.equal(code.complexity, 2);
});

test("an empty source has no metrics", () => {
  assert.equal(codeMetrics("  \n"), null);
  assert.equal(codeMetrics(null), null);
});
