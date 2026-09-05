// sonnet-5-max
// Reactive vector-field controller. Every tick sums a handful of named force vectors (goal
// attraction, hazard/wall/flame repulsion, opponent interaction) into one steering command, plus
// a separate weighted blend of target headings. No multi-tick rollout, no named-state cascade:
// the sum recomputed fresh each tick is the whole decision. Memory carries only a few numbers
// that smooth an otherwise noisy choice (which side to circle, where "home" is).
//
// Facts about rules 0.2.2 that the field weights are built around:
//   - Energy never regenerates on its own. 300 total, 0.5/s drains regardless of action, only a
//     charger pickup (up to 60, 8s cooldown per cell) adds any back. Spend like it is the only
//     money you will ever see.
//   - A shove in sustained contact carries both robots together at roughly the pusher's closing
//     speed. A hazard that is far away right now can still be the thing that kills me in three
//     seconds if I let the corridor behind me stay open while someone leans on me.
//   - Solid floor fails after 12 robot-seconds of standing load, 6 if shared. A "safe" tile now
//     may not be safe in ten seconds.
//   - Timeout is decided by fewer flips, then more energy, then closer to center.
export function tick(s, mem) {
  const TAU = 6.283185307179586, PI = 3.141592653589793;
  const wrap = (a) => a - TAU * Math.round(a / TAU);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const me = s.self, op = s.opponent;
  const M = mem && typeof mem === "object" ? mem : {};
  const t = s.time, timeLeft = 120 - t;
  const half = s.arena.nextHalfExtent;

  // ------------------------------------------------------------------ geometry
  const dx = op.x - me.x, dy = op.y - me.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  const ux = dx / dist, uy = dy / dist;
  const bearing = Math.atan2(dy, dx);
  const cosH = Math.cos(me.heading), sinH = Math.sin(me.heading);
  const vLong = me.vx * cosH + me.vy * sinH;
  const opSpeed = Math.sqrt(op.vx * op.vx + op.vy * op.vy);
  const mySpeed = Math.sqrt(me.vx * me.vx + me.vy * me.vy);
  const opTo = -(op.vx * ux + op.vy * uy);          // opponent speed toward me
  const opExposure = Math.abs(wrap(bearing + PI - op.heading)); // 0 = their wedge faces me
  const opActive = op.status === "active";
  const opFlipped = op.status === "flipped";
  const dangerous = opActive && op.energy > 3;
  const eLead = me.energy - op.energy;

  // ------------------------------------------------------------------ terrain
  const hz = [], fl = [], ch = [];
  let myTileInteg = 1, myTileX = 0, myTileY = 0, sharedTile = false, onTile = false;
  for (let i = 0; i < s.arena.cells.length; i++) {
    const c = s.arena.cells[i];
    if (c.state === "inactive") continue;
    if (me.x >= c.x - 0.5 && me.x <= c.x + 0.5 && me.y >= c.y - 0.5 && me.y <= c.y + 0.5) {
      onTile = true; myTileInteg = c.integrity; myTileX = c.x; myTileY = c.y;
      sharedTile = op.x >= c.x - 0.5 && op.x <= c.x + 0.5 && op.y >= c.y - 0.5 && op.y <= c.y + 0.5;
    }
    const open = c.type === "hole" || c.state === "hole";
    const doomed = c.collapseIn !== null && c.collapseIn !== undefined;
    if (open || doomed) { hz.push({ x: c.x, y: c.y, t: open ? 0 : c.collapseIn }); continue; }
    if (c.type === "flame") {
      if (c.state === "flaming") fl.push({ x: c.x, y: c.y, on: 1, at: c.timeUntilChange === null ? 1.5 : c.timeUntilChange });
      else if (c.state === "warning") fl.push({ x: c.x, y: c.y, on: 0, at: c.timeUntilChange === null ? 0 : c.timeUntilChange });
    } else if (c.type === "recharge") {
      ch.push({ x: c.x, y: c.y, wait: c.state === "ready" ? 0 : (c.timeUntilChange === null ? 0 : c.timeUntilChange) });
    }
  }
  const nHz = hz.length, nCh = ch.length;

  // Ray to the nearest wall or fatal cell from (px,py) heading (sx,sy) (unit vector).
  const runway = (px, py, sx, sy) => {
    let r = 1e9;
    if (sx > 1e-6) r = Math.min(r, (half - px) / sx);
    if (sx < -1e-6) r = Math.min(r, (-half - px) / sx);
    if (sy > 1e-6) r = Math.min(r, (half - py) / sy);
    if (sy < -1e-6) r = Math.min(r, (-half - py) / sy);
    for (let i = 0; i < nHz; i++) {
      const rx = hz[i].x - px, ry = hz[i].y - py;
      const along = rx * sx + ry * sy, off = Math.abs(-rx * sy + ry * sx);
      if (along > 0.3 && off < 0.6 && along - 0.5 < r) r = along - 0.5;
    }
    return r < 0 ? 0 : r;
  };
  const insideAt = (x, y, m) => Math.abs(x) < half - m && Math.abs(y) < half - m;

  // ------------------------------------------------------- energy price curve
  // What one unit of thrust/turn is "worth" spending right now, given what is left to spend for
  // the rest of the match and a reserve that still buys a way out of trouble.
  const spendable = (me.energy - 40) / (timeLeft > 2 ? timeLeft : 2);
  let price = 1.7 / (spendable > 0.45 ? spendable : 0.45);
  if (me.energy < 70) price *= 2.3;
  if (me.energy < 28) price *= 2.6;
  price = clamp(price, 0.35, 7);

  // -------------------------------------------------------- force accumulator
  // Every concern below adds an (fx, fy) push/pull. The sum is the direction and rough urgency of
  // where the body wants to go this tick; it is not a target point, it is a vote.
  let fx = 0, fy = 0;

  // Home pull: mild attraction toward a station near the center, recomputed on a slow cadence and
  // nudged whenever the tile under it wears out, so the bot is not forever fighting a stale point.
  let homeX = typeof M.hx === "number" ? M.hx : 0, homeY = typeof M.hy === "number" ? M.hy : 0;
  const homeStale = s.tick % 24 === 0 || !insideAt(homeX, homeY, 1.3) ||
    (Math.abs(homeX - myTileX) < 0.6 && Math.abs(homeY - myTileY) < 0.6 && myTileInteg < 0.5);
  if (homeStale) {
    let best = -1e9;
    for (let k = 0; k < 9; k++) {
      const ang = (k - 1) * 0.7853981633974483, rad = k === 0 ? 0 : 2.1;
      const cx = k === 0 ? 0 : Math.cos(ang) * rad, cy = k === 0 ? 0 : Math.sin(ang) * rad;
      if (!insideAt(cx, cy, 1.4)) continue;
      let sc = -0.7 * Math.sqrt(cx * cx + cy * cy);
      let dead = false;
      for (let i = 0; i < nHz; i++) {
        const d2 = Math.max(Math.abs(cx - hz[i].x), Math.abs(cy - hz[i].y));
        if (d2 < 1.0) { dead = true; break; }
        if (d2 < 2.0) sc -= 3;
      }
      if (dead) continue;
      if (Math.abs(cx - myTileX) < 0.6 && Math.abs(cy - myTileY) < 0.6 && myTileInteg < 0.5) sc -= 20;
      if (sc > best) { best = sc; homeX = cx; homeY = cy; }
    }
  }
  {
    const hdx = homeX - me.x, hdy = homeY - me.y, hd = Math.sqrt(hdx * hdx + hdy * hdy);
    if (hd > 0.35) { const w = 3.4 / (1 + hd * 0.15); fx += (hdx / hd) * w; fy += (hdy / hd) * w; }
  }

  // Wall repulsion: grows sharply inside the last couple of metres, using where the boundary will
  // be, not where it is now, since it is always shrinking.
  {
    const marginX = half - Math.abs(me.x), marginY = half - Math.abs(me.y);
    if (marginX < 3.0) { const w = 72 / (marginX < 0.12 ? 0.12 : marginX); fx += -Math.sign(me.x || 1) * w; }
    if (marginY < 3.0) { const w = 72 / (marginY < 0.12 ? 0.12 : marginY); fy += -Math.sign(me.y || 1) * w; }
  }

  // Fatal-cell repulsion. A cell along the corridor directly behind me, on the line an opponent
  // closing on me would push me along, counts as far closer than its real distance: that corridor
  // is exactly what a sustained shove turns into a few seconds later, and by the time contact
  // starts it is too late to react to it as a surprise.
  const shoveClosing = dangerous && opTo > 0.3 ? clamp(opTo, 0, 2.6) : 0;
  for (let i = 0; i < nHz; i++) {
    const hxr = hz[i].x - me.x, hyr = hz[i].y - me.y;
    let d = Math.sqrt(hxr * hxr + hyr * hyr);
    if (d < 0.02) d = 0.02;
    const along = -(hxr * ux + hyr * uy);   // positive = behind me, roughly on the push line
    const off = Math.abs(-hxr * uy + hyr * ux);
    if (shoveClosing > 0.15 && along > 0 && off < 1.0) {
      const boost = 1 + shoveClosing * (1.0 - off) * 1.8;
      d = d / boost;
    }
    const cutoff = hz[i].t < 0.6 ? 3.4 : 2.4;
    if (d < cutoff) {
      const w = 34 * (1 / d - 1 / cutoff);
      fx += -(hxr / (d || 1)) * w; fy += -(hyr / (d || 1)) * w;
    }
  }
  if (onTile && myTileInteg < 0.5) {
    // Repel from the center of my own failing tile; degenerate only if standing exactly on it,
    // in which case fall back to current velocity direction.
    let rx = me.x - myTileX, ry = me.y - myTileY;
    let rl = Math.sqrt(rx * rx + ry * ry);
    if (rl < 0.05) { rx = vLong >= 0 ? cosH : -cosH; ry = vLong >= 0 ? sinH : -sinH; rl = 1; }
    const w = 40 * (1 - myTileInteg);
    fx += (rx / rl) * w; fy += (ry / rl) * w;
  }

  // Flame repulsion, active or about to be.
  for (let i = 0; i < fl.length; i++) {
    const burning = fl[i].on ? true : fl[i].at < 1.0;
    if (!burning) continue;
    const hxr = fl[i].x - me.x, hyr = fl[i].y - me.y;
    const d = Math.sqrt(hxr * hxr + hyr * hyr) || 0.02;
    if (d < 1.8) { const w = 14 * (1 / d - 1 / 1.8); fx += -(hxr / d) * w; fy += -(hyr / d) * w; }
  }

  // Charger attraction: only worth it unspent capacity exists, the path is not wasted on a robot
  // already full, and the opponent is not clearly going to beat me there while dangerous.
  let bestCh = -1, bestChScore = -1e9;
  for (let i = 0; i < nCh; i++) {
    if (!insideAt(ch[i].x, ch[i].y, 0.1)) continue;
    const cd = Math.sqrt((ch[i].x - me.x) ** 2 + (ch[i].y - me.y) ** 2);
    const od = Math.sqrt((ch[i].x - op.x) ** 2 + (ch[i].y - op.y) ** 2);
    const eta = cd / 2.3 + 0.3;
    const wait = ch[i].wait - eta;
    if (wait > 2.5) continue;
    const gain = Math.min(60, 300 - me.energy);
    if (gain < 10) continue;
    const contested = dangerous && od < cd + 1.2 ? 20 : 0;
    const sc = gain - 10 * cd - 8 * Math.max(0, wait) - contested;
    if (sc > bestChScore) { bestChScore = sc; bestCh = i; }
  }
  if (bestCh >= 0) {
    const cx = ch[bestCh].x, cy = ch[bestCh].y;
    const cdx = cx - me.x, cdy = cy - me.y, cd = Math.sqrt(cdx * cdx + cdy * cdy) || 0.02;
    const need = clamp((300 - me.energy) / 60, 0.3, 1);
    const w = (dangerous && dist < 3.2 ? 14 : 26) * need;
    fx += (cdx / cd) * w; fy += (cdy / cd) * w;
  }

  // Opponent interaction. Exactly one of these three regimes applies each tick.
  let attackLeadX = 0, attackLeadY = 0, wantHit = false;
  let huntNow = !!M.hn;
  let circleSide = typeof M.sd === "number" ? M.sd : 1;
  let pinnedEscX = 0, pinnedEscY = 0, pinned = false;
  if (opFlipped) {
    // Push it along its own axis toward whichever edge or hazard sits closer that way, from
    // directly behind that line. Free four seconds of work if there is time to reach it.
    const oc = Math.cos(op.heading), os = Math.sin(op.heading);
    const room = (sx, sy) => runway(op.x, op.y, sx, sy);
    const rp = room(oc, os), rm = room(-oc, -os);
    const plus = rp <= rm, pdx = plus ? oc : -oc, pdy = plus ? os : -os, need = plus ? rp : rm;
    const flipTime = op.statusTimer + (op.energy < 25 ? 3 : 0);
    const standX = op.x - pdx * 1.1, standY = op.y - pdy * 1.1;
    const standD = Math.sqrt((standX - me.x) ** 2 + (standY - me.y) ** 2);
    if (need < 5.5 && me.energy > 35 && standD / 2.2 + need / 2.4 + 0.4 < flipTime && insideAt(standX, standY, 0.3)) {
      const gx = standD < 0.5 ? op.x + pdx * 0.9 - me.x : standX - me.x;
      const gy = standD < 0.5 ? op.y + pdy * 0.9 - me.y : standY - me.y;
      const gd = Math.sqrt(gx * gx + gy * gy) || 0.02;
      fx += (gx / gd) * 44; fy += (gy / gd) * 44;
      attackLeadX = pdx; attackLeadY = pdy; wantHit = true;
    } else {
      // Not worth the trip: give it room and let its own timer run out.
      const gx = op.x - ux * 2.2 - me.x, gy = op.y - uy * 2.2 - me.y;
      const gd = Math.sqrt(gx * gx + gy * gy) || 0.02;
      fx += (gx / gd) * 6; fy += (gy / gd) * 6;
    }
  } else {
    pinned = dangerous && dist < 1.3;
    if (pinned) {
      const pushAng = Math.atan2(-uy, -ux);
      let bestSc = -1e9;
      for (let k = 0; k < 12; k++) {
        const ang = k * 0.5235987755982988;
        if (Math.abs(wrap(ang - pushAng)) < 0.8) continue;
        const ex = Math.cos(ang), ey = Math.sin(ang);
        const room = runway(me.x, me.y, ex, ey);
        if (room < 1.1) continue;
        const reach = clamp(room - 0.3, 0.6, 3.0);
        const tx = me.x + ex * reach, ty = me.y + ey * reach;
        const sc = Math.min(room, 4.5) - Math.sqrt(tx * tx + ty * ty);
        if (sc > bestSc) { bestSc = sc; pinnedEscX = ex; pinnedEscY = ey; }
      }
      if (bestSc <= -1e8) pinned = false;
    }
    // Live opponent: an intercept when the flank is open and I can afford it, otherwise a
    // spring toward a standoff ring, plus a slow tangential drift toward their weak side.
    let hunting = !!M.hn;
    if (opActive && op.energy < 12 && eLead > 55 && me.energy > 85) hunting = true;
    if (!opActive || op.energy > 45 || me.energy < 40) hunting = false;
    huntNow = hunting;

    const lead = clamp(dist / 7.5, 0.02, 0.22);
    const leadX = op.x + op.vx * lead, leadY = op.y + op.vy * lead;
    const leadDist = Math.sqrt((leadX - me.x) ** 2 + (leadY - me.y) ** 2) || 1e-6;
    const leadBear = Math.atan2(leadY - me.y, leadX - me.x);
    const leadErr = Math.abs(wrap(leadBear - me.heading));
    const clearShot = insideAt(leadX, leadY, 0.6);
    const canHit = dangerous && dist < 3.6 && leadErr < 0.5 && opExposure > 0.75 && me.energy > 30 && clearShot;

    if (pinned && !opFlipped) {
      fx += pinnedEscX * 42; fy += pinnedEscY * 42;
    } else if (canHit || hunting) {
      let gx, gy;
      if (canHit) { gx = leadX - me.x; gy = leadY - me.y; }
      else {
        const oc = Math.cos(op.heading), os = Math.sin(op.heading);
        const cross = (me.x - op.x) * os - (me.y - op.y) * oc;
        const side = cross >= 0 ? 1 : -1;
        const rx = op.x - oc * 1.9, ry = op.y - os * 1.9;
        gx = rx - me.x + os * side * 0.5; gy = ry - me.y - oc * side * 0.5;
      }
      const gd = Math.sqrt(gx * gx + gy * gy) || 0.02;
      const w = canHit ? 50 : 20;
      fx += (gx / gd) * w; fy += (gy / gd) * w;
      wantHit = canHit;
    } else if (dangerous && dist < 6.5) {
      // Spring toward a standoff ring plus a mild tangential drift, softer as danger rises so a
      // fast, aligned charge gets a real repulsion instead of a token one. Capped: this is a local
      // correction near the ring, not a summons from across the arena.
      const standoff = 2.4;
      const radial = clamp(dist - standoff, -2.6, 2.6);
      const threatening = opExposure < 0.9 && opTo > 1.0;
      const rw = threatening ? -(2.6 - Math.min(dist, 2.6)) * 10 - 6 : radial * 4;
      fx += ux * rw; fy += uy * rw;
      if (!threatening) {
        const leftRoom = runway(me.x, me.y, -uy, ux), rightRoom = runway(me.x, me.y, uy, -ux);
        if (circleSide > 0 && rightRoom > leftRoom + 1.2) circleSide = -1;
        else if (circleSide < 0 && leftRoom > rightRoom + 1.2) circleSide = 1;
        fx += -uy * circleSide * 4.2; fy += ux * circleSide * 4.2;
      }
    } else {
      // Harmless neighbour: nearly ignore it, tiny separation only if we are touching.
      if (dist < 1.15) { fx += -ux * 6; fy += -uy * 6; }
    }
  }

  // Endgame: ahead on the tiebreak ladder in the last stretch, weight everything toward safety
  // and the center instead of opportunity.
  const flipLead = op.flipsTaken - me.flipsTaken;
  const winningOnTime = flipLead > 0 || (flipLead === 0 && eLead > 25);
  if (timeLeft < 20 && winningOnTime) {
    fx *= 0.5; fy *= 0.5;
    fx += -me.x * 0.9; fy += -me.y * 0.9;
  }

  // -------------------------------------------------------------- heading law
  // Desired heading is a weighted circular mean of a few directions, not simply "face the net
  // force": the wedge discipline (face the threat) has to hold even while the body is moving away
  // from it, and a shove-in-progress needs the heading locked to the push line, not the goal.
  let hx = 0, hy = 0;
  const forceAng = Math.atan2(fy, fx), forceMag = Math.sqrt(fx * fx + fy * fy);
  hx += Math.cos(forceAng) * Math.min(forceMag, 6) * 0.55;
  hy += Math.sin(forceAng) * Math.min(forceMag, 6) * 0.55;

  if (wantHit && opFlipped) {
    const pushAng = Math.atan2(attackLeadY, attackLeadX);
    hx += Math.cos(pushAng) * 7; hy += Math.sin(pushAng) * 7;
  } else if (wantHit) {
    const lead = clamp(dist / 7.5, 0.02, 0.22);
    const leadBear = Math.atan2(op.y + op.vy * lead - me.y, op.x + op.vx * lead - me.x);
    hx += Math.cos(leadBear) * 6; hy += Math.sin(leadBear) * 6;
  } else if (dangerous) {
    if (pinned) {
      // Escape and wedge safety both matter here: give up neither. A dumb opponent that is
      // simply leaning on me gets walked toward daylight; a sharp one that is lining up a hit
      // still meets a wedge, not a flank.
      const escAng = Math.atan2(pinnedEscY, pinnedEscX);
      hx += Math.cos(escAng) * 3; hy += Math.sin(escAng) * 3;
      hx += Math.cos(bearing) * 6; hy += Math.sin(bearing) * 6;
    } else {
      const faceW = dist < 3.6 ? 5.5 : dist < 6 ? 2.4 : 0.7;
      hx += Math.cos(bearing) * faceW; hy += Math.sin(bearing) * faceW;
    }
  }
  const desiredHeading = (hx === 0 && hy === 0) ? me.heading : Math.atan2(hy, hx);
  const headErr = wrap(desiredHeading - me.heading);

  // ----------------------------------------------------------------- steering
  let turn = clamp(headErr * 3.2 - me.omega * (dist < 1.3 ? 1.25 : 0.75), -1, 1);
  const align = Math.cos(headErr);
  let rawThrust = clamp(forceMag / 14, 0, 1) * clamp((align - 0.15) / 0.85, 0, 1);
  // Reverse is often the efficient way to reach a goal that sits behind the current heading.
  if (Math.abs(headErr) > PI * 0.62 && !wantHit && !(dangerous && dist < 2.0)) {
    const revErr = wrap(headErr + PI);
    turn = clamp(revErr * 3.2 - me.omega * 0.75, -1, 1);
    rawThrust = -clamp(forceMag / 14, 0, 1) * clamp((Math.cos(revErr) - 0.15) / 0.85, 0, 1);
  }
  // A near-static clinch: turning to line up with the escape heading is resisted by continuous
  // contact and can crawl for seconds while the collision itself keeps billing energy. Waiting
  // for good alignment before spending any thrust is how that stall happens; a small unconditional
  // reverse breaks contact first, and heading can catch up once there is room to actually move.
  if (pinned && Math.abs(rawThrust) < 0.15 && mySpeed < 0.4) rawThrust = -0.42;
  let thrust = rawThrust / (price > 1 ? Math.sqrt(price) : 1);
  if (me.energy <= 0) { thrust = 0; turn = 0; }

  // ------------------------------------------------------------------- safety
  // Cheap exact projection, a fifth of a second, damping thrust down (then reversing it) before
  // ever accepting a command that would cross an opening tile or the moving boundary.
  const project = (th, tu) => {
    let x = me.x, y = me.y, hd = me.heading, w = me.omega, v = vLong;
    for (let k = 0; k < 11; k++) {
      w += (5.4 * tu - 1.8 * w) / 60;
      hd += w / 60;
      v += (8 * th - 1.6 * v) / 60;
      x += v * Math.cos(hd) / 60; y += v * Math.sin(hd) / 60;
      if (Math.abs(x) > half - 0.13 || Math.abs(y) > half - 0.13) return false;
      for (let i = 0; i < nHz; i++)
        if (hz[i].t < k / 60 + 0.22 && Math.abs(x - hz[i].x) < 0.53 && Math.abs(y - hz[i].y) < 0.53) return false;
    }
    return true;
  };
  if (!project(thrust, turn)) {
    if (project(thrust * 0.4, turn)) thrust *= 0.4;
    else if (project(0, turn)) thrust = 0;
    else {
      const back = vLong > 0.2 ? -1 : vLong < -0.2 ? 1 : 0;
      thrust = back !== 0 ? back : 0;
      const toC = wrap(Math.atan2(-me.y, -me.x) - me.heading);
      turn = clamp((Math.abs(toC) < PI / 2 ? toC : wrap(toC + PI)) * 3 - me.omega * 0.7, -1, 1);
    }
  }

  return {
    actions: { thrust: clamp(thrust, -1, 1), turn: clamp(turn, -1, 1) },
    memory: { hx: homeX, hy: homeY, hn: huntNow, sd: circleSide },
  };
}
