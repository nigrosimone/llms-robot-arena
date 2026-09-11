import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { sin, cos, atan, atan2, hypot } from "../packages/sim/math.js";
import { mulberry32 } from "../packages/sim/spec.js";

const ulpsApart = (a, b) => {
  const words = new BigInt64Array(new Float64Array([a, b]).buffer);
  return Number(words[0] > words[1] ? words[0] - words[1] : words[1] - words[0]);
};
const close = (mine, native, x) =>
  assert.ok(ulpsApart(mine, native) <= 2, `${x}: ${mine} vs ${native}`);

test("the fdlibm port agrees with Math within two ulps across the arena ranges", () => {
  const rng = mulberry32(2024);
  for (let i = 0; i < 20000; i++) {
    // Headings stay within (-pi, pi]; spawn angles reach 2 pi plus a quarter.
    const angle = (rng() - 0.5) * 16;
    close(sin(angle), Math.sin(angle), `sin ${angle}`);
    close(cos(angle), Math.cos(angle), `cos ${angle}`);
    const y = (rng() - 0.5) * 40, x = (rng() - 0.5) * 40;
    close(atan2(y, x), Math.atan2(y, x), `atan2 ${y} ${x}`);
    close(atan(y), Math.atan(y), `atan ${y}`);
    close(hypot(y, x), Math.hypot(y, x), `hypot ${y} ${x}`);
  }
  // Multiples of pi/2 exercise the cancellation rounds of the reduction.
  for (let n = -40; n <= 40; n++) {
    const x = (n * Math.PI) / 2;
    close(sin(x), Math.sin(x), `sin ${x}`);
    close(cos(x), Math.cos(x), `cos ${x}`);
  }
});

test("special values keep their signs and limits", () => {
  assert.ok(Object.is(sin(0), 0) && Object.is(sin(-0), -0));
  assert.equal(cos(0), 1);
  assert.equal(sin(1e-30), 1e-30);
  assert.equal(atan2(0, -1), Math.PI);
  assert.equal(atan2(-0, -1), -Math.PI);
  assert.ok(Object.is(atan2(-0, 1), -0));
  assert.equal(atan2(1, 0), Math.PI / 2);
  assert.equal(atan2(-1, 0), -Math.PI / 2);
  assert.equal(atan2(0, 0), 0);
  assert.equal(atan2(1, 1), Math.PI / 4);
  assert.equal(atan2(1, Infinity), 0);
  assert.equal(atan2(Infinity, Infinity), Math.PI / 4);
  assert.ok(Number.isNaN(sin(Infinity)) && Number.isNaN(cos(NaN)) && Number.isNaN(atan2(NaN, 1)));
  assert.equal(hypot(3, 4), 5);
  assert.ok(Math.abs(sin(1e6) - Math.sin(1e6)) < 1e-9, "huge arguments still reduce");
});

test("the simulation never calls the engine-dependent Math functions", async () => {
  const dir = new URL("../packages/sim/", import.meta.url);
  for (const name of await readdir(dir)) {
    if (name === "math.js") continue;
    const source = await readFile(new URL(name, dir), "utf8");
    const calls = source.match(/Math\.(sin|cos|tan|asin|acos|atan2?|hypot|exp|log\w*|pow|cbrt|sinh|cosh|tanh)\b/g);
    assert.equal(calls, null, `${name} uses ${calls?.join(", ")}`);
  }
});
