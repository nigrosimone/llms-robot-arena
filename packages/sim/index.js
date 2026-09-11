import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import {
  SPEC as S,
  SPEC_VERSION,
  ENGINE_VERSION,
  halfExtent,
  wrap,
  clamp,
  mulberry32,
} from "./spec.js";
import { resolveContact } from "./collision.js";
import { sin, cos, atan2, hypot } from "./math.js";
import { createTerrain, cellSnapshots, crossesCell, cellInArena, applyTerrain, applyFloorWeight, isHole, recordTerrainTransitions } from "./terrain.js";
export { SPEC, halfExtent } from "./spec.js";
export const digest = (value) =>
  bytesToHex(
    sha256(
      new TextEncoder().encode(
        typeof value === "string" ? value : JSON.stringify(value),
      ),
    ),
  );
export function publicRobot(r) {
  const {
    x,
    y,
    heading,
    vx,
    vy,
    omega,
    energy,
    flipsTaken,
    status,
    statusTimer,
  } = r;
  return {
    x,
    y,
    heading,
    vx,
    vy,
    omega,
    energy,
    flipsTaken,
    status,
    statusTimer,
  };
}
export const STATUSES = ["active", "flipped", "recovering", "out"];
const pack = (robots) =>
  robots.flatMap((r) => [
    r.x,
    r.y,
    r.heading,
    r.energy,
    STATUSES.indexOf(r.status),
    r.statusTimer,
  ]);
const spawnRobot = (x, y, rng) => ({
  x,
  y,
  heading: wrap(atan2(-y, -x) + (rng() - 0.5) * 0.3),
  vx: 0,
  vy: 0,
  omega: 0,
  energy: S.ENERGY_MAX,
  flipsTaken: 0,
  status: "active",
  statusTimer: 0,
  _freshFlip: false,
});
// Duels keep their original diagonal spawns. A rumble spreads the roster on the
// same circle, so no robot starts closer to the center than the others.
function createSpawns(count, rng) {
  if (count === 2)
    return [1, -1].map((sign) =>
      spawnRobot(sign * 4.8 + (rng() - 0.5) * 0.6, sign * 4.8 + (rng() - 0.5) * 0.6, rng),
    );
  const radius = hypot(4.8, 4.8);
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI / 4 + (2 * Math.PI * i) / count;
    return spawnRobot(
      radius * cos(angle) + (rng() - 0.5) * 0.6,
      radius * sin(angle) + (rng() - 0.5) * 0.6,
      rng,
    );
  });
}
export function createMatch(seed = 0, mirrored = false, refs = []) {
  const count = Math.max(2, refs.length);
  const rng = mulberry32(seed),
    spawns = createSpawns(count, rng);
  if (mirrored) spawns.reverse();
  return {
    seed: seed >>> 0,
    mirrored,
    bots: refs,
    robots: spawns,
    cells: createTerrain(seed, spawns),
    cellCooldowns: {},
    floorWear: {},
    floorLoads: [],
    tick: 0,
    halfExtent: 8,
    violations: spawns.map(() => 0),
    engineViolations: 0,
    lastContacts: spawns.map(() => null),
    standings: [],
    events: [],
    frames: [],
    arenaExtents: [],
    stateHashes: [],
    previousHash: "",
    initialFrame: pack(spawns),
    result: null,
  };
}
// `opponent` stays the single closest live rival, so a controller written for a
// duel drives a rumble unchanged. `opponents` lists every rival for the others.
export function nearestOpponent(robots, i) {
  const self = robots[i];
  let best = -1, distance = Infinity;
  for (let j = 0; j < robots.length; j++) {
    if (j === i || robots[j].status === "out") continue;
    const d = hypot(robots[j].x - self.x, robots[j].y - self.y);
    if (d < distance) {
      distance = d;
      best = j;
    }
  }
  return best < 0 ? (i + 1) % robots.length : best;
}
export function sensorsFor(m, i) {
  const t = m.tick * S.DT;
  const others = () =>
    m.robots
      .map((r, j) => ({ ...publicRobot(r), index: j, out: r.status === "out" }))
      .filter((_, j) => j !== i);
  return {
    tick: m.tick,
    time: t,
    dt: S.DT,
    self: publicRobot(m.robots[i]),
    opponent: publicRobot(m.robots[nearestOpponent(m.robots, i)]),
    ...(m.robots.length > 2 ? { opponents: others() } : {}),
    arena: {
      halfExtent: halfExtent(t), nextHalfExtent: halfExtent(t + S.DT),
      cells: cellSnapshots(m.cells, m.tick, halfExtent(t), m.cellCooldowns, m.floorWear),
    },
    lastContact: m.lastContacts[i] ? { ...m.lastContacts[i] } : null,
  };
}
export function limit(r) {
  const speed = hypot(r.vx, r.vy);
  if (speed > S.MAX_SPEED) {
    r.vx *= S.MAX_SPEED / speed;
    r.vy *= S.MAX_SPEED / speed;
  }
  r.omega = clamp(r.omega, -S.MAX_OMEGA, S.MAX_OMEGA);
  r.heading = wrap(r.heading);
}
// Survivors are ranked like a timeout decision: fewer flips, then more energy,
// then closer to the center.
const byCondition = (robots) => (i, j) => {
  const a = robots[i], b = robots[j];
  const distance = (r) => r.x * r.x + r.y * r.y;
  return a.flipsTaken !== b.flipsTaken
    ? a.flipsTaken - b.flipsTaken
    : a.energy !== b.energy
      ? b.energy - a.energy
      : distance(a) - distance(b);
};
export function step(m, outputs, memoryHashes = ["", ""]) {
  if (m.result) return m.result;
  const count = m.robots.length;
  const live = (i) => m.robots[i].status !== "out";
  m.halfExtent = halfExtent(m.tick * S.DT);
  recordTerrainTransitions(m);
  const before = m.robots.map((r) => ({ ...r }));
  for (let i = 0; i < count; i++) {
    if (!live(i)) continue;
    const out = outputs[i] ?? {
      actions: { thrust: 0, turn: 0 },
      violations: ["missing-output"],
    };
    const problems = [...(out.violations ?? [])];
    let thrust = out.actions?.thrust,
      turn = out.actions?.turn;
    if (typeof thrust !== "number" || !Number.isFinite(thrust)) {
      thrust = 0;
      problems.push("invalid-thrust");
    }
    if (typeof turn !== "number" || !Number.isFinite(turn)) {
      turn = 0;
      problems.push("invalid-turn");
    }
    for (const reason of problems) {
      m.violations[i]++;
      m.events.push({ type: "violation", tick: m.tick, robot: i, reason });
    }
    const r = m.robots[i];
    thrust = clamp(thrust, -1, 1);
    turn = clamp(turn, -1, 1);
    if (r.status === "flipped" || r.energy <= 0) {
      thrust = 0;
      turn = 0;
    }
    const demand =
      (S.K_THRUST * thrust * thrust + S.K_TURN * turn * turn) * S.DT;
    if (demand > r.energy) {
      const k = r.energy / demand;
      thrust *= k;
      turn *= k;
      r.energy = 0;
    } else r.energy -= demand;
    const c = cos(r.heading),
      s = sin(r.heading);
    r.vx += ((thrust * S.F_MAX * c - S.C_LIN * r.vx) / S.ROBOT_MASS) * S.DT;
    r.vy += ((thrust * S.F_MAX * s - S.C_LIN * r.vy) / S.ROBOT_MASS) * S.DT;
    r.x += r.vx * S.DT;
    r.y += r.vy * S.DT;
    r.omega += ((turn * S.T_MAX - S.C_ANG * r.omega) / S.ROBOT_INERTIA) * S.DT;
    r.heading = wrap(r.heading + r.omega * S.DT);
    const hc = cos(r.heading),
      hs = sin(r.heading);
    const long = r.vx * hc + r.vy * hs,
      lat = (-r.vx * hs + r.vy * hc) * (1 - S.LATERAL_GRIP);
    r.vx = long * hc - lat * hs;
    r.vy = long * hs + lat * hc;
    limit(r);
  }
  resolveContact(m.robots, m.tick, m.events, m.lastContacts);
  for (let i = 0; i < count; i++) {
    if (!live(i)) continue;
    const r = m.robots[i];
    limit(r);
    if (
      ![
        r.x,
        r.y,
        r.heading,
        r.vx,
        r.vy,
        r.omega,
        r.energy,
        r.statusTimer,
      ].every(Number.isFinite)
    ) {
      m.robots[i] = { ...before[i] };
      m.engineViolations++;
      m.events.push({ type: "engine-violation", tick: m.tick, robot: i });
    }
  }
  const outs = m.robots.map(
    (r, i) => live(i) && (Math.abs(r.x) > m.halfExtent || Math.abs(r.y) > m.halfExtent),
  );
  const holes = m.robots.map((r, i) => live(i) && m.cells.find(cell => isHole(cell, m.tick, m.floorWear) &&
    cellInArena(cell, m.halfExtent) && crossesCell(cell, before[i], r)));
  const fallen = outs.map((out, i) => out || Boolean(holes[i]));
  outs.forEach((v, i) => {
    if (holes[i]) m.events.push({ type: "hole", tick: m.tick, robot: i, cell: holes[i].id });
    else if (v) m.events.push({ type: "ring-out", tick: m.tick, robot: i });
  });
  for (let i = 0; i < count; i++) {
    if (!live(i)) continue;
    const r = m.robots[i];
    if (r.status !== "active" && !r._freshFlip)
      r.statusTimer = Math.max(0, r.statusTimer - S.DT);
    if (
      r.status === "flipped" &&
      r.statusTimer < 1e-9 &&
      r.energy >= S.E_RIGHT
    ) {
      r.energy -= S.E_RIGHT;
      r.status = "recovering";
      r.statusTimer = S.FLIP_IMMUNITY;
      m.events.push({ type: "recovery", tick: m.tick, robot: i });
    } else if (r.status === "recovering" && r.statusTimer < 1e-9) {
      r.status = "active";
      r.statusTimer = 0;
    }
    r._freshFlip = false;
    r.energy = clamp(r.energy - S.K_IDLE * S.DT, 0, S.ENERGY_MAX);
  }
  const inactive = fallen.map((v, i) => v || !live(i));
  applyTerrain(m, before, inactive);
  applyFloorWeight(m, inactive);
  m.frames.push(...pack(m.robots));
  m.arenaExtents.push(m.halfExtent);
  m.tick++;
  // One category per tick, in the historical order: falling beats flips, flips
  // beat disqualification. A duel therefore ends exactly as it always did.
  const flipped = m.robots.map((r, i) => live(i) && r.flipsTaken >= S.FLIPS_TO_LOSE),
    dq = m.violations.map((n, i) => live(i) && n >= S.MAX_VIOLATIONS);
  const [losers, reason] = fallen.some(Boolean)
    ? [fallen, holes.some(Boolean) ? "hole" : "ring-out"]
    : flipped.some(Boolean)
      ? [flipped, "flips"]
      : dq.some(Boolean)
        ? [dq, "disqualification"]
        : [null, null];
  // A duel ends on the spot, so its loser keeps the pose and status it had:
  // only a rumble parks the robot out of play and keeps simulating the rest.
  if (losers && count > 2)
    for (const [i, loser] of losers.entries())
      if (loser) {
        m.robots[i].status = "out";
        m.robots[i].statusTimer = 0;
        m.events.push({ type: "eliminated", tick: m.tick - 1, robot: i, reason });
      }
  if (losers)
    m.standings.push(...losers.flatMap((v, i) => (v ? [{ robot: i, tick: m.tick, reason }] : [])));
  const alive = m.robots.flatMap((r, i) =>
    r.status === "out" || losers?.[i] ? [] : [i],
  );
  if (losers && alive.length <= 1)
    m.result = { winner: alive.length === 1 ? alive[0] : null, reason, ticks: m.tick };
  else if (m.tick >= S.MATCH_DURATION / S.DT) {
    const ordered = [...alive].sort(byCondition(m.robots));
    const [a, b] = ordered.map((i) => m.robots[i]);
    const distance = (r) => r.x * r.x + r.y * r.y;
    const decision = !b || a.flipsTaken !== b.flipsTaken
      ? "flips"
      : a.energy !== b.energy
        ? "energy"
        : distance(a) !== distance(b)
          ? "center"
          : "equal";
    m.result = {
      winner: decision === "equal" ? null : ordered[0],
      reason: "timeout",
      decision,
      ticks: m.tick,
    };
  }
  if (m.result && count > 2) {
    const placed = new Set(m.standings.map((s) => s.robot));
    m.result.standings = [
      ...m.robots.flatMap((_, i) => (placed.has(i) ? [] : [i])).sort(byCondition(m.robots)),
      ...m.standings.map((s) => s.robot).reverse(),
    ];
  }
  if (m.tick % 60 === 0 || m.result) {
    m.previousHash = digest({
      previous: m.previousHash,
      tick: m.tick,
      robots: m.robots,
      halfExtent: m.halfExtent,
      cells: m.cells,
      cellCooldowns: m.cellCooldowns,
      floorWear: m.floorWear,
      violations: m.violations,
      lastContacts: m.lastContacts,
      memoryHashes,
      result: m.result,
    });
    m.stateHashes.push({ tick: m.tick, hash: m.previousHash });
  }
  return m.result;
}
export function closeReplay(m, mode = "exhibition", runtime = {}) {
  if (!m.result)
    throw new Error("The replay can only be closed after the match ends.");
  return {
    specVersion: SPEC_VERSION,
    engineVersion: ENGINE_VERSION,
    mode,
    seed: m.seed,
    mirrored: m.mirrored,
    bots: m.bots,
    dt: S.DT,
    energyMax: S.ENERGY_MAX,
    arenaCells: structuredClone(m.cells),
    floorLoads: [...m.floorLoads],
    initialFrame: m.initialFrame,
    frames: new Float32Array(m.frames),
    arenaExtents: new Float32Array(m.arenaExtents),
    events: m.events,
    stateHashes: m.stateHashes,
    result: m.result,
    finalStates: m.robots.map(publicRobot),
    violations: m.violations,
    engineViolations: m.engineViolations,
    runtime,
  };
}
