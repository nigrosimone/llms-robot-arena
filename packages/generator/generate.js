import {
  SYSTEM_PROMPT, buildInitialMessage, describeGate, extractControllerSource,
  improveMessage, repairMessage,
} from "./prompt.js";

const summarizeGate = gate => ({
  pass: gate.pass, eligible: gate.eligible, p99: gate.p99 ?? null,
  failed: gate.checks.filter(check => !check.pass).map(check => check.name),
});
const summarizeSeries = series => series && {
  matches: series.matches, wins: series.wins, draws: series.draws, losses: series.losses,
  score: series.score, beatsOpponent: series.beatsOpponent, violations: series.violations,
};

// Runs the generate → gate → evaluate loop. Every dependency is injected so the
// orchestration is testable without a network call or a simulated match.
export async function generateController({
  spec, language = "js", brief = "",
  complete, gate, evaluate = null,
  attempts = 3, rounds = 0, requireFullConformity = false,
  opponentId = "the opponent", stopWhenWinning = false,
  log = () => {},
}) {
  if (typeof complete !== "function" || typeof gate !== "function")
    throw new Error("generateController requires complete() and gate() implementations.");
  if (!(attempts >= 1)) throw new Error("At least one attempt is required.");
  const messages = [{ role: "user", content: buildInitialMessage({ spec, language, brief }) }];
  const history = [];
  const accepted = verdict => (requireFullConformity ? verdict.pass : verdict.eligible);
  let requests = 0, feedbackUsed = false;
  const propose = async () => {
    requests++;
    const text = await complete({ system: SYSTEM_PROMPT, messages });
    messages.push({ role: "assistant", content: text });
    return extractControllerSource(text);
  };
  const feedback = content => {
    feedbackUsed = true;
    messages.push({ role: "user", content });
  };
  // A candidate is only usable once the conformity gate admits it.
  const conforming = async (stage, budget) => {
    let candidate = null, verdict = null;
    for (let attempt = 1; attempt <= budget; attempt++) {
      try {
        candidate = await propose();
      } catch (e) {
        log({ stage, attempt, error: e.message });
        if (attempt === budget) throw e;
        feedback(`${e.message}\nReply with the complete controller file only.`);
        continue;
      }
      verdict = await gate(candidate);
      history.push({ stage, attempt, gate: summarizeGate(verdict) });
      log({ stage, attempt, gate: summarizeGate(verdict) });
      if (accepted(verdict)) return { source: candidate, gate: verdict };
      if (attempt < budget) feedback(repairMessage(verdict));
    }
    return { source: candidate, gate: verdict, rejected: true };
  };

  const first = await conforming("generate", attempts);
  if (first.rejected) throw new Error(
    `No conforming controller after ${attempts} attempts.\n${describeGate(first.gate)}`,
  );
  let best = { source: first.source, gate: first.gate, series: null }, current = best;
  if (evaluate) {
    current = { ...first, series: await evaluate(first.source) };
    best = current;
    history.push({ stage: "evaluate", round: 0, series: summarizeSeries(current.series) });
    log({ stage: "evaluate", round: 0, series: summarizeSeries(current.series) });
    for (let round = 1; round <= rounds; round++) {
      if (stopWhenWinning && current.series.beatsOpponent) break;
      feedback(improveMessage(current.series, { opponentId }));
      const revision = await conforming(`improve-${round}`, attempts);
      if (revision.rejected) {
        log({ stage: `improve-${round}`, discarded: "conformity" });
        feedback([
          "That revision did not pass the conformity gate and was discarded.",
          "The controller still in use is:",
          "```" + language, current.source.trim(), "```",
        ].join("\n"));
        continue;
      }
      // Feedback always describes the newest conforming revision; the best scoring
      // controller is tracked separately and is the one returned.
      current = { source: revision.source, gate: revision.gate, series: await evaluate(revision.source) };
      history.push({ stage: `improve-${round}`, round, series: summarizeSeries(current.series) });
      log({ stage: `improve-${round}`, round, series: summarizeSeries(current.series) });
      if (current.series.score > best.series.score) best = current;
      else log({ stage: `improve-${round}`, kept: "previous best" });
    }
  }
  return {
    ...best,
    // Any gate or match feedback sent back to the model makes the run iterative.
    provenance: feedbackUsed ? "iterative" : "one-shot",
    requests, history,
  };
}
