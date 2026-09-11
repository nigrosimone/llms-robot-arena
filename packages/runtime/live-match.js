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

// The keyboard has nine states: thrust and turn in {-1, 0, 1}. A code per state
// keeps the input log small enough to travel inside a link.
export const NEUTRAL_INPUT = 4;
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const encodeInput = ({ thrust, turn } = {}) => (sign(thrust) + 1) * 3 + (sign(turn) + 1);
export const decodeInput = (code) => ({ thrust: Math.floor(code / 3) - 1, turn: (code % 3) - 1 });
// Reads a logged sequence of [tick, code] changes back, one tick at a time.
export function replayInputs(log) {
  let next = 0,
    code = NEUTRAL_INPUT;
  return (tick) => {
    while (next < log.length && log[next][0] <= tick) code = log[next++][1];
    return decodeInput(code);
  };
}

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
// The result is a normal replay marked `manual` with the human inputs logged:
// the same seed, controller and log reproduce it hash for hash. It is never
// comparable with automated matches.
export async function runLiveMatch({
  bot,
  seed = 0,
  mirrored = false,
  player = 0,
  budgetMode = "fuel",
  control = "keyboard",
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
    const log = [];
    let state = NEUTRAL_INPUT;
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
      const code = encodeInput(readInput(m.tick));
      if (code !== state) {
        log.push([m.tick, code]);
        state = code;
      }
      out[player] = { actions: decodeInput(code), memory: null };
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
        loads = m.floorLoads.length,
        cells = m.cells.length;
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
        // Stepping on a fresh tile creates its floor cell. Without these the
        // viewer has nothing to wear down, and later nothing to open a hole in.
        cells: structuredClone(m.cells.slice(cells)),
        events: m.events.slice(events),
        hashes: m.stateHashes.slice(hashes),
      });
      await pacer(m.tick - 1);
    }
    if (!m.result) return null;
    const replay = closeReplay(m, "manual", {
      engine: "QuickJS 0.31.0 / WASM",
      budgetMode,
      control,
    });
    replay.inputs = refs.map((_, i) => (i === player ? log : null));
    return replay;
  } finally {
    client.close();
  }
}

// Rebuilds a manual match from its input log at full speed. The caller checks
// that `bot` is the controller the log was played against.
export const resimulateLiveMatch = ({ inputs, player = 0, ...options }) =>
  runLiveMatch({
    ...options,
    player,
    readInput: replayInputs(inputs[player] ?? []),
    pacer: async () => {},
    control: "replayed",
  });
