import { createMatch, sensorsFor, step, closeReplay, digest } from "../sim/index.js";
import { SPEC as S } from "../sim/spec.js";
import { botMetadata } from "../bot-catalog.js";

export const HUMAN_BOT = Object.freeze({
  id: "human",
  model: "You",
  provider: "Keyboard",
  thinking: null,
  harness: null,
  provenance: "manual",
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Real-time pacing at 60 Hz. A late tick is played immediately and the backlog
// is dropped: a manual match trades determinism for interactivity by design.
function createPacer() {
  let next = 0;
  return async (tick) => {
    const now = performance.now();
    if (tick === 0) next = now;
    next += S.DT * 1000;
    const delay = next - now;
    if (delay > 1) await wait(delay);
    else if (delay < -100) next = now;
  };
}

// One robot is driven by the keyboard, the other by a sandboxed controller.
// The result is a normal replay marked `manual`: watchable and exportable,
// never comparable with automated matches.
export async function runLiveMatch({
  bot,
  seed = 0,
  mirrored = false,
  player = 0,
  budgetMode = "fuel",
  createClient,
  readInput,
  onTick = () => {},
  stopped = () => false,
  pacer = createPacer(),
}) {
  const opponent = 1 - player;
  const client = await createClient();
  try {
    await client.request({ type: "init", source: bot.source, budgetMode });
    const refs = [];
    refs[player] = { ...HUMAN_BOT, codeSha256: digest("") };
    refs[opponent] = { ...botMetadata(bot), codeSha256: digest(bot.source) };
    const m = createMatch(seed, mirrored, refs);
    onTick({
      type: "live-start",
      arenaCells: structuredClone(m.cells),
      initialFrame: m.initialFrame,
      bots: refs,
      seed: m.seed,
      mirrored,
      player,
    });
    while (!m.result && !stopped()) {
      const out = [];
      out[player] = { actions: readInput(), memory: null };
      try {
        out[opponent] = await client.request({
          type: "tick",
          sensors: sensorsFor(m, opponent),
        });
      } catch (error) {
        // Leaving the match closes the controller while a tick is in flight.
        if (stopped()) break;
        throw error;
      }
      if (stopped()) break;
      const events = m.events.length,
        hashes = m.stateHashes.length,
        loads = m.floorLoads.length;
      step(
        m,
        out,
        out.map((o) => digest(o.memory)),
      );
      onTick({
        type: "live-tick",
        tick: m.tick,
        frame: m.frames.slice((m.tick - 1) * 12, m.tick * 12),
        extent: m.arenaExtents[m.tick - 1],
        loads: m.floorLoads.slice(loads),
        events: m.events.slice(events),
        hashes: m.stateHashes.slice(hashes),
      });
      await pacer(m.tick - 1);
    }
    return m.result
      ? closeReplay(m, "manual", {
          engine: "QuickJS 0.31.0 / WASM",
          budgetMode,
          control: "keyboard",
        })
      : null;
  } finally {
    client.close();
  }
}
