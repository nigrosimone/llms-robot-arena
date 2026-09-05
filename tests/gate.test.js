import test from "node:test";
import assert from "node:assert/strict";
import { gateBot } from "../packages/runtime/gate.js";
import { renderReport } from "../packages/tournament/report.js";

// Public fixtures make admission tests independent of machine speed and bot internals.
function client({ duration = 4.4, violations = [], initError = false, mutate = () => {} } = {}) {
  let probes = 0;
  return {
    async request(message) {
      if (message.type === "init") {
        assert.equal(message.budgetMode, "fuel");
        if (initError) throw Error("Compilation rejected");
        return {};
      }
      const output = { actions: { thrust: 0, turn: 0 }, memory: "null", violations, duration };
      mutate(output, message.type, probes++);
      return output;
    },
  };
}

test("slow timing is advisory for fuel admission and remains a full conformity failure", async () => {
  const gate = await gateBot(client(), "public fixture", "fuel");
  assert.equal(gate.eligible, true);
  assert.equal(gate.pass, false);
  assert.equal(gate.p99, 4.4);
  assert.equal(gate.checks.filter(check => !check.pass).length, 1);
  assert.equal(gate.checks.find(check => !check.pass).required, false);
  assert.equal(gate.requestedMatchBudget, "fuel");
});

test("wall admission retains the strict 2 ms boundary", async () => {
  for (const duration of [1.9, 2, 4.4]) {
    const gate = await gateBot(client({ duration }), "public fixture", "wall");
    assert.equal(gate.eligible, duration < 2);
    assert.equal(gate.pass, duration < 2);
    assert.equal(gate.checks.find(check => check.name.startsWith("p99")).required, true);
    assert.equal(gate.requestedMatchBudget, "wall");
  }
});

test("fast controllers pass both verdicts under either budget", async () => {
  for (const budget of ["fuel", "wall"]) {
    const gate = await gateBot(client({ duration: 0.5 }), "public fixture", budget);
    assert.equal(gate.pass, true);
    assert.equal(gate.eligible, true);
  }
});

test("fuel admission still rejects compilation, exceptions, instruction limits and invalid output", async () => {
  for (const violation of ["exception", "tick-budget", "invalid-thrust", "invalid-turn", "invalid-memory"]) {
    const gate = await gateBot(client({ violations: [violation] }), "public fixture", "fuel");
    assert.equal(gate.eligible, false, violation);
    assert.equal(gate.pass, false);
  }
  const invalid = await gateBot(client({ initError: true }), "public fixture", "fuel");
  assert.equal(invalid.eligible, false);
  assert.equal(invalid.pass, false);
  assert.equal(invalid.checks[0].detail, "Compilation rejected");
});

test("purity and inert-scenario failures remain required in fuel mode", async () => {
  for (const mutate of [
    (output, type, count) => { if (type === "probe") output.actions.thrust = count % 2; },
    (output, type) => { if (type === "tick") output.violations = ["tick-budget"]; },
  ]) {
    const gate = await gateBot(client({ mutate }), "public fixture", "fuel");
    assert.equal(gate.eligible, false);
    assert.ok(gate.checks.some(check => !check.pass && check.required !== false));
  }
});

test("reports distinguish fuel admission from full conformity and retain legacy gate results", async () => {
  const gate = await gateBot(client(), "public fixture", "fuel");
  const report = renderReport({
    bots: [{ id: "fixture", model: "Fixture", provider: null }],
    ranking: [], records: [], budgetMode: "fuel", mode: "exhibition", replicates: 0,
    gates: [{ id: "fixture", ...gate }, { id: "legacy", pass: true, p99: 0.5 }],
  });
  assert.match(report, /Fixture \| PASS \| FAIL \| 4\.400/);
  assert.match(report, /PASS \| PASS \| 0\.500/);
  assert.match(report, /fuel budget/);
});

test("unknown gate budgets cannot silently select advisory timing", async () => {
  await assert.rejects(gateBot(client(), "public fixture", "unknown"), /Invalid gate budget/);
});
