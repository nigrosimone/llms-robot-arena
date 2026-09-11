// GLM 5.3 Flash controller - developed from the public rules in AGENTS.md only.
// Strategy: circle the opponent outside its wedge cone (its turn rate is the
// limiting factor), strike its side/rear with enough closing speed to flip,
// punish the overrun after its charges (wedge-first retreat is safe against
// flips), shove flipped/depleted opponents out of the arena, top up energy
// opportunistically, escape hazards (holes, flames, announced collapses,
// shrinking edge), and hold the center for the timeout tiebreakers.

const HW = 0.6109; // wedge half-angle

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function clamp1(v) {
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

function clampv(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function tick(s, m) {
  const me = s.self;
  const op = s.opponent;
  const cells = s.arena.cells;
  const he =
    s.arena.nextHalfExtent < s.arena.halfExtent
      ? s.arena.nextHalfExtent
      : s.arena.halfExtent;
  const t = s.time;

  if (me.status === 'flipped') {
    return { actions: { thrust: 0, turn: 0 }, memory: m };
  }

  const mem =
    m !== null && typeof m === 'object' && !Array.isArray(m) ? m : {};
  let side = mem.s === -1 ? -1 : 1;
  const memStrike =
    typeof mem.k === 'number' && isFinite(mem.k) ? mem.k : 0;

  // ---------- hazard perception ----------
  function dangerAt(px, py) {
    if (Math.max(Math.abs(px), Math.abs(py)) > he - 0.5) return 2;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.state === 'inactive') continue;
      const ch = Math.max(Math.abs(px - c.x), Math.abs(py - c.y));
      if (ch > 1.0) continue;
      if (c.type === 'hole' || c.state === 'hole') return 2;
      if (c.collapseIn !== null && c.collapseIn < 2.0) return 2;
      if (c.type === 'flame' && c.state !== 'safe') return 1;
      if (c.collapseIn !== null) return 1;
    }
    return 0;
  }

  function cellOf(px, py) {
    const gx = Math.floor(px) + 0.5;
    const gy = Math.floor(py) + 0.5;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.state === 'inactive') continue;
      if (c.x === gx && c.y === gy) return c;
    }
    return null;
  }

  function repelAt(px, py) {
    let rx = 0;
    let ry = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.state === 'inactive') continue;
      let w = 0;
      if (c.type === 'hole' || c.state === 'hole') w = 3;
      else if (c.type === 'flame' && c.state !== 'safe') w = 1.4;
      else if (c.collapseIn !== null) w = c.collapseIn < 2.5 ? 3 : 1.4;
      else if (c.type === 'recharge' && c.state === 'cooldown') w = 0.6;
      if (w === 0) continue;
      const ddx = px - c.x;
      const ddy = py - c.y;
      const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      if (d < 1.5) {
        const f = (w * (1.5 - d)) / d;
        rx += ddx * f;
        ry += ddy * f;
      }
    }
    const e = he - 0.55;
    if (px > e) rx -= (px - e) * 3;
    if (px < -e) rx += (-e - px) * 3;
    if (py > e) ry -= (py - e) * 3;
    if (py < -e) ry += (-e - py) * 3;
    return [rx, ry];
  }

  // ---------- geometry ----------
  const dxo = op.x - me.x;
  const dyo = op.y - me.y;
  const dist = Math.sqrt(dxo * dxo + dyo * dyo) || 0.001;
  const ux = dxo / dist;
  const uy = dyo / dist;
  const angToOp = Math.atan2(dyo, dxo);
  const rel = angDiff(angToOp + Math.PI, op.heading);
  const off = Math.abs(rel);
  const cone = off < HW + 0.3;
  const approaching = -(op.vx * ux + op.vy * uy);
  const opAway = op.vx * ux + op.vy * uy;
  const lead = Math.min(0.4, dist / 9);
  const txp = op.x + op.vx * lead;
  const typ = op.y + op.vy * lead;
  const opCanHurt = op.status !== 'flipped' && op.energy > 5;

  const rep = repelAt(me.x, me.y);
  const fx = me.x + me.vx * 0.3;
  const fy = me.y + me.vy * 0.3;
  const standCell = cellOf(me.x, me.y);
  const emerg =
    dangerAt(me.x, me.y) === 2 ||
    dangerAt(fx, fy) === 2 ||
    Math.abs(fx) > he - 0.5 ||
    Math.abs(fy) > he - 0.5 ||
    (standCell !== null && standCell.collapseIn !== null);

  // nearest safe ready charger
  let charger = null;
  let cdist = 1e9;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.type !== 'recharge' || c.state !== 'ready') continue;
    if (Math.max(Math.abs(c.x), Math.abs(c.y)) > he - 0.75) continue;
    const d = Math.sqrt((c.x - me.x) ** 2 + (c.y - me.y) ** 2);
    if (d < cdist && dangerAt(c.x, c.y) === 0) {
      cdist = d;
      charger = c;
    }
  }

  // committed orbit side
  if (off < 1.6 && rel * side < 0) side = rel >= 0 ? 1 : -1;

  const q1X = me.x + (txp - me.x) / 3;
  const q1Y = me.y + (typ - me.y) / 3;
  const q2X = me.x + (2 * (txp - me.x)) / 3;
  const q2Y = me.y + (2 * (typ - me.y)) / 3;
  const pathOK =
    dangerAt(q1X, q1Y) === 0 &&
    dangerAt(q2X, q2Y) === 0 &&
    dangerAt((me.x + txp) / 2, (me.y + typ) / 2) === 0 &&
    dangerAt(txp, typ) === 0;

  let strikeUntil = memStrike;

  // estimated closing speed if I charge now
  const vMe = Math.sqrt(me.vx * me.vx + me.vy * me.vy);
  const vAtContact = Math.sqrt(vMe * vMe + 2 * 7 * Math.max(0, dist - 0.8));
  const vClose = vAtContact - Math.max(0, opAway);

  const canStrike =
    me.energy > 45 && op.status === 'active' && pathOK &&
    dist < 2.9 && (!cone || dist < 1.9) &&
    (op.energy < 60 || strikeUntil > s.tick || vClose > 3.0);

  // defensive candidates: back off, cut diagonally, slide along the edge
  function defensiveMove(slideFirst) {
    const s1x = -uy * side;
    const s1y = ux * side;
    const s2x = uy * side;
    const s2y = -ux * side;
    const cr = Math.sqrt(me.x * me.x + me.y * me.y) || 0.001;
    const bx0 = -ux - (me.x / cr) * 0.5;
    const by0 = -uy - (me.y / cr) * 0.5;
    const bn = Math.sqrt(bx0 * bx0 + by0 * by0) || 0.001;
    const back = { x: bx0 / bn, y: by0 / bn, len: 2.0, back: true };
    const d1n = Math.sqrt((-ux + s1x) ** 2 + (-uy + s1y) ** 2) || 0.001;
    const d2n = Math.sqrt((-ux + s2x) ** 2 + (-uy + s2y) ** 2) || 0.001;
    const diag1 = { x: (-ux + s1x) / d1n, y: (-uy + s1y) / d1n, len: 1.4, back: false, diag: true };
    const diag2 = { x: (-ux + s2x) / d2n, y: (-uy + s2y) / d2n, len: 1.4, back: false, diag: true };
    const side1 = { x: s1x, y: s1y, len: 0.8, back: false, slide: true };
    const side2 = { x: s2x, y: s2y, len: 0.8, back: false, slide: true };
    const nearEdge = Math.max(Math.abs(me.x), Math.abs(me.y)) > he - 1.6;
    const inward = {
      x: -me.x / cr,
      y: -me.y / cr,
      len: 2.0,
      back: false,
      inward: true,
    };
    const contact = dist < 1.15;
    const cand = slideFirst && !contact
      ? [side1, side2, diag1, diag2, back]
      : [back, diag1, diag2, side1, side2];
    if (nearEdge) cand.push(inward);
    for (let k = 0; k < cand.length; k++) {
      const c = cand[k];
      const px3 = me.x + c.x * c.len;
      const py3 = me.y + c.y * c.len;
      if (
        Math.max(Math.abs(px3), Math.abs(py3)) < he - 0.6 &&
        dangerAt(px3, py3) === 0 &&
        dangerAt(me.x + c.x * 0.6, me.y + c.y * 0.6) === 0
      ) {
        if (c.back) {
          if (strikeUntil < s.tick + 70) strikeUntil = s.tick + 70;
          return [angToOp, -0.9, true];
        }
        if (c.slide) return [Math.atan2(c.y, c.x), 1, true];
        const bias = c.diag || c.inward ? 0 : 0.3;
        return [Math.atan2(c.y + uy * bias, c.x + ux * bias), 0.95, false];
      }
      if (!c.back && !c.diag && !c.slide) side = -side;
    }
    const lastN = Math.sqrt(inward.x * inward.x + inward.y * inward.y) || 1;
    return [Math.atan2(inward.y / lastN, inward.x / lastN), 1, true];
  }

  let face = angToOp;
  let thrust = 0;
  let raw = false;

  if (emerg) {
    let vx = rep[0];
    let vy = rep[1];
    const rr = Math.sqrt(me.x * me.x + me.y * me.y);
    if (rr > 0.5) {
      vx -= (me.x / rr) * 1.2;
      vy -= (me.y / rr) * 1.2;
    }
    if (ux * me.x + uy * me.y < 0) {
      vx -= ux * 0.9;
      vy -= uy * 0.9;
    }
    const n = Math.sqrt(vx * vx + vy * vy) || 1;
    face = Math.atan2(vy / n, vx / n);
    thrust = 1;
  } else if (
    (op.status === 'flipped' || (!opCanHurt && op.status === 'active')) &&
    dist < 5 &&
    me.energy > 15
  ) {
    // finish: shove them out along the best edge, avoiding ready chargers
    const margX = he - Math.abs(op.x);
    const margY = he - Math.abs(op.y);
    let bx = op.x >= 0 ? 1 : -1;
    let by = 0;
    let score = margX;
    if (margY < margX) {
      bx = 0;
      by = op.y >= 0 ? 1 : -1;
      score = margY;
    }
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.type === 'recharge' && c.state === 'ready') {
        const ax = op.x + bx * 1.4 - c.x;
        const ay = op.y + by * 1.4 - c.y;
        if (Math.sqrt(ax * ax + ay * ay) < 1.9) score -= 10;
      }
    }
    if (score < -5) {
      bx = -bx;
      by = -by;
    }
    const gx = op.x - bx * 0.9;
    const gy = op.y - by * 0.9;
    const dg = Math.sqrt((gx - me.x) ** 2 + (gy - me.y) ** 2);
    if (dg > 0.5 && dist > 1.1) {
      face = Math.atan2(gy - me.y, gx - me.x);
      thrust = 0.85;
    } else {
      face = angToOp;
      thrust = Math.max(Math.abs(me.x), Math.abs(me.y)) < he - 1.05 ? 1 : 0.5;
    }
  } else if (canStrike) {
    // broadside strike at the exposed side/rear
    face = Math.atan2(typ - me.y, txp - me.x);
    thrust = 1;
    if (cone && dist < 1.5) {
      // they squared up at the last moment: ram head-on, wedge covered
      face = angToOp;
    }
    const aheadX = me.x + ux * 0.5;
    const aheadY = me.y + uy * 0.5;
    if (
      dist < 1.4 &&
      Math.max(Math.abs(aheadX), Math.abs(aheadY)) > he - 0.75
    ) {
      // do not follow them over the edge
      thrust = 0.25;
    }
  } else if (opCanHurt && dist < 3.0 && approaching > 2.0) {
    // fast charge incoming: back off wedge-first while there is room,
    // brace at the last moment (wedge-on-wedge cannot flip us)
    if (dist > 1.5) {
      const dmv = defensiveMove(false);
      face = dmv[0];
      thrust = dmv[1];
      raw = dmv[2];
    } else {
      face = angToOp;
      thrust = 1;
      raw = true;
    }
    if (strikeUntil < s.tick + 70) strikeUntil = s.tick + 70;
  } else if (opCanHurt && cone && dist < 2.0) {
    // slow press at close range: slide around their nose, center-ward side
    const aC = Math.atan2(-me.y, -me.x);
    const f1 = Math.atan2(-uy * side + uy * 0.4, ux * side + ux * 0.4);
    const f2 = Math.atan2(uy * side + uy * 0.4, -ux * side + ux * 0.4);
    const d1 = Math.cos(angDiff(f1, aC));
    const d2 = Math.cos(angDiff(f2, aC));
    if (d2 > d1 + 0.05) side = -side;
    const s1x = -uy * side;
    const s1y = ux * side;
    const px3 = me.x + s1x * 1.2;
    const py3 = me.y + s1y * 1.2;
    if (
      Math.max(Math.abs(px3), Math.abs(py3)) < he - 0.6 &&
      dangerAt(px3, py3) === 0 &&
      dangerAt(me.x + s1x * 0.6, me.y + s1y * 0.6) === 0
    ) {
      face = Math.atan2(s1y + uy * 0.4, s1x + ux * 0.4);
      thrust = 0.75;
} else {
        // slow press: back-diagonal slide, precess around them center-ward
        const aC = Math.atan2(-me.y, -me.x);
        const bA = angToOp + side * 0.6 + Math.PI;
        const bB = angToOp - side * 0.6 + Math.PI;
        if (Math.cos(angDiff(bB, aC)) > Math.cos(angDiff(bA, aC)) + 0.05) {
          side = -side;
        }
        face = angToOp + side * 0.6;
        thrust = -0.3;
        raw = true;
      }
  } else if (charger && me.energy < 250 && cdist < 3.0) {
    // cheap top-up when the charger is on my orbit path
    face = Math.atan2(charger.y - me.y, charger.x - me.x);
    thrust = cdist > 0.7 ? 0.6 : 0.15;
  } else {
    // orbit: circle outside their wedge cone, cut inward to strike
    const r = 2.1;
    const a = op.heading + side * 1.95;
    const lim = he - 1.0;
    const gx = clampv(op.x + Math.cos(a) * r, -lim, lim);
    const gy = clampv(op.y + Math.sin(a) * r, -lim, lim);
    let vx = gx - me.x;
    let vy = gy - me.y;
    if (dist < 1.6) {
      vx -= ux * 1.3;
      vy -= uy * 1.3;
    } else if (dist > 3.2) {
      vx += ux * 0.6;
      vy += uy * 0.6;
    }
    vx += rep[0] * 0.35;
    vy += rep[1] * 0.35;
    face = Math.atan2(vy, vx);
    const gap = Math.sqrt((gx - me.x) ** 2 + (gy - me.y) ** 2);
    thrust = gap > 0.5 ? 0.6 : 0.15;
  }

  // ---------- braking near the edge (escape overrides) ----------
  const sx = me.x + me.vx * 0.45;
  const sy = me.y + me.vy * 0.45;
  if (!emerg && dist > 1.6 && (Math.abs(sx) > he - 0.35 || Math.abs(sy) > he - 0.35)) {
    const ch = Math.cos(me.heading);
    const sh = Math.sin(me.heading);
    const vL = me.vx * ch + me.vy * sh;
    if (vL > 0.25) thrust = -1;
    else if (vL < -0.25) thrust = 1;
  }

  // ---------- actuator mapping ----------
  const ferr = angDiff(face, me.heading);
  const turn = Math.abs(ferr) < 0.12 ? 0 : clamp1(ferr * 2.4);
  let th = thrust;
  if (th > 0 && !raw) {
    const align = Math.cos(ferr);
    th = th * (0.25 + 0.75 * (align > 0 ? align : 0));
    if (Math.abs(ferr) > 2.4) th *= 0.4;
  }
  if (me.energy < 15 && !emerg) th *= 0.4;

  return {
    actions: { thrust: th, turn: turn },
    memory: {
      s: side,
      k: strikeUntil
    },
  };
}