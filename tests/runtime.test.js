import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileBot } from "../packages/runtime/compile.js";
import { createSandbox } from "../packages/runtime/sandbox.js";
import { createMatch, sensorsFor } from "../packages/sim/index.js";
import { fixtures } from "../packages/runtime/fixtures.js";
const sensor = sensorsFor(createMatch(0), 0);
const using = async (src, fn) => {
  const bot = await createSandbox(compileBot(src));
  try {
    await fn(bot);
  } finally {
    bot.dispose();
  }
};
test("AST accepts annotated TypeScript; rejects imports, extra exports and banned globals", () => {
  assert.ok(
    compileBot(
      "type Memory=unknown; export function tick(s: any,m: Memory){return {actions:{thrust:0,turn:0},memory:m}}",
    ),
  );
  for (const src of [
    'import x from "x"; export function tick(){}',
    "export function tick(){} export const x=1",
    "export function tick(){return Math.random()}",
    "export function tick(){return Date.now()}",
    'export function tick(){return import("fs")}',
  ])
    assert.throws(() => compileBot(src));
});
test("baseline has finite outputs on 200 edge snapshots and bounded memory through 600 inert ticks", async () => {
  const source = await readFile(
    new URL("../packages/bots/baseline.js", import.meta.url),
    "utf8",
  );
  await using(source, (bot) => {
    for (const s of fixtures()) {
      const a = bot.call(s, null),
        b = bot.call(s, null);
      assert.deepEqual(a.actions, b.actions);
      assert.equal(a.memory, b.memory);
      assert.deepEqual(a.violations, []);
    }
    for (let i = 0; i < 600; i++) {
      const r = bot.call({ ...sensor, tick: i, time: i / 60 });
      assert.equal(r.memory, "null");
      assert.deepEqual(r.violations, []);
    }
  });
});
test("invalid actions zero individual components; finite out-of-range actions clamp freely", async () => {
  await using(
    "export function tick(){return {actions:{thrust:2,turn:NaN},memory:null}}",
    (b) => {
      const r = b.call(sensor);
      assert.deepEqual(r.actions, { thrust: 1, turn: 0 });
      assert.deepEqual(r.violations, ["invalid-turn"]);
    },
  );
});
test("invalid memory preserves previous memory; UTF-8 64 KiB cap is enforced", async () => {
  await using(
    'export function tick(s,m){return {actions:{thrust:0,turn:0},memory:s.tick===0?{ok:1}:"é".repeat(40000)}}',
    (b) => {
      assert.equal(b.call(sensor).memory, '{"ok":1}');
      const r = b.call({ ...sensor, tick: 1 });
      assert.equal(r.memory, '{"ok":1}');
      assert.deepEqual(r.violations, ["invalid-memory"]);
    },
  );
  await using(
    "export function tick(){const m={};m.x=m;return {actions:{thrust:0,turn:0},memory:m}}",
    (b) => assert.deepEqual(b.call(sensor).violations, ["invalid-memory"]),
  );
});
test("infinite loops are interrupted and exceptions yield zero commands", async () => {
  await using("export function tick(){while(true){}}", (b) => {
    const r = b.call(sensor);
    assert.deepEqual(r.actions, { thrust: 0, turn: 0 });
    assert.deepEqual(r.violations, ["tick-budget"]);
  });
  await using('export function tick(){throw Error("oops")}', (b) =>
    assert.deepEqual(b.call(sensor).violations, ["exception"]),
  );
});
test("module state cannot persist, builtins and inputs cannot be mutated", async () => {
  await using(
    "let counter=0;export function tick(){return {actions:{thrust:0,turn:0},memory:++counter}}",
    (b) => {
      assert.equal(b.call(sensor).memory, "1");
      assert.equal(b.call(sensor).memory, "1");
    },
  );
  await using(
    "export function tick(s){s.self.energy=99;return {actions:{thrust:0,turn:0},memory:null}}",
    (b) => assert.deepEqual(b.call(sensor).violations, ["exception"]),
  );
  await using(
    "export function tick(){Math.cos=()=>0;return {actions:{thrust:0,turn:0},memory:null}}",
    (b) => assert.deepEqual(b.call(sensor).violations, ["exception"]),
  );
});
test("indirect random and code construction cannot bypass the isolated scope", async () => {
  await using(
    'export function tick(){const key="ran"+"dom";return {actions:{thrust:Math[key](),turn:0},memory:null}}',
    (b) => assert.deepEqual(b.call(sensor).violations, ["exception"]),
  );
  await using(
    'export function tick(){const key="constr"+"uctor";return {actions:{thrust:(()=>{})[key]("return 1")(),turn:0},memory:null}}',
    (b) => assert.deepEqual(b.call(sensor).violations, ["exception"]),
  );
});
test("valid surrogate pairs count as four UTF-8 bytes, not six", async () => {
  await using(
    'export function tick(){return {actions:{thrust:0,turn:0},memory:"😀".repeat(11000)}}',
    (b) => {
      const r = b.call(sensor);
      assert.deepEqual(r.violations, []);
      assert.equal(new TextEncoder().encode(r.memory).length, 44002);
    },
  );
});
