// fable-5-6-max (rules 0.2.2)
// Doctrine: never fall (edge, holes, collapses), never show the flank at speed, spend little,
// pick up charges when they are worth 60, and punish clear openings: exhausted, flipped or
// rear-exposed opponents. Written for a cheap tick: arithmetic wrap, one pass over cells.
export function tick(s, m) {
  const PI = Math.PI, TAU = 2 * Math.PI;
  const wrap = (a) => a - TAU * Math.round(a / TAU);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const me = s.self, op = s.opponent;
  const mem = m && typeof m === "object" ? m : {};
  const t = s.time;
  const h = s.arena.nextHalfExtent;
  const hSoon = Math.max(3, h - (t > 58 ? 0.08 : 0));
  const timeLeft = 120 - t;

  // ---------- Geometry.
  const dx = op.x - me.x, dy = op.y - me.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  const ux = dx / dist, uy = dy / dist;
  const bearing = Math.atan2(dy, dx);
  const myErr = wrap(bearing - me.heading);
  const opErr = wrap(bearing + PI - op.heading);
  const opAbs = Math.abs(opErr);
  const cosH = Math.cos(me.heading), sinH = Math.sin(me.heading);
  const vLong = me.vx * cosH + me.vy * sinH;
  const myTo = me.vx * ux + me.vy * uy;
  const opTo = -(op.vx * ux + op.vy * uy);
  const closing = myTo + opTo;
  const ax = Math.abs(me.x), ay = Math.abs(me.y);
  const myOut = ax > ay ? ax : ay;
  const opOut = Math.max(Math.abs(op.x), Math.abs(op.y));
  const myR = Math.sqrt(me.x * me.x + me.y * me.y);
  const opActive = op.status === "active";
  const opFlipped = op.status === "flipped";
  const eAdv = me.energy - op.energy;
  const inContact = dist < 1.25;
  const near = dist < 4.6;

  // ---------- One pass over the arena cells.
  // Hazards are squares the center must never cross: holes and announced collapses.
  const hz = []; // {x, y}
  const fire = []; // grates warning or burning
  const chargers = []; // {x, y, ready, wait}
  let myCell = null, opCell = null;
  const cells = s.arena.cells;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.state === "inactive") continue;
    const onMe = Math.abs(me.x - c.x) <= 0.5 && Math.abs(me.y - c.y) <= 0.5;
    const onOp = Math.abs(op.x - c.x) <= 0.5 && Math.abs(op.y - c.y) <= 0.5;
    if (onMe) myCell = c;
    if (onOp) opCell = c;
    if (c.type === "hole" || c.state === "hole" || (c.collapseIn !== null && c.collapseIn !== undefined)) {
      if (hz.length < 24) hz.push(c);
    } else if (c.type === "flame") {
      if (c.state === "flaming" || (c.state === "warning" && c.timeUntilChange !== null && c.timeUntilChange < 1.2)) fire.push(c);
    } else if (c.type === "recharge") {
      chargers.push({ x: c.x, y: c.y, ready: c.state === "ready", wait: c.state === "ready" ? 0 : c.timeUntilChange ?? 8 });
    }
  }
  // Segment (ax,ay)->(bx,by) crosses the square of cell c grown by margin g.
  const hits = (c, x0, y0, x1, y1, g) => {
    const r = 0.5 + g;
    // Starting inside the grown square: only moving deeper counts as blocked.
    const sx0 = Math.abs(x0 - c.x), sy0 = Math.abs(y0 - c.y);
    if (sx0 <= r && sy0 <= r) {
      const sx1 = Math.abs(x1 - c.x), sy1 = Math.abs(y1 - c.y);
      return (sx1 <= 0.52 && sy1 <= 0.52) || Math.max(sx1, sy1) < Math.max(sx0, sy0) - 0.02;
    }
    let enter = 0, leave = 1;
    let lo = c.x - r, hi = c.x + r, d = x1 - x0;
    if (Math.abs(d) < 1e-9) { if (x0 < lo || x0 > hi) return false; }
    else { const a = (lo - x0) / d, b = (hi - x0) / d; enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b)); if (enter > leave) return false; }
    lo = c.y - r; hi = c.y + r; d = y1 - y0;
    if (Math.abs(d) < 1e-9) { if (y0 < lo || y0 > hi) return false; }
    else { const a = (lo - y0) / d, b = (hi - y0) / d; enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b)); if (enter > leave) return false; }
    return true;
  };
  const blocked = (x0, y0, x1, y1, g, avoidFire) => {
    for (let i = 0; i < hz.length; i++) if (hits(hz[i], x0, y0, x1, y1, g)) return true;
    if (avoidFire) for (let i = 0; i < fire.length; i++) if (hits(fire[i], x0, y0, x1, y1, 0.05)) return true;
    return false;
  };
  // Free distance from (px,py) along unit (sx,sy): edge of the square and first hazard.
  const roomAlong = (px, py, sx, sy, lim) => {
    let r = 1e9;
    if (sx > 1e-6) r = Math.min(r, (lim - px) / sx);
    if (sx < -1e-6) r = Math.min(r, (-lim - px) / sx);
    if (sy > 1e-6) r = Math.min(r, (lim - py) / sy);
    if (sy < -1e-6) r = Math.min(r, (-lim - py) / sy);
    for (let i = 0; i < hz.length; i++) {
      const c = hz[i];
      // Ray-square entry distance (square grown by 0.1).
      const q = 0.6;
      let tmin = -1e9, tmax = 1e9;
      if (Math.abs(sx) < 1e-9) { if (px < c.x - q || px > c.x + q) continue; }
      else { const a = (c.x - q - px) / sx, b = (c.x + q - px) / sx; tmin = Math.max(tmin, Math.min(a, b)); tmax = Math.min(tmax, Math.max(a, b)); }
      if (Math.abs(sy) < 1e-9) { if (py < c.y - q || py > c.y + q) continue; }
      else { const a = (c.y - q - py) / sy, b = (c.y + q - py) / sy; tmin = Math.max(tmin, Math.min(a, b)); tmax = Math.min(tmax, Math.max(a, b)); }
      if (tmax >= Math.max(0, tmin) && tmax > 0) r = Math.min(r, Math.max(0, tmin));
    }
    return r;
  };
  const insideSoon = (x, y, margin) => Math.abs(x) < hSoon - margin && Math.abs(y) < hSoon - margin;

  // ---------- Steering helpers (hazard aware).
  const faceAngle = (ang, gain) => clamp(wrap(ang - me.heading) * gain - me.omega * 0.7, -1, 1);
  // Errors under about 7 degrees are corrected with turn <= 0.05 (cheap); larger with a capped PD.
  const faceCtl = (ang, gain, cap) => {
    const e = wrap(ang - me.heading);
    if (Math.abs(e) < 0.12 && Math.abs(me.omega) < 0.45) return clamp(e * 1.2 - me.omega * 0.4, -0.05, 0.05);
    return clamp(e * gain - me.omega * 0.7, -cap, cap);
  };
  // Pick a safe travel direction toward a goal; null when everything nearby is blocked.
  const safeDir = (gx, gy, avoidFire) => {
    const gdx = gx - me.x, gdy = gy - me.y;
    const gd = Math.sqrt(gdx * gdx + gdy * gdy);
    if (gd < 0.03) return null;
    const base = Math.atan2(gdy, gdx);
    const L = Math.min(gd, 2.0) + 0.35;
    const offs = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, 2.6, -2.6];
    for (let i = 0; i < offs.length; i++) {
      const a = base + offs[i];
      const ex = me.x + Math.cos(a) * L, ey = me.y + Math.sin(a) * L;
      if (!insideSoon(ex, ey, 0.35)) continue;
      if (!blocked(me.x, me.y, ex, ey, 0.22, avoidFire)) return a;
    }
    return null;
  };
  let rev = false;
  const driveTo = (tx, ty, power, allowReverse, avoidFire) => {
    const a = safeDir(tx, ty, avoidFire);
    if (a === null) return { turn: 0, thrust: 0 };
    const e = wrap(a - me.heading);
    if (allowReverse && Math.abs(e) > PI / 2 + (mem.rev ? -0.5 : 0.5)) {
      const er = wrap(e + PI);
      rev = true;
      return { turn: clamp(er * 3 - me.omega * 0.7, -1, 1), thrust: Math.abs(er) < 0.5 ? -power : Math.abs(er) < 1 ? -power * 0.3 : 0 };
    }
    return { turn: clamp(e * 3 - me.omega * 0.7, -1, 1), thrust: Math.abs(e) < 0.4 ? power : Math.abs(e) < 1 ? power * 0.3 : 0 };
  };

  // Aim point: lead a little so the contact stays inside the wedge.
  const lead = clamp(dist / 8, 0.02, 0.2);
  const aimX = op.x + op.vx * lead, aimY = op.y + op.vy * lead;
  const aimBearing = near ? Math.atan2(aimY - me.y, aimX - me.x) : bearing;
  const aimErr = wrap(aimBearing - me.heading);

  const opDanger = opActive && op.energy > 4;
  const dangerClose = opDanger && (dist < 3.5 || (closing > 1.5 && dist < 5.5));

  // Recovery with hysteresis: at low energy only defend; there is no passive regeneration,
  // so this mostly means moving to a charger cheaply.
  let recovering = !!mem.rec;
  if (me.energy < 20) recovering = true;
  if (me.energy > 45) recovering = false;
  // Hunting with hysteresis: an exhausted opponent never recovers without a charger.
  let huntT = mem.hunt ? (mem.huntT || 0) + 1 : 0;
  let hunting = !!mem.hunt && opActive && op.energy < 12 && me.energy > 40 && huntT < 480 && myOut < hSoon - 1.1;
  const huntCd = mem.huntCd || 0;
  if (!hunting && opActive && op.energy < 6 && !recovering && me.energy >= 60 && s.tick > huntCd && myOut < hSoon * 0.6 && opOut < hSoon - 1.4 && dist < 5) { hunting = true; huntT = 0; }
  const nextCd = mem.hunt && !hunting ? s.tick + 480 : huntCd;

  let thrust = 0, turn = 0, mode = "hold";
  let nextMode = "hold", nextUntil = 0;
  const committed = (name) => mem.mode === name && s.tick < (mem.until || 0);

  // ---------- 0a. Coasting into a hazard: brake before anything else.
  const speed0 = Math.abs(vLong);
  const dir0x = vLong >= 0 ? cosH : -cosH, dir0y = vLong >= 0 ? sinH : -sinH;
  const stop0 = (speed0 > 0 ? speed0 / 1.6 - 3.125 * Math.log(1 + 0.2 * speed0) : 0) + 0.15;
  const insideHz0 = hz.some((c) => Math.abs(me.x - c.x) <= 0.5 && Math.abs(me.y - c.y) <= 0.5);
  const holeAhead0 = speed0 > 0.12 && !insideHz0 && blocked(me.x, me.y, me.x + dir0x * (stop0 + 0.2), me.y + dir0y * (stop0 + 0.2), 0.04, false);
  let urgent = false;
  if (holeAhead0) {
    urgent = true; mode = "brake";
    thrust = -Math.sign(vLong);
    turn = 0;
  }

  // ---------- 0. My own tile: announced collapse or fire means leave now.
  if (myCell && !urgent) {
    const collapsing = myCell.collapseIn !== null && myCell.collapseIn !== undefined;
    const burning = myCell.type === "flame" && (myCell.state === "flaming" || (myCell.state === "warning" && myCell.timeUntilChange !== null && myCell.timeUntilChange < 0.9));
    if (collapsing || burning) {
      urgent = true;
      mode = "exit";
      // Leave through the nearest side that is safe, preferring my own axis (no turning needed).
      const offX = me.x - myCell.x, offY = me.y - myCell.y;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      let best = null, bestScore = -1e9;
      for (let i = 0; i < 4; i++) {
        const [sx, sy] = dirs[i];
        const need = 0.55 - (offX * sx + offY * sy);
        const ex = me.x + sx * (need + 0.3), ey = me.y + sy * (need + 0.3);
        if (!insideSoon(ex, ey, 0.3)) continue;
        if (blocked(me.x, me.y, ex, ey, 0.1, false)) continue;
        const along = Math.abs(sx * cosH + sy * sinH); // 1 when aligned with my axis
        const score = -need * 2 + along * 1.5 - (Math.abs(ex - op.x) + Math.abs(ey - op.y) < 1.2 ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = { sx, sy, need }; }
      }
      if (best) {
        // A hazard touching my tile leaves no room for a curved start: align first, then go.
        let tight = false;
        for (let i = 0; i < hz.length; i++) if (Math.abs(hz[i].x - me.x) < 0.95 && Math.abs(hz[i].y - me.y) < 0.95) tight = true;
        const lim = tight ? 0.22 : 1.1;
        const a = Math.atan2(best.sy, best.sx);
        const e = wrap(a - me.heading);
        if (Math.abs(e) < PI / 2) { turn = clamp(e * 4 - me.omega * 0.8, -1, 1); thrust = Math.abs(e) < lim ? 1 : 0; }
        else { const er = wrap(e + PI); turn = clamp(er * 4 - me.omega * 0.8, -1, 1); thrust = Math.abs(er) < lim ? -1 : 0; }
      } else { const d = driveTo(0, 0, 1, true, false); turn = d.turn; thrust = d.thrust; }
    }
  }

  // ---------- 1. Opponent flipped: push it into a hole or over the edge, drain it, or wait behind.
  if (mode === "hold" && opFlipped) {
    const oc = Math.cos(op.heading), osn = Math.sin(op.heading);
    const dPlus = roomAlong(op.x, op.y, oc, osn, h), dMinus = roomAlong(op.x, op.y, -oc, -osn, h);
    const stuck = op.energy < 25 ? 1e3 : 0; // no charger, no self-righting
    const tLeft = op.statusTimer + stuck;
    const pushPlus = dPlus <= dMinus;
    const pdx = pushPlus ? oc : -oc, pdy = pushPlus ? osn : -osn;
    const pushDist = pushPlus ? dPlus : dMinus;
    const standX = op.x - pdx * 1.25, standY = op.y - pdy * 1.25;
    const standD = Math.sqrt((standX - me.x) ** 2 + (standY - me.y) ** 2);
    const behind = (me.x - op.x) * pdx + (me.y - op.y) * pdy < -0.45;
    const pushHeading = Math.atan2(pdy, pdx);
    const alignedToPush = Math.abs(wrap(pushHeading - me.heading)) < 0.35;
    const tReposition = standD / 2.2 + (behind && alignedToPush ? 0 : 0.8);
    // Pushing them along the ray must not take me into a hazard myself.
    const myRoom = roomAlong(me.x, me.y, pdx, pdy, h);
    const canRingOut = tReposition + pushDist / 2.3 + 0.3 < tLeft && me.energy > 20 + pushDist * 6 && myRoom > pushDist + 0.4;
    const canDrain = inContact && Math.abs(myErr) < 0.55 && me.energy > 90 && eAdv > 40 && op.energy > 2 && op.energy < 60;
    if (canRingOut) {
      mode = "push";
      if (behind && dist < 1.5 && alignedToPush) { turn = faceAngle(bearing, 3); thrust = 1; }
      else if (behind && dist < 1.5) { turn = faceAngle(pushHeading, 3); thrust = 0.5; }
      else {
        const d = driveTo(standX, standY, standD > 1.2 ? 1 : 0.6, false, true);
        turn = d.turn; thrust = d.thrust;
        if (dist < 1.1 && Math.abs(myErr) < 0.9) thrust = -0.4;
      }
    } else if (canDrain) {
      mode = "drain"; turn = faceAngle(bearing, 3); thrust = 1;
    } else {
      mode = "wait";
      const rearX = op.x - oc * 2.3, rearY = op.y - osn * 2.3;
      const rearD = Math.sqrt((rearX - me.x) ** 2 + (rearY - me.y) ** 2);
      if (rearD > 0.5 && !recovering && insideSoon(rearX, rearY, 0.6) && op.statusTimer > 0.6) {
        const d = driveTo(rearX, rearY, rearD > 1.5 ? 0.7 : 0.4, false, true);
        turn = d.turn; thrust = d.thrust;
        if (dist < 1.2 && Math.abs(myErr) < 1.0) thrust = -0.5;
      } else turn = faceCtl(bearing, 2, 0.4);
    }
  }

  // ---------- 2. Hunt an exhausted opponent: orbit to its rear, then strike.
  if (mode === "hold" && hunting) {
    mode = "hunt";
    const rel = wrap(bearing + PI - op.heading);
    const side = rel >= 0 ? 1 : -1;
    const rx = -ux, ry = -uy;
    const tx = -ry * side, ty = rx * side;
    if (inContact && Math.abs(myErr) < 1.1) {
      thrust = -0.7; turn = faceCtl(bearing, 2, 0.3);
    } else {
      const radial = clamp((dist - 2.3) * 0.9, -1, 1);
      const gx = me.x + (tx - rx * radial) * 1.5, gy = me.y + (ty - ry * radial) * 1.5;
      const d = driveTo(gx, gy, 0.6, false, true);
      turn = d.turn; thrust = d.thrust;
    }
  }

  // ---------- 3. Strike window: hit their side or rear before they can rotate it away.
  if ((mode === "hold" || mode === "hunt") && near && !opFlipped && !recovering && opActive) {
    const contactD = Math.max(0, dist - 0.72);
    const v0 = Math.max(0, myTo);
    const acc = 7;
    const tImp = contactD > 0 ? (-v0 + Math.sqrt(v0 * v0 + 2 * acc * contactD)) / acc : 0;
    const vImp = Math.min(5, v0 + acc * tImp) * 0.92;
    const closeImp = vImp + Math.min(opTo, 0) + Math.max(0, opTo) * 0.5;
    const wToward = -Math.sign(opErr) * op.omega;
    const E = op.energy + (op.energy > 0 ? 1.5 : 0.3), T = tImp + 0.05;
    const tau = Math.max(0, Math.min(T, E / 3));
    const ex = Math.exp(-1.8 * tau);
    const w = 3 * (1 - ex);
    const reach = 3 * tau - 1.6667 * (1 - ex) + (w * (1 - Math.exp(-1.8 * (T - tau)))) / 1.8 + Math.max(0, wToward) * Math.min(T, 0.5);
    const angleAtImpact = opAbs - reach;
    const lev = angleAtImpact > 2.53 ? 0.85 : angleAtImpact > 1.34 ? 1 : angleAtImpact > 0.8 ? 0.6 : 0;
    const safeTarget = insideSoon(aimX, aimY, 0.6) && !blocked(me.x, me.y, aimX, aimY, 0.15, false);
    const canFlip = lev > 0 && closeImp * lev * Math.cos(Math.min(0.5, Math.abs(aimErr))) > 2.95 && Math.abs(aimErr) < 0.5 && safeTarget && me.energy > 30 && dist < 4;
    const huntStrike = mode === "hunt" && opAbs > 2.5 && dist < 3.2 && dist > 1.4 && Math.abs(aimErr) < 0.25 && safeTarget && op.energy < 12;
    if (canFlip || huntStrike || (committed("strike") && opAbs > 1.35 && dist < 3 && Math.abs(aimErr) < 0.8 && safeTarget)) {
      mode = "strike";
      turn = clamp(aimErr * 4 - me.omega * 0.8, -1, 1);
      thrust = Math.abs(aimErr) < 0.5 ? 1 : 0.3;
      nextMode = "strike"; nextUntil = committed("strike") ? mem.until : s.tick + 45;
    } else if (mem.mode === "strike" && mode !== "hunt" && dist < 2 && closing > 2 && opAbs < 1.35) {
      thrust = -1; turn = faceAngle(aimBearing, 4);
    }
  }

  // ---------- 4. Shove: they stand next to a hole or the edge with me on the inside line.
  if (mode === "hold" && near && !opFlipped && !recovering && opActive) {
    const behindOp = roomAlong(op.x, op.y, ux, uy, hSoon); // free distance behind them along my push line
    const shoveOK = behindOp < 0.9 && dist < 2.6 && Math.abs(myErr) < 0.35 && me.energy > 40 && roomAlong(me.x, me.y, ux, uy, hSoon) > dist + 0.9;
    const shoveEnergy = eAdv > 60 && me.energy > 90 && opOut > hSoon - 1.5 && myOut < opOut - 0.7 && dist < 3 && Math.abs(myErr) < 0.5;
    if (shoveOK || shoveEnergy || (committed("shove") && dist < 2.2 && me.energy > 30)) {
      mode = "shove";
      turn = clamp(aimErr * 4 - me.omega * 0.8, -1, 1);
      thrust = Math.abs(aimErr) < 0.35 ? 1 : 0.2;
      nextMode = "shove"; nextUntil = committed("shove") ? mem.until : s.tick + (shoveOK ? 50 : 100);
    }
  }

  // ---------- 5. Hold: face them, manage energy and position, absorb pushes wisely.
  let resisting = false, leaving = false, nextHome, slideUntil = 0, slideSide = mem.slideSide || 1, backUntil = 0, shieldX = null, shieldY = null;
  let chargeTarget = null;
  if (mode === "hold") {
    turn = faceCtl(aimBearing, dangerClose ? 3.5 : 2, dangerClose ? 1 : opDanger ? 0.6 : 0.3);

    // Energy plan: a pickup is worth its full 60 only below 240. Late in the match the last
    // pickup should land as late as possible: every idle second costs 0.5.
    let best = null, bestCost = 1e9;
    for (let i = 0; i < chargers.length; i++) {
      const c = chargers[i];
      if (!insideSoon(c.x, c.y, -0.3)) continue;
      const cdx = c.x - me.x, cdy = c.y - me.y;
      const cd = Math.sqrt(cdx * cdx + cdy * cdy);
      const od = Math.sqrt((c.x - op.x) ** 2 + (c.y - op.y) ** 2);
      const eta = cd / 2.2 + 0.4;
      if (!c.ready && c.wait > eta + 1.5) continue; // not ready when I would arrive
      if (blocked(me.x, me.y, c.x, c.y, 0.2, true) && cd > 1.5) continue;
      let cost = cd + Math.max(0, c.wait - eta) * 1.5;
      if (opDanger && od < cd - 0.5 && od < 3) cost += 4; // they will get there first
      if (opDanger && od < 1.6) cost += 3; // contested ground
      if (cost < bestCost) { bestCost = cost; best = { ...c, cd, od, eta }; }
    }
    const wantFull = me.energy <= 240;
    const finale = timeLeft < 9;
    const deny = opDanger && op.energy < 110 && best && best.od < 4 && best.cd < best.od && best.cd < 5;
    let goCharge = false;
    if (best && !dangerClose) {
      if (finale) {
        // Aim the crossing at about 0.6 s before the end; wait at 1.3 m until then.
        const tNeeded = best.cd > 1.3 ? (best.cd - 1.3) / 2 + 1.0 : 0.9;
        goCharge = timeLeft < tNeeded + 0.6 || (best.cd > 1.4 && timeLeft > 2) || (opDanger && best.od < 2.2 && best.od < best.cd + 1);
        if (best.cd <= 1.4 && !goCharge && timeLeft >= tNeeded + 0.6) { chargeTarget = null; }
      } else if ((wantFull || deny) && best.cd < 7) goCharge = true;
      else if (me.energy <= 280 && best.cd < 1.6 && best.ready) goCharge = true;
    }
    if (goCharge) {
      mode = "charge";
      chargeTarget = best;
      // Drive through the center of the cell; the pickup happens on entry.
      const gx = best.x + (best.x - me.x) * 0.15, gy = best.y + (best.y - me.y) * 0.15;
      const power = best.cd > 3 ? 0.7 : 0.5;
      const d = driveTo(gx, gy, power, opDanger && dist < 6, true);
      turn = d.turn; thrust = d.thrust;
      if (!best.ready && best.cd < 1.3 && best.wait > 0.35) { thrust = 0; turn = faceCtl(aimBearing, 2, 0.3); } // hold off the cell until ready
    } else {
      // Position: a fresh central tile away from holes, nudged toward the opponent so a push
      // carries me across the arena. Switch tiles when mine wears down or becomes unsafe.
      const shared = opCell && myCell && opCell.id === myCell.id;
      // Leave a tile before it fails: alone it lasts 12 s, shared only 6 s.
      const worn = !!(myCell && myCell.integrity < (shared ? 0.55 : 0.25));
      const tileScore = (hx, hy) => {
        if (!insideSoon(hx, hy, 0.7)) return -1e9;
        let sc = -0.7 * Math.max(Math.abs(hx), Math.abs(hy));
        let sides = 0; // hazards on the four edge neighbours: two or more risk an island
        for (let i = 0; i < hz.length; i++) {
          const ddx = Math.abs(hz[i].x - hx), ddy = Math.abs(hz[i].y - hy);
          if (ddx < 0.6 && ddy < 0.6) return -1e9;
          if (ddx < 1.6 && ddy < 1.6) { sc -= 2; if (ddx < 0.6 || ddy < 0.6) sides++; }
        }
        if (sides >= 2) sc -= 12; else if (sides === 1) sc -= 1;
        for (let i = 0; i < fire.length; i++) if (Math.abs(fire[i].x - hx) < 0.6 && Math.abs(fire[i].y - hy) < 0.6) sc -= 3;
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i];
          if (Math.abs(c.x - hx) < 0.6 && Math.abs(c.y - hy) < 0.6) { sc -= 5 * (1 - c.integrity); if (c.type === "recharge") sc -= 1.5; if (c.type === "flame") sc -= 2; }
        }
        if (Math.abs(op.x - hx) < 0.6 && Math.abs(op.y - hy) < 0.6) sc -= 3;
        return sc;
      };
      let home = typeof mem.home === "number" ? mem.home : -1;
      let hx = home >= 0 ? (home % 4) - 1.5 : 1e9, hy = home >= 0 ? Math.floor(home / 4) - 1.5 : 1e9;
      const onHome = home >= 0 && Math.abs(me.x - hx) <= 0.5 && Math.abs(me.y - hy) <= 0.5;
      const curScore = home >= 0 ? tileScore(hx, hy) : -1e9;
      const reeval = home < 0 || curScore < -50 || (worn && onHome) || s.tick % 12 === 0;
      let bk = -1, bs = -1e9, bx = 0, by = 0;
      if (reeval) for (let k = 0; k < 16; k++) {
        const cx = (k % 4) - 1.5, cy = Math.floor(k / 4) - 1.5;
        if (worn && Math.abs(me.x - cx) <= 0.5 && Math.abs(me.y - cy) <= 0.5) continue;
        const sc = tileScore(cx, cy) - 0.3 * (Math.abs(cx - me.x) + Math.abs(cy - me.y));
        if (sc > bs) { bs = sc; bk = k; bx = cx; by = cy; }
      }
      // Relocate when the current tile is worn, unsafe, or clearly worse than the best option.
      if (bk >= 0 && (home < 0 || curScore < -50 || (worn && onHome) || bs > curScore + 3.5)) { home = bk; hx = bx; hy = by; }
      // Hole shield: with the opponent far and coming, stand just beyond a hole on its line.
      if (reeval && opDanger && dist > 1.6 && opTo > 0.6 && hz.length) {
        let sx0 = 0, sy0 = 0, sbest = 1e9;
        for (let i = 0; i < hz.length; i++) {
          const c = hz[i];
          const vx0 = c.x - op.x, vy0 = c.y - op.y, vl = Math.sqrt(vx0 * vx0 + vy0 * vy0) || 1;
          if (vl > dist + 1.5 || vl < 1.2) continue;
          const px = c.x + (vx0 / vl) * 1.5, py = c.y + (vy0 / vl) * 1.5;
          const tsc = tileScore(Math.floor(px) + 0.5, Math.floor(py) + 0.5);
          if (tsc < -50 || !insideSoon(px, py, 0.8)) continue;
          const dme = Math.sqrt((px - me.x) ** 2 + (py - me.y) ** 2);
          if (dme > (opTo > 1.2 ? 7 : 4) || dme > vl - 0.3) continue;
          if (dme < sbest) { sbest = dme; sx0 = px; sy0 = py; }
        }
        if (sbest < 1e9) { hx = sx0; hy = sy0; shieldX = sx0; shieldY = sy0; }
      } else if (!reeval && typeof mem.shx === "number" && opDanger && dist > 1.4 && opTo > 0.4) { hx = mem.shx; hy = mem.shy; shieldX = hx; shieldY = hy; }
      nextHome = home;
      const shift = opDanger ? Math.min(0.25, dist / 20) : 0;
      const goalX = hx + ux * shift, goalY = hy + uy * shift;
      const goalD = Math.sqrt((goalX - me.x) ** 2 + (goalY - me.y) ** 2);
      const wantD = dangerClose && !worn ? 1.2 : 0.35;
      const leave = (inContact || (mem.leaving && dist < 2.2)) && !opDanger && me.energy > 8 && (myOut > hSoon * 0.45 || goalD > 1.5 || mem.leaving);
      leaving = !!leave;
      if (leave) { thrust = -0.5; turn = faceCtl(bearing, 2, 0.3); }
      else if (goalD > wantD && !recovering) {
        if (!dangerClose || worn) {
          const d = driveTo(goalX, goalY, goalD > 2.5 ? 0.6 : 0.4, opDanger && dist < 7, true);
          turn = d.turn; thrust = d.thrust;
        } else if (myR > 1.6) {
          const toC = wrap(Math.atan2(goalY - me.y, goalX - me.x) - me.heading);
          if (Math.abs(toC) < 0.8 && !blocked(me.x, me.y, me.x + cosH, me.y + sinH, 0.2, false)) thrust = 0.3;
          else if (Math.abs(wrap(toC + PI)) < 0.8 && !blocked(me.x, me.y, me.x - cosH, me.y - sinH, 0.2, false)) thrust = -0.3;
        }
      } else if (goalD > wantD && recovering && !opDanger) {
        const gb = Math.atan2(goalY - me.y, goalX - me.x);
        const toC = wrap(gb - me.heading);
        if (Math.abs(toC) < 0.6 && !blocked(me.x, me.y, me.x + cosH * 0.8, me.y + sinH * 0.8, 0.2, false)) thrust = 0.05;
        else if (Math.abs(wrap(toC + PI)) < 0.6 && !blocked(me.x, me.y, me.x - cosH * 0.8, me.y - sinH * 0.8, 0.2, false)) thrust = -0.05;
      }
    }
    if (!inContact && s.tick < (mem.slideUntil || 0) && opDanger && dist < 2.4) {
      // Finish the sideways slide away from the push line, then face them again.
      mode = "slide"; slideUntil = mem.slideUntil; slideSide = mem.slideSide || 1;
      const d = driveTo(me.x - uy * 1.8 * slideSide + ux * 0.3, me.y + ux * 1.8 * slideSide + uy * 0.3, 0.8, true, true);
      turn = d.turn; thrust = d.thrust;
    }
    // A charger coming at me: step behind a hole if one is at hand, otherwise brace.
    const incoming = opTo > 1.5 && dist < 6 && opAbs < 1.0 && opDanger;
    if (incoming && !inContact && mode === "hold") {
      if (shieldX !== null && Math.hypot(shieldX - me.x, shieldY - me.y) > 0.4) {
        // Lead the chaser across the hole: run there forward while it is far (rear exposure only
        // at near-zero closing speed), reverse with the wedge on it when it is close.
        mode = "shield";
        const d = driveTo(shieldX, shieldY, dist > 3 ? 0.95 : 0.75, dist < 3, true);
        turn = d.turn; thrust = d.thrust;
      } else if (dist < 3.4 && opTo > 1.2 && !recovering) {
        // Keep the wedge on them and back away along a clear path; a chaser that follows a
        // straight line will meet the holes before it meets me.
        mode = "flee";
        const d = driveTo(me.x - ux * 2.5, me.y - uy * 2.5, 0.8, true, true);
        if (d.thrust !== 0 || d.turn !== 0) { turn = d.turn; thrust = d.thrust; }
        else { turn = faceAngle(aimBearing, 4); thrust = 0; }
      } else if (opTo > 2 && dist < 5) {
        turn = faceAngle(aimBearing, 4);
        thrust = myTo > 0.3 ? -Math.sign(vLong) * 0.8 : 0;
      }
    }
    // In contact: let them push me while they burn energy; resist as much as the room requires,
    // and never let a hole open up behind me.
    if (inContact && opDanger) {
      mode = "hold";
      const forward = Math.abs(myErr) < PI / 2;
      const sgn = forward ? 1 : -1;
      const roomBack = roomAlong(me.x, me.y, -ux, -uy, hSoon) - 0.9;
      const pushing = opTo > 0.05 || -myTo > 0.15 || closing > 0.3;
      turn = faceCtl(aimBearing, 3, 1);
      // Sustained contact bleeds both sides through impact costs, the pusher more than me.
      // Yield while there is room; slide out sideways (a committed manoeuvre) when it runs out.
      thrust = sgn * 0.05;
      const wornHere = !!(myCell && myCell.integrity < 0.55);
      if (pushing && roomBack < 1.5) { thrust = sgn; resisting = true; } // last resort: hold the line at the edge
      const committedSlide = s.tick < (mem.slideUntil || 0) && !pushing;
      if (committedSlide || (wornHere && !pushing && s.tick > (mem.slideCd || 0))) {
        let side = mem.slideSide || 1;
        if (!committedSlide) {
          const leftFree = !blocked(me.x, me.y, me.x - uy * 1.5, me.y + ux * 1.5, 0.15, false);
          const rightFree = !blocked(me.x, me.y, me.x + uy * 1.5, me.y - ux * 1.5, 0.15, false);
          const left = leftFree ? roomAlong(me.x, me.y, -uy, ux, hSoon) : 0, right = rightFree ? roomAlong(me.x, me.y, uy, -ux, hSoon) : 0;
          side = left >= right ? 1 : -1;
          slideUntil = s.tick + 45;
        } else slideUntil = mem.slideUntil;
        slideSide = side;
        const a = Math.atan2(ux * side, -uy * side);
        const e = wrap(a - me.heading);
        if (Math.abs(e) < PI / 2) { turn = clamp(e * 4 - me.omega * 0.8, -1, 1); thrust = Math.abs(e) < 1.0 ? 1 : 0.2; }
        else { const er = wrap(e + PI); turn = clamp(er * 4 - me.omega * 0.8, -1, 1); thrust = Math.abs(er) < 1.0 ? -1 : -0.2; }
        mode = "slide";
      }
    } else if (inContact && !leaving && mode === "hold") {
      if (Math.abs(thrust) <= 0.05) thrust = Math.abs(myErr) < PI / 2 ? 0.05 : -0.05;
    }
  }

  // ---------- 6. Recovery: minimal spending unless a charger is the plan.
  if (recovering && mode === "hold" && !resisting) {
    if (!inContact && Math.abs(thrust) > 0.05 && !leaving) thrust = 0;
    if (dangerClose) turn = faceCtl(aimBearing, 2.5, 0.7);
    else turn = clamp(turn, -0.05, 0.05);
  }
  if (recovering && mode === "wait") { thrust = 0; turn = clamp(turn, -0.05, 0.05); }

  // ---------- 7. Safety override: never leave the square, never coast into a hole.
  if (!urgent) {
    const speed = Math.abs(vLong);
    const dirx = vLong >= 0 ? cosH : -cosH, diry = vLong >= 0 ? sinH : -sinH;
    const stop = (speed > 0 ? speed / 1.6 - 3.125 * Math.log(1 + 0.2 * speed) : 0) + 0.12;
    const sx = me.x + dirx * stop, sy = me.y + diry * stop;
    const hardLimit = hSoon - 0.3;
    const projOut = Math.max(Math.abs(sx), Math.abs(sy));
    const holeAhead = speed > 0.15 && blocked(me.x, me.y, sx + dirx * 0.2, sy + diry * 0.2, 0.05, false);
    const softLimit = dangerClose ? hSoon - 1.4 : hSoon - 0.9;
    if (projOut > hardLimit || holeAhead) {
      mode = "escape";
      const movingOut = speed > 0.25 && (holeAhead || me.vx * sx + me.vy * sy > 0);
      const power = me.energy < 3 ? 0.3 : 1;
      if (movingOut) {
        thrust = -Math.sign(vLong) * power;
        if (!holeAhead) {
          const toC = Math.atan2(-me.y, -me.x);
          turn = Math.abs(wrap(toC - me.heading)) < PI / 2 ? faceAngle(toC, 3) : faceAngle(toC + PI, 3);
        }
      } else {
        const d = driveTo(0, 0, power, true, false);
        thrust = d.thrust; turn = d.turn;
      }
      nextMode = "hold"; nextUntil = 0;
    } else if (myOut > softLimit && !resisting && mode !== "strike" && mode !== "push" && mode !== "shove" && mode !== "hunt" && mode !== "charge" && mode !== "slide" && mode !== "back" && mode !== "flee" && mode !== "shield" && !(inContact && opDanger)) {
      const urgentEdge = myOut > softLimit + 0.5;
      const cb = Math.atan2(-me.y, -me.x);
      const toC = wrap(cb - me.heading);
      const fwdFree = !blocked(me.x, me.y, me.x + cosH * 1.2, me.y + sinH * 1.2, 0.2, false);
      const bwdFree = !blocked(me.x, me.y, me.x - cosH * 1.2, me.y - sinH * 1.2, 0.2, false);
      if (recovering) {
        if (Math.abs(toC) < 0.7 && fwdFree) thrust = 0.05;
        else if (Math.abs(wrap(toC + PI)) < 0.7 && bwdFree) thrust = -0.05;
        else if (!dangerClose) { thrust = 0; turn = clamp(faceAngle(Math.abs(toC) < PI / 2 ? cb : cb + PI, 1), -0.25, 0.25); }
        if (urgentEdge && me.energy > 5) thrust = Math.abs(toC) < PI / 2 && fwdFree ? 0.4 : bwdFree ? -0.4 : 0;
      } else if (dist < 2.5 && !urgentEdge && opDanger) {
        thrust = Math.abs(toC) < PI / 2 && fwdFree ? 0.4 : bwdFree ? -0.4 : 0;
      } else {
        const d = driveTo(0, 0, urgentEdge ? 0.8 : 0.4, dist < 5 && opDanger, true);
        thrust = d.thrust; turn = d.turn;
      }
    }
  }

  // ---------- Final gate: thrust only along a clear axis (a hole beside me is one turn away).
  if (thrust > 0.06 || thrust < -0.06) {
    const sgn = thrust > 0 ? 1 : -1;
    const ahead = 0.45 + Math.abs(vLong) * 0.35;
    const insideHz = hz.some((c) => Math.abs(me.x - c.x) <= 0.5 && Math.abs(me.y - c.y) <= 0.5);
    if (!insideHz && blocked(me.x, me.y, me.x + cosH * sgn * ahead, me.y + sinH * sgn * ahead, 0.08, false)) {
      thrust = vLong * sgn > 0.2 ? -sgn * 0.6 : 0;
    }
  }

  return {
    actions: { thrust: clamp(thrust, -1, 1), turn: clamp(turn, -1, 1) },
    memory: { mode: nextMode, until: nextUntil, rec: recovering, hunt: hunting, huntT, huntCd: nextCd, rev, leaving, home: nextHome === undefined ? mem.home || 0 : nextHome, slideUntil, slideSide, slideCd: slideUntil > 0 ? slideUntil + 60 : (mem.slideCd || 0), backUntil, shx: shieldX, shy: shieldY },
  };
}
