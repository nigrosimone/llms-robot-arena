// Prompt assembly and reply parsing. Only public material reaches a model:
// the rules document, the generated controller itself and public match outcomes.
// No competing implementation, memory dump or internal state is ever sent.
export const SYSTEM_PROMPT = [
  "You write autonomous robot controllers for the llms-robot-arena simulator.",
  "Reply with one complete controller file and nothing else: no explanation, no prose,",
  "no markdown outside a single fenced code block.",
  "The file must use ESM with exactly one export named tick(sensors, memory) returning",
  "{ actions: { thrust, turn }, memory }. No imports, no dependencies, no network,",
  "filesystem, clock, randomness or dynamic code evaluation. Treat sensors and the incoming",
  "memory as immutable, return finite numbers and strict JSON memory under 64 KiB, and keep",
  "each tick well under the documented execution budget.",
].join(" ");

export function buildTask({ language = "js", brief = "" } = {}) {
  return [
    `Write the complete controller as a single ${language === "ts" ? "TypeScript" : "JavaScript"} file.`,
    "It must pass every conformity check and beat a basic blind baseline controller.",
    brief && `Additional guidance from the operator: ${brief}`,
    "Reply with the file content only.",
  ].filter(Boolean).join("\n");
}

export function buildInitialMessage({ spec, language = "js", brief = "" }) {
  if (!spec?.trim()) throw new Error("The specification document is empty.");
  return [
    "Rules, contract and evaluation procedure for the arena:",
    "", spec.trim(), "",
    buildTask({ language, brief }),
  ].join("\n");
}

// Models wrap code in fences, prefix it with prose or return the bare file.
export function extractControllerSource(text) {
  if (typeof text !== "string" || !text.trim())
    throw new Error("The model returned an empty reply.");
  const blocks = [...text.matchAll(/```[a-zA-Z]*\s*\n([\s\S]*?)```/g)].map(match => match[1]);
  const candidates = blocks.filter(block => /\btick\b/.test(block));
  const source = (candidates.length ? candidates : blocks.length ? blocks : [text])
    .reduce((longest, block) => (block.length > longest.length ? block : longest), "")
    .trim();
  if (!source) throw new Error("The model reply contained no source code.");
  if (!/\btick\b/.test(source))
    throw new Error("The model reply contains no tick implementation.");
  return source + "\n";
}

export function botIdFromModel(model, thinking = null) {
  const id = [model, thinking].filter(Boolean).join(" ").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) throw new Error("Could not derive a bot ID; pass --id.");
  return id;
}

const round = (value, digits = 2) =>
  typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(digits)) : value;

export function describeGate(gate) {
  const failed = gate.checks.filter(check => !check.pass);
  return [
    `Conformity gate: admission ${gate.eligible ? "PASS" : "FAIL"}, full conformity ${gate.pass ? "PASS" : "FAIL"}.`,
    ...failed.map(check => `- FAILED ${check.name}${check.detail ? `: ${check.detail}` : ""}` +
      (check.required === false ? " (advisory for this budget)" : "")),
    failed.length ? "" : "- All checks passed.",
  ].filter(Boolean).join("\n");
}

// Only public match outcomes are reported back: results, reasons and the controller's
// own telemetry. The opponent stays an opaque identifier.
export function describeSeries(series, { opponentId = "the opponent" } = {}) {
  const lines = series.records.map(record => {
    const outcome = record.score === 1 ? "win" : record.score === 0 ? "loss" : "draw";
    return `- seed ${record.seed}${record.mirrored ? " mirrored" : ""}: ${outcome} by ${record.reason}` +
      ` after ${record.ticks} ticks; your flips ${record.flips[0]}, energy ${round(record.energy[0], 1)},` +
      ` distance from center ${round(record.centerDistance[0], 1)}` +
      (record.violations[0] ? `, violations ${record.violations[0]}` : "");
  });
  return [
    `Result against ${opponentId} over ${series.matches} mirrored-seed matches:`,
    `${series.wins} wins, ${series.draws} draws, ${series.losses} losses (score ${(series.score * 100).toFixed(1)}%).`,
    ...lines,
  ].join("\n");
}

export function repairMessage(gate) {
  return [
    describeGate(gate),
    "",
    "Fix the controller so every required check passes and reply with the complete file only.",
  ].join("\n");
}

export function improveMessage(series, options) {
  return [
    describeSeries(series, options),
    "",
    series.beatsOpponent
      ? "Improve the margin without losing conformity."
      : "The controller must win more matches than it loses. Diagnose the losses above and revise the strategy.",
    "Reply with the complete revised file only.",
  ].join("\n");
}
