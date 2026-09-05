import { SPEC as S, mulberry32, halfExtent } from "./spec.js";
import { floorIndex, floorPosition, floorCapacity, addFloorLoad, collapseSchedule } from "./floor.js";

// World-space tiles and schedules use their own seed stream. Mirroring swaps
// robot identities only: both legs of a match see exactly the same terrain.
export function createTerrain(seed, spawns) {
  const rng = mulberry32((seed ^ 0x74696c65) >>> 0);
  const cells = [];
  const holes = S.HOLE_CELLS_MIN + Math.floor(rng() * (S.HOLE_CELLS_MAX - S.HOLE_CELLS_MIN + 1));
  const candidates = [];
  for (let x = -7.5; x <= 7.5; x++)
    for (let y = -7.5; y <= 7.5; y++) {
      if (Math.max(Math.abs(x), Math.abs(y)) < 2.5) continue;
      if (spawns.some(r => Math.hypot(x - r.x, y - r.y) < 2)) continue;
      candidates.push({ x, y });
    }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  function place(type, inner = false) {
    const index = candidates.findIndex(p =>
      (!inner || Math.max(Math.abs(p.x), Math.abs(p.y)) <= 2.5) &&
      cells.every(c => Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) >= 2));
    if (index < 0) throw new Error("Unable to place arena cells.");
    const { x, y } = candidates.splice(index, 1)[0];
    const cell = { id: `${type}-${cells.filter(c => c.type === type).length}`, type, x, y, size: S.CELL_SIZE };
    if (type === "flame") {
      cell.bursts = [];
      let end = 0;
      while (end < S.MATCH_DURATION / S.DT) {
        const gap = Math.round((S.FLAME_GAP_MIN + rng() * (S.FLAME_GAP_MAX - S.FLAME_GAP_MIN)) / S.DT);
        const warning = end + gap;
        const start = warning + Math.round(S.FLAME_WARNING / S.DT);
        end = start + Math.round(S.FLAME_DURATION / S.DT);
        cell.bursts.push({ warning, start, end });
      }
    }
    cells.push(cell);
  }
  // Reserve two accessible central charging sites before placing hazards.
  place("recharge", true);
  place("recharge", true);
  for (let i = 2; i < S.RECHARGE_CELLS; i++) place("recharge");
  for (let i = 0; i < holes; i++) place("hole");
  for (let i = 0; i < S.FLAME_CELLS; i++) place("flame");
  // A separate stream preserves the initial terrain and fire schedules. Future
  // collapse locations are not exposed in sensors before their warning starts.
  const collapseRng = mulberry32((seed ^ 0x63726163) >>> 0);
  let warningTick = Math.round((S.COLLAPSE_FIRST_MIN + collapseRng() *
    (S.COLLAPSE_FIRST_MAX - S.COLLAPSE_FIRST_MIN)) / S.DT);
  for (let i = 0; i < S.COLLAPSE_CELLS; i++) {
    const collapseTick = warningTick + Math.round(S.COLLAPSE_WARNING / S.DT);
    const half = halfExtent(collapseTick * S.DT), eligible = [];
    for (let x = -7.5; x <= 7.5; x++)
      for (let y = -7.5; y <= 7.5; y++) {
        if (Math.max(Math.abs(x), Math.abs(y)) + S.CELL_SIZE / 2 > half) continue;
        if (cells.some(c => c.x === x && c.y === y)) continue;
        eligible.push({ x, y });
      }
    const position = eligible[Math.floor(collapseRng() * eligible.length)];
    if (!position) throw new Error("Unable to place a collapsing cell.");
    cells.push({ id: `floor-${floorIndex(position)}`, type: "collapse", ...position,
      size: S.CELL_SIZE, warningTick, collapseTick });
    warningTick += Math.round((S.COLLAPSE_GAP_MIN + collapseRng() *
      (S.COLLAPSE_GAP_MAX - S.COLLAPSE_GAP_MIN)) / S.DT);
  }
  return cells;
}

export const isHole = (cell, tick, wear = {}) => cell.type === "hole" ||
  tick >= (collapseSchedule(cell, wear)?.collapseTick ?? Infinity);

export function recordTerrainTransitions(match) {
  for (const cell of match.cells) {
    const schedule = collapseSchedule(cell, match.floorWear);
    if (!schedule || cell.type === "hole" || !cellInArena(cell, match.halfExtent)) continue;
    if (match.tick === schedule.warningTick)
      match.events.push({ type: "collapse-warning", tick: match.tick, cell: cell.id, cause: schedule.cause });
    if (match.tick === schedule.collapseTick)
      match.events.push({ type: "collapse", tick: match.tick, cell: cell.id, cause: schedule.cause });
  }
}

export const cellInArena = (cell, half) =>
  Math.abs(cell.x) - cell.size / 2 < half && Math.abs(cell.y) - cell.size / 2 < half;

export const cellContains = (cell, point) =>
  Math.abs(point.x - cell.x) <= cell.size / 2 && Math.abs(point.y - cell.y) <= cell.size / 2;

// Swept center test: even a glancing crossing between tick endpoints counts.
export function crossesCell(cell, from, to) {
  let enter = 0, leave = 1;
  for (const axis of ["x", "y"]) {
    const lo = cell[axis] - cell.size / 2, hi = cell[axis] + cell.size / 2;
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-12) {
      if (from[axis] < lo || from[axis] > hi) return false;
    } else {
      const a = (lo - from[axis]) / delta, b = (hi - from[axis]) / delta;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
      if (enter > leave) return false;
    }
  }
  return true;
}

export function flamePhase(cell, tick) {
  for (const burst of cell.bursts) {
    if (tick < burst.warning) return { state: "safe", nextTick: burst.warning };
    if (tick < burst.start) return { state: "warning", nextTick: burst.start };
    if (tick < burst.end) return { state: "flaming", nextTick: burst.end };
  }
  return { state: "safe", nextTick: null };
}

export function cellSnapshots(cells, tick, half, cooldowns = {}, wear = {}) {
  return cells.filter(cell => {
    if (cell.type === "floor") return Boolean(wear[floorIndex(cell)]);
    return cell.type !== "collapse" || tick >= cell.warningTick || Boolean(wear[floorIndex(cell)]);
  }).map(cell => {
    const hole = isHole(cell, tick, wear), active = cellInArena(cell, half);
    const schedule = collapseSchedule(cell, wear);
    const warning = !hole && schedule && tick >= schedule.warningTick;
    let type = hole ? "hole" : cell.type;
    if (type === "floor" || type === "collapse") type = warning ? "collapse" : "floor";
    let state, nextTick = null;
    if (!active) state = "inactive";
    else if (hole) state = "hole";
    else if (type === "collapse") { state = "warning"; nextTick = schedule.collapseTick; }
    else if (type === "floor") state = "safe";
    else if (cell.type === "flame") ({ state, nextTick } = flamePhase(cell, tick));
    else {
      nextTick = cooldowns[cell.id] > tick ? cooldowns[cell.id] : null;
      state = nextTick === null ? "ready" : "cooldown";
    }
    return {
      id: cell.id, type, x: cell.x, y: cell.y, size: cell.size,
      state, timeUntilChange: nextTick === null ? null : (nextTick - tick) * S.DT,
      integrity: hole ? 0 : 1 - (wear[floorIndex(cell)]?.load ?? 0) / floorCapacity(),
      collapseIn: active && warning ? (schedule.collapseTick - tick) * S.DT : null,
    };
  });
}

export function applyFloorWeight(match, fallen) {
  const loads = match.robots.map((robot, i) => fallen[i] ? -1 : floorIndex(robot));
  for (const index of [...loads].sort((a, b) => a - b)) {
    if (index < 0) continue;
    if (!match.cells.some(cell => floorIndex(cell) === index))
      match.cells.push({ id: `floor-${index}`, type: "floor", ...floorPosition(index), size: S.CELL_SIZE });
    addFloorLoad(match.floorWear, index, match.tick);
  }
  match.floorLoads.push(...loads);
}

export function applyTerrain(match, before, fallen) {
  const { tick, robots, cells, cellCooldowns: cooldowns } = match;
  for (const cell of cells) {
    if (!cellInArena(cell, match.halfExtent) || isHole(cell, tick, match.floorWear) ||
      !["recharge", "flame"].includes(cell.type)) continue;
    if (cell.type === "recharge") {
      if ((cooldowns[cell.id] ?? 0) > tick) continue;
      const entrants = [0, 1].filter(i => !fallen[i] && robots[i].energy < S.ENERGY_MAX &&
        !cellContains(cell, before[i]) && crossesCell(cell, before[i], robots[i]));
      if (!entrants.length) continue;
      // Simultaneous arrivals share one charge; neither robot index has priority.
      for (const i of entrants) {
        const amount = Math.min(S.RECHARGE_AMOUNT / entrants.length, S.ENERGY_MAX - robots[i].energy);
        robots[i].energy += amount;
        match.events.push({ type: "recharge", tick, robot: i, cell: cell.id, amount,
          readyTick: tick + Math.round(S.RECHARGE_COOLDOWN / S.DT) });
      }
      cooldowns[cell.id] = tick + Math.round(S.RECHARGE_COOLDOWN / S.DT);
    } else if (flamePhase(cell, tick).state === "flaming") {
      for (let i = 0; i < 2; i++) {
        if (fallen[i] || !cellContains(cell, robots[i])) continue;
        const amount = Math.min(robots[i].energy, S.FLAME_DAMAGE * S.DT);
        robots[i].energy -= amount;
        // One event on entry/start and then once per second, avoiding a log per tick.
        if (amount > 0 && (!cellContains(cell, before[i]) || tick % 60 === 0 || flamePhase(cell, tick - 1).state !== "flaming"))
          match.events.push({ type: "fire-damage", tick, robot: i, cell: cell.id, rate: S.FLAME_DAMAGE });
      }
    }
  }
}
