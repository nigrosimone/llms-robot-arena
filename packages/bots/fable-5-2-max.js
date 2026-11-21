// fable-5-2-max: wedge-forward defender that keeps hazards between itself and the opponent,
// manages energy and floor wear, and finishes disabled opponents.
const PI = Math.PI;
const TAU = 2 * Math.PI;
const DBG = true;

function wrap(a) {
  if (!(a > -1e6 && a < 1e6)) return 0;
  while (a > PI) a -= TAU;
  while (a <= -PI) a += TAU;
  return a;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Penetration depth into deadly zones inflated by m (0 = clear, > m = inside the real hazard).
// L is a flat list of deadly cells: x, y, seconds until the cell opens (0 = already open).
function hazD(L, h, x, y, tA, m) {
  h -= m;
  let dep = 0;
  let e = (x < 0 ? -x : x) - h; if (e > dep) dep = e;
  e = (y < 0 ? -y : y) - h; if (e > dep) dep = e;
  for (let i = 0; i < L.length; i += 3) {
    if (L[i + 2] > tA + 0.3) continue;
    let ax = x - L[i]; if (ax < 0) ax = -ax; ax = 0.5 + m - ax; if (ax <= 0) continue;
    let ay = y - L[i + 1]; if (ay < 0) ay = -ay; ay = 0.5 + m - ay; if (ay <= 0) continue;
    const p = ax < ay ? ax : ay; if (p > dep) dep = p;
  }
  return dep;
}

function segHitsSq(x0, y0, x1, y1, cx, cy, half) {
  const ddx = x1 - x0, ddy = y1 - y0;
  let t0 = 0, t1 = 1;
  if (ddx === 0) { if (x0 < cx - half || x0 > cx + half) return false; }
  else {
    let a = (cx - half - x0) / ddx, b = (cx + half - x0) / ddx;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false;
  }
  if (ddy === 0) { if (y0 < cy - half || y0 > cy + half) return false; }
  else {
    let a = (cy - half - y0) / ddy, b = (cy + half - y0) / ddy;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false;
  }
  return true;
}

export function tick(sensors, memory) {
  const me = sensors.self, op = sensors.opponent, arena = sensors.arena;
  const M0 = (memory !== null && typeof memory === 'object') ? memory : {};
  const tickN = sensors.tick, now = sensors.time;
  const mx = me.x, my = me.y, mh = me.heading, mvx = me.vx, mvy = me.vy, mw = me.omega;
  const ox = op.x, oy = op.y, oh = op.heading;
  const hNext = Math.min(arena.halfExtent, arena.nextHalfExtent);
  const ch = Math.cos(mh), sh = Math.sin(mh);
  const vLong = mvx * ch + mvy * sh;
  const mySpeed = Math.hypot(mvx, mvy);
  const opSpeed = Math.hypot(op.vx, op.vy);
  const dx = ox - mx, dy = oy - my;
  const dist = Math.hypot(dx, dy);
  const brg = Math.atan2(dy, dx);
  const myErr = wrap(brg - mh);
  const opErr = wrap(brg + PI - oh);
  const ux = dist > 1e-6 ? dx / dist : 1, uy = dist > 1e-6 ? dy / dist : 0;
  const vOpToMe = -(op.vx * ux + op.vy * uy);
  const vMeToOp = mvx * ux + mvy * uy;
  const deficit = 300 - me.energy;

  if (me.status === 'flipped') {
    return { actions: { thrust: 0, turn: 0 }, memory: M0 };
  }

  // ---------- cells ----------
  const cells = arena.cells;
  const HZ = [];
  const RC = [];
  const FL = [];
  const grid = [];
  const integ = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.state === 'inactive') continue;
    const idx = (Math.floor(c.y) + 8) * 16 + Math.floor(c.x) + 8;
    const ty = c.type;
    if (ty === 'hole') { HZ.push(c.x, c.y, 0); grid[idx] = 1; continue; }
    let ci = c.collapseIn;
    if (ci == null && ty === 'collapse') ci = c.timeUntilChange == null ? 0 : c.timeUntilChange;
    if (ci != null) { HZ.push(c.x, c.y, ci); grid[idx] = 1; }
    else if (ty === 'flame') grid[idx] = 2;
    else if (ty === 'recharge') grid[idx] = 3;
    if (ty === 'recharge') RC.push(c); else if (ty === 'flame') FL.push(c);
    integ[idx] = c.integrity;
  }
  const NH = [];
  for (let i = 0; i < HZ.length; i += 3) {
    if (Math.abs(HZ[i] - mx) < 5.5 && Math.abs(HZ[i + 1] - my) < 5.5) NH.push(HZ[i], HZ[i + 1], HZ[i + 2]);
  }

  function hAt(tA) {
    const t = now + tA;
    let h = 8 - 0.07 * (t > 60 ? t - 60 : 0);
    if (h < 3) h = 3;
    return h < hNext ? h : hNext;
  }

  // the rim only moves inward after the first minute
  const hDrop = now > 59 ? 0.07 : 0;

  // Free distance from (x, y) along the unit vector (ax, ay); leaving a margin zone counts as free.
  function ray(x, y, ax, ay, maxD, m, st) {
    let prev = hazD(NH, hNext, x, y, 0, m);
    for (let d = st; d <= maxD + 1e-9; d += st) {
      const dep = hazD(NH, hNext - hDrop * d * 0.25, x + ax * d, y + ay * d, d * 0.25, m);
      if (dep > 0 && dep >= prev - 0.02) return d - st;
      prev = dep;
    }
    return maxD;
  }

  // Turning costs energy with the square of the command: `eco` trades turning speed for economy and
  // is switched on whenever nothing urgent is going on.
  let eco = false;
  function steer(e, wff) {
    const a = e < 0 ? -e : e;
    if (eco) {
      if (a < 0.05) return clamp(-0.5 * mw, -0.3, 0.3);
      let we = 2.5 * a; if (we > 1.6) we = 1.6;
      if (e < 0) we = -we;
      return clamp(we / 3 + 0.5 * (we - mw), -0.6, 0.6);
    }
    let wd = a < 0.32 ? 5 * a : Math.sqrt(8 * a);
    if (wd > 3) wd = 3;
    if (e < 0) wd = -wd;
    wd += wff;
    return clamp(wd / 3 + 1.5 * (wd - mw), -1, 1);
  }

  // ---------- opponent assessment ----------
  const opFlipped = op.status === 'flipped';
  const opDead = op.energy <= 0.05;
  const opStuck = opFlipped && op.energy < 25;
  const opActive = !opFlipped && !opDead;
  let ag = typeof M0.ag === 'number' ? M0.ag : 0.4;
  const aoe = Math.abs(opErr);
  let vTop = typeof M0.vt === 'number' ? M0.vt : 3.5;
  if (opSpeed > vTop) vTop = opSpeed;
  // Is it coming for me? A brief drift in my direction does not count: it has to keep coming (or
  // come fast and straight). Persistence is counted in ticks.
  let ac = typeof M0.ac === 'number' ? M0.ac : 0;
  ac = opActive && vOpToMe > 1.2 && aoe < 0.9 ? (ac < 60 ? ac + 1 : ac) : (ac > 2 ? ac - 2 : 0);
  // false alarms so far: approaches that ended without it ever touching me make me harder to scare
  let fa = typeof M0.fa === 'number' ? M0.fa : 0;
  const coming = (ac >= 14 + 10 * fa && dist < (2.2 + 2.4 * (vOpToMe > 0 ? vOpToMe : 0)) / (1 + 0.7 * fa)) ||
    (opActive && vOpToMe > 2.6 + 0.5 * fa && aoe < 0.5 && dist < 7 / (1 + 0.5 * fa));
  const approaching = opActive && (coming || (M0.om === 1 && dist < 4) || (dist < 3.5 && aoe < 1.0 && vOpToMe > 0.25 && vTop <= 4.3 && M0.ch === 1));
  ag += ((approaching ? 1 : 0) - ag) * (approaching ? 0.04 : 0.004);
  // ticks since the opponent was last actually coming for me
  let np = typeof M0.np === 'number' ? M0.np : 0;
  np = opActive && (coming || (M0.ch === 1 && ((vOpToMe > 1.0 && aoe < 1.1) || (dist < 2.6 && aoe < 0.9 && opSpeed > 0.5))) ||
    (M0.om === 1 && dist < 4.5 && vTop <= 4.3 && opSpeed > 0.3))
    ? 0 : (np < 9999 ? np + 1 : np);

  let tAvail = 99, tHit = 99;
  const gap = dist > 0.95 ? dist - 0.95 : 0;
  if (opActive) {
    const v0 = vOpToMe > 0 ? vOpToMe : 0;
    let a = (8 - 1.6 * v0) * 0.75; if (a < 0.5) a = 0.5;
    tHit = (-v0 + Math.sqrt(v0 * v0 + 2 * a * gap)) / a;
    if (tHit < gap / 5) tHit = gap / 5;
    tHit += aoe > 0.5 ? (aoe - 0.5) / 3.6 : 0;
    tAvail = tHit - 0.1;
  } else if (opFlipped && !opStuck) {
    tAvail = op.statusTimer + gap / 5;
  }
  const rot = tAvail <= 0 ? 0 : (tAvail < 0.55 ? 2.3 * tAvail * tAvail : 0.7 + 2.2 * (tAvail - 0.55));
  // How far my wedge may point away from the opponent: what I can still rotate back before it arrives.
  let phi = 0.35 + rot; if (phi > PI) phi = PI;

  const lc = sensors.lastContact;
  const inContact = lc !== null && lc !== undefined && tickN - lc.tick <= 5;

  // ---------- goal selection ----------
  let gx = mx, gy = my, vmax = 0, mode = 'hold', usePlan = false;
  let igx = typeof M0.gx === 'number' ? M0.gx : null, igy = typeof M0.gy === 'number' ? M0.gy : null;
  let rcid = typeof M0.rc === 'string' ? M0.rc : null;
  let stSide = typeof M0.ss === 'number' ? M0.ss : 0;
  let pa = typeof M0.pa === 'number' ? M0.pa : null;
  let oc = null;            // hole being used as cover: [cx, cy]
  let od = typeof M0.od === 'number' ? M0.od : 0;   // direction around that hole
  let ld = typeof M0.ld === 'number' ? M0.ld : 0;   // direction of the kiting loop
  let orbDir = 0, orbV = 0, orbCx = 0, orbCy = 0, orbR = 1; // circle-following command (orbDir 0 = none)
  let holdTan = false;      // stand still, tangent to that circle
  let bh = Array.isArray(M0.bh) && M0.bh.length === 3 ? M0.bh : null;   // hole to avoid for a while: [x, y, untilTick]
  let sk = typeof M0.sk === 'number' ? M0.sk : 0;                         // ticks spent blocked next to a hole
  let covered = false;      // a hole lies between the opponent and me
  let nh = typeof M0.nh === 'number' ? M0.nh : 0;   // holes are not used as cover before this tick
  let ot = typeof M0.ot === 'number' ? M0.ot : 0;   // time spent circling a hole without result
  let flow = false;         // keep speed through the goal instead of stopping on it
  let loopDir = null, loopV = 0;   // retreat-loop command: direction of motion and speed
  let freeze = false;       // spend nothing this tick
  let finalDir = null;      // last-moment step into a recharge cell: heading to drive along
  let holdDir = null;       // heading to keep while parked
  let dbgx = '';
  let fg = M0.fg === 1 ? 1 : 0;   // committed to the last walk into a recharge cell
  const cx0 = Math.floor(mx) + 0.5, cy0 = Math.floor(my) + 0.5;
  const myIdx = clamp(Math.floor(my) + 8, 0, 15) * 16 + clamp(Math.floor(mx) + 8, 0, 15);
  const myInteg = integ[myIdx] === undefined ? 1 : integ[myIdx];
  let myCollapse = -1;
  for (let i = 0; i < NH.length; i += 3) {
    if (NH[i] === cx0 && NH[i + 1] === cy0 && NH[i + 2] > 0) myCollapse = NH[i + 2];
  }

  function cellScore(cx, cy, minI) {
    if (cx < -8 || cx > 8 || cy < -8 || cy > 8) return -1e9;
    const idx = (Math.floor(cy) + 8) * 16 + Math.floor(cx) + 8;
    if (grid[idx] !== undefined) return -1e9;
    // how far from the (shrinking) rim a standing spot must be; an emergency exit can be less picky
    const hf = minI < 0.15 ? hAt(4) - 0.7 : hAt(14) - 1.3;
    if (cx > hf || cx < -hf || cy > hf || cy < -hf) return -1e9;
    const I = integ[idx] === undefined ? 1 : integ[idx];
    if (I < minI) return -1e9;
    const acx = cx < 0 ? -cx : cx, acy = cy < 0 ? -cy : cy;
    let s = 6 * I - 0.45 * Math.hypot(cx - mx, cy - my) - 0.3 * (acx > acy ? acx : acy);
    for (let i = 0; i < NH.length; i += 3) {
      if (Math.abs(NH[i] - cx) < 1.01 && Math.abs(NH[i + 1] - cy) < 1.01) s -= 1.5;
    }
    if (opActive) { const od = Math.hypot(cx - ox, cy - oy); if (od < 3) s -= (3 - od) * 1.2; }
    return s;
  }

  function pickCell(R, minI) {
    let best = -1e8, bx = null, by = null;
    for (let j = -R; j <= R; j++) {
      for (let i = -R; i <= R; i++) {
        if (i === 0 && j === 0) continue;
        const s = cellScore(cx0 + i, cy0 + j, minI);
        if (s > best) { best = s; bx = cx0 + i; by = cy0 + j; }
      }
    }
    return bx === null ? null : [bx, by];
  }

  function rechargeOk(c, d) {
    if (c.collapseIn != null && c.collapseIn < 2.5) return false;
    const lim = hAt(3) - 0.35;
    if (Math.abs(c.x) > lim || Math.abs(c.y) > lim) return false;
    const wait = c.state === 'ready' ? 0 : (c.timeUntilChange == null ? 9 : c.timeUntilChange);
    return wait <= d / 3.5 + 1.3;
  }

  // Recharge cell worth visiting, or null.
  function pickRecharge(minScore) {
    let bestR = null, bestRs = minScore;
    for (let i = 0; i < RC.length; i++) {
      const c = RC[i];
      const d = Math.hypot(c.x - mx, c.y - my);
      if (!rechargeOk(c, d)) continue;
      const tt = d / 3.5 + 0.3;
      const wait = c.state === 'ready' ? 0 : (c.timeUntilChange == null ? 9 : c.timeUntilChange);
      const gain = deficit + 0.5 * tt < 60 ? deficit + 0.5 * tt : 60;
      let s = gain - 4 * tt - 3 * (wait > tt ? wait - tt : 0);
      if (opActive) { const od = Math.hypot(c.x - ox, c.y - oy); if (od < d + 1.5) s -= 25; }
      if (c.id === rcid) s += 6;
      if (s > bestRs) { bestRs = s; bestR = c; }
    }
    return bestR;
  }

  function rechargeGoal(c) {
    rcid = c.id;
    const inside = Math.abs(mx - c.x) <= 0.5 && Math.abs(my - c.y) <= 0.5;
    if (!inside) { gx = c.x; gy = c.y; return; }
    let bd = -1e9; gx = c.x; gy = c.y;
    const dirs = [1, 0, -1, 0, 0, 1, 0, -1];
    for (let k = 0; k < 8; k += 2) {
      const px = c.x + dirs[k] * 0.85, py = c.y + dirs[k + 1] * 0.85;
      if (hazD(HZ, hNext, px, py, 0, 0.4) > 0) continue;
      const sc = -Math.hypot(px - mx, py - my);
      if (sc > bd) { bd = sc; gx = px; gy = py; }
    }
  }

  let phiUse = phi;
  let pk = typeof M0.pk === 'number' ? M0.pk : 0;   // ticks spent in the current pounce
  let pf = typeof M0.pf === 'number' ? M0.pf : 0;   // pounces this opponent has read so far
  const mustLeave = myCollapse >= 0 || myInteg < 0.1;
  // being hunted: it has been coming for me lately (not merely wandering past)
  const chased = opActive && ag > 0.3 && np < 100;
  // an episode that ends without any contact was a false alarm; one with contact proves intent
  let ec = typeof M0.ec === 'number' ? M0.ec : 0;
  if (chased) { if (inContact) ec = 1; }
  else if (M0.ch === 1) { if (ec === 1) fa = 0; else if (fa < 4) fa++; ec = 0; }

  if (mustLeave) {
    const p = pickCell(1, 0.12) || pickCell(2, 0.12);
    if (p) { gx = p[0]; gy = p[1]; vmax = 4.5; mode = 'leave'; phiUse = PI; }
  } else if (opDead || opStuck) {
    mode = 'safe';
    if (!opFlipped && me.flipsTaken > op.flipsTaken) mode = 'strike';
  } else if (opFlipped) {
    mode = 'flipwait';
    if (op.statusTimer > 0.7 && dist < 4 && me.energy > op.energy * 0.4 + 40) {
      // keep pressing a flipped opponent: every tick of contact costs it more than it costs me
      mode = 'press'; gx = ox; gy = oy; vmax = 5; phiUse = PI;
    } else if (dist < 2.3) {
      // it is about to get up: give it room, wedge toward it
      const bx = ox - ux * 2.6, by = oy - uy * 2.6;
      if (hazD(HZ, hNext, bx, by, 0, 0.6) <= 0) { mode = 'backoff'; gx = bx; gy = by; vmax = 3.5; phiUse = PI; }
    }
  } else if (chased) {
    mode = 'chased';
  } else {
    mode = 'econ';
  }

  // A slow, distracted opponent showing its flank or rear within reach: hit it.
  if (opActive && op.status === 'active' && me.energy > 45 && mode !== 'leave' && pk < 150 && pf < 2 &&
    (tickN < 6480 || me.flipsTaken > op.flipsTaken || me.energy + 30 < op.energy)) {
    const vAway = op.vx * ux + op.vy * uy;
    const run = dist > 0.75 ? dist - 0.75 : 0;
    const v0 = vMeToOp > 0 ? vMeToOp : 0;
    let vHit = Math.sqrt(v0 * v0 + 11 * run); if (vHit > 5) vHit = 5;
    let a = (8 - 1.6 * v0) * 0.75; if (a < 0.5) a = 0.5;
    const tMe = (-v0 + Math.sqrt(v0 * v0 + 2 * a * run)) / a;
    const tTurn = 0.15 + (aoe > 0.6 ? (aoe - 0.6) / 2.6 : 0);
    const go = pk > 0
      ? ((aoe > 0.6 || dist < 1.7) && !(inContact && lc.opponentWedge))
      : (np > 20 + pf * 25 && aoe > 1.15 && dist < 5 && vHit - vAway > (aoe > 2.53 ? 3.5 : 3.0) &&
        tMe < (pf > 1 ? tTurn * 0.8 : tTurn * 1.3 + 0.25));
    if (go) {
      const ax = ox + op.vx * tMe * 0.8, ay = oy + op.vy * tMe * 0.8;
      const al = Math.hypot(ax - mx, ay - my) + 1.2;
      let clear = true;
      for (let d = 0.5; d <= al && clear; d += 0.5) {
        if (hazD(HZ, hNext, mx + (ax - mx) / (al - 1.2) * d, my + (ay - my) / (al - 1.2) * d, 0, 0.3) > 0) clear = false;
      }
      if (clear) { mode = 'pounce'; gx = ax; gy = ay; vmax = 5; phiUse = PI; flow = true; usePlan = false; }
    }
  }
  if (mode === 'pounce') pk++;
  else {
    // a pounce that ended with the opponent facing me (and no flip) was read: be pickier next time
    if (pk > 0 && opActive && pf < 6) pf++;
    pk = 0;
  }

  if (mode === 'strike') {
    // Immobile, upright target: hit the middle of a flank at speed.
    const px = -Math.sin(oh), py = Math.cos(oh);
    let best = -1e9, bs = 0;
    for (let s = -1; s <= 1; s += 2) {
      const sx = ox + s * 2.3 * px, sy = oy + s * 2.3 * py;
      if (hazD(HZ, hNext, sx, sy, 0, 0.45) > 0) continue;
      let clear = true;
      for (let d = 0.4; d <= 3.4; d += 0.5) {
        if (hazD(HZ, hNext, sx - s * px * d, sy - s * py * d, 0, 0.15) > 0) { clear = false; break; }
      }
      if (!clear) continue;
      let sc = -Math.hypot(sx - mx, sy - my); if (s === stSide) sc += 1.0;
      if (sc > best) { best = sc; bs = s; }
    }
    stSide = bs;
    if (bs === 0) mode = 'safe';
    else {
      const sx = ox + bs * 2.3 * px, sy = oy + bs * 2.3 * py;
      const lat = (mx - ox) * Math.cos(oh) + (my - oy) * Math.sin(oh);
      const out = ((mx - ox) * px + (my - oy) * py) * bs;
      if ((lat < 0.14 && lat > -0.14 && out > 0.9) || (M0.sg === 1 && lat < 0.3 && lat > -0.3 && out > 0.5)) {
        gx = ox; gy = oy; vmax = 5; phiUse = PI; mode = 'strikeGo';
      } else { gx = sx; gy = sy; vmax = 3; phiUse = PI; usePlan = true; }
    }
  }

  // Nobody is coming for me: look after energy and floor wear.
  function economy() {
    eco = !opActive || np > 30;
    // Last seconds, flips level or better: the bell is decided on energy. Wait beside a recharge
    // cell that will be ready and step into it at the very end, so I finish full.
    const ticksLeft = 7200 - tickN;
    if (ticksLeft < 780 && ticksLeft >= 510 && deficit >= 18 && me.flipsTaken <= op.flipsTaken) {
      // a last ordinary top-up while the cell still has time to be ready again for the bell
      const c9 = pickRecharge(-30);
      if (c9 !== null) { mode = 'recharge'; vmax = 3.0; usePlan = true; rechargeGoal(c9); return; }
    }
    if (ticksLeft < 510 && ticksLeft > 0 && me.flipsTaken <= op.flipsTaken) {
      // Last seconds with flips level or better: the bell is decided on energy. Spend nothing,
      // then walk into a ready recharge cell so that the sip lands just before the end.
      rcid = null;
      const tl = ticksLeft / 60;
      if (deficit <= 0.5 && ticksLeft < 150) { mode = 'full'; vmax = 0; holdDir = mh; return; }
      let tc = null, td = 1e9, tw = 0;
      for (let i = 0; i < RC.length; i++) {
        const c = RC[i];
        if (c.collapseIn != null || Math.abs(c.x) > 3.55 || Math.abs(c.y) > 3.55) continue;
        const wait = c.state === 'ready' ? 0 : (c.timeUntilChange == null ? 99 : c.timeUntilChange);
        const ex = Math.abs(mx - c.x) - 0.5, ey = Math.abs(my - c.y) - 0.5;
        const de = ex > ey ? (ex > 0 ? ex : 0) : (ey > 0 ? ey : 0);
        if (wait > tl - 0.2 || (fg === 0 && de / 1.6 + 0.45 > tl - 0.3)) continue;
        if (opActive && Math.hypot(c.x - ox, c.y - oy) < 1.6) continue;
        if (de >= td) continue;
        // the straight walk to it has to be free of holes
        const dl = Math.hypot(c.x - mx, c.y - my);
        let free = true;
        for (let s = 0.35; s < dl && free; s += 0.35) {
          if (hazD(HZ, hNext, mx + (c.x - mx) * s / dl, my + (c.y - my) * s / dl, 99, 0.28) > 0) free = false;
        }
        if (!free) continue;
        td = de; tc = c; tw = wait;
      }
      if (DBG) dbgx = ' eg:' + (tc ? tc.id + '/' + td.toFixed(2) + '/' + tw.toFixed(2) : 'none') + '/' + RC.map((c) => c.id.slice(-1) + c.state[0] + (c.timeUntilChange == null ? '' : c.timeUntilChange.toFixed(1))).join(',');
      if (tc !== null && deficit > 6) {
        // time to get in: turn toward it (either end first), then a short walk
        const dc = Math.atan2(tc.y - my, tc.x - mx);
        const te = Math.min(Math.abs(wrap(dc - mh)), Math.abs(wrap(dc + PI - mh)));
        const need = td / 1.6 + 0.45 + te / 2.4;
        if (td <= 0 && fg === 0) {
          // standing inside it: step out first, there is still time
          mode = 'park'; vmax = 1.5; usePlan = true; rechargeGoal(tc); rcid = null; return;
        }
        if (fg === 1 || (tl <= need + 0.35 && tw <= need - 0.1)) {
          // committed: walk in (and keep walking even if the estimate wobbles)
          fg = 1; eco = false; mode = 'final'; gx = tc.x; gy = tc.y; vmax = 2.0; usePlan = true; flow = true; return;
        }
      }
      fg = 0;
      // nothing to do but wait, on a cell that will hold me until the bell
      if (myInteg * 12 > tl + 1.5) {
        mode = 'rest'; vmax = 0; holdDir = opActive && dist < 4 ? null : mh;
        return;
      }
    }
    // Top up only for a full helping (a little earlier late in the match, so the last sip at the
    // bell can fill me): small sips cost more in travel than they bring.
    const c = deficit >= (tickN > 5400 ? 35 : 55) ? pickRecharge(8) : null;
    if (c !== null) {
      mode = 'recharge'; vmax = 3.0; usePlan = true;
      rechargeGoal(c);
    } else {
      rcid = null;
      // stand on sound floor close to where I am; move on before the cell wears out
      const curOk = igx !== null && Math.hypot(igx - mx, igy - my) < 1.6 && cellScore(igx, igy, 0.3) > -1e8;
      if (!curOk) {
        const here = cellScore(cx0, cy0, 0.45);
        if (here > -1e8) { igx = cx0; igy = cy0; }
        else { const p = pickCell(2, 0.6) || pickCell(3, 0.45) || pickCell(1, 0.2); if (p) { igx = p[0]; igy = p[1]; } else { igx = null; igy = null; } }
      }
      if (igx !== null) {
        gx = igx; gy = igy; usePlan = true;
        vmax = Math.abs(igx - mx) < 0.3 && Math.abs(igy - my) < 0.3 ? 0 : 1.6;
      }
    }
    if (!opActive) phiUse = PI;
  }
  if (mode === 'safe' || mode === 'econ' || mode === 'flipwait') economy();

  if (mode === 'chased') {
    const hFut = hAt(10);
    const near = dist < 5.5 || tHit < 1.1;
    // retreat speed: a little faster than this opponent has ever gone, so the chase costs it more than me
    const vK = clamp(vTop + 0.5, 3.0, 5);
    const slowOp = vTop <= 4.3;      // slower than my own top speed: I can afford to show a flank at speed
    let handled = false;
    // --- A) use a hole as cover: a charger that comes straight at me has to cross it
    const RHO = 1.5;
    let hb = -1, hbs = -1e9;
    const pid = Array.isArray(M0.oc) ? M0.oc : null;
    if (tickN >= nh) {
      for (let i = 0; i < HZ.length; i += 3) {
        if (HZ[i + 2] > 0) continue;
        const hx = HZ[i], hy = HZ[i + 1];
        const lim = hFut - 0.45 - RHO;
        if (hx > lim || hx < -lim || hy > lim || hy < -lim) continue;
        if (bh !== null && bh[0] === hx && bh[1] === hy && tickN < bh[2]) continue;
        // the whole circle must stay clear of every other deadly cell
        let ok = true;
        for (let k = 0; k < HZ.length && ok; k += 3) {
          if (k === i) continue;
          const ddx = Math.abs(HZ[k] - hx), ddy = Math.abs(HZ[k + 1] - hy);
          const qx = ddx > 0.5 ? ddx - 0.5 : 0, qy = ddy > 0.5 ? ddy - 0.5 : 0;
          if (Math.hypot(qx, qy) < RHO + 0.45 && Math.hypot(ddx + 0.5, ddy + 0.5) > RHO - 0.45) ok = false;
        }
        if (!ok) continue;
        let s = -Math.hypot(hx - mx, hy - my);
        if (pid !== null && pid[0] === hx && pid[1] === hy) s += 2.5;
        if (s > hbs) { hbs = s; hb = i; }
      }
    }
    if (hb >= 0) {
      const cx = HZ[hb], cy = HZ[hb + 1];
      const rx = mx - cx, ry = my - cy; const r = Math.hypot(rx, ry);
      const ang = Math.atan2(ry, rx);
      const angT = Math.atan2(cy - oy, cx - ox);
      const dA = wrap(angT - ang);
      const pc = Math.hypot(ox - cx, oy - cy);
      const cov = segHitsSq(ox, oy, mx, my, cx, cy, 0.4);
      const pFar = pc > 3.6 && dist > 4.0;
      // an opponent that walks round the hole, or shoves me toward it from outside, is not fooled
      if (!slowOp && M0.om === 1 && dist < 1.5 && pc > r + 0.25) nh = tickN + 900;
      else if (ot > 720) { nh = tickN + 1200; ot = 0; }
      else if (slowOp || pFar || (cov && r < RHO + 0.9)) {
        handled = true;
        oc = [cx, cy];
        orbCx = cx; orbCy = cy; orbR = RHO;
        covered = cov;
        if (slowOp) phiUse = PI;
        if (r > RHO + 0.9) {
          mode = 'toHole'; usePlan = true; vmax = near ? 5 : 3.6;
          let a2 = angT;
          if (pFar) od = 0;
          else {
            // join the circle on a tangent, already heading the way I will keep circling
            if (od === 0) od = Math.abs(dA) < 2.6 ? (dA > 0 ? 1 : -1) : ((-ry * (mx - ox) + rx * (my - oy)) >= 0 ? 1 : -1);
            a2 = ang + od * Math.acos(RHO / r);
            flow = true;
          }
          gx = cx + RHO * Math.cos(a2); gy = cy + RHO * Math.sin(a2);
          if (flow) {
            // arrive slowly enough to be able to bend onto the circle
            const dT = Math.hypot(gx - mx, gy - my);
            if (dT < 2.2 && vmax > 2.7 + dT) vmax = 2.7 + dT;
          }
        } else if (Math.abs(dA) < 0.15 && Math.abs(r - RHO) < 0.45 && (pFar || cov)) {
          // in the shadow: a straight charge has to cross the hole
          mode = 'shadow'; holdTan = true; od = 0;
        } else if (pFar) {
          // settle on the far side while there is time
          mode = 'set'; orbDir = dA > 0 ? 1 : -1; od = 0;
          orbV = Math.sqrt(10 * RHO * Math.abs(dA)); if (orbV > 3.4) orbV = 3.4;
        } else if (slowOp) {
          // charger close: keep circling the hole, always the same way round
          if (od === 0) {
            if (mySpeed > 1.2 && Math.abs(rx * mvy - ry * mvx) > 0.4 * r * mySpeed) od = rx * mvy - ry * mvx >= 0 ? 1 : -1;
            else od = (-ry * (mx - ox) + rx * (my - oy)) >= 0 ? 1 : -1;
          }
          // speed up only as fast as my turn rate can hold the circle
          mode = 'orbit'; orbDir = od; orbV = clamp(Math.abs(mw) * RHO * 1.25, 2.7, 3.5);
          ot += 2;
        } else {
          // fast charger at the hole and I am covered: stay put, wedge toward it
          mode = 'shadow'; vmax = 0; od = 0;
        }
      }
    }
    if (!handled) {
      // --- B) no usable cover: back away round a wide loop at speed, wedge toward the charger,
      // topping up on the way. It cannot flip a wedge and it pays for the chase.
      od = 0;
      // widest loop round the centre that stays clear of every hole (and of the grates if possible)
      let RL = clamp(hFut - 1.9, 2.2, 4.2), rlScore = -1;
      for (let R = RL; R >= 2.19; R -= 0.4) {
        let sc = 2;
        for (let k = 0; k < HZ.length && sc > 0; k += 3) {
          const ax = Math.abs(HZ[k]), ay = Math.abs(HZ[k + 1]);
          const lo = Math.hypot(ax > 1.1 ? ax - 1.1 : 0, ay > 1.1 ? ay - 1.1 : 0);
          if (lo < R && R < Math.hypot(ax + 1.1, ay + 1.1)) sc = 0;
        }
        for (let k = 0; k < FL.length && sc > 1; k++) {
          const ax = Math.abs(FL[k].x), ay = Math.abs(FL[k].y);
          const lo = Math.hypot(ax > 0.6 ? ax - 0.6 : 0, ay > 0.6 ? ay - 0.6 : 0);
          if (lo < R && R < Math.hypot(ax + 0.6, ay + 0.6)) sc = 1;
        }
        if (sc > rlScore) { rlScore = sc; RL = R; if (sc === 2) break; }
      }
      // badly placed (far out, little room behind): start moving while the charger is still far away
      const early = Math.hypot(mx, my) > RL + 0.8 && dist < 9.5;
      if ((!near && !early && mySpeed < 1.0) || np > 18) { ld = 0; mode = 'econ'; economy(); }
      else {
        if (ld === 0) ld = (-my * (mx - ox) + mx * (my - oy)) >= 0 ? 1 : -1;
        const r0 = Math.hypot(mx, my), a0 = Math.atan2(my, mx);
        loopDir = a0 + ld * (PI / 2 - clamp(0.6 * (RL - r0), -0.8, 0.8));
        // matched retreat: only a little faster than it is coming, so the chase costs it more than me
        loopV = near ? vK : (vK < 3.4 ? vK : 3.4);
        mode = 'loop';
        if (deficit >= 15) {
          // the next ready cell ahead of me, going round the centre my way: sweep through it
          let bl = 2.2;
          const lim = hFut - 1.3;
          for (let i = 0; i < RC.length; i++) {
            const c = RC[i];
            const d = Math.hypot(c.x - mx, c.y - my);
            if (d < 0.3 || d > 7 || !rechargeOk(c, d)) continue;
            if (c.x > lim || c.x < -lim || c.y > lim || c.y < -lim) continue;
            const rc0 = Math.hypot(c.x, c.y);
            if (rc0 > RL + 0.8) continue;
            let lead = ld * wrap(Math.atan2(c.y, c.x) - a0);
            if (rc0 < 1.2) lead = 0.5;
            if (lead < -0.2 || lead >= bl) continue;
            const dc = Math.atan2(c.y - my, c.x - mx);
            if (dist < 6 && Math.cos(dc - brg) > 0.2) continue;
            bl = lead; loopDir = dc; mode = 'krech';
          }
        }
      }
    }
    if (ot > 0) ot--;
  }

  // ---------- local direction planner ----------
  let gD = Math.hypot(gx - mx, gy - my);
  if (orbDir === 0 && usePlan && vmax > 0 && gD > 0.3) {
    const base = Math.atan2(gy - my, gx - mx);
    const chase = opActive ? (opSpeed > ag * 4 ? opSpeed : ag * 4) : 0;
    let best = -1e9, ba = base, bl = gD < 3 ? gD : 3;
    let found = false;
    for (let k = 0; k < 10; k++) {
      const a = base + k * (TAU / 10);
      const cx = Math.cos(a), cy = Math.sin(a);
      const f = ray(mx, my, cx, cy, 3, 0.4, 0.75);
      if (f < 0.7) continue;
      let L = f;
      if (k === 0 && gD < L) L = gD;
      const px = mx + cx * L, py = my + cy * L;
      let s = -Math.hypot(gx - px, gy - py) - (3 - L) * 0.3;
      let pen = 0;
      if (opActive) {
        const tau = L / 4.5;
        const qx = mx + cx * L * 0.6 - ox, qy = my + cy * L * 0.6 - oy; const ql = Math.hypot(qx, qy) + 1e-6;
        const adv = chase * tau < ql ? chase * tau : ql;
        const dEnd = Math.hypot(px - ox - qx / ql * adv, py - oy - qy / ql * adv);
        let t = dx * cx + dy * cy; t = t < 0 ? 0 : (t > L ? L : t);
        const dSeg = Math.hypot(mx + cx * t - ox, my + cy * t - oy);
        if (dEnd < 2.6) pen += (2.6 - dEnd) * 3;
        if (t > 0.01 && dSeg < 2.2) pen += (2.2 - dSeg) * 3;
      } else if (mode !== 'press' && mode !== 'strikeGo') {
        // a disabled opponent is just an obstacle: do not waste energy shoving it
        let t = dx * cx + dy * cy; t = t < 0 ? 0 : (t > L ? L : t);
        const dSeg = Math.hypot(mx + cx * t - ox, my + cy * t - oy);
        if (dSeg < 1.5) pen += (1.5 - dSeg) * 8;
      }
      s -= pen;
      if (pa !== null && Math.abs(wrap(a - pa)) < 0.55) s += 0.5;
      if (s > best) { best = s; ba = a; bl = L; found = true; }
      // the straight line is free and nobody is in the way: no need to look any further
      if (k === 0 && pen === 0 && f >= (gD < 3 ? gD - 0.01 : 2.99)) break;
    }
    if (found) {
      // routing around something close to the goal: take the corner slowly unless someone is on my tail
      if (gD < 3.5 && Math.abs(wrap(ba - base)) > 0.5 && vmax > 2.8 && !(opActive && tHit < 1.6)) vmax = 2.8;
      gx = mx + Math.cos(ba) * bl; gy = my + Math.sin(ba) * bl; pa = ba; gD = bl;
    } else pa = null;
  } else pa = null;

  // ---------- motion ----------
  // Which directions may I move in without offering a flank at flip speed? Retreats within a cone
  // around "straight away" (wider the faster I already go), or a nose-first advance.
  function safeDir(dir0, ph) {
    if (!opActive || ph >= PI - 0.01) return dir0;
    const away = brg + PI;
    let dev = wrap(dir0 - away);
    const ad = dev < 0 ? -dev : dev;
    const rat = (vTop - 2.0) / (mySpeed > 0.5 ? mySpeed : 0.5);
    let cone = rat >= 1 ? 0 : Math.acos(rat < -1 ? -1 : rat);
    if (cone < ph) cone = ph;
    if (ad <= cone || ad >= PI - ph) return dir0;
    if (dist < 4.5 || ad - cone <= PI - ph - ad) return away + (dev > 0 ? cone : -cone);
    return away + (dev > 0 ? PI - ph : ph - PI);
  }

  let thrust = 0, turn = 0;
  const farOp = !opActive || (dist > 6 && ag < 0.3);
  if (finalDir !== null) {
    thrust = 1; turn = steer(wrap(finalDir - mh), 0);
  } else if (loopDir !== null) {
    // Retreat loop. While slow: back straight away from the opponent, wedge toward it, and swing
    // into the loop only as speed builds (a J-turn). Once moving: keep the flow, never brake.
    let want = loopDir;
    if (opActive && dist < 6) {
      const away = brg + PI;
      let cone = clamp((mySpeed - 0.6) * 0.75, 0.3, 3.2);
      if (phi > cone) cone = phi;
      const dev = wrap(want - away);
      if (dev > cone) want = away + cone; else if (dev < -cone) want = away - cone;
      // never run into the opponent's half of the floor
      if (dist < 5 && Math.cos(want - brg) > 0.3) want = brg + (wrap(want - brg) >= 0 ? 1 : -1) * (PI / 2 + 0.2);
    }
    let md = want, best = -1;
    for (let k = 0; k < 7; k++) {
      const a = want + (k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * ld * 0.35 * ((k + 1) >> 1));
      const f = ray(mx, my, Math.cos(a), Math.sin(a), 3, 0.4, 0.6);
      if (f >= 2.4) { md = a; break; }
      if (f > best) { best = f; md = a; }
    }
    const eF = wrap(md - mh), eR = wrap(md + PI - mh);
    let rev;
    if (vLong > 1.2) rev = false;
    else if (vLong < -1.2) rev = true;
    else {
      const cb = Math.cos(md - brg);
      rev = !opActive || (cb > -0.2 && cb < 0.4) ? Math.abs(eR) < Math.abs(eF) : cb <= -0.2;
    }
    const e = rev ? eR : eF;
    turn = steer(e, 0);
    const vdes = rev ? -loopV : loopV;
    thrust = clamp(vdes / 5 + 1.2 * (vdes - vLong), -1, 1);
    pa = md;
  } else if (orbDir !== 0) {
    // follow the circle: tangent heading, corrected outward when inside and inward when outside
    const rr = Math.hypot(mx - orbCx, my - orbCy);
    const des = Math.atan2(my - orbCy, mx - orbCx) + orbDir * (PI / 2 - (rr < orbR ? clamp(2.2 * (orbR - rr), 0, 1.2) : clamp(0.9 * (orbR - rr), -0.7, 0)));
    const eF = wrap(des - mh), eR = wrap(des + PI - mh);
    let rev = Math.abs(eR) < Math.abs(eF);
    if (vLong > 1.2) rev = false; else if (vLong < -1.2) rev = true;
    const e = rev ? eR : eF;
    turn = steer(e, orbDir * orbV / orbR * 0.8);
    const al = Math.abs(e);
    let vdes = al > 0.6 ? orbV * (al > 1.5 ? 0.55 : 1 - 0.5 * (al - 0.6)) : orbV;
    if (rev) vdes = -vdes;
    thrust = clamp(vdes / 5 + 1.2 * (vdes - vLong), -1, 1);
  } else if (holdTan) {
    // parked behind the hole, side-on, ready to slide either way
    const tA = Math.atan2(my - orbCy, mx - orbCx) + PI / 2;
    const e1 = wrap(tA - mh), e2 = wrap(tA + PI - mh);
    turn = steer(Math.abs(e1) < Math.abs(e2) ? e1 : e2, 0);
    if (Math.abs(vLong) > 0.05) thrust = clamp(-1.2 * vLong, -1, 1);
  } else if (vmax <= 0 || gD < 0.12) {
    if (holdDir !== null && (farOp || tHit > 1.5)) turn = steer(wrap(holdDir - mh), 0);
    else if (!(farOp && Math.abs(myErr) < 0.5) && !(eco && Math.abs(myErr) < (dist > 4.5 ? 0.6 : 0.2))) turn = steer(myErr, 0);
    // never brake against a pusher: only cancel my own residual motion when not in contact
    if (!inContact && Math.abs(vLong) > 0.05) thrust = clamp(-1.2 * vLong, -1, 1);
  } else {
    const dir0 = Math.atan2(gy - my, gx - mx);
    const mdir = safeDir(dir0, phiUse);
    const eF = Math.abs(wrap(mdir - mh)), eR = Math.abs(wrap(mdir + PI - mh));
    let rev;
    if (vLong > 1.2 && eF < 1.75) rev = false;
    else if (vLong < -1.2 && eR < 1.75) rev = true;
    else if (!opActive) rev = eR + 0.25 < eF;
    else {
      // wedge toward the opponent when backing away; for sideways moves keep whichever end is
      // already nearer to the direction of travel (no flip-flopping)
      const cb = Math.cos(mdir - brg);
      rev = cb < -0.3 ? true : (cb > 0.3 ? false : eR < eF);
    }
    const e = wrap((rev ? mdir + PI : mdir) - mh);
    turn = steer(e, 0);
    let vdes = flow ? vmax : Math.sqrt(9 * gD); if (vdes > vmax) vdes = vmax;
    const axisErr = Math.abs(wrap(mdir - dir0));
    if (!flow) vdes *= axisErr < 1.4 ? Math.cos(axisErr) : 0.17;
    const al = Math.abs(e);
    if (flow) { if (al > 0.5) vdes *= al > 1.4 ? 0.45 : 1 - 0.6 * (al - 0.5); }
    else if (al > 1.0) vdes = 0; else if (al > 0.35) vdes *= (1.0 - al) / 0.65;
    const vs = rev ? -vdes : vdes;
    thrust = clamp(vs / 5 + 1.2 * (vs - vLong), -1, 1);
  }

  // Caught slow with the opponent about to arrive: never offer a flank or the rear.
  // Instead of standing and soaking a push: leave along my own axis, away from the opponent, and
  // swing that axis toward open ground once I am moving (a J-turn when backing off nose-first).
  if (opActive && !covered && orbDir === 0 && mySpeed < 2.0 && tHit < 0.8 && dist < 4.5) {
    const am = Math.abs(myErr);
    const away = brg + PI;
    // how far the escape direction may deviate from "straight away": grows with my retreat speed
    let room = ray(mx, my, -ux, -uy, 3, 0.3, 0.6);
    let off = clamp((-vMeToOp - 0.6) * 0.7, 0, 1.3);
    if (room < 2.2 && off < 0.3 + (2.2 - room) * 0.6) off = 0.3 + (2.2 - room) * 0.6;
    let dev;
    if (pa !== null) dev = clamp(wrap(pa - away), -off, off);
    else {
      const a1 = away + 1.0, a2 = away - 1.0;
      dev = ray(mx, my, Math.cos(a1), Math.sin(a1), 3, 0.3, 0.6) >= ray(mx, my, Math.cos(a2), Math.sin(a2), 3, 0.3, 0.6) ? off : -off;
    }
    const esc = away + dev;
    if (am <= 1.35) { thrust = -1; turn = steer(wrap(esc + PI - mh), 0); }
    else if (am >= 2.0) { thrust = 1; turn = steer(wrap(esc - mh), 0); }
    else {
      const fwd = ray(mx, my, ch, sh, 2.4, 0.3, 0.6), bck = ray(mx, my, -ch, -sh, 2.4, 0.3, 0.6);
      if (fwd >= bck) { thrust = 1; turn = steer(wrap(esc - mh), 0); }
      else { thrust = -1; turn = steer(wrap(esc + PI - mh), 0); }
    }
    mode += '+lmd';
  }

  // Opponent wedge pressed on my flank: slide out along my own axis instead of soaking the drain.
  if (inContact && opActive && dist < 1.5 && lc.opponentWedge && !lc.selfWedge) {
    const fwd = ray(mx, my, ch, sh, 2.4, 0.3, 0.6), bck = ray(mx, my, -ch, -sh, 2.4, 0.3, 0.6);
    const toward = ch * ux + sh * uy;
    thrust = fwd - toward * 1.2 >= bck + toward * 1.2 ? 1 : -1;
    mode += '+clinch';
  }

  // ---------- safety filter ----------
  const marg = inContact ? 0.32 : 0.22;
  // Roll my own dynamics forward (2-tick steps): hold (u, r) for n1 steps, then brake to a stop.
  // Returns how deep the path gets into a deadly zone (0 = clear).
  function roll(u, r, n1, nMax) {
    let x = mx, y = my, th = mh, vx = mvx, vy = mvy, w = mw;
    let c = ch, s = sh;
    let worst = 0, tA = 0, d = 0;
    const h = 1 / 30;
    for (let k = 0; k < nMax; k++) {
      let uu = u, rr = r;
      if (k >= n1) {
        const vl = vx * c + vy * s;
        if (vl < 0.25 && vl > -0.25) break;
        uu = vl > 0 ? -1 : 1;
        rr = w > 0.667 ? -1 : (w < -0.667 ? 1 : -1.5 * w);
      }
      vx += (8 * uu * c - 1.6 * vx) * h; vy += (8 * uu * s - 1.6 * vy) * h;
      x += vx * h; y += vy * h;
      w += (5.4 * rr - 1.8 * w) * h; th += w * h;
      c = Math.cos(th); s = Math.sin(th);
      const vl2 = vx * c + vy * s, vt2 = (vy * c - vx * s) * 0.0225;
      vx = vl2 * c - vt2 * s; vy = vl2 * s + vt2 * c;
      tA += h;
      d = hazD(NH, hNext - hDrop * tA, x, y, tA, marg);
      if (d > worst) worst = d;
    }
    // already inside a margin zone: only what goes deeper than where I stand counts as risk
    return (worst > d0 ? worst - d0 : 0) + 0.3 * (d > d0 ? d - d0 : 0) + (d0 > 0 && d >= d0 ? 0.02 : 0);
  }
  const d0 = hazD(NH, hNext, mx, my, 0, marg);
  const risk = roll(thrust, turn, 2, 15);
  if (risk > 0.001) {
    const br = vLong > 0.3 ? -1 : (vLong < -0.3 ? 1 : 0);
    // with someone on my tail, steering round the hazard beats braking in front of it
    const pb = opActive && tHit < 1.2 ? 0.05 : 0;
    const t1 = turn >= 0 ? 1 : -1, hold = pb > 0 ? 13 : 6;
    // candidates: thrust, turn, steps held before the braking check, penalty
    const cand = [thrust, t1, hold, 0, thrust, -t1, hold, 0, br, 0, 2, pb, br, t1, 2, pb, br, -t1, 2, pb,
      1, 0, 3, 0, -1, 0, 3, 0, 0, turn, 2, pb];
    let bestRisk = risk, bu = thrust, bt = turn;
    for (let i = 0; i < cand.length; i += 4) {
      const rk = roll(cand[i], cand[i + 1], cand[i + 2], 13) + cand[i + 3];
      if (rk < bestRisk - 1e-4) { bestRisk = rk; bu = cand[i]; bt = cand[i + 1]; if (rk <= 0.001) break; }
    }
    thrust = bu; turn = bt; mode += '!';
    // blocked beside the hole I am using as cover: give that hole up for a while
    if (oc !== null && mySpeed < 0.7) { sk++; if (sk > 10) { bh = [oc[0], oc[1], tickN + 300]; sk = 0; } }
  } else if (sk > 0) sk--;

  if (freeze && mode === 'full') { thrust = 0; turn = 0; }
  if (!(thrust >= -1 && thrust <= 1)) thrust = 0;
  if (!(turn >= -1 && turn <= 1)) turn = 0;
  const out = { ag: ag, vt: vTop, gx: igx, gy: igy, rc: rcid, ss: stSide, sg: mode === 'strikeGo' ? 1 : 0, pa: pa, oc: oc, od: od, ld: ld, bh: bh, sk: sk, nh: nh, ot: ot, np: np, ac: ac, fa: fa, ec: ec, fg: fg, ch: chased ? 1 : 0, pk: pk, pf: pf, om: orbDir !== 0 || holdTan ? 1 : 0 };
  if (DBG) out.dbg = mode + dbgx + ' g(' + gx.toFixed(1) + ',' + gy.toFixed(1) + ') oc' + (oc ? oc[0] + ',' + oc[1] : '-') + ' ag' + ag.toFixed(2) + ' tH' + tHit.toFixed(2);
  return { actions: { thrust: thrust, turn: turn }, memory: out };
}
