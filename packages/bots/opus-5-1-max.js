// opus-5-1-max
// Receding-horizon controller. Every tick it rolls a short physics forecast forward for a small
// set of candidate commands and keeps the one with the best score. Terrain, the moving boundary,
// energy price and wedge geometry are all scored inside the same forecast, so there is no
// priority cascade to get out of order: the forecast decides.
//
// Rules 0.2.2 facts that shape the design:
//   - Energy never regenerates. Standing still buys nothing, it only avoids spending. The whole
//     economy is: start at 300, drain 0.5/s no matter what, collect 60 per charger pickup.
//   - Every solid tile fails after 12 robot-seconds, 6 if two robots share it. Camping is suicide.
//   - A timeout is decided by flips, then energy, then distance from the center.
export function tick(s, mem) {
  const TAU = 6.283185307179586, PI = 3.141592653589793;
  const wrap = (a) => a - TAU * Math.round(a / TAU);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const me = s.self, op = s.opponent;
  const M = mem && typeof mem === "object" ? mem : {};
  const time = s.time, timeLeft = 120 - time;
  const half = s.arena.nextHalfExtent;

  // ---------------------------------------------------------------- geometry
  const dx = op.x - me.x, dy = op.y - me.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  const ux = dx / dist, uy = dy / dist;
  const bearing = Math.atan2(dy, dx);
  const cosH = Math.cos(me.heading), sinH = Math.sin(me.heading);
  const vLong = me.vx * cosH + me.vy * sinH;
  const opSpeed = Math.sqrt(op.vx * op.vx + op.vy * op.vy);
  const opTo = -(op.vx * ux + op.vy * uy);
  const opExposure = Math.abs(wrap(bearing + PI - op.heading));
  const opActive = op.status === "active";
  const opFlipped = op.status === "flipped";
  const eLead = me.energy - op.energy;

  // ------------------------------------------------------------ terrain scan
  // Fatal cells carry the time left before the floor is gone: 0 for an open hole, the announced
  // countdown for a warning tile. A warning tile is still solid until then and may be crossed.
  const hzX = [], hzY = [], hzT = [];
  const flX = [], flY = [], flOn = [], flAt = [];
  const chX = [], chY = [], chW = [];
  let myInteg = 1, myCellX = 0, myCellY = 0, sharedTile = false;
  const cells = s.arena.cells;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.state === "inactive") continue;
    if (me.x >= c.x - 0.5 && me.x <= c.x + 0.5 && me.y >= c.y - 0.5 && me.y <= c.y + 0.5) {
      myInteg = c.integrity; myCellX = c.x; myCellY = c.y;
      sharedTile = op.x >= c.x - 0.5 && op.x <= c.x + 0.5 && op.y >= c.y - 0.5 && op.y <= c.y + 0.5;
    }
    const open = c.type === "hole" || c.state === "hole";
    const doomed = c.collapseIn !== null && c.collapseIn !== undefined;
    if (open || doomed) { hzX.push(c.x); hzY.push(c.y); hzT.push(open ? 0 : c.collapseIn); continue; }
    if (c.type === "flame") {
      if (c.state === "flaming") { flX.push(c.x); flY.push(c.y); flOn.push(1); flAt.push(c.timeUntilChange === null ? 1.5 : c.timeUntilChange); }
      else if (c.state === "warning") { flX.push(c.x); flY.push(c.y); flOn.push(0); flAt.push(c.timeUntilChange === null ? 0 : c.timeUntilChange); }
    } else if (c.type === "recharge") {
      chX.push(c.x); chY.push(c.y);
      chW.push(c.state === "ready" ? 0 : (c.timeUntilChange === null ? 0 : c.timeUntilChange));
    }
  }
  const nHz = hzX.length, nFl = flX.length, nCh = chX.length;
  const insideAt = (x, y, margin) => Math.abs(x) < half - margin && Math.abs(y) < half - margin;
  // Straight-line reachability, used only to pick goals; the forecast does the real checking.
  const pathClear = (tx, ty, margin) => {
    const px = tx - me.x, py = ty - me.y;
    const len = Math.sqrt(px * px + py * py);
    if (len < 0.05) return true;
    const steps = len > 5 ? 10 : 6, sx = px / steps, sy = py / steps;
    for (let k = 1; k <= steps; k++) {
      const qx = me.x + sx * k, qy = me.y + sy * k;
      for (let i = 0; i < nHz; i++)
        if (Math.abs(qx - hzX[i]) < 0.5 + margin && Math.abs(qy - hzY[i]) < 0.5 + margin) return false;
    }
    return true;
  };
  const runway = (px, py, sx, sy) => {
    let r = 1e9;
    if (sx > 1e-6) r = Math.min(r, (half - px) / sx);
    if (sx < -1e-6) r = Math.min(r, (-half - px) / sx);
    if (sy > 1e-6) r = Math.min(r, (half - py) / sy);
    if (sy < -1e-6) r = Math.min(r, (-half - py) / sy);
    for (let i = 0; i < nHz; i++) {
      const rx = hzX[i] - px, ry = hzY[i] - py;
      const along = rx * sx + ry * sy, sideOff = Math.abs(-rx * sy + ry * sx);
      if (along > 0.3 && sideOff < 0.62 && along - 0.5 < r) r = along - 0.5;
    }
    return r < 0 ? 0 : r;
  };
  const hazardNear = (x, y, r) => {
    for (let i = 0; i < nHz; i++)
      if (Math.abs(x - hzX[i]) < r && Math.abs(y - hzY[i]) < r) return true;
    return false;
  };

  // ------------------------------------------------------- opponent forecast
  // Their heading holds and drag decays their speed; good enough over half a second.
  const opCos = opSpeed > 0.01 ? op.vx / opSpeed : Math.cos(op.heading);
  const opSin = opSpeed > 0.01 ? op.vy / opSpeed : Math.sin(op.heading);
  const opAt = (tt) => {
    const travel = opSpeed > 0.01 ? (opSpeed / 1.6) * (1 - Math.exp(-1.6 * tt)) : 0;
    return [op.x + opCos * travel, op.y + opSin * travel];
  };

  // -------------------------------------------------------------- objectives
  // A goal is a point plus the weights saying how much the forecast should care about reaching it,
  // about keeping the wedge on the opponent, and about the price of the commands.
  // Spendable energy per remaining second, keeping a reserve that still buys an escape.
  const affordable = (me.energy - 45) / (timeLeft > 2 ? timeLeft : 2);
  let priceScale = 1.6 / (affordable > 0.5 ? affordable : 0.5);
  if (priceScale > 6) priceScale = 6; else if (priceScale < 0.3) priceScale = 0.3;
  if (me.energy < 70) priceScale *= 2.2;
  if (me.energy < 30) priceScale *= 2.5;
  let goalX, goalY, wGoal = 1.2, wFace = 2.2, wCost = 0.34, plan = "guard";
  const dangerous = opActive && op.energy > 3;
  const engaged = dangerous && dist < 3.6;
  const charging = dangerous && opTo > 1.6 && dist < 6 && opExposure < 1.0;

  // Energy plan. With no regeneration the pickups are the whole budget, so a charger is worth a
  // detour whenever it is not wasted and I can be there before or together with the opponent.
  let bestCh = -1, bestChScore = -1e9, bestChD = 0;
  for (let i = 0; i < nCh; i++) {
    const cdx = chX[i] - me.x, cdy = chY[i] - me.y;
    const cd = Math.sqrt(cdx * cdx + cdy * cdy);
    const od = Math.sqrt((chX[i] - op.x) * (chX[i] - op.x) + (chY[i] - op.y) * (chY[i] - op.y));
    if (!insideAt(chX[i], chY[i], 0.15)) continue;
    if (cd > 1.2 && !pathClear(chX[i], chY[i], 0.18)) continue;
    const eta = cd / 2.4 + 0.3;
    const wait = chW[i] - eta;
    if (wait > 2.5) continue;
    const gain = Math.min(60, 300 - me.energy);
    if (gain < 12) continue;
    // Denying a charger to a starving opponent is worth almost as much as taking it.
    const deny = dangerous && op.energy < 140 && od < cd + 1.5 ? 26 : 0;
    const desperate = me.energy < 110 ? 0.25 : 1;
    const risk = ((engaged ? 22 : 0) + (od < 1.8 && dangerous ? 18 : 0)) * desperate;
    const score = gain + deny - 11 * cd - 9 * Math.max(0, wait) - risk;
    if (score > bestChScore) { bestChScore = score; bestCh = i; bestChD = cd; }
  }

  // A station to hold when nothing else is pressing: near the center, clear of hazards, on floor
  // that still has life in it. Recomputed on a slow cadence and kept in memory in between.
  let stX = typeof M.stX === "number" ? M.stX : 0, stY = typeof M.stY === "number" ? M.stY : 0;
  if (s.tick % 20 === 0 || hazardNear(stX, stY, 1.0) || !insideAt(stX, stY, 1.4)) {
    let bs = -1e9;
    for (let k = 0; k < 13; k++) {
      const ang = (k - 1) * 0.7853981633974483;
      const rad = k <= 8 ? 1.7 : 2.9;
      const cx = k === 0 ? 0 : Math.cos(ang) * rad, cy = k === 0 ? 0 : Math.sin(ang) * rad;
      if (!insideAt(cx, cy, 1.5)) continue;
      let sc = -0.8 * Math.sqrt(cx * cx + cy * cy);
      let blocked = false;
      for (let i = 0; i < nHz; i++) {
        const ddx = Math.abs(cx - hzX[i]), ddy = Math.abs(cy - hzY[i]);
        if (ddx < 1.0 && ddy < 1.0) { blocked = true; break; }
        if (ddx < 2.0 && ddy < 2.0) sc -= 3;
      }
      if (blocked) continue;
      for (let i = 0; i < nFl; i++) if (Math.abs(cx - flX[i]) < 1.0 && Math.abs(cy - flY[i]) < 1.0) sc -= 8;
      for (let i = 0; i < nCh; i++) if (Math.abs(cx - chX[i]) < 0.9 && Math.abs(cy - chY[i]) < 0.9) sc -= 2;
      // Prefer somewhere I am not already standing: the tile under me is the one wearing out.
      if (Math.abs(cx - myCellX) < 0.6 && Math.abs(cy - myCellY) < 0.6 && myInteg < 0.55) sc -= 25;
      sc -= 0.45 * Math.sqrt((cx - me.x) * (cx - me.x) + (cy - me.y) * (cy - me.y));
      const dop = Math.sqrt((cx - op.x) * (cx - op.x) + (cy - op.y) * (cy - op.y));
      sc += dangerous ? 0.85 * (dop < 5 ? dop : 5) : 0;
      if (sc > bs) { bs = sc; stX = cx; stY = cy; }
    }
  }
  goalX = stX; goalY = stY;

  // Worn floor forces a move even when the station is exactly where I stand.
  const wornOut = myInteg < (sharedTile ? 0.5 : 0.22);
  if (wornOut && Math.abs(goalX - me.x) < 0.7 && Math.abs(goalY - me.y) < 0.7) {
    let bx = me.x, by = me.y, bd = -1e9;
    for (let k = 0; k < 8; k++) {
      const ang = k * 0.7853981633974483;
      const cx = me.x + Math.cos(ang) * 1.25, cy = me.y + Math.sin(ang) * 1.25;
      if (!insideAt(cx, cy, 1.0) || hazardNear(cx, cy, 0.95)) continue;
      const sc = -Math.sqrt(cx * cx + cy * cy);
      if (sc > bd) { bd = sc; bx = cx; by = cy; }
    }
    goalX = bx; goalY = by; plan = "shift";
  }

  if (bestCh >= 0 && (!engaged || bestChD < 2.6 || me.energy < 150)) {
    goalX = chX[bestCh]; goalY = chY[bestCh]; plan = "harvest";
    // A pickup is 60 energy: worth spending real energy to reach, and worth ignoring the wedge
    // discipline for, as long as the opponent is not already on top of me.
    wGoal = 3.2; wFace = dangerous && dist < 3.2 ? 1.8 : 0.4;
    wCost = me.energy < 150 ? 0.06 : 0.18;
  }

  // A flipped opponent is four seconds of free work: shove it toward whichever edge or hole sits
  // closest along its own axis, taking position directly behind that push line.
  if (opFlipped) {
    const oc = Math.cos(op.heading), os = Math.sin(op.heading);
    const room = (sx, sy) => {
      let r = 1e9;
      if (sx > 1e-6) r = Math.min(r, (half - op.x) / sx);
      if (sx < -1e-6) r = Math.min(r, (-half - op.x) / sx);
      if (sy > 1e-6) r = Math.min(r, (half - op.y) / sy);
      if (sy < -1e-6) r = Math.min(r, (-half - op.y) / sy);
      for (let i = 0; i < nHz; i++) {
        const rx = hzX[i] - op.x, ry = hzY[i] - op.y;
        const along = rx * sx + ry * sy, side = Math.abs(-rx * sy + ry * sx);
        if (along > 0.4 && side < 0.55) r = Math.min(r, along - 0.45);
      }
      return r;
    };
    const rp = room(oc, os), rm = room(-oc, -os);
    const plus = rp <= rm;
    const pdx = plus ? oc : -oc, pdy = plus ? os : -os;
    const need = plus ? rp : rm;
    const flipTime = op.statusTimer + (op.energy < 25 ? 3 : 0);
    const standX = op.x - pdx * 1.15, standY = op.y - pdy * 1.15;
    const standD = Math.sqrt((standX - me.x) * (standX - me.x) + (standY - me.y) * (standY - me.y));
    const feasible = need < 5.5 && me.energy > 40 && standD / 2.2 + need / 2.4 + 0.4 < flipTime;
    if (feasible && insideAt(standX, standY, 0.3)) {
      const lined = standD < 0.55 || Math.abs(wrap(Math.atan2(pdy, pdx) - me.heading)) < 0.4;
      goalX = lined ? op.x + pdx * 0.9 : standX;
      goalY = lined ? op.y + pdy * 0.9 : standY;
      plan = "shove"; wGoal = 3.4; wFace = 0.7; wCost = 0.1;
    } else {
      // Not worth the trip: keep a polite distance and let its own timer burn.
      goalX = op.x - ux * 2.2; goalY = op.y - uy * 2.2;
      plan = "wait"; wGoal = 0.9; wFace = 1.6; wCost = 0.5;
    }
  }

  // An opponent that cannot turn is a target: arrive on the side or the rear, where the lever is
  // worth 1.0 and 0.85 against 0.6 at the front.
  let hunting = !!M.hunt;
  if (opActive && op.energy < 12 && eLead > 60 && me.energy > 90) hunting = true;
  if (!opActive || op.energy > 45 || me.energy < 45) hunting = false;
  if (hunting && !opFlipped) {
    const oc = Math.cos(op.heading), os = Math.sin(op.heading);
    const cross = (me.x - op.x) * os - (me.y - op.y) * oc;
    const side = cross >= 0 ? 1 : -1;
    let aX, aY;
    if (opExposure > 1.9) { aX = op.x; aY = op.y; }
    else if (opExposure > 1.1) { aX = op.x - oc * 1.2 + os * side * 0.9; aY = op.y - os * 1.2 - oc * side * 0.9; }
    else { aX = op.x - os * side * 2.0; aY = op.y + oc * side * 2.0; }
    if (insideAt(aX, aY, 0.5) && !hazardNear(aX, aY, 0.75)) {
      goalX = aX; goalY = aY; plan = "hunt"; wGoal = 2.8; wFace = 1.4; wCost = 0.12;
    }
  }

  // Endgame arithmetic. A timeout goes to fewer flips, then more energy, then the center. Ahead on
  // both, the correct play is to stop taking risks and sit near the middle.
  const flipLead = op.flipsTaken - me.flipsTaken;
  const winningOnTime = flipLead > 0 || (flipLead === 0 && eLead > 25);
  if (timeLeft < 22 && winningOnTime && plan !== "shove" && plan !== "harvest") {
    goalX = stX * 0.35; goalY = stY * 0.35;
    plan = "hold"; wGoal = 2.2; wFace = engaged ? 2.6 : 1.0; wCost = 0.55;
  }
  const mustAct = timeLeft < 25 && !winningOnTime && flipLead <= 0 && eLead < 0 && bestCh < 0;

  // The line an approaching opponent would shove me along. If it ends at an edge or a hole within
  // a few metres, standing anywhere on it is the mistake; stepping off it early is cheap, and once
  // the shove starts there is no cheap way out at all.
  const pushRoom = runway(me.x, me.y, -ux, -uy);
  // Two different answers to pressure, and picking the wrong one loses the match.
  //
  // Turning away is fast but shows the flank, which is exactly what a wedge is looking for. It is
  // only right when the shove already has me and its line ends at an edge or a hole.
  //
  // Backing off keeps the wedge pointed at them the whole way and still opens the gap, because a
  // chaser has to spend to close it while I only spend to hold station. That is the default.
  const wantContact = opFlipped || (opActive && op.energy < 12 && me.energy > 90);
  const pinnedBadly = dist < 1.3 && opTo > 0.5 && pushRoom < 3.2;
  let escapeUntil = typeof M.esc === "number" ? M.esc : 0;
  let escX = typeof M.escX === "number" ? M.escX : 0, escY = typeof M.escY === "number" ? M.escY : 0;
  if (!wantContact && (pinnedBadly || s.tick < escapeUntil)) {
    if (s.tick >= escapeUntil) {
      let bestSc = -1e9, bx = 0, by = 0;
      const pushAng = Math.atan2(-uy, -ux);
      for (let k = 0; k < 12; k++) {
        const ang = k * 0.5235987755982988;
        if (Math.abs(wrap(ang - pushAng)) < 0.9) continue;
        const ex = Math.cos(ang), ey = Math.sin(ang);
        const room = runway(me.x, me.y, ex, ey);
        if (room < 1.3) continue;
        const reach = clamp(room - 0.35, 0.7, 2.8);
        const tx = me.x + ex * reach, ty = me.y + ey * reach;
        const sc = (room < 4 ? room : 4) - 1.15 * Math.sqrt(tx * tx + ty * ty);
        if (sc > bestSc) { bestSc = sc; bx = tx; by = ty; }
      }
      if (bestSc > -1e8) { escapeUntil = s.tick + 55; escX = bx; escY = by; }
      else escapeUntil = 0;
    }
    if (s.tick < escapeUntil) {
      goalX = escX; goalY = escY;
      plan = "sidestep"; wGoal = 4.5; wFace = 0.5; wCost = 0.05;
    }
  } else if (!wantContact && dangerous && dist < 3.2 && me.energy > 45) {
    // Retreat along whichever heading keeps room behind me and drifts back toward the middle,
    // while the forecast is told to hold the wedge on them.
    let bestSc = -1e9, bx = me.x - ux * 2.5, by = me.y - uy * 2.5;
    for (let k = 0; k < 8; k++) {
      const ang = Math.atan2(-uy, -ux) + (k % 2 === 0 ? 1 : -1) * (0.45 * ((k >> 1) + (k < 2 ? 0 : 1)));
      const ex = Math.cos(ang), ey = Math.sin(ang);
      const room = runway(me.x, me.y, ex, ey);
      if (room < 1.2) continue;
      const reach = clamp(room - 0.4, 0.8, 2.6);
      const tx = me.x + ex * reach, ty = me.y + ey * reach;
      const sc = (room < 4 ? room : 4) - 0.9 * Math.sqrt(tx * tx + ty * ty) - 0.8 * Math.abs(wrap(ang - Math.atan2(-uy, -ux)));
      if (sc > bestSc) { bestSc = sc; bx = tx; by = ty; }
    }
    goalX = bx; goalY = by;
    plan = "standoff"; wGoal = 3.0; wFace = 3.6; wCost = 0.09;
  }

  // Being charged with their wedge pointed at me is the one case always worth spending on: the
  // flank must never be the thing that meets them.
  if (charging && plan === "guard") { wFace = 4.2; wCost = 0.18; }
  else if (engaged && plan === "guard") wFace = 3.4;

  wCost *= priceScale;

  // -------------------------------------------------------- horizon forecast
  // Longitudinal-only model: lateral grip removes 85% of side velocity every tick, so within a few
  // ticks the robot travels along its heading. Drag and torque use the documented constants.
  const H = 6, HDT = 0.17;
  const opFX = [], opFY = [];
  for (let k = 1; k <= H; k++) { const p = opAt(k * HDT); opFX.push(p[0]); opFY.push(p[1]); }
  const THRUSTS = [1, 0.4, -0.55], TURNS = [1, 0.4, 0, -0.4, -1];
  const wantFlip = (plan === "hunt" || plan === "shove" || mustAct || (dangerous && opExposure > 1.25)) && me.energy > 35;
  const power = me.energy <= 0 ? 0 : 1;
  // In a sustained shove the two robots travel together, so the opponent speed along the contact
  // normal is the drift speed of the pair. One engine against two masses tops out at 2.5 m/s.
  const pushSpeed = dangerous ? clamp(opTo, 0, 2.6) : 0;
  const pinned = dist < 1.15 && pushSpeed > 0.35;
  // Roughly four seconds of runway is enough to keep coasting and let them pay for the push.
  const pushDanger = pinned && pushRoom < 4.5 * (pushSpeed > 0.3 ? pushSpeed : 0.3);

  let s1 = -1e30, t1 = 0, r1 = 0, s2 = -1e30, t2 = 0, r2 = 0, s3 = -1e30, t3 = 0, r3 = 0;
  for (let ti = 0; ti < 3; ti++) {
    const thr = THRUSTS[ti] * power;
    for (let ri = 0; ri < 5; ri++) {
      const trn = TURNS[ri] * power;
      let x = me.x, y = me.y, hd = me.heading, w = me.omega, v = vLong;
      let score = -wCost * (9 * thr * thr + 3 * trn * trn) * (H * HDT);
      let dead = false, flipBonus = 0;
      for (let k = 0; k < H; k++) {
        const tAt = (k + 1) * HDT;
        w += (5.4 * trn - 1.8 * w) * HDT;
        if (w > 4) w = 4; else if (w < -4) w = -4;
        hd += w * HDT;
        v += (8 * thr - 1.6 * v) * HDT;
        if (v > 5.2) v = 5.2; else if (v < -5.2) v = -5.2;
        const px = x, py = y;
        x += v * Math.cos(hd) * HDT; y += v * Math.sin(hd) * HDT;
        // The square shrinks under me, so measure against where the edge will be.
        const lim = half - 0.07 * tAt;
        if (Math.abs(x) > lim - 0.22 || Math.abs(y) > lim - 0.22) { score -= 4000 / (1 + k); dead = true; break; }
        // Fatal floor: a cell counts only if it is already open when I would be crossing it.
        const ax = px + (x - px) * 0.34, ay = py + (y - py) * 0.34;
        const bx2 = px + (x - px) * 0.67, by2 = py + (y - py) * 0.67;
        for (let i = 0; i < nHz; i++) {
          const cx = hzX[i], cy = hzY[i];
          if ((Math.abs(x - cx) < 0.58 && Math.abs(y - cy) < 0.58) ||
              (Math.abs(bx2 - cx) < 0.55 && Math.abs(by2 - cy) < 0.55) ||
              (Math.abs(ax - cx) < 0.55 && Math.abs(ay - cy) < 0.55)) {
            if (hzT[i] <= tAt + 0.4) { score -= 4000 / (1 + k); dead = true; } else score -= 30;
            break;
          }
        }
        if (dead) break;
        for (let i = 0; i < nFl; i++) {
          if (Math.abs(x - flX[i]) < 0.52 && Math.abs(y - flY[i]) < 0.52) {
            if (flOn[i] ? tAt < flAt[i] : tAt > flAt[i]) score -= 48 * HDT;
            break;
          }
        }
        // Contact geometry against the forecast opponent: my wedge on their flank is the prize,
        // their wedge on my flank is the thing to stay away from.
        const rx = opFX[k] - x, ry = opFY[k] - y;
        const rd = Math.sqrt(rx * rx + ry * ry) || 1e-6;
        if (rd < 0.95 && pushSpeed > 0.1) {
          // Carried along the contact normal. This is what turns a comfortable shove into a
          // ring-out several seconds later, and it is the only way the forecast can see it.
          const carry = pushSpeed * HDT;
          x -= (rx / rd) * carry; y -= (ry / rd) * carry;
        }
        if (rd < 2.2) {
          const mine = Math.abs(wrap(Math.atan2(ry, rx) - hd));
          const theirs = Math.abs(wrap(Math.atan2(-ry, -rx) - op.heading));
          if (rd < 1.35 && mine < 0.55 && theirs > 1.25 && opActive && wantFlip) {
            const lever = theirs > 2.53 ? 0.85 : 1;
            const closingNow = v * Math.cos(mine) + opTo;
            const b = 260 * Math.min(1, (closingNow * lever) / 2.6);
            if (b > flipBonus) flipBonus = b;
          }
          if (theirs < 0.61 && mine > 0.7 && dangerous && rd < 1.35) score -= 150 * (1.35 - rd);
          if (!wantFlip && dangerous) score -= 26 * (1.35 - rd);
        }
      }
      if (!dead) {
        score += flipBonus;
        const gdx = goalX - x, gdy = goalY - y;
        score -= wGoal * Math.sqrt(gdx * gdx + gdy * gdy);
        if (pushDanger) {
          // Getting out of the push line is worth more than any goal while it lasts.
          const away = Math.sqrt((opFX[H - 1] - x) * (opFX[H - 1] - x) + (opFY[H - 1] - y) * (opFY[H - 1] - y));
          score += 26 * Math.min(away, 2.6);
        }
        const fx = opFX[H - 1] - x, fy = opFY[H - 1] - y;
        score -= wFace * (dist < 5 ? 1 : 0.3) * Math.abs(wrap(Math.atan2(fy, fx) - hd));
        const outward = Math.abs(x) > Math.abs(y) ? Math.abs(x) : Math.abs(y);
        if (outward > half - 2.6) score -= 26 * (outward - (half - 2.6));
        if (timeLeft < 20) score -= 0.5 * Math.sqrt(x * x + y * y);
        if (wornOut && Math.abs(x - myCellX) < 0.5 && Math.abs(y - myCellY) < 0.5) score -= 22;
      }
      if (score > s1) { s3 = s2; t3 = t2; r3 = r2; s2 = s1; t2 = t1; r2 = r1; s1 = score; t1 = thr; r1 = trn; }
      else if (score > s2) { s3 = s2; t3 = t2; r3 = r2; s2 = score; t2 = thr; r2 = trn; }
      else if (score > s3) { s3 = score; t3 = thr; r3 = trn; }
    }
  }

  // -------------------------------------------------------------- safety net
  // The forecast is coarse. Before committing, walk the next fifth of a second exactly and refuse
  // a command that drives the center into an open hole or over the edge.
  const walkSafe = (thr, trn) => {
    let x = me.x, y = me.y, hd = me.heading, w = me.omega, v = vLong;
    for (let k = 0; k < 20; k++) {
      w += (5.4 * trn - 1.8 * w) / 60;
      hd += w / 60;
      v += (8 * thr - 1.6 * v) / 60;
      x += v * Math.cos(hd) / 60; y += v * Math.sin(hd) / 60;
      if (Math.abs(x) > half - 0.12 || Math.abs(y) > half - 0.12) return false;
      for (let i = 0; i < nHz; i++)
        if (hzT[i] < k / 60 + 0.2 && Math.abs(x - hzX[i]) < 0.52 && Math.abs(y - hzY[i]) < 0.52) return false;
    }
    return true;
  };
  let thrust = t1, turn = r1, bad = !walkSafe(t1, r1);
  if (bad && s2 > -1e29 && walkSafe(t2, r2)) { thrust = t2; turn = r2; bad = false; }
  if (bad && s3 > -1e29 && walkSafe(t3, r3)) { thrust = t3; turn = r3; bad = false; }
  if (bad) {
    // Kill the momentum first, then steer back inside over the following ticks.
    thrust = Math.abs(vLong) > 0.25 ? (vLong > 0 ? -1 : 1) : 0;
    const toC = wrap(Math.atan2(-me.y, -me.x) - me.heading);
    turn = clamp((Math.abs(toC) < PI / 2 ? toC : wrap(toC + PI)) * 3 - me.omega * 0.7, -1, 1);
  }

  return {
    actions: { thrust: clamp(thrust, -1, 1), turn: clamp(turn, -1, 1) },
    memory: { stX, stY, hunt: hunting, esc: escapeUntil, escX, escY },
  };
}
