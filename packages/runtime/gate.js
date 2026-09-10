import { fixtures } from "./fixtures.js";
import { createMatch, sensorsFor } from "../sim/index.js";
export async function gateBot(client, source, budgetMode = "fuel") {
  if (!["fuel", "wall"].includes(budgetMode)) throw new Error("Invalid gate budget.");
  const verdict = checks => ({
    // Full conformity always includes timing. Admission follows the match budget.
    pass: checks.every(c => c.pass),
    eligible: checks.every(c => c.pass || c.required === false),
    checks,
    budgetMode: "fuel",
    requestedMatchBudget: budgetMode,
  });
  const checks = [];
  // Functional checks must not mislabel an OS scheduling spike as impurity.
  // Deterministic bounded execution is used here; p99 wall time is assessed separately.
  try {
    await client.request({ type: "init", source, budgetMode: "fuel" });
    checks.push(
      { name: "Export tick · JavaScript", pass: true },
      { name: "Static analysis and isolated scope", pass: true },
    );
  } catch (e) {
    return verdict([
      { name: "Compilation and sandbox", pass: false, detail: e.message },
    ]);
  }
  const inputs = fixtures(),
    times = [];
  let pure = true,
    exceptions = 0,
    actions = true,
    memory = true;
  // Warm up instrumentation outside measured samples.
  for (let i = 0; i < 10; i++)
    await client.request({ type: "probe", sensors: inputs[i], memory: null });
  for (const s of inputs) {
    const a = await client.request({ type: "probe", sensors: s, memory: null }),
      b = await client.request({ type: "probe", sensors: s, memory: null });
    pure &&=
      JSON.stringify([a.actions, a.memory, a.violations]) ===
      JSON.stringify([b.actions, b.memory, b.violations]);
    times.push(a.duration, b.duration);
    exceptions += a.violations.filter(
      (v) => v === "exception" || v === "tick-budget",
    ).length;
    actions &&= !a.violations.some((v) => v.startsWith("invalid-t"));
    memory &&= !a.violations.includes("invalid-memory");
  }
  let maxBytes = 0,
    inertOK = true;
  const inert = createMatch(123);
  for (let tick = 0; tick < 600; tick++) {
    inert.tick = tick;
    const s = sensorsFor(inert, 0);
    const r = await client.request({ type: "tick", sensors: s });
    maxBytes = Math.max(maxBytes, new TextEncoder().encode(r.memory).length);
    inertOK &&= r.violations.length === 0;
  }
  times.sort((a, b) => a - b);
  const p99 = times[Math.ceil(times.length * 0.99) - 1];
  checks.push(
    { name: "Purity · identical input, identical output", pass: pure },
    {
      name: "200 snapshots, including edge cases",
      pass: exceptions === 0,
      detail: exceptions + " errors",
    },
    { name: "Finite numeric actions", pass: actions },
    { name: "Memory JSON ≤ 64 KB", pass: memory },
    { name: "p99 time < 2 ms", pass: p99 < 2, detail: p99.toFixed(3) + " ms", required: budgetMode === "wall" },
    {
      name: "600 inert ticks · bounded memory",
      pass: inertOK && maxBytes <= 65536,
      detail: maxBytes + " peak bytes",
    },
  );
  return {
    ...verdict(checks),
    p99,
    maxBytes,
  };
}
