import test from "node:test";
import assert from "node:assert/strict";
import { sortedBotOptions, groupedBotOptions, controllerFilename } from "../packages/viewer/controllers.js";

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

test("selectors group controllers by provider, then reference, then the ones written in the tab", () => {
  const bots = [
    { id: "b", model: "GPT B", provider: "OpenAI" },
    { id: "Baseline", model: "Baseline", provider: null, provenance: "reference" },
    { id: "custom-1", model: "Mine", provider: "Assistant" },
    { id: "a", model: "Claude A", provider: "Anthropic" },
    { id: "c", model: "GPT A", provider: "OpenAI" },
  ];
  assert.deepEqual(groupedBotOptions(bots).map((g) => [g.label, g.options.map((o) => o.index)]), [
    ["Anthropic", [3]], ["OpenAI", [4, 0]], ["Reference", [1]], ["Your controllers", [2]],
  ]);
});
