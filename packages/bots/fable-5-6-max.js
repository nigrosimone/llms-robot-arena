// fable-5-6-max
// Doctrine: never leave the square, never show the flank at speed, keep more energy than
// the opponent, and punish clear openings: exhausted, flipped, or rear-exposed opponents.
// Written for a cheap tick: no trig inside wrap, expensive estimates only at close range.
export function tick(s, m) {
  const PI = Math.PI, TAU = 2 * Math.PI;
  const wrap = (a) => a - TAU * Math.round(a / TAU);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const me = s.self, op = s.opponent;
  const mem = m && typeof m === "object" ? m : {};
  const t = s.time;
  // Arena limit a little ahead, so the shrink never surprises us.
  const h = s.arena.nextHalfExtent;
  const hSoon = Math.max(3, h - (t > 58 ? 0.08 : 0));

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

  // Distance from a point to the edge along a direction.
  const roomAlong = (px, py, sx, sy, lim) => {
    let r = 1e9;
    if (sx > 1e-6) r = Math.min(r, (lim - px) / sx);
    if (sx < -1e-6) r = Math.min(r, (-lim - px) / sx);
    if (sy > 1e-6) r = Math.min(r, (lim - py) / sy);
    if (sy < -1e-6) r = Math.min(r, (-lim - py) / sy);
    return r;
  };

  // Steering helpers.
  const faceAngle = (ang, gain) => clamp(wrap(ang - me.heading) * gain - me.omega * 0.7, -1, 1);
  // Facing controller: errors under about 7 degrees are corrected for free (turn <= 0.05 keeps
  // regeneration running); larger errors use a capped PD.
  const faceCtl = (ang, gain, cap) => {
    const e = wrap(ang - me.heading);
    if (Math.abs(e) < 0.12 && Math.abs(me.omega) < 0.45) return clamp(e * 1.2 - me.omega * 0.4, -0.05, 0.05);
    return clamp(e * gain - me.omega * 0.7, -cap, cap);
  };
  let rev = false;
  const driveTo = (tx, ty, power, allowReverse) => {
    const e = wrap(Math.atan2(ty - me.y, tx - me.x) - me.heading);
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

  // How dangerous is the opponent right now?
  const opDanger = opActive && op.energy > 4;
  const dangerClose = opDanger && (dist < 3.5 || (closing > 1.5 && dist < 5.5));

  // Recovery with hysteresis: at low energy only defend and regenerate.
  let recovering = !!mem.rec;
  if (me.energy < 12) recovering = true;
  if (me.energy > 40) recovering = false;
  // Hunting with hysteresis: pressure a weak opponent only with a real reserve, from a central
  // position, for a bounded time.
  let huntT = mem.hunt ? (mem.huntT || 0) + 1 : 0;
  let hunting = !!mem.hunt && opActive && op.energy < 12 && me.energy > 22 && huntT < 360 && myOut < hSoon - 1.1;
  const huntCd = mem.huntCd || 0;
  if (!hunting && opActive && op.energy < 6 && !recovering && me.energy >= 45 && eAdv > 30 && s.tick > huntCd && myOut < hSoon * 0.55 && opOut < hSoon - 1.6 && dist < 4.5) { hunting = true; huntT = 0; }
  const nextCd = mem.hunt && !hunting ? s.tick + 600 : huntCd;

  let thrust = 0, turn = 0, mode = "hold";
  let nextMode = "hold", nextUntil = 0;
  const committed = (name) => mem.mode === name && s.tick < (mem.until || 0);

  // ---------- 1. Opponent flipped: push it out along its axis, drain it, or wait behind it.
  if (opFlipped) {
    const oc = Math.cos(op.heading), osn = Math.sin(op.heading);
    const dPlus = roomAlong(op.x, op.y, oc, osn, h), dMinus = roomAlong(op.x, op.y, -oc, -osn, h);
    const stuckExtra = op.energy < 25 ? (25 - op.energy) / 4 : 0;
    const timeLeft = op.statusTimer + stuckExtra;
    const pushPlus = dPlus <= dMinus;
    const pdx = pushPlus ? oc : -oc, pdy = pushPlus ? osn : -osn;
    const pushDist = pushPlus ? dPlus : dMinus;
    const standX = op.x - pdx * 1.25, standY = op.y - pdy * 1.25;
    const standD = Math.sqrt((standX - me.x) ** 2 + (standY - me.y) ** 2);
    const behind = (me.x - op.x) * pdx + (me.y - op.y) * pdy < -0.45;
    const pushHeading = Math.atan2(pdy, pdx);
    const alignedToPush = Math.abs(wrap(pushHeading - me.heading)) < 0.35;
    const tReposition = standD / 2.2 + (behind && alignedToPush ? 0 : 0.8);
    const canRingOut = tReposition + pushDist / 2.3 + 0.3 < timeLeft && me.energy > 6 + pushDist * 6;
    const canDrain = inContact && Math.abs(myErr) < 0.55 && me.energy > 45 && me.energy > op.energy * 0.6 + 25 && op.energy > 2;
    if (canRingOut) {
      mode = "push";
      if (behind && dist < 1.5 && alignedToPush) { turn = faceAngle(bearing, 3); thrust = 1; }
      else if (behind && dist < 1.5) { turn = faceAngle(pushHeading, 3); thrust = 0.5; }
      else {
        const d = driveTo(standX, standY, standD > 1.2 ? 1 : 0.6, false);
        turn = d.turn; thrust = d.thrust;
        if (dist < 1.1 && Math.abs(myErr) < 0.9) thrust = -0.4;
      }
    } else if (canDrain) {
      mode = "drain"; turn = faceAngle(bearing, 3); thrust = 1;
    } else {
      mode = "wait";
      const rearX = op.x - oc * 2.3, rearY = op.y - osn * 2.3;
      const rearD = Math.sqrt((rearX - me.x) ** 2 + (rearY - me.y) ** 2);
      const rearSafe = Math.max(Math.abs(rearX), Math.abs(rearY)) < hSoon - 0.6;
      if (rearD > 0.5 && !recovering && rearSafe && op.statusTimer > 0.6) {
        const d = driveTo(rearX, rearY, rearD > 1.5 ? 0.7 : 0.4, false);
        turn = d.turn; thrust = d.thrust;
        if (dist < 1.2 && Math.abs(myErr) < 1.0) thrust = -0.5;
      } else turn = faceCtl(bearing, 2, 0.4);
    }
  }

  // ---------- 2. Hunt a weak opponent: orbit to its rear, deny its rest, then strike.
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
      let ddx = tx - rx * radial, ddy = ty - ry * radial;
      if (myOut > hSoon - 1.3) { ddx += (-me.x / (myR || 1)) * 1.5; ddy += (-me.y / (myR || 1)) * 1.5; }
      const e = wrap(Math.atan2(ddy, ddx) - me.heading);
      turn = clamp(e * 3 - me.omega * 0.7, -1, 1);
      thrust = Math.abs(e) < 0.5 ? 0.65 : Math.abs(e) < 1.2 ? 0.23 : 0;
    }
  }

  // ---------- 3. Strike window: hit their side or rear before they can rotate it away.
  if ((mode === "hold" || mode === "hunt") && near && !opFlipped && !recovering && opActive) {
    const contactD = Math.max(0, dist - 0.72);
    const v0 = Math.max(0, myTo);
    // Time to cover the gap at full thrust (constant-acceleration estimate) and the speed then.
    const acc = 7;
    const tImp = contactD > 0 ? (-v0 + Math.sqrt(v0 * v0 + 2 * acc * contactD)) / acc : 0;
    const vImp = Math.min(5, v0 + acc * tImp) * 0.92;
    const closeImp = vImp + Math.min(opTo, 0) + Math.max(0, opTo) * 0.5;
    const wToward = -Math.sign(opErr) * op.omega;
    // Largest angle they can rotate before impact: full turn while energy lasts, then coast.
    const E = op.energy + (op.energy > 0 ? 1.5 : 0.3), T = tImp + 0.05;
    const tau = Math.max(0, Math.min(T, E / 3));
    const ex = Math.exp(-1.8 * tau);
    const w = 3 * (1 - ex);
    const reach = 3 * tau - 1.6667 * (1 - ex) + (w * (1 - Math.exp(-1.8 * (T - tau)))) / 1.8 + Math.max(0, wToward) * Math.min(T, 0.5);
    const angleAtImpact = opAbs - reach;
    const lev = angleAtImpact > 2.53 ? 0.85 : angleAtImpact > 1.34 ? 1 : angleAtImpact > 0.8 ? 0.6 : 0;
    const safeTarget = Math.max(Math.abs(aimX), Math.abs(aimY)) < hSoon - 0.6;
    const canFlip = lev > 0 && closeImp * lev * Math.cos(Math.min(0.5, Math.abs(aimErr))) > 2.95 && Math.abs(aimErr) < 0.5 && safeTarget && me.energy > 15 && dist < 4;
    const huntStrike = mode === "hunt" && opAbs > 2.5 && dist < 3.2 && dist > 1.4 && Math.abs(aimErr) < 0.25 && safeTarget && op.energy < 12;
    if (canFlip || huntStrike || (committed("strike") && opAbs > 1.35 && dist < 3 && Math.abs(aimErr) < 0.8)) {
      mode = "strike";
      turn = clamp(aimErr * 4 - me.omega * 0.8, -1, 1);
      thrust = Math.abs(aimErr) < 0.5 ? 1 : 0.3;
      nextMode = "strike"; nextUntil = committed("strike") ? mem.until : s.tick + 45;
    } else if (mem.mode === "strike" && mode !== "hunt" && dist < 2 && closing > 2 && opAbs < 1.35) {
      // Aborted charge into a wedge: brake to soften the mutual loss.
      thrust = -1; turn = faceAngle(aimBearing, 4);
    }
  }

  // ---------- 4. Shove: big energy lead and they sit near an edge with me inside.
  if (mode === "hold" && near && !opFlipped && !recovering) {
    const shoveOK = eAdv > 45 && me.energy > 60 && opOut > hSoon - 1.5 && myOut < opOut - 0.7 && dist < 3 && Math.abs(myErr) < 0.5 && opActive;
    if (shoveOK || (committed("shove") && dist < 2.2 && eAdv > 20 && me.energy > 30)) {
      mode = "shove";
      turn = clamp(aimErr * 4 - me.omega * 0.8, -1, 1);
      thrust = Math.abs(aimErr) < 0.35 ? 1 : 0.2;
      nextMode = "shove"; nextUntil = committed("shove") ? mem.until : s.tick + 100;
    }
  }

  // ---------- 5. Hold: face them, keep the center, absorb pushes wisely.
  let resisting = false, leaving = false;
  if (mode === "hold") {
    turn = faceCtl(aimBearing, dangerClose ? 3.5 : 2, dangerClose ? 1 : opDanger ? 0.6 : 0.3);
    // Position goal: the center, nudged toward the opponent so a push carries me across the arena.
    const shift = opDanger ? Math.min(0.8, dist / 8) : 0;
    const goalX = ux * shift, goalY = uy * shift;
    const goalD = Math.sqrt((goalX - me.x) ** 2 + (goalY - me.y) ** 2);
    const wantD = dangerClose ? 1.2 : 0.4;
    // A harmless neighbour pinning me off-center: step back out of contact, it cannot follow.
    const leave = (inContact || (mem.leaving && dist < 2.2)) && !opDanger && me.energy > 8 && (myOut > hSoon * 0.45 || goalD > 1.5 || mem.leaving);
    leaving = !!leave;
    if (leave) { thrust = -0.5; turn = faceCtl(bearing, 2, 0.3); }
    else if (goalD > wantD && !recovering) {
      if (!dangerClose) {
        const d = driveTo(goalX, goalY, goalD > 2.5 ? 0.7 : 0.4, opDanger && dist < 7);
        turn = d.turn; thrust = d.thrust;
      } else if (myR > 1.6) {
        const toC = wrap(Math.atan2(-me.y, -me.x) - me.heading);
        if (Math.abs(toC) < 0.8) thrust = 0.3;
        else if (Math.abs(wrap(toC + PI)) < 0.8) thrust = -0.3;
      }
    } else if (goalD > wantD && recovering && !opDanger) {
      // Free creep toward the center while regenerating.
      const gb = Math.atan2(goalY - me.y, goalX - me.x);
      const toC = wrap(gb - me.heading);
      if (Math.abs(toC) < 0.6) thrust = 0.05; else if (Math.abs(wrap(toC + PI)) < 0.6) thrust = -0.05;
      else turn = clamp(faceAngle(Math.abs(toC) < PI / 2 ? gb : gb + PI, 1), -0.05, 0.05);
    }
    // Brace for a charge: stop and face precisely (a front-sector hit at speed now flips).
    const incoming = opTo > 2 && dist < 5 && opAbs < 0.9 && opDanger;
    if (incoming && !inContact) {
      turn = faceAngle(aimBearing, 4);
      thrust = myTo > 0.3 ? -Math.sign(vLong) * 0.8 : 0;
    }
    // In contact: let them push me while they burn energy; resist only as much as the room requires.
    if (inContact && opDanger) {
      const forward = Math.abs(myErr) < PI / 2;
      const sgn = forward ? 1 : -1;
      const roomBack = roomAlong(me.x, me.y, -ux, -uy, hSoon) - 0.9;
      const pushing = opTo > 0.05 || -myTo > 0.15;
      turn = faceCtl(aimBearing, 3, 1);
      let q = 0.05;
      if (pushing) {
        q = 1;
        for (const cand of [0.05, 0.3, 0.6, 0.8]) {
          if (2.5 * (1 - cand) * (op.energy / (9 + 20 * (1 + cand))) < roomBack) { q = cand; break; }
        }
      }
      if (roomBack < 0.6) q = 1;
      if (recovering && roomBack >= 0.6) q = 0.05;
      thrust = sgn * q;
      resisting = q > 0.05;
    } else if (inContact && !leave) {
      // Harmless neighbour: hold a free counter-push so its pulses cannot move me.
      if (Math.abs(thrust) <= 0.05) thrust = Math.abs(myErr) < PI / 2 ? 0.05 : -0.05;
    }
  }

  // ---------- 6. Recovery: minimal spending, wedge kept on a dangerous opponent.
  if (recovering && mode === "hold" && !resisting) {
    if (!inContact && Math.abs(thrust) > 0.05 && !leaving) thrust = 0;
    if (dangerClose) turn = faceCtl(aimBearing, 2.5, 0.7);
    else turn = clamp(turn, -0.05, 0.05);
  }
  if (recovering && mode === "wait") { thrust = 0; turn = clamp(turn, -0.05, 0.05); }

  // ---------- 7. Edge safety. Hard limit: never leave the square. Soft limit: keep a margin.
  {
    const speed = Math.abs(vLong);
    const dirx = vLong >= 0 ? cosH : -cosH, diry = vLong >= 0 ? sinH : -sinH;
    // Braking distance under full reverse thrust with drag, plus a margin.
    const stop = (speed > 0 ? speed / 1.6 - 3.125 * Math.log(1 + 0.2 * speed) : 0) + 0.12;
    const sx = me.x + dirx * stop, sy = me.y + diry * stop;
    const hardLimit = hSoon - 0.3;
    const projOut = Math.max(Math.abs(sx), Math.abs(sy));
    const softLimit = dangerClose ? hSoon - 1.4 : hSoon - 0.9;
    if (projOut > hardLimit) {
      mode = "escape";
      const movingOut = me.vx * sx + me.vy * sy > 0 && speed > 0.25;
      const power = me.energy < 3 ? 0.3 : me.energy < 12 ? 0.6 : 1;
      if (movingOut) {
        thrust = -Math.sign(vLong) * power;
        const toC = Math.atan2(-me.y, -me.x);
        turn = Math.abs(wrap(toC - me.heading)) < PI / 2 ? faceAngle(toC, 3) : faceAngle(toC + PI, 3);
      } else {
        const d = driveTo(0, 0, power, true);
        thrust = d.thrust; turn = d.turn;
      }
      nextMode = "hold"; nextUntil = 0;
    } else if (myOut > softLimit && !resisting && mode !== "strike" && mode !== "push" && mode !== "shove" && mode !== "hunt") {
      const urgent = myOut > softLimit + 0.5;
      const cb = Math.atan2(-me.y, -me.x);
      const toC = wrap(cb - me.heading);
      if (recovering) {
        if (Math.abs(toC) < 0.7) thrust = 0.05;
        else if (Math.abs(wrap(toC + PI)) < 0.7) thrust = -0.05;
        else if (!dangerClose) { thrust = 0; turn = clamp(faceAngle(Math.abs(toC) < PI / 2 ? cb : cb + PI, 1), -0.25, 0.25); }
        if (urgent && me.energy > 5) thrust = Math.abs(toC) < PI / 2 ? 0.4 : -0.4;
      } else if (dist < 2.5 && !urgent && opDanger) {
        thrust = Math.abs(toC) < PI / 2 ? 0.4 : -0.4;
      } else {
        const d = driveTo(0, 0, urgent ? 0.8 : 0.4, dist < 5 && opDanger);
        thrust = d.thrust; turn = d.turn;
      }
    }
  }

  return {
    actions: { thrust: clamp(thrust, -1, 1), turn: clamp(turn, -1, 1) },
    memory: { mode: nextMode, until: nextUntil, rec: recovering, hunt: hunting, huntT, huntCd: nextCd, rev, leaving },
  };
}
