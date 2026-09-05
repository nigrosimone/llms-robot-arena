import test from "node:test";
import assert from "node:assert/strict";
import { readMatchSettings, matchSettingsSearch } from "../packages/viewer/match-link.js";

const bots = [{ id: "alpha" }, { id: "beta" }];

test("a match link selects controllers, seed and spawn", () => {
  assert.deepEqual(readMatchSettings("?a=beta&b=alpha&seed=7&spawn=mirror", bots), {
    a: 1, b: 0, seed: 7, spawn: "mirror",
  });
  assert.deepEqual(readMatchSettings("?seed=0", bots), { a: null, b: null, seed: 0, spawn: null });
  assert.equal(readMatchSettings("", bots), null);
  assert.equal(readMatchSettings("?replay=./replays/demo.json", bots), null);
});

test("a match link rejects unknown controllers and invalid settings", () => {
  assert.throws(() => readMatchSettings("?a=gamma", bots), /Unknown controller/);
  for (const seed of ["-1", "1.5", "4294967296", "", "abc"])
    assert.throws(() => readMatchSettings("?seed=" + seed, bots), /seed/);
  assert.throws(() => readMatchSettings("?spawn=random", bots), /spawn/);
});

test("simulated matches produce a shareable query string", () => {
  assert.equal(
    matchSettingsSearch({ a: "alpha", b: "beta", seed: 12, mirrored: false }),
    "?a=alpha&b=beta&seed=12&spawn=normal",
  );
  assert.equal(
    readMatchSettings(matchSettingsSearch({ a: "beta", b: "alpha", seed: 3, mirrored: true }), bots).spawn,
    "mirror",
  );
});
