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
const pack = (robots) =>
  robots.flatMap((r) => [
    r.x,
    r.y,
    r.heading,
    r.energy,
    ["active", "flipped", "recovering"].indexOf(r.status),
    r.statusTimer,
  ]);
export function createMatch(seed = 0, mirrored = false, refs = []) {
  const rng = mulberry32(seed),
    spawns = [1, -1].map((sign) => {
      const x = sign * 4.8 + (rng() - 0.5) * 0.6,
        y = sign * 4.8 + (rng() - 0.5) * 0.6;
      return {
        x,
        y,
        heading: wrap(Math.atan2(-y, -x) + (rng() - 0.5) * 0.3),
        vx: 0,
        vy: 0,
        omega: 0,
        energy: S.ENERGY_MAX,
        flipsTaken: 0,
        status: "active",
        statusTimer: 0,
        _freshFlip: false,
      };
    });
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
    violations: [0, 0],
    engineViolations: 0,
    lastContacts: [null, null],
    events: [],
    frames: [],
    arenaExtents: [],
    stateHashes: [],
    previousHash: "",
    initialFrame: pack(spawns),
    result: null,
  };
}
export function sensorsFor(m, i) {
  const t = m.tick * S.DT;
  return {
    tick: m.tick,
    time: t,
    dt: S.DT,
    self: publicRobot(m.robots[i]),
    opponent: publicRobot(m.robots[1 - i]),
    arena: {
      halfExtent: halfExtent(t), nextHalfExtent: halfExtent(t + S.DT),
      cells: cellSnapshots(m.cells, m.tick, halfExtent(t), m.cellCooldowns, m.floorWear),
    },
    lastContact: m.lastContacts[i] ? { ...m.lastContacts[i] } : null,
  };
}
export function limit(r) {
  const speed = Math.hypot(r.vx, r.vy);
  if (speed > S.MAX_SPEED) {
    r.vx *= S.MAX_SPEED / speed;
    r.vy *= S.MAX_SPEED / speed;
  }
  r.omega = clamp(r.omega, -S.MAX_OMEGA, S.MAX_OMEGA);
  r.heading = wrap(r.heading);
}
export function step(m, outputs, memoryHashes = ["", ""]) {
  if (m.result) return m.result;
  m.halfExtent = halfExtent(m.tick * S.DT);
  recordTerrainTransitions(m);
  const before = m.robots.map((r) => ({ ...r }));
  for (let i = 0; i < 2; i++) {
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
    const c = Math.cos(r.heading),
      s = Math.sin(r.heading);
    r.vx += ((thrust * S.F_MAX * c - S.C_LIN * r.vx) / S.ROBOT_MASS) * S.DT;
    r.vy += ((thrust * S.F_MAX * s - S.C_LIN * r.vy) / S.ROBOT_MASS) * S.DT;
    r.x += r.vx * S.DT;
    r.y += r.vy * S.DT;
    r.omega += ((turn * S.T_MAX - S.C_ANG * r.omega) / S.ROBOT_INERTIA) * S.DT;
    r.heading = wrap(r.heading + r.omega * S.DT);
    const hc = Math.cos(r.heading),
      hs = Math.sin(r.heading);
    const long = r.vx * hc + r.vy * hs,
      lat = (-r.vx * hs + r.vy * hc) * (1 - S.LATERAL_GRIP);
    r.vx = long * hc - lat * hs;
    r.vy = long * hs + lat * hc;
    limit(r);
  }
  resolveContact(m.robots, m.tick, m.events, m.lastContacts);
  for (let i = 0; i < 2; i++) {
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
    (r) => Math.abs(r.x) > m.halfExtent || Math.abs(r.y) > m.halfExtent,
  );
  const holes = m.robots.map((r, i) => m.cells.find(cell => isHole(cell, m.tick, m.floorWear) &&
    cellInArena(cell, m.halfExtent) && crossesCell(cell, before[i], r)));
  const fallen = outs.map((out, i) => out || Boolean(holes[i]));
  outs.forEach((v, i) => {
    if (holes[i]) m.events.push({ type: "hole", tick: m.tick, robot: i, cell: holes[i].id });
    else if (v) m.events.push({ type: "ring-out", tick: m.tick, robot: i });
  });
  for (let i = 0; i < 2; i++) {
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
  applyTerrain(m, before, fallen);
  applyFloorWeight(m, fallen);
  m.frames.push(...pack(m.robots));
  m.arenaExtents.push(m.halfExtent);
  m.tick++;
  const finish = (losers, reason) => {
    m.result = {
      winner: losers[0] === losers[1] ? null : losers[0] ? 1 : 0,
      reason,
      ticks: m.tick,
    };
  };
  if (fallen.some(Boolean)) finish(fallen, holes.some(Boolean) ? "hole" : "ring-out");
  else {
    const flipped = m.robots.map((r) => r.flipsTaken >= S.FLIPS_TO_LOSE),
      dq = m.violations.map((n) => n >= S.MAX_VIOLATIONS);
    if (flipped.some(Boolean)) finish(flipped, "flips");
    else if (dq.some(Boolean)) finish(dq, "disqualification");
    else if (m.tick >= S.MATCH_DURATION / S.DT) {
      const [a, b] = m.robots;
      const distanceA = a.x * a.x + a.y * a.y,
        distanceB = b.x * b.x + b.y * b.y;
      const winner =
        a.flipsTaken !== b.flipsTaken
          ? a.flipsTaken < b.flipsTaken
            ? 0
            : 1
          : a.energy !== b.energy
            ? a.energy > b.energy ? 0 : 1
            : distanceA === distanceB ? null : distanceA < distanceB ? 0 : 1;
      const decision = a.flipsTaken !== b.flipsTaken ? "flips" : a.energy !== b.energy ? "energy" : distanceA !== distanceB ? "center" : "equal";
      m.result = { winner, reason: "timeout", decision, ticks: m.tick };
    }
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
