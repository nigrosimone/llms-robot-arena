import { SPEC as S } from "./spec.js";

// One supporting tile per center. Grid boundaries belong to the positive side;
// the outer +8 edge belongs to the last tile. Hole boundaries remain inclusive.
export function floorIndex(point) {
  return Math.min(15, Math.max(0, Math.floor(point.y) + 8)) * 16 +
    Math.min(15, Math.max(0, Math.floor(point.x) + 8));
}

export const floorPosition = index => ({ x: index % 16 - 7.5, y: Math.floor(index / 16) - 7.5 });
export const floorCapacity = () => Math.round(S.FLOOR_LOAD_CAPACITY / S.DT);

// Integer kg-ticks avoid rounding drift at the failure threshold. Each entry
// contributes one robot's mass for one tick, including simultaneous occupants.
export function addFloorLoad(wear, index, tick) {
  if (index < 0) return;
  const state = wear[index] ??= { load: 0 };
  if (state.warningTick !== undefined) return;
  state.load = Math.min(floorCapacity(), state.load + S.ROBOT_MASS);
  if (state.load >= floorCapacity()) {
    state.warningTick = tick + 1;
    state.collapseTick = state.warningTick + Math.round(S.FLOOR_WARNING / S.DT);
  }
}

export function collapseSchedule(cell, wear = {}) {
  const weight = wear[floorIndex(cell)];
  const random = cell.type === "collapse" ? cell : null;
  if (weight?.collapseTick !== undefined && (!random || weight.collapseTick < random.collapseTick))
    return { warningTick: weight.warningTick, collapseTick: weight.collapseTick, cause: "weight" };
  return random ? { warningTick: random.warningTick, collapseTick: random.collapseTick, cause: "random" } : null;
}

const playbackCache = new WeakMap();
export function floorWearAt(replay, tick) {
  if (!replay.floorLoads) return {};
  let cached = playbackCache.get(replay);
  if (!cached || tick < cached.tick) {
    cached = { tick: 0, wear: {} };
    playbackCache.set(replay, cached);
  }
  const count = replay.floorLoads.length / replay.result.ticks;
  for (; cached.tick < tick; cached.tick++)
    for (let i = 0; i < count; i++)
      addFloorLoad(cached.wear, replay.floorLoads[cached.tick * count + i], cached.tick);
  return cached.wear;
}
