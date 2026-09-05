import test from "node:test";
import assert from "node:assert/strict";
import { controllerExtension, controllerFilename } from "../packages/viewer/controllers.js";

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
