import test from "node:test";
import assert from "node:assert/strict";
import { sortedBotOptions, controllerExtension, controllerFilename } from "../packages/viewer/controllers.js";

test("alphabetical selectors retain original bot indices and leave the roster untouched", () => {
  const bots = ["Zulu", "alpha", "Beta"].map((model, i) => ({ id: String(i), model, provider: null }));
  const before = structuredClone(bots);
  assert.deepEqual(sortedBotOptions(bots).map(b => b.index), [1, 2, 0]);
  assert.deepEqual(bots, before);
});

test("controller downloads preserve JS and TS types, including explicit language changes", () => {
  assert.equal(controllerExtension({ file: "packages/bots/fixture.js" }), "js");
  assert.equal(controllerExtension({ file: "packages/bots/fixture.ts" }), "ts");
  assert.equal(controllerExtension({ extension: "ts" }), "ts");
  assert.equal(controllerExtension({ extension: "js", file: "fixture.ts" }), "js");
  assert.equal(controllerExtension({}), "js");
  assert.equal(controllerFilename("Example bot", "js"), "Example-bot.js");
  assert.equal(controllerFilename("Example bot", "ts"), "Example-bot.ts");
  assert.equal(controllerFilename("", "js"), "controller.js");
});
