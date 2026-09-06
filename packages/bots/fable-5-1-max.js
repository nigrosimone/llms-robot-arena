// fable-5-1-max (rules 0.2.2)
// Doctrine: the wedge stays on the opponent at all times. A flank push costs the pinned robot
// about 45 energy/s and the pusher a third of that, so never sit in a pin: slide out along my own
// axis at once, and do the pinning myself when the opponent is flipped. Strike only a flank that
// cannot be turned away in time, keep energy high with pickups, and never fall.
export function tick(s, m) {
  const PI = Math.PI, TAU = 2 * Math.PI;
  const wrap = (a) => a - TAU * Math.round(a / TAU);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const me = s.self, op = s.opponent;
  const mem = m && typeof m === "object" ? m : {};
  const tick = s.tick, t = s.time;
  const h = s.arena.nextHalfExtent;
  const hSoon = Math.max(3, h - (t > 58 ? 0.08 : 0));
  const timeLeft = 120 - t;

  // ---------- Geometry.
  const dx = op.x - me.x, dy = op.y - me.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  const ux = dx / dist, uy = dy / dist;
  const bearing = Math.atan2(dy, dx);
  const myErr = wrap(bearing - me.heading); // where they are, relative to my heading
  const opErr = wrap(bearing + PI - op.heading); // where I am, relative to their heading
  const myAbs = Math.abs(myErr), opAbs = Math.abs(opErr);
  const cosH = Math.cos(me.heading), sinH = Math.sin(me.heading);
  const oc = Math.cos(op.heading), os = Math.sin(op.heading);
  const vLong = me.vx * cosH + me.vy * sinH;
  const myTo = me.vx * ux + me.vy * uy;
  const opTo = -(op.vx * ux + op.vy * uy);
  const closing = myTo + opTo;
  const myOut = Math.max(Math.abs(me.x), Math.abs(me.y));
  const opActive = op.status === "active", opFlipped = op.status === "flipped";
  const opCan = opActive && op.energy > 1; // can move and attack
  const lc = s.lastContact;
  const touching = !!lc && tick - lc.tick <= 1 && dist < 1.4;
  const cTicks = touching ? (mem.cTicks || 0) + 1 : 0;
  const wwTicks = touching && lc.selfWedge && lc.opponentWedge ? (mem.wwTicks || 0) + 1 : 0;
  // Pusher profile: the share of time the opponent keeps its wedge on me. A blind charger never
  // shows a flank to strike and cannot be shaken off by reversing (it just follows), so it gets
  // the old doctrine instead: be pushed cheaply while there is room, lead it across holes.
  const pf = 0.97 * (typeof mem.pf === "number" ? mem.pf : 0.5) + 0.03 * (opActive && opAbs < 0.45 ? 1 : 0);
  const pusher = pf > 0.86 && t > 3;

  // ---------- One pass over the arena cells.
  const hz = []; // holes and announced collapses: squares the center must never cross
  const fire = []; // grates warning or burning
  const chargers = []; // {x, y, ready, wait}
  let myCell = null, opCell = null;
  const central = []; // cell on each of the 16 central tiles, k = (x + 1.5) + (y + 1.5) * 4
  const cells = s.arena.cells;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.state === "inactive") continue;
    if (Math.abs(me.x - c.x) <= 0.5 && Math.abs(me.y - c.y) <= 0.5) myCell = c;
    if (Math.abs(op.x - c.x) <= 0.5 && Math.abs(op.y - c.y) <= 0.5) opCell = c;
    if (Math.abs(c.x) < 2 && Math.abs(c.y) < 2) central[Math.round(c.x + 1.5) + Math.round(c.y + 1.5) * 4] = c;
    if (c.type === "hole" || c.state === "hole" || (c.collapseIn !== null && c.collapseIn !== undefined)) {
      if (hz.length < 24) hz.push(c);
    } else if (c.type === "flame") {
      if (c.state === "flaming" || (c.state === "warning" && c.timeUntilChange !== null && c.timeUntilChange < 1.2)) fire.push(c);
    } else if (c.type === "recharge") {
      chargers.push({ x: c.x, y: c.y, ready: c.state === "ready", wait: c.state === "ready" ? 0 : c.timeUntilChange ?? 8 });
    }
  }
  // Segment (x0,y0)->(x1,y1) crosses the square of cell c grown by margin g.
  const hits = (c, x0, y0, x1, y1, g) => {
    const r = 0.5 + g;
    const sx0 = Math.abs(x0 - c.x), sy0 = Math.abs(y0 - c.y);
    if (sx0 <= r && sy0 <= r) {
      // Starting inside the grown square: only moving deeper counts as blocked.
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
      const c = hz[i], q = 0.6;
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
  const roomF = roomAlong(me.x, me.y, cosH, sinH, hSoon), roomB = roomAlong(me.x, me.y, -cosH, -sinH, hSoon);

  // ---------- Steering helpers.
  // PD heading controller; saturates for anything beyond about 0.3 rad.
  const face = (ang, gain, kd) => clamp(wrap(ang - me.heading) * (gain || 3.2) - me.omega * (kd || 0.9), -1, 1);
  // Tracking a moving opponent: feed the bearing rate forward so the nose does not lag a
  // target crossing at speed (a lag of half a radian at impact is a flank).
  const bRate = ((op.vx - me.vx) * -uy + (op.vy - me.vy) * ux) / Math.max(dist, 0.8);
  const track = (ang, gain, kd) => clamp(wrap(ang - me.heading) * (gain || 3.5) + (bRate - me.omega) * (kd || 0.9) + bRate / 3, -1, 1);
  // Pick a safe travel direction toward a goal; null when everything nearby is blocked.
  const safeDir = (gx, gy, avoidFire) => {
    const gdx = gx - me.x, gdy = gy - me.y;
    const gd = Math.sqrt(gdx * gdx + gdy * gdy);
    if (gd < 0.03) return null;
    const base = Math.atan2(gdy, gdx);
    const offs = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, 2.6, -2.6];
    // Second pass: shorter step and any endpoint no further out than I already am, so a hole
    // between me and the center never leaves me frozen at the edge.
    for (let pass = 0; pass < 2; pass++) {
      const L = pass === 0 ? Math.min(gd, 2.0) + 0.35 : 1.0;
      for (let i = 0; i < offs.length; i++) {
        const a = base + offs[i];
        const ex = me.x + Math.cos(a) * L, ey = me.y + Math.sin(a) * L;
        if (!insideSoon(ex, ey, 0.35) && (pass === 0 || Math.max(Math.abs(ex), Math.abs(ey)) > myOut - 0.05 || !insideSoon(ex, ey, 0.1))) continue;
        if (!blocked(me.x, me.y, ex, ey, pass === 0 ? 0.22 : 0.12, avoidFire)) return a;
      }
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

  // Time to impact at full thrust from here, and the aim point led by it so the contact lands
  // inside my wedge even against an orbiting target.
  const contactD = Math.max(0, dist - 0.72);
  const v0 = Math.max(0, myTo);
  const tImp = (-v0 + Math.sqrt(v0 * v0 + 2 * 6.5 * contactD)) / 6.5;
  const lead = clamp(tImp * 0.9, 0.05, 0.6);
  const aimX = op.x + op.vx * lead, aimY = op.y + op.vy * lead;
  const aimBearing = Math.atan2(aimY - me.y, aimX - me.x);
  const aimErr = wrap(aimBearing - me.heading);

  let thrust = 0, turn = 0, mode = "hold", until = 0, dir = mem.dir || 0;
  let nextHome = typeof mem.home === "number" ? mem.home : -1;
  const committed = (name) => mem.mode === name && tick < (mem.until || 0);
  const memory = () => ({ mode, until, dir, rev, home: nextHome, cTicks, wwTicks, pf });

  if (me.status === "flipped") return { actions: { thrust: 0, turn: 0 }, memory: memory() };

  // ---------- 0a. Coasting into a hazard: brake before anything else.
  const speed0 = Math.abs(vLong);
  const dir0x = vLong >= 0 ? cosH : -cosH, dir0y = vLong >= 0 ? sinH : -sinH;
  const stop0 = (speed0 > 0 ? speed0 / 1.6 - 3.125 * Math.log(1 + 0.2 * speed0) : 0) + 0.15;
  const insideHz = hz.some((c) => Math.abs(me.x - c.x) <= 0.5 && Math.abs(me.y - c.y) <= 0.5);
  let urgent = false;
  if (speed0 > 0.12 && !insideHz && blocked(me.x, me.y, me.x + dir0x * (stop0 + 0.2), me.y + dir0y * (stop0 + 0.2), 0.04, false)) {
    urgent = true; mode = "brake";
    thrust = -Math.sign(vLong);
    turn = 0;
  }

  // ---------- 0b. My own tile: announced collapse or fire means leave now.
  if (myCell && !urgent) {
    const collapsing = myCell.collapseIn !== null && myCell.collapseIn !== undefined;
    const burning = myCell.type === "flame" && (myCell.state === "flaming" || (myCell.state === "warning" && myCell.timeUntilChange !== null && myCell.timeUntilChange < 0.9));
    if (collapsing || burning) {
      urgent = true;
      mode = "exit";
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
        // The opponent is a wall: a flipped or stalled one does not move out of my way.
        const opAlong = (op.x - me.x) * sx + (op.y - me.y) * sy, opSide = Math.abs((op.x - me.x) * sy - (op.y - me.y) * sx);
        const wall = opAlong > 0 && opAlong < need + 1.2 && opSide < 1.0;
        const score = -need * 2 + along * 1.5 - (wall ? 6 : 0);
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

  // ---------- 1. Helpless opponent (flipped, or out of energy): ring it out along its axis if
  // there is time, otherwise pin a flipped one, or set up the flip on an exhausted one.
  let stuckFoe = false;
  const exhausted = !opFlipped && op.energy <= 0.5;
  if (mode === "hold" && (opFlipped || exhausted)) {
    const stuck = exhausted || op.energy < 25; // cannot move, or cannot self-right without a pickup
    const tLeft = stuck ? 1e3 : op.statusTimer;
    const dPlus = roomAlong(op.x, op.y, oc, os, h), dMinus = roomAlong(op.x, op.y, -oc, -os, h);
    const pushPlus = dPlus <= dMinus;
    const pdx = pushPlus ? oc : -oc, pdy = pushPlus ? os : -os;
    const pushDist = pushPlus ? dPlus : dMinus;
    const standX = op.x - pdx * 1.2, standY = op.y - pdy * 1.2;
    const standD = Math.sqrt((standX - me.x) ** 2 + (standY - me.y) ** 2);
    const behind = (me.x - op.x) * pdx + (me.y - op.y) * pdy < -0.5;
    const pushHeading = Math.atan2(pdy, pdx);
    const aligned = Math.abs(wrap(pushHeading - me.heading)) < 0.4;
    const tRepos = standD / 2.2 + (behind && aligned ? 0.1 : 1.0);
    // Never push them across a ready charger: a pickup funds their self-righting.
    let chargerOnPath = false;
    for (let i = 0; i < chargers.length; i++) if (chargers[i].ready && hits(chargers[i], op.x, op.y, op.x + pdx * pushDist, op.y + pdy * pushDist, 0)) chargerOnPath = true;
    // I follow 0.8 m behind their center on the same line, so my own room is theirs plus that.
    const feasible = !chargerOnPath && pushDist < 9 && me.energy > 12 + pushDist * 5 && insideSoon(standX, standY, 0.4) && !blocked(standX, standY, standX + pdx * 0.5, standY + pdy * 0.5, 0.1, false) && (behind || !blocked(me.x, me.y, standX, standY, 0.15, true));
    const canRingOut = feasible && tRepos + 0.8 + pushDist / 2.2 < tLeft;
    if (canRingOut || (committed("push") && feasible)) {
      mode = "push"; until = tick + 30;
      if (behind && dist < 1.6) { turn = face(aligned ? bearing : pushHeading, 4, 0.8); thrust = aligned || myAbs < 0.5 ? 1 : 0.4; }
      else {
        const d = driveTo(standX, standY, standD > 1.2 ? 1 : 0.6, false, true);
        turn = d.turn; thrust = d.thrust;
        if (dist < 1.1 && myAbs < 0.9 && !behind) thrust = -0.5; // do not shove them the wrong way
      }
    } else if (exhausted) {
      // Cannot turn: any hit outside its wedge at speed flips it, and a flip at zero energy is
      // final. Back off to striking distance on its flank; section 3 fires the strike.
      if (opAbs < 0.8 || (dist < 2.2 && myAbs > 0.6)) {
        mode = "circle";
        const px = -os, py = oc;
        const side = (me.x - op.x) * px + (me.y - op.y) * py >= 0 ? 1 : -1;
        const d = driveTo(op.x + px * side * 2.4, op.y + py * side * 2.4, 0.7, false, true);
        turn = d.turn; thrust = d.thrust;
      } else if (dist < 2.2) {
        mode = "backoff"; turn = face(bearing, 4, 0.8); thrust = roomB > 1.5 ? -0.8 : 0;
      }
    } else if (stuck) {
      stuckFoe = true; // harmless for the rest of the match: play safe, keep energy
    } else if (tLeft > 0.45 && (me.energy > 60 || op.energy - 45 * tLeft < 25)) {
      // Pin: wedge on their side, perpendicular to their heading, full thrust. A lateral push
      // barely moves them (grip) but costs them about 45 energy/s.
      mode = "pin";
      const px = -os, py = oc;
      let side = (me.x - op.x) * px + (me.y - op.y) * py >= 0 ? 1 : -1;
      let sx = op.x + px * side * 1.1, sy = op.y + py * side * 1.1;
      if (!insideSoon(sx, sy, 0.4) || blocked(op.x, op.y, sx, sy, 0.1, true)) { side = -side; sx = op.x + px * side * 1.1; sy = op.y + py * side * 1.1; }
      const sd = Math.sqrt((sx - me.x) ** 2 + (sy - me.y) ** 2);
      const wedgeOn = touching && lc.selfWedge;
      if (wedgeOn && roomF > 0.8) { turn = face(bearing, 4, 0.8); thrust = 1; }
      else if (dist < 1.35 && myAbs < 0.7 && roomF > 0.8) { turn = face(bearing, 4, 0.8); thrust = 0.9; }
      else if (sd < 0.3 || (dist < 1.5 && myAbs < 1.2)) { turn = face(bearing, 4, 0.8); thrust = myAbs < 0.4 && roomF > 0.8 ? 0.6 : 0; }
      else { const d = driveTo(sx, sy, sd > 1.5 ? 1 : 0.6, false, true); turn = d.turn; thrust = d.thrust; }
    } else {
      // Self-righting imminent: hold 1.5 m off with the wedge on them, ready for the next strike.
      mode = "guard";
      const gx = op.x - ux * 1.5, gy = op.y - uy * 1.5;
      const gd = Math.sqrt((gx - me.x) ** 2 + (gy - me.y) ** 2);
      if (gd > 0.3) { const d = driveTo(gx, gy, 0.6, true, true); turn = d.turn; thrust = d.thrust; }
      else { turn = face(bearing, 4, 0.8); thrust = 0; }
    }
  }

  // ---------- 2. Contact with an active opponent.
  const slideOn = committed("slide"), pivotOn = committed("pivot");
  if (mode === "hold" && !opFlipped && (touching || slideOn || pivotOn)) {
    const myW = touching && lc.selfWedge, opW = touching && lc.opponentWedge;
    if (myW && !opW) {
      // My wedge on their flank: push while it drains them (about 45/s against a third for me)
      // or moves them toward a drop; otherwise back off and set up a real strike.
      const roomOp = roomAlong(op.x, op.y, cosH, sinH, hSoon);
      const shove = roomOp < 2.5 && roomF > roomOp + 0.9;
      const clear = roomF > 1.0 && !blocked(me.x, me.y, me.x + cosH * 0.9, me.y + sinH * 0.9, 0.1, false);
      turn = face(bearing, 4, 0.8);
      // A drain costs me a third of what it costs them, but they recharge: only worth it with an
      // energy lead, near their exhaustion, or into a drop. Otherwise back off for a real strike.
      const worth = shove || (op.energy > 8 && ((me.energy > op.energy + 40 && me.energy > 120) || op.energy < 30));
      if (clear && worth) { mode = "push"; until = 0; thrust = 1; }
      else { mode = "backoff"; until = 0; thrust = roomB > 1.5 ? -0.8 : 0; }
    } else if (slideOn) {
      // Keep sliding, no steering, until the contact has been broken for a few ticks.
      if (!touching && (!lc || tick - lc.tick >= 8) && dist > 1.3) { mode = "brace"; turn = face(bearing, 4, 0.8); thrust = Math.abs(vLong) > 0.5 ? -Math.sign(vLong) * 0.6 : 0; }
      else { mode = "slide"; until = mem.until; thrust = (dir > 0 ? roomF : roomB) > 0.9 ? dir : 0; turn = 0; }
    } else if (pivotOn && dist < 2.5 && (touching || !lc || tick - lc.tick < 6 || myTo < -1)) {
      mode = "pivot"; until = mem.until;
      if (roomB > 2.1 + Math.max(0, -vLong) * 0.5) { turn = dir; thrust = -1; }
      else { turn = face(bearing, 4, 0.8); thrust = 1; }
    } else if (pusher && myAbs < 1.0 && touching) {
      // A blind pusher: let it carry me at a trickle of thrust (it pays more than I do) and hold
      // the line with full thrust only when the edge is close.
      mode = "brace"; turn = face(bearing, 4, 0.8);
      const roomBack = roomAlong(me.x, me.y, -ux, -uy, hSoon);
      thrust = roomBack < 2.4 + Math.max(0, -vLong) * 0.6 ? 1 : 0.05;
    } else if (myAbs < 1.0 && ((myTo < -0.5 && opTo > -0.2) || cTicks >= 3)) {
      // Pushed from the front. Face to face the contact locks my rotation; reversing hard while
      // turning breaks it in a tick (measured: about 15 energy against 45 for holding and 100
      // for a thrust stall). Without room behind me the stall is all that keeps me on the platform.
      const need = 2.1 + Math.max(0, -vLong) * 0.5;
      mode = "pivot"; until = tick + 18;
      const roomL = roomAlong(me.x, me.y, -sinH, cosH, hSoon), roomR = roomAlong(me.x, me.y, sinH, -cosH, hSoon);
      dir = roomL >= roomR ? 1 : -1;
      if (roomB > need) { turn = dir; thrust = -1; }
      else { turn = face(bearing, 4, 0.8); thrust = 1; }
    } else if (opW && !myW && myAbs >= 1.0) {
      // Pinned on the side or rear: slide out along my own axis without steering (measured:
      // a straight reverse costs about 9 energy, steering while sliding 45, stopping to face
      // them 130). Backward is cheaper because their wedge then slides off my front sector.
      mode = "slide"; until = tick + 45;
      const need = 1.6 + Math.abs(vLong) * 0.5;
      dir = roomB > need ? -1 : roomF > need ? 1 : 0;
      thrust = dir; turn = 0;
    } else {
      // A brief bounce: keep the wedge on them and kill any backward drift.
      mode = "brace"; turn = face(bearing, 4, 0.8);
      thrust = vLong < -0.4 && roomF > 1 ? 0.6 : 0;
    }
  }

  // ---------- 3. Strike: hit a flank they cannot turn away before impact.
  if (mode === "hold" && !opFlipped && dist < 4.6 && me.status === "active") {
    const vImp = Math.min(5, v0 + 6.5 * tImp);
    const vClose = vImp + opTo;
    // Their plausible rotation toward me before impact: a reaction delay, then three quarters
    // of the physical maximum. At 5 m/s any sector but the wedge itself flips, so a front-sector
    // prediction still scores.
    const T = Math.max(0, tImp - 0.15);
    let reach = 0.75 * (T < 0.55 ? 2.7 * T * T : 3 * T - 0.82);
    if (op.energy < 6) reach *= op.energy / 6;
    const wTo = -Math.sign(opErr) * op.omega;
    const angAt = opAbs - reach - Math.max(0, wTo) * Math.min(T, 0.3);
    const lev = angAt > 2.53 ? 0.85 : angAt > 1.22 ? 1 : angAt > 0.65 ? 0.6 : 0;
    const score = vClose * Math.cos(Math.min(Math.abs(aimErr), 0.6)) * lev;
    const pathOk = insideSoon(aimX, aimY, 0.6) && !blocked(me.x, me.y, aimX, aimY, 0.12, false) && roomAlong(me.x, me.y, Math.cos(aimBearing), Math.sin(aimBearing), hSoon) > dist + 1.0;
    const immune = op.status === "recovering" && op.statusTimer > tImp;
    // A side-on target inside 2.8 m cannot bring its wedge round in time: the hit is cheap for
    // me whatever happens and usually a flip, so take it even when the score is marginal.
    const cheap = opAbs > 1.25 && dist < 2.8 && opTo < 1.0 && angAt > 0.75 && me.energy > 100;
    const go = lev > 0 && (score > 2.7 || cheap) && Math.abs(aimErr) < 0.7 && pathOk && !immune && me.energy > 40;
    const keep = committed("strike") && lev > 0 && Math.abs(aimErr) < 0.9 && pathOk && !immune && opAbs > 0.9;
    if (go || keep) {
      mode = "strike"; until = committed("strike") ? mem.until : tick + 40;
      turn = track(aimBearing, 4, 0.7);
      thrust = Math.abs(aimErr) < 0.5 ? 1 : 0.3;
    } else if (mem.mode === "strike" && dist < 2.2 && closing > 1.5 && opAbs < 0.9) {
      mode = "abort"; thrust = -1; turn = track(aimBearing, 4, 0.7);
    }
  }

  // ---------- 4. Hold: face them, manage energy and position.
  if (mode === "hold") {
    const threat = opCan && !stuckFoe && (dist < 6.5 || (closing > 2.5 && dist < 9));
    // Ambush: a hole already on the line between us while they come at me. Standing still keeps
    // it there; a blind charge drops in, a careful one has to go round.
    let lineHole = false;
    if (opCan && opTo > 0.8 && dist > 2.0 && !touching) {
      for (let i = 0; i < hz.length; i++) {
        const c = hz[i];
        if (c.state !== "hole") continue;
        const along = (c.x - op.x) * -ux + (c.y - op.y) * -uy;
        if (along < 1.0 || along > dist - 0.9) continue;
        const perp = Math.abs((c.x - op.x) * uy - (c.y - op.y) * ux);
        if (perp < 0.45) { lineHole = true; break; }
      }
    }
    turn = threat ? track(aimBearing, 3.5, 0.9) : clamp(face(bearing, 1.2, 0.9), -0.35, 0.35);

    // Energy plan: hold a post 1.25 m from a charger on the opponent's side of it. A pickup is
    // then a short reverse with the wedge still on them, and the post itself is central ground.
    let best = null, bestCost = 1e9;
    for (let i = 0; i < chargers.length; i++) {
      const c = chargers[i];
      if (!insideSoon(c.x, c.y, 0.7)) continue;
      if (!c.ready && c.wait > 4.5) continue;
      const cd = Math.sqrt((c.x - me.x) ** 2 + (c.y - me.y) ** 2);
      const od = Math.sqrt((c.x - op.x) ** 2 + (c.y - op.y) ** 2);
      let vx = op.x - c.x, vy = op.y - c.y;
      if (!threat || dist > 7) { vx = -c.x; vy = -c.y; } // nobody near: post on the center side
      const vl = Math.sqrt(vx * vx + vy * vy) || 1;
      const px = c.x + (vx / vl) * 1.25, py = c.y + (vy / vl) * 1.25;
      if (!insideSoon(px, py, 0.6) || blocked(c.x, c.y, px, py, 0.05, false)) continue;
      const pd = Math.sqrt((px - me.x) ** 2 + (py - me.y) ** 2);
      const off = Math.abs(wrap(Math.atan2(py - me.y, px - me.x) - bearing));
      const exposure = Math.min(off, PI - off); // 0 when the route runs along the line between us
      let cost = pd + c.wait * 0.6 + Math.max(Math.abs(c.x), Math.abs(c.y)) * 0.15;
      if (opCan && od < 1.6 && od < cd) cost += 4; // they are on it
      if (threat && dist < 5 && pd > 0.5) cost += exposure * 2;
      if (pd > 1 && blocked(me.x, me.y, px, py, 0.2, true)) cost += 3;
      if (cost < bestCost) { bestCost = cost; best = { x: c.x, y: c.y, ready: c.ready, wait: c.wait, cd, od, px, py, pd, exposure }; }
    }
    const finale = timeLeft < 4.5;
    const atPost = !!best && best.pd < 0.55;
    const wantE = me.energy <= 240 || (finale && me.energy < 296) || (me.energy <= 285 && atPost && !threat);
    // A flank shown to a charging opponent is a flip: lateral moves need distance and a slow foe.
    // Running dry is a certain loss, though, so the lower the energy the more exposure is taken.
    const charging = opTo > 2.5 && opAbs < 0.8;
    const canMove = !lineHole && (!threat || (dist > 3.5 && opTo < 1.2) || (dist > 6 && opTo < 3) || (!!best && best.exposure < 0.5 && dist > 2) || (me.energy < 110 && dist > 1.8 && opTo < 1)) && !(opCan && opTo > 1.5 && me.energy > 150);
    const grab = !!best && best.ready && !charging && (
      (me.energy <= 240 && best.cd < 2.2 && (dist > 2.0 || best.exposure < 0.9)) ||
      (me.energy <= 150 && best.cd < 4 && dist > 1.5) ||
      (me.energy <= 150 && best.cd < 5.5 && opTo < -0.8) || // they are leaving: refuel, do not chase
      (me.energy <= 80 && best.cd < 6));
    // Hole shield: with the opponent coming from a distance, stand just beyond a hole on its
    // line. A blind charge drops in (this alone decides a third of the matches against the
    // reference controller); a careful one has to go round, which buys time and angles.
    let shX = null, shY = null, shD = 1e9;
    if (opCan && !lineHole && opTo > 0.5 && dist > 2.2 && me.energy > 100 && (pusher || dist > 4 || t < 4)) {
      for (let i = 0; i < hz.length; i++) {
        const c = hz[i];
        if (c.state !== "hole") continue;
        const vx0 = c.x - op.x, vy0 = c.y - op.y, vl = Math.sqrt(vx0 * vx0 + vy0 * vy0) || 1;
        if (vl > dist + 1.5 || vl < 1.2) continue;
        const px = c.x + (vx0 / vl) * 1.5, py = c.y + (vy0 / vl) * 1.5;
        if (!insideSoon(px, py, 0.8)) continue;
        let bad = false;
        for (let k = 0; k < hz.length; k++) if (k !== i && Math.abs(hz[k].x - px) < 1.1 && Math.abs(hz[k].y - py) < 1.1) bad = true;
        if (bad) continue;
        const dme = Math.sqrt((px - me.x) ** 2 + (py - me.y) ** 2);
        if (dme > (opTo > 1.2 ? 7 : 4) || dme > vl - 0.3 || dme > dist * 0.8) continue; // there before them
        if (dme > 0.5 && blocked(me.x, me.y, px, py, 0.2, true)) continue;
        if (dme < shD) { shD = dme; shX = px; shY = py; }
      }
    }
    if (shX !== null && shD > 0.35) {
      mode = "shield";
      const d = driveTo(shX, shY, dist > 3 ? 0.95 : 0.75, dist < 3, true);
      turn = d.turn; thrust = d.thrust;
    } else if (lineHole && !(grab && me.energy <= 150)) {
      mode = "ambush"; turn = track(aimBearing, 3.5, 0.9); thrust = Math.abs(vLong) > 0.3 ? -Math.sign(vLong) * 0.5 : 0;
    } else if (best && wantE && best.ready && best.cd < 2.2 && (atPost || canMove || grab) && (!threat || dist > 1.5 || grab)) {
      // Collect: through the cell center and out again; reverse keeps the wedge on them.
      mode = "collect";
      const d = driveTo(best.x + (best.x - me.x) * 0.2, best.y + (best.y - me.y) * 0.2, 0.8, threat, true);
      turn = d.turn; thrust = d.thrust;
    } else if (best && grab && best.cd < 6) {
      // Low and the cell is close but not ready or not quite in reach: go for it anyway.
      mode = "collect";
      const d = driveTo(best.x + (best.x - me.x) * 0.2, best.y + (best.y - me.y) * 0.2, 0.8, threat, true);
      turn = d.turn; thrust = d.thrust;
      if (!best.ready && best.cd < 1.3 && best.wait > 0.3) { thrust = 0; turn = track(aimBearing, 3.5, 0.9); } // hold off the cell until ready
    } else if (best && !atPost && canMove && (wantE || !threat || best.pd < 3)) {
      mode = "post";
      const d = driveTo(best.px, best.py, best.pd > 2 ? 0.8 : 0.5, threat, true);
      turn = d.turn; thrust = d.thrust;
    } else if (threat) {
      // Range control: never let a circling opponent inside 1.7 m, meet a charge with a little
      // reverse, close in slowly otherwise. The wedge stays on them throughout.
      const incoming = opTo > 2 && opAbs < 0.8;
      if (pusher && dist < 3.4 && opTo > 1.2 && myOut < hSoon - 2.2) {
        // Back away along a clear path with the wedge on it: its straight line meets the holes
        // before it meets me.
        mode = "flee";
        const d = driveTo(me.x - ux * 2.5, me.y - uy * 2.5, 0.8, true, true);
        if (d.thrust !== 0 || d.turn !== 0) { turn = d.turn; thrust = d.thrust; }
        else { turn = track(aimBearing, 3.5, 0.9); thrust = 0; }
      } else if (incoming && opTo > 3.5 && dist < 1.9 && opAbs < 0.6 && roomB > 3.0 && !pusher) {
        // A full-speed charge: reverse hard while turning so it grazes past instead of pushing
        // me (measured: one tick of contact). Reversing also keeps any hit below the flip score.
        mode = "pivot"; until = tick + 18;
        const roomL = roomAlong(me.x, me.y, -sinH, cosH, hSoon), roomR = roomAlong(me.x, me.y, sinH, -cosH, hSoon);
        dir = roomL >= roomR ? 1 : -1;
        turn = dir; thrust = -1;
      }
      // Yielding ground is how one ends up at the edge: reverse only from a central position.
      else if (incoming) thrust = Math.abs(vLong) > 0.3 ? -Math.sign(vLong) * 0.5 : 0; // meet a charge standing still
      else if (dist < 1.5 && roomB > 2.5 && myOut < hSoon - 2.5 && myAbs < 1.0) thrust = -0.5;
      else if (dist > 3.2 && myAbs < 0.5 && opTo < 0.5 && myOut < hSoon - 1.6 && roomF > dist) thrust = 0.35;
      else thrust = Math.abs(vLong) > 0.4 ? -Math.sign(vLong) * 0.4 : 0;
      // Do not wear my tile through: alone it lasts 12 s, shared 6 s.
      const shared = opCell && myCell && opCell.id === myCell.id;
      if (myCell && myCell.integrity < (shared ? 0.45 : 0.2) && thrust === 0) thrust = roomF >= roomB ? 0.5 : -0.5;
    } else {
      // Far or harmless: sit on a fresh central tile away from hazards.
      const tileScore = (hx, hy) => {
        if (!insideSoon(hx, hy, 0.7)) return -1e9;
        let sc = -0.7 * Math.max(Math.abs(hx), Math.abs(hy));
        let sides = 0;
        for (let i = 0; i < hz.length; i++) {
          const ddx = Math.abs(hz[i].x - hx), ddy = Math.abs(hz[i].y - hy);
          if (ddx < 0.6 && ddy < 0.6) return -1e9;
          if (ddx < 1.6 && ddy < 1.6) { sc -= 2; if (ddx < 0.6 || ddy < 0.6) sides++; }
        }
        if (sides >= 2) sc -= 12; else if (sides === 1) sc -= 1;
        for (let i = 0; i < fire.length; i++) if (Math.abs(fire[i].x - hx) < 0.6 && Math.abs(fire[i].y - hy) < 0.6) sc -= 3;
        const c = central[Math.round(hx + 1.5) + Math.round(hy + 1.5) * 4];
        if (c) { sc -= 5 * (1 - c.integrity); if (c.type === "recharge") sc -= 1.5; if (c.type === "flame") sc -= 2; }
        if (Math.abs(op.x - hx) < 0.6 && Math.abs(op.y - hy) < 0.6) sc -= 3;
        return sc;
      };
      let home = nextHome;
      let hx = home >= 0 ? (home % 4) - 1.5 : 1e9, hy = home >= 0 ? Math.floor(home / 4) - 1.5 : 1e9;
      const onHome = home >= 0 && Math.abs(me.x - hx) <= 0.5 && Math.abs(me.y - hy) <= 0.5;
      const worn = !!(myCell && myCell.integrity < 0.25);
      const curScore = home >= 0 ? tileScore(hx, hy) : -1e9;
      if (home < 0 || curScore < -50 || (worn && onHome) || tick % 12 === 0) {
        let bk = -1, bs = -1e9, bx = 0, by = 0;
        for (let k = 0; k < 16; k++) {
          const cx = (k % 4) - 1.5, cy = Math.floor(k / 4) - 1.5;
          if (worn && Math.abs(me.x - cx) <= 0.5 && Math.abs(me.y - cy) <= 0.5) continue;
          const sc = tileScore(cx, cy) - 0.3 * (Math.abs(cx - me.x) + Math.abs(cy - me.y));
          if (sc > bs) { bs = sc; bk = k; bx = cx; by = cy; }
        }
        if (bk >= 0 && (home < 0 || curScore < -50 || (worn && onHome) || bs > curScore + 3.5)) { home = bk; hx = bx; hy = by; }
      }
      nextHome = home;
      const goalD = Math.sqrt((hx - me.x) ** 2 + (hy - me.y) ** 2);
      if (goalD > 0.35) { const d = driveTo(hx, hy, goalD > 2.5 ? 0.6 : 0.4, opCan && dist < 8, true); turn = d.turn; thrust = d.thrust; }
    }
  }

  // ---------- 5. Safety override: never leave the square, never coast into a hole.
  if (!urgent) {
    const speed = Math.abs(vLong);
    const dirx = vLong >= 0 ? cosH : -cosH, diry = vLong >= 0 ? sinH : -sinH;
    // Being pushed, only drag slows the pair: my motors cannot shorten the stop.
    const pushed = touching && myTo < -0.3 && opTo > -0.2;
    const stop = (speed > 0 ? (pushed ? speed / 1.6 : speed / 1.6 - 3.125 * Math.log(1 + 0.2 * speed)) : 0) + (pushed ? 0.3 : 0.12);
    const sx = me.x + dirx * stop, sy = me.y + diry * stop;
    const hardLimit = hSoon - 0.3;
    const projOut = Math.max(Math.abs(sx), Math.abs(sy));
    const holeAhead = speed > 0.15 && blocked(me.x, me.y, sx + dirx * 0.2, sy + diry * 0.2, 0.05, false);
    const busy = mode !== "hold" && mode !== "brace" && mode !== "guard";
    const softLimit = opCan && dist < 3.5 ? hSoon - 1.4 : hSoon - 0.9;
    if (projOut > hardLimit || holeAhead) {
      const movingOut = speed > 0.25 && (holeAhead || me.vx * sx + me.vy * sy > 0);
      const power = me.energy < 3 ? 0.3 : 1;
      if (movingOut) {
        // Brake. A pivot in progress keeps its turn: turning sideways is itself the brake.
        thrust = -Math.sign(vLong) * power;
        if (mode !== "pivot") {
          mode = "escape"; until = 0;
          if (!holeAhead) {
            const toC = Math.atan2(-me.y, -me.x);
            turn = Math.abs(wrap(toC - me.heading)) < PI / 2 ? face(toC, 3, 0.7) : face(toC + PI, 3, 0.7);
          }
        }
      } else if (!touching) {
        // In contact at the edge the contact logic keeps its commands: driving toward the
        // center would mean driving into the pusher.
        mode = "escape"; until = 0;
        const d = driveTo(0, 0, power, true, false);
        thrust = d.thrust; turn = d.turn;
      }
    } else if (myOut > softLimit && !busy && !touching) {
      const urgentEdge = myOut > softLimit + 0.5;
      const cb = Math.atan2(-me.y, -me.x);
      const toC = wrap(cb - me.heading);
      const fwdFree = !blocked(me.x, me.y, me.x + cosH * 1.2, me.y + sinH * 1.2, 0.2, false);
      const bwdFree = !blocked(me.x, me.y, me.x - cosH * 1.2, me.y - sinH * 1.2, 0.2, false);
      if (opCan && dist < 3 && !urgentEdge) {
        // Keep the wedge on them; creep toward the center along my own axis.
        thrust = Math.abs(toC) < PI / 2 && fwdFree ? 0.4 : bwdFree ? -0.4 : 0;
      } else {
        const d = driveTo(0, 0, urgentEdge ? 0.8 : 0.4, opCan && dist < 6, true);
        thrust = d.thrust; turn = d.turn;
      }
    }
  }

  // ---------- Final gate: thrust only along a clear axis (a hole beside me is one turn away).
  if (thrust > 0.06 || thrust < -0.06) {
    const sgn = thrust > 0 ? 1 : -1;
    const ahead = 0.45 + Math.abs(vLong) * 0.35;
    const px = me.x + cosH * sgn * ahead, py = me.y + sinH * sgn * ahead;
    const outAhead = Math.max(Math.abs(px), Math.abs(py));
    if ((!insideHz && blocked(me.x, me.y, px, py, 0.08, false)) || (outAhead > hSoon - 0.25 && outAhead > myOut)) {
      thrust = vLong * sgn > 0.2 ? -sgn * 0.6 : 0;
    }
  }

  return { actions: { thrust: clamp(thrust, -1, 1), turn: clamp(turn, -1, 1) }, memory: memory() };
}
