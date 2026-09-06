// Rendering-only sampling. No physics imports or mutable simulation state.
import { cellSnapshots } from "../sim/terrain.js";
import { floorWearAt } from "../sim/floor.js";
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

export function samplePlayback(replay, time) {
  const duration = replay.result.ticks / 60;
  const visualTime = Math.max(0, time);
  const simTime = Math.min(duration, visualTime);
  const rawTick = Math.min(replay.result.ticks, simTime * 60);
  // Division by 60 and multiplication back can land just below an integer.
  const tick = Math.abs(rawTick - Math.round(rawTick)) < 1e-9 ? Math.round(rawTick) : rawTick;
  const lo = Math.floor(tick),
    hi = Math.min(replay.result.ticks, lo + 1),
    alpha = tick - lo;
  const robots = replay.initialFrame.length / 6;
  const stride = robots * 6;
  const values = (k) =>
    k === 0
      ? replay.initialFrame
      : replay.frames.subarray((k - 1) * stride, k * stride);
  const a = values(lo),
    b = values(hi);
  const events = replay.events.filter((e) => e.tick < lo);
  const extent = (k) => (k === 0 ? 8 : replay.arenaExtents[k - 1]);
  const states = Array.from({ length: robots }, (_, i) => {
    const offset = i * 6;
    const robotEvents = events.filter((e) => e.robot === i);
    const flips = robotEvents.filter((e) => e.type === "flip");
    const flip = flips.at(-1),
      recovery = robotEvents.filter((e) => e.type === "recovery").at(-1);
    const status = a[offset + 4],
      heading =
        a[offset + 2] +
        Math.atan2(
          Math.sin(b[offset + 2] - a[offset + 2]),
          Math.cos(b[offset + 2] - a[offset + 2]),
        ) *
          alpha;
    let rotation = flip
      ? Math.PI * smooth((visualTime - (flip.tick + 1) / 60) / 0.5)
      : 0;
    if (flip && recovery && recovery.tick > flip.tick)
      rotation =
        Math.PI * (1 - smooth((visualTime - (recovery.tick + 1) / 60) / 0.5));
    const out = robotEvents.find((e) => e.type === "ring-out" || e.type === "hole");
    const fall = out ? Math.max(0, visualTime - (out.tick + 1) / 60) : 0;
    let x = mix(a[offset], b[offset], alpha),
      y = mix(a[offset + 1], b[offset + 1], alpha);
    const dx = Math.abs(x) >= Math.abs(y) ? Math.sign(x) : 0;
    const dy = dx === 0 ? Math.sign(y) || 1 : 0;
    if (out?.type !== "hole") {
      x += dx * 1.8 * fall;
      y += dy * 1.8 * fall;
    }
    return {
      x,
      y,
      z: fall ? -4.9 * fall * fall : 0,
      heading,
      energy: mix(a[offset + 3], b[offset + 3], alpha),
      status,
      statusTimer: a[offset + 5],
      flips: flips.length,
      rotation,
      axis: flip?.axis ?? [0, 1],
      ringOut: Boolean(out),
      out: status === 3,
      hole: out?.type === "hole",
      fall,
      fallAxis: [-dy, dx],
    };
  });
  const half = mix(extent(lo), extent(hi), alpha);
  // End-of-match animations must not trigger an unprocessed future collapse.
  const terrainTick = Math.min(lo, replay.result.ticks - 1);
  const cooldowns = {};
  for (const event of events)
    if (event.type === "recharge") cooldowns[event.cell] = event.readyTick;
  return {
    time: simTime,
    visualTime,
    tick,
    states,
    events,
    half,
    energyMax: replay.energyMax ?? 100,
    terrainTick,
    cells: cellSnapshots(replay.arenaCells ?? [], terrainTick, half, cooldowns, floorWearAt(replay, lo)),
  };
}
