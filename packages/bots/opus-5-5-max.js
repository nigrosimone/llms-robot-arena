// opus-5-5-max
//
// The rules that shape this controller:
//  1. falling is the only mistake that cannot be undone, so a hazard scan
//     filters the direction of every command before it is sent;
//  2. lateral grip means a robot only moves along its own axis, so while the
//     opponent is close enough to reach the flip threshold the wedge stays
//     on it and the only free axis is the line between the two;
//  3. on that line giving ground is cheap, but with the edge behind me
//     driving forward is the safe answer: wedge against wedge never flips,
//     and then the opponent is the one that has to give ground;
//  4. flips and then energy decide a timeout, so energy goes to runs that
//     really reach the flip threshold, to recharge cells and to escapes;
//  5. a controller that drives straight at its target can be parked on the
//     far side of an open hole.

const TAU = Math.PI * 2;

function wrapAngle(a) {
  let v = a;
  while (v > Math.PI) v -= TAU;
  while (v < -Math.PI) v += TAU;
  return v;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Leverage of a hit, from the angle between the target heading and the contact.
function leverageOf(a) {
  return a < 1.2217 ? 0.6 : a < 2.5307 ? 1 : 0.85;
}

export function tick(sensors, memory) {
  const me = sensors.self;
  const foe = sensors.opponent;
  const now = sensors.tick;
  const old = memory && typeof memory === "object" ? memory : null;
  let commit = old && typeof old.c === "number" ? old.c : -1;
  const lastDir = old && typeof old.d === "number" ? old.d : null;
  // No command is accepted while flipped: do not waste the tick.
  if (me.status === "flipped")
    return { actions: { thrust: 0, turn: 0 }, memory: { c: commit, d: lastDir } };

  const time = sensors.time;
  const half = sensors.arena.nextHalfExtent;
  const shrink = time > 58 ? 0.07 : 0;
  const speed = Math.hypot(me.vx, me.vy);

  const dx = foe.x - me.x;
  const dy = foe.y - me.y;
  let dist = Math.hypot(dx, dy);
  let ux = 1;
  let uy = 0;
  if (dist > 1e-6) {
    ux = dx / dist;
    uy = dy / dist;
  }
  if (dist < 0.05) dist = 0.05;
  const toFoe = Math.atan2(uy, ux);
  const aimFoe = wrapAngle(toFoe - me.heading);
  // Where I stand seen from the opponent nose: outside its wedge I can flip it.
  const relNow = wrapAngle(Math.atan2(-uy, -ux) - foe.heading);
  const helpless =
    foe.status === "flipped" ||
    (foe.energy <= 0.6 && Math.hypot(foe.vx, foe.vy) < 0.6);
  const lead = foe.flipsTaken - me.flipsTaken;

  // Time the opponent needs to cover the gap, against the time I would need
  // to put the wedge back on it. While it is ahead, turning away is not safe.
  const gap = dist - 0.78 > 0 ? dist - 0.78 : 0;
  const foeClosing = -(foe.vx * ux + foe.vy * uy);
  const reachTime = gap / (foeClosing + 1.5 > 0.6 ? foeClosing + 1.5 : 0.6);
  const locked =
    foe.status === "active" && !helpless && dist < 3.2 && reachTime < 0.45;

  // ---- arena reading --------------------------------------------------
  // Flat arrays keep the per tick allocation and the instruction budget low.
  // Openings and grates are few and always matter; worn floor is kept only
  // around me, where a look ahead can still reach it.
  const cells = sensors.arena.cells;
  const holes = [];
  const burn = [];
  const soft = [];
  const power = [];
  let floorHere = 1;
  let nearest = 99;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.state === "inactive") continue;
    const integrity = typeof c.integrity === "number" ? c.integrity : 1;
    const due = typeof c.collapseIn === "number" ? c.collapseIn : -1;
    const until = typeof c.timeUntilChange === "number" ? c.timeUntilChange : -1;
    const ox = c.x - me.x < 0 ? me.x - c.x : c.x - me.x;
    const oy = c.y - me.y < 0 ? me.y - c.y : c.y - me.y;
    const span = (ox > oy ? ox : oy) - 0.5;
    if (span < 0 && integrity < floorHere) floorHere = integrity;
    if (c.type === "hole") {
      holes.push(c.x, c.y, 0);
      if (span < nearest) nearest = span;
      continue;
    }
    if (due >= 0) {
      holes.push(c.x, c.y, due);
      if (span < nearest) nearest = span;
    }
    if (c.type === "flame") {
      if (c.state === "flaming") burn.push(c.x, c.y, -1, until < 0 ? 1.5 : until);
      else if (c.state === "warning") burn.push(c.x, c.y, until, until + 1.5);
      else if (until >= 0) burn.push(c.x, c.y, until + 1, until + 2.5);
      soft.push(c.x, c.y, 0.7);
      if (span < nearest) nearest = span;
    } else if (c.type === "recharge" && due < 0) {
      power.push(c.x, c.y, c.state === "ready" ? 0 : until < 0 ? 0 : until);
    }
    if (integrity < 0.62 && span < 4.2) {
      soft.push(c.x, c.y, (0.62 - integrity) * 7);
      if (span < nearest) nearest = span;
    }
  }

  // Cost of standing on a point after `at` seconds. Lethal terms dominate
  // anything a tactic can ask for; the middle of the arena is mildly cheaper.
  let avoidFoe = false;
  function pointCost(x, y, at) {
    let cost = 0;
    const ax = x < 0 ? -x : x;
    const ay = y < 0 ? -y : y;
    const span = ax > ay ? ax : ay;
    const over = span - (half - shrink * at);
    if (over > -0.6) cost += 90;
    else if (over > -1.7) cost += (over + 1.7) * 5;
    if (span > 2.6) cost += (span - 2.6) * 0.45;
    for (let i = 0; i < holes.length; i += 3)
      if (
        at + 0.25 >= holes[i + 2] &&
        x > holes[i] - 0.63 &&
        x < holes[i] + 0.63 &&
        y > holes[i + 1] - 0.63 &&
        y < holes[i + 1] + 0.63
      )
        cost += 90;
    for (let i = 0; i < burn.length; i += 4)
      if (
        at + 0.3 > burn[i + 2] &&
        at - 0.2 < burn[i + 3] &&
        x > burn[i] - 0.55 &&
        x < burn[i] + 0.55 &&
        y > burn[i + 1] - 0.55 &&
        y < burn[i + 1] + 0.55
      )
        cost += 16;
    for (let i = 0; i < soft.length; i += 3)
      if (
        x > soft[i] - 0.5 &&
        x < soft[i] + 0.5 &&
        y > soft[i + 1] - 0.5 &&
        y < soft[i + 1] + 0.5
      )
        cost += soft[i + 2];
    // The opponent is a moving wall: shoving it costs energy and wins nothing.
    if (
      avoidFoe &&
      x > foe.x - 0.95 &&
      x < foe.x + 0.95 &&
      y > foe.y - 0.95 &&
      y < foe.y + 0.95
    )
      cost += 5;
    return cost;
  }

  // ---- plan -----------------------------------------------------------
  let goalX = 0;
  let goalY = 0;
  let goalWeight = 2.4;
  let effort = 0.45;
  let horizon = 1;
  let faceMode = 0; // 0 travel, 1 opponent, 2 through the goal
  let busy = false;
  let axial = 0; // non zero: wedge on the opponent, thrust along that line

  // A trip to a recharge cell pays for itself: the tank caps at 300, so what
  // is picked up is mobility that costs nothing in the energy tie break.
  let bestCell = -1;
  let bestCost = 1e9;
  for (let i = 0; i < power.length; i += 3) {
    const d = Math.hypot(power[i] - me.x, power[i + 1] - me.y);
    const eta = d / 2.6 + 0.25;
    const wait = power[i + 2] - eta;
    if (wait > 1.8) continue;
    const cost =
      d +
      (wait > 0 ? wait * 1.6 : 0) +
      Math.hypot(power[i], power[i + 1]) * 0.25 +
      pointCost(power[i], power[i + 1], eta) * 0.5;
    if (cost < bestCost) {
      bestCost = cost;
      bestCell = i;
    }
  }
  const room = 300 - me.energy;
  const wantPower =
    bestCell >= 0 && bestCost < 14 && (room > 55 || (room > 25 && bestCost < 3));

  // Pushing a helpless opponent off the platform ends the match at once.
  if (helpless) {
    let ex = foe.x < 0 ? -1 : 1;
    let ey = 0;
    let out = half - (foe.x < 0 ? -foe.x : foe.x) + 0.12;
    const side = half - (foe.y < 0 ? -foe.y : foe.y) + 0.12;
    if (side < out) {
      out = side;
      ex = 0;
      ey = foe.y < 0 ? -1 : 1;
    }
    for (let i = 0; i < holes.length; i += 3) {
      if (holes[i + 2] > 0.4) continue;
      const hx = holes[i] - foe.x;
      const hy = holes[i + 1] - foe.y;
      const hd = Math.hypot(hx, hy);
      if (hd < 0.9 || hd - 0.45 >= out) continue;
      out = hd - 0.45;
      ex = hx / hd;
      ey = hy / hd;
    }
    const anchorX = foe.x - ex * 0.92;
    const anchorY = foe.y - ey * 0.92;
    const reach = Math.hypot(anchorX - me.x, anchorY - me.y);
    const grace = foe.status === "flipped" ? foe.statusTimer : 3;
    if (out < 3.2 && reach < 2.8 && grace > 0.3 + out * 0.45 + reach * 0.4) {
      busy = true;
      effort = 1;
      if (reach > 0.5) {
        goalX = anchorX;
        goalY = anchorY;
        horizon = 0.8;
      } else {
        goalX = foe.x + ex * (out + 0.6);
        goalY = foe.y + ey * (out + 0.6);
        faceMode = 2;
        horizon = 0.35;
      }
    }
  }

  // A run is worth its energy only when the arithmetic reaches the threshold.
  if (!busy) {
    let tau = (dist - 0.78) / (speed > 1.2 ? speed + 1.2 : 2.4);
    tau = clamp(tau, 0.06, 1.4);
    const hit = 5 - (5 - speed) / (1 + 1.6 * tau + 1.28 * tau * tau);
    const vClose = hit - (foe.vx * ux + foe.vy * uy);
    const relHit = wrapAngle(relNow - foe.omega * tau);
    const flank = relHit < 0 ? -relHit : relHit;
    const score = vClose * Math.cos(clamp(aimFoe, -1.2, 1.2)) * leverageOf(flank);
    const immune = me.status === "recovering";
    let needScore = 2.95;
    let needFlank = 0.85;
    let needRange = 2.5;
    if (lead < 0 || (time > 96 && me.energy < foe.energy - 25)) {
      needScore = 2.7;
      needFlank = 0.72;
      needRange = 3.4;
    } else if (lead > 0 && !immune) {
      needScore = 3.3;
      needFlank = 1.2;
      needRange = 2;
    }
    if (immune) {
      needScore -= 0.15;
      needRange += 0.6;
    }
    const launch =
      foe.status === "active" &&
      me.energy > 45 &&
      flank > needFlank &&
      score > needScore &&
      dist < needRange &&
      aimFoe < 0.55 &&
      aimFoe > -0.55;
    if (launch || (now < commit && dist < 3 && flank > 0.62 && foe.status === "active")) {
      busy = true;
      if (launch) commit = now + 16;
      goalX = foe.x + foe.vx * tau * 0.75;
      goalY = foe.y + foe.vy * tau * 0.75;
      effort = 1;
      faceMode = 2;
      horizon = dist < 1.8 ? 0.5 : 0.8;
    }
  }

  if (!busy && locked) {
    faceMode = 1;
    const backCost =
      pointCost(me.x - ux * 1.5, me.y - uy * 1.5, 0.35) +
      pointCost(me.x - ux * 2.7, me.y - uy * 2.7, 0.8);
    if (backCost > 8) axial = dist < 1.4 ? 1 : 0.45;
    else axial = -clamp((1.9 - dist) * 0.85, 0.06, 1);
  } else if (!busy) {
    if (wantPower && (dist > 2 || me.energy < 130 || helpless)) {
      goalX = power[bestCell];
      goalY = power[bestCell + 1];
      effort = me.energy < 100 ? 0.8 : 0.55;
    } else {
      // Default post: between the middle and the opponent. The slow radial
      // sweep spreads the floor load so no tile collapses under the wheels.
      const post = 1.15 + 0.45 * Math.sin(time * 0.7);
      const far = Math.hypot(foe.x, foe.y);
      let px = far > 0.4 ? (foe.x / far) * post : post;
      let py = far > 0.4 ? (foe.y / far) * post : 0;
      // A hole between the opponent and me is worth standing behind.
      let baitValue = 0;
      for (let i = 0; i < holes.length; i += 3) {
        if (holes[i + 2] > 0.5) continue;
        const bx = holes[i] - foe.x;
        const by = holes[i + 1] - foe.y;
        const bd = Math.hypot(bx, by);
        if (bd < 1.3 || bd > 6.5) continue;
        const sx = holes[i] + (bx / bd) * 1.2;
        const sy = holes[i + 1] + (by / bd) * 1.2;
        const trip = Math.hypot(sx - me.x, sy - me.y);
        if (trip > 4) continue;
        const risk = pointCost(sx, sy, trip / 2.5);
        if (risk > 3) continue;
        const value = 6 - trip * 0.9 - bd * 0.3 - risk;
        if (value > baitValue) {
          baitValue = value;
          px = sx;
          py = sy;
        }
      }
      const walk = Math.hypot(px - me.x, py - me.y);
      goalX = px;
      goalY = py;
      const ceiling = me.energy < 70 ? 0.35 : lead > 0 ? 0.5 : 0.62;
      effort = walk < 0.4 && floorHere > 0.6 ? 0 : clamp(walk * 0.45, 0.16, ceiling);
    }
  }
  avoidFoe = !busy && axial === 0;

  // ---- safety veto ----------------------------------------------------
  const ax0 = me.x < 0 ? -me.x : me.x;
  const ay0 = me.y < 0 ? -me.y : me.y;
  const clear = !avoidFoe && nearest > 3.4 && half - (ax0 > ay0 ? ax0 : ay0) > 3.2;
  const brake = (speed * speed) / (16 + 1.6 * speed) + 0.45;
  let panic = pointCost(me.x, me.y, 2.2) > 60;
  if (!panic && speed > 0.25) {
    const bt = brake / speed;
    if (
      pointCost(
        me.x + (me.vx / speed) * brake * 0.6,
        me.y + (me.vy / speed) * brake * 0.6,
        bt * 0.6,
      ) > 30 ||
      pointCost(me.x + (me.vx / speed) * brake, me.y + (me.vy / speed) * brake, bt) > 30
    )
      panic = true;
  }
  if (panic) {
    goalX = 0;
    goalY = 0;
    goalWeight = 1.1;
    effort = 1;
    horizon = 1;
    faceMode = 0;
    busy = false;
    axial = 0;
  }

  // ---- pick a heading -------------------------------------------------
  const goalDir = axial
    ? axial > 0
      ? toFoe
      : toFoe + Math.PI
    : Math.atan2(goalY - me.y, goalX - me.x);
  const leadX = me.x + me.vx * 0.16;
  const leadY = me.y + me.vy * 0.16;
  let moveDir = goalDir;
  let best = -1e9;
  // The goal direction is checked first: when it is already clean, and it
  // usually is, the fan of alternatives is never evaluated.
  let straight = 0;
  const scanning = !clear && axial === 0;
  if (scanning) {
    const gx = Math.cos(goalDir);
    const gy = Math.sin(goalDir);
    for (let j = 1; j <= 3; j++) {
      const reach = j * 0.7 * horizon;
      straight += pointCost(leadX + gx * reach, leadY + gy * reach, 0.12 + reach / 2.7);
    }
  }
  if (scanning && straight > 0.75)
    for (let k = 0; k < 12; k++) {
      const dir = goalDir + (k * TAU) / 12;
      const cx = Math.cos(dir);
      const cy = Math.sin(dir);
      const swing = Math.abs(wrapAngle(dir - me.heading));
      const delay = 0.12 + swing * 0.2;
      let value = goalWeight * Math.cos(wrapAngle(dir - goalDir)) - 0.42 * swing;
      // Without this the two ways round an obstacle score the same and the
      // controller dithers between them, turning hard and going nowhere.
      if (lastDir !== null) value += 1.2 * Math.cos(wrapAngle(dir - lastDir));
      for (let j = 1; j <= 3; j++) {
        const reach = j * 0.7 * horizon;
        value -= pointCost(leadX + cx * reach, leadY + cy * reach, delay + reach / 2.7);
      }
      if (value > best) {
        best = value;
        moveDir = dir;
      }
    }

  // ---- commands -------------------------------------------------------
  const faceDir = faceMode === 1 ? toFoe : faceMode === 2 ? goalDir : moveDir;
  const aimErr = wrapAngle(faceDir - me.heading);
  let turn = clamp(2 * aimErr - 0.78 * me.omega, -1, 1);
  let thrust = axial
    ? axial * Math.cos(aimFoe)
    : effort * Math.cos(wrapAngle(moveDir - me.heading));
  thrust = clamp(thrust, -1, 1);
  // Last word: the robot travels along its own axis, not along the direction
  // the plan chose, so speed is never added towards something lethal.
  if (thrust > 0.06 || thrust < -0.06) {
    const way = thrust > 0 ? 1 : -1;
    const look = 0.5 + brake * 0.9;
    const nx = Math.cos(me.heading) * way;
    const ny = Math.sin(me.heading) * way;
    if (
      pointCost(me.x + nx * look, me.y + ny * look, look / 2.6) > 30 ||
      pointCost(me.x + nx * look * 0.55, me.y + ny * look * 0.55, look / 4.7) > 30
    )
      thrust = -way * 0.4;
  }
  // Keep the 25 units a self righting costs when no cell can refill them.
  if (me.energy < 32 && bestCell < 0 && !panic) thrust *= 0.3;
  if (thrust < 0.06 && thrust > -0.06) thrust = 0;
  if (turn < 0.05 && turn > -0.05) turn = 0;
  if (!Number.isFinite(thrust)) thrust = 0;
  if (!Number.isFinite(turn)) turn = 0;
  return { actions: { thrust, turn }, memory: { c: commit, d: moveDir } };
}
