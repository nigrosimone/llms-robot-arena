import test from "node:test";
import assert from "node:assert/strict";
import { sortedBotOptions, controllerFilename } from "../packages/viewer/controllers.js";

test("alphabetical selectors retain original bot indices and leave the roster untouched", () => {
  const bots = ["Zulu", "alpha", "Beta"].map((model, i) => ({ id: String(i), model, provider: null }));
  const before = structuredClone(bots);
  assert.deepEqual(sortedBotOptions(bots).map(b => b.index), [1, 2, 0]);
  assert.deepEqual(bots, before);
});

test("a downloaded controller is always a JS file with a safe name", () => {
  assert.equal(controllerFilename("Example bot"), "Example-bot.js");
  assert.equal(controllerFilename(" Ünïcode / path "), "-n-code---path.js");
  assert.equal(controllerFilename(""), "controller.js");
});
