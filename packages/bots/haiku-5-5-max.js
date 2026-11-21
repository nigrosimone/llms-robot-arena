// haiku-5-5-max: iterative controller for llms-robot-arena.
// Pure and deterministic: no imports, no globals. Persistent state lives only in memory.
//
// Priorities, highest first:
//   1. Flipped: the engine ignores commands, so send zeros.
//   2. Danger: hazard or edge repulsion too strong -> escape toward a clear point.
//   3. Strike: opponent active, my wedge on it, its side or rear exposed -> full thrust.
//   4. Farm: recharge cells while energy is low (with hysteresis). Energy decides the
//      match; a stalled robot burns it fast and a robot at zero energy cannot move.
//   5. Defend: its wedge points at me -> keep my wedge on it and back away at the speed it
//      closes in. Never thrust toward it: pushing contact costs both robots energy.
//   6. Flank: move behind an opponent that is not facing me, when energy allows.
//   7. Patrol: circle the center at a varying radius to spread floor wear.

const PI = Math.PI;
const TWO_PI = 2 * Math.PI;
const HALF_CELL = 0.5;

// Repulsion fields (meters, m/s). Hard hazards: holes, collapse warnings, burning grates.
const HAZARD_RANGE = 0.9;
const HAZARD_GAIN = 6.0;
const SOFT_GAIN = 2.0;
const EDGE_RANGE = 1.8;
const EDGE_GAIN = 6.0;
const DANGER_LEVEL = 1.5;
const OPP_RANGE = 1.0;
const OPP_GAIN = 3.0;
const ATTRACT_GAIN = 1.5;
const STRIKE_GAIN = 10.0;
const SCAN_R2 = 4.5 * 4.5;

// Steering. Heading: alpha = 5.4 * turn - 1.8 * omega. Forward: a = 8 * thrust - 1.6 * v.
const TURN_P = 3.0;
const TURN_D = 0.9;
const SPEED_GAIN = 4.0;
const DRAG_PER_MASS = 1.6;
const ACCEL_PER_THRUST = 8.0;

// Energy policy (energy is in [0, 300]).
const FARM_ON = 200;
const FARM_OFF = 260;
const FLANK_MIN_ENERGY = 100;
const STRIKE_MIN_ENERGY = 50;

// Combat geometry (radians, meters).
// alpha = my bearing in the opponent's frame; eb = opponent bearing in my frame.
const FACING_OK = 0.6;
const EXPOSED = 1.2;
const THREAT = 0.7;
const ENGAGE = 3.5;
const STRIKE_RANGE = 2.8;
const HOLD_DIST = 2.2;

function len(x, y) {
  return Math.sqrt(x * x + y * y);
}

function wrap(a) {
  let r = (a + PI) % TWO_PI;
  if (r < 0) r += TWO_PI;
  return r - PI;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// One pass over the cells. Hazards that can drop or burn the center: holes, collapse
// warnings, grates that are warning or burning, announced openings (collapseIn), and
// nearly exhausted floor (soft). Only hazards near the robot are kept. Recharge cells
// that are still usable are collected for farming.
function scanCells(cells, px, py) {
  const hazards = [];
  const pads = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const ty = c.type;
    const announced = c.collapseIn != null;
    let hard;
    if (ty === 'floor') {
      // Most cells are ordinary floor: only worn-out or announced floor matters.
      if (!announced && c.integrity > 0.15) continue;
      if (c.state === 'inactive') continue;
      hard = announced;
    } else {
      const st = c.state;
      if (st === 'inactive') continue;
      if (ty === 'recharge' && !announced) {
        pads.push(c);
        continue;
      }
      hard = announced || ty === 'hole' || ty === 'collapse';
      if (ty === 'flame') {
        hard = hard || st === 'warning' || st === 'flaming' ||
          (c.timeUntilChange !== null && c.timeUntilChange < 0.6);
      }
      if (!hard) continue;
    }
    const dx = c.x - px, dy = c.y - py;
    if (dx * dx + dy * dy <= SCAN_R2) hazards.push({ x: c.x, y: c.y, hard: hard });
  }
  return { hazards: hazards, pads: pads };
}

// Push the center out of a 1 m square hazard. Inside: leave through the nearest face.
// Outside: repel from the nearest point of the square within HAZARD_RANGE.
function addHazardField(px, py, h, gain, f) {
  const x0 = h.x - HALF_CELL, x1 = h.x + HALF_CELL;
  const y0 = h.y - HALF_CELL, y1 = h.y + HALF_CELL;
  if (px >= x0 && px <= x1 && py >= y0 && py <= y1) {
    const dl = px - x0, dr = x1 - px, db = py - y0, dt = y1 - py;
    const m = Math.min(dl, dr, db, dt);
    if (m === dl) f.x -= gain;
    else if (m === dr) f.x += gain;
    else if (m === db) f.y -= gain;
    else f.y += gain;
    return;
  }
  const qx = clamp(px, x0, x1), qy = clamp(py, y0, y1);
  const dx = px - qx, dy = py - qy;
  const d = len(dx, dy);
  if (d >= HAZARD_RANGE) return;
  const mag = gain * (HAZARD_RANGE - d) / HAZARD_RANGE;
  f.x += dx / d * mag;
  f.y += dy / d * mag;
}

// Push inward near the shrinking boundary (H is the half-extent that applies next tick).
function addEdgeField(px, py, H, f) {
  const ex = H - Math.abs(px);
  if (ex < EDGE_RANGE) {
    f.x -= (px >= 0 ? 1 : -1) * EDGE_GAIN * (EDGE_RANGE - ex) / EDGE_RANGE;
  }
  const ey = H - Math.abs(py);
  if (ey < EDGE_RANGE) {
    f.y -= (py >= 0 ? 1 : -1) * EDGE_GAIN * (EDGE_RANGE - ey) / EDGE_RANGE;
  }
}

// The opponent body is an obstacle for non-strike moves: keeps us out of contact.
function addOpponentField(px, py, ox, oy, f) {
  const dx = px - ox, dy = py - oy;
  const d = len(dx, dy);
  if (d >= OPP_RANGE || d < 1e-6) return;
  const mag = OPP_GAIN * (OPP_RANGE - d) / OPP_RANGE;
  f.x += dx / d * mag;
  f.y += dy / d * mag;
}

// Choose among 8 nearby points the one farthest from hazards and close to the center.
function safeGoal(px, py, hazards, H) {
  const lim = Math.max(0.5, H - 1.2);
  let bestX = 0, bestY = 0, bestScore = -Infinity;
  for (let k = 0; k < 8; k++) {
    const a = k * PI / 4;
    const cx = clamp(px + 2.0 * Math.cos(a), -lim, lim);
    const cy = clamp(py + 2.0 * Math.sin(a), -lim, lim);
    let clear = 2.0;
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      const qx = clamp(cx, h.x - HALF_CELL, h.x + HALF_CELL);
      const qy = clamp(cy, h.y - HALF_CELL, h.y + HALF_CELL);
      const d = len(cx - qx, cy - qy);
      if (d < clear) clear = d;
    }
    const score = 2.0 * clear - 0.4 * len(cx, cy);
    if (score > bestScore) {
      bestScore = score;
      bestX = cx;
      bestY = cy;
    }
  }
  return { x: bestX, y: bestY };
}

// Convert a desired world velocity into thrust and torque. The robot only moves along
// its heading (lateral grip is high), so heading follows the velocity direction.
function steer(me, vx, vy, vMax, reverseOk) {
  const th = me.heading;
  const c = Math.cos(th), s = Math.sin(th);
  let headingDes = th;
  if (len(vx, vy) > 0.05) {
    let ang = Math.atan2(vy, vx);
    if (reverseOk && Math.abs(wrap(ang - th)) > PI / 2) ang = wrap(ang + PI);
    headingDes = ang;
  }
  const vfd = clamp(vx * c + vy * s, reverseOk ? -vMax : 0, vMax);
  const vf = me.vx * c + me.vy * s;
  const turn = clamp(TURN_P * wrap(headingDes - th) - TURN_D * me.omega, -1, 1);
  const thrust = clamp(
    (SPEED_GAIN * (vfd - vf) + DRAG_PER_MASS * vf) / ACCEL_PER_THRUST, -1, 1);
  return { thrust: thrust, turn: turn };
}

// Attraction toward (gx, gy) plus a repulsion field, then steer.
function goTo(me, gx, gy, vMax, field, reverseOk, gain) {
  const dx = gx - me.x, dy = gy - me.y;
  const d = len(dx, dy);
  let vx = field.x, vy = field.y;
  if (d > 1e-6) {
    const sp = Math.min(vMax, gain * d);
    vx += dx / d * sp;
    vy += dy / d * sp;
  }
  return steer(me, vx, vy, vMax, reverseOk);
}

// Keep my wedge on the opponent and back away at the speed it closes in, so the distance
// holds and no contact develops. Never drive toward it. If it already touches me without
// closing, rotate out of its wedge line instead of pushing against it.
function defend(me, op, dx, dy, dist, eb) {
  const d = Math.max(dist, 1e-6);
  const ux = dx / d, uy = dy / d;
  const vApp = -((op.vx - me.vx) * ux + (op.vy - me.vy) * uy);  // > 0 when closing
  let vfd = clamp(1.2 * (dist - HOLD_DIST) - Math.max(0, vApp), -5.0, 0.0);
  let turn = clamp(TURN_P * eb - TURN_D * me.omega, -1, 1);
  if (dist < 1.0 && vApp < 0.5) {
    turn = eb >= 0 ? -1 : 1;
    vfd = -0.3;
  }
  const c = Math.cos(me.heading), s = Math.sin(me.heading);
  const vf = me.vx * c + me.vy * s;
  return {
    thrust: clamp((SPEED_GAIN * (vfd - vf) + DRAG_PER_MASS * vf) / ACCEL_PER_THRUST, -1, 1),
    turn: turn,
  };
}

// Go to a recharge cell when it is ready (or will be by arrival); otherwise orbit it
// at 1.3 m so the robot never lingers on one floor cell during the cooldown.
// Returns null when no recharge cell is usable.
function farmAction(me, pads, field) {
  let best = null;
  let bestEta = Infinity;
  for (let i = 0; i < pads.length; i++) {
    const c = pads[i];
    const d = len(c.x - me.x, c.y - me.y);
    const wait = c.state === 'ready' || c.timeUntilChange === null ? 0 : c.timeUntilChange;
    const eta = Math.max(d / 2.0, wait);
    if (eta < bestEta) {
      bestEta = eta;
      best = c;
    }
  }
  if (best === null) return null;
  const d = len(best.x - me.x, best.y - me.y);
  const wait = best.state === 'ready' || best.timeUntilChange === null ? 0 : best.timeUntilChange;
  if (wait <= d / 2.0) return goTo(me, best.x, best.y, 3.0, field, false, ATTRACT_GAIN);
  const ang = Math.atan2(me.y - best.y, me.x - best.x) + 0.6;
  return goTo(me, best.x + 1.3 * Math.cos(ang), best.y + 1.3 * Math.sin(ang),
    1.6, field, false, ATTRACT_GAIN);
}

// Circle the center at a radius that varies slowly with time; shrink to the center late.
function patrolAction(me, t, H, field) {
  const endgame = t > 105;
  let R = endgame ? 0.6 : 2.2 + 0.6 * Math.sin(0.07 * t);
  R = clamp(R, 0.5, Math.max(0.5, H - 1.6));
  const r = len(me.x, me.y);
  const base = r > 0.3 ? Math.atan2(me.y, me.x) : 0.5 * t;
  const phi = base + 0.6;
  return goTo(me, R * Math.cos(phi), R * Math.sin(phi),
    endgame ? 0.8 : 1.5, field, false, ATTRACT_GAIN);
}

export function tick(sensors, memory) {
  const me = sensors.self;
  const op = sensors.opponent;
  const t = sensors.time;
  const H = Math.min(sensors.arena.halfExtent, sensors.arena.nextHalfExtent);
  const wasFarming = memory !== null && typeof memory === 'object' && memory.f === 1;

  if (me.status === 'flipped') {
    return { actions: { thrust: 0, turn: 0 }, memory: { f: wasFarming ? 1 : 0 } };
  }

  // Fields: hard hazards and the edge at full strength, worn floor at reduced strength.
  const scan = scanCells(sensors.arena.cells, me.x, me.y);
  const hazards = scan.hazards;
  const hard = { x: 0, y: 0 };
  const soft = { x: 0, y: 0 };
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    if (h.hard) addHazardField(me.x, me.y, h, HAZARD_GAIN, hard);
    else addHazardField(me.x, me.y, h, SOFT_GAIN, soft);
  }
  addEdgeField(me.x, me.y, H, hard);
  const danger = len(hard.x, hard.y) > DANGER_LEVEL;
  const terrain = { x: hard.x + soft.x, y: hard.y + soft.y };
  const nav = { x: terrain.x, y: terrain.y };
  addOpponentField(me.x, me.y, op.x, op.y, nav);

  // Opponent geometry.
  const dx = op.x - me.x, dy = op.y - me.y;
  const dist = len(dx, dy);
  const eb = wrap(Math.atan2(dy, dx) - me.heading);
  const alpha = wrap(Math.atan2(-dy, -dx) - op.heading);
  const absEb = Math.abs(eb);
  const absA = Math.abs(alpha);
  const facedBy = dist < ENGAGE && absA < THREAT;

  // Energy hysteresis for farming.
  let farm = wasFarming;
  if (me.energy < FARM_ON) farm = true;
  else if (me.energy > FARM_OFF) farm = false;

  let act = null;
  if (danger) {
    const g = safeGoal(me.x, me.y, hazards, H);
    act = goTo(me, g.x, g.y, 2.5, nav, true, ATTRACT_GAIN);
  } else if (op.status === 'active' && dist < STRIKE_RANGE && absA >= EXPOSED &&
             absEb < FACING_OK && me.energy >= STRIKE_MIN_ENERGY) {
    act = goTo(me, op.x, op.y, 5.5, terrain, false, STRIKE_GAIN);
  } else if (farm) {
    act = farmAction(me, scan.pads, nav);
  }
  if (act === null && facedBy) {
    act = defend(me, op, dx, dy, dist, eb);
  }
  if (act === null && dist < ENGAGE && me.energy >= FLANK_MIN_ENERGY) {
    const side = alpha >= 0 ? 1 : -1;
    const psi = op.heading + side * 2.2;
    act = goTo(me, op.x + Math.cos(psi), op.y + Math.sin(psi), 4.0, nav, false, ATTRACT_GAIN);
  }
  if (act === null) act = patrolAction(me, t, H, nav);

  return {
    actions: { thrust: act.thrust, turn: act.turn },
    memory: { f: farm ? 1 : 0 },
  };
}
