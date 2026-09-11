export function tick(s, m) {
  const TAU = Math.PI * 2;
  const wrap = (a) => {
    let v = a % TAU;
    if (v > Math.PI) v -= TAU;
    if (v < -Math.PI) v += TAU;
    return v;
  };
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const me = s.self, opp = s.opponent, arena = s.arena;
  const mem = m && typeof m === "object" ? m : {};

  let orbit = typeof mem.orbit === "number" ? mem.orbit : 0;
  if (orbit === 0) {
    const b0 = Math.atan2(opp.y - me.y, opp.x - me.x);
    orbit = wrap(opp.heading - b0) > 0 ? 1 : -1;
  }

  const dx = opp.x - me.x, dy = opp.y - me.y;
  const dist = Math.hypot(dx, dy);
  const bearing = Math.atan2(dy, dx);
  const oppAim = wrap(Math.atan2(-dy, -dx) - opp.heading);
  const selfImmune = me.status === "recovering";
  const oppFlipped = opp.status === "flipped";
  const oppLow = opp.energy <= 0;
  const half = arena.nextHalfExtent;

  let tx = opp.x, ty = opp.y, spd = 0.6;

  if (oppFlipped || oppLow) {
    let ox = 0, oy = 0;
    if (Math.abs(opp.x) >= Math.abs(opp.y)) ox = Math.sign(opp.x) || 1;
    else oy = Math.sign(opp.y) || 1;
    tx = opp.x + ox * 1.6;
    ty = opp.y + oy * 1.6;
    spd = 1.0;
  } else {
    const needCharge = me.energy < 150 && (dist > 2.0 || me.energy < 90);
    let cell = null, bd = Infinity;
    if (needCharge) {
      for (let i = 0; i < arena.cells.length; i++) {
        const c = arena.cells[i];
        if (c.type === "recharge" && c.state === "ready") {
          const d = Math.hypot(c.x - me.x, c.y - me.y);
          if (d < bd) { bd = d; cell = c; }
        }
      }
    }
    if (cell) {
      tx = cell.x; ty = cell.y; spd = 0.9;
    } else {
      const facing = Math.abs(oppAim) < 0.72;
      if (facing && !selfImmune && dist > 1.2) {
        const hx = Math.cos(opp.heading), hy = Math.sin(opp.heading);
        const px = -hy, py = hx;
        tx = opp.x + px * orbit * 1.35;
        ty = opp.y + py * orbit * 1.35;
        spd = 0.6;
      } else {
        tx = opp.x; ty = opp.y; spd = 0.85;
      }
    }
  }

  let Vx = 0, Vy = 0, W = 0;
  const oo = Math.hypot(tx - me.x, ty - me.y);
  if (oo > 1e-6) {
    const w = 1.0;
    Vx += ((tx - me.x) / oo) * w;
    Vy += ((ty - me.y) / oo) * w;
    W += w;
  }

  const minClear = Math.min(half - Math.abs(me.x), half - Math.abs(me.y));
  let edgePull = clamp((1.2 - minClear) / 1.2, 0, 1);
  edgePull = edgePull * edgePull * 3;
  if (edgePull > 0) {
    const cd = Math.hypot(me.x, me.y) || 1e-6;
    Vx += (-me.x / cd) * edgePull;
    Vy += (-me.y / cd) * edgePull;
    W += edgePull;
  }

  for (let i = 0; i < arena.cells.length; i++) {
    const c = arena.cells[i];
    let danger = 0;
    if (c.state === "inactive") continue;
    if (c.type === "hole" || c.state === "hole") danger = 1;
    else if (c.state === "flaming") danger = 0.95;
    else if (c.type === "flame" && c.state === "warning") danger = 0.55;
    else if (c.type === "collapse" && c.state === "warning") danger = 0.8;
    else if (typeof c.integrity === "number" && c.integrity < 0.6) danger = 0.8;
    if (danger <= 0) continue;
    const hx = me.x - c.x, hy = me.y - c.y;
    const hd = Math.hypot(hx, hy) || 1e-6;
    const range = danger === 1 ? 1.8 : 1.5;
    if (hd > range) continue;
    const w = danger * (1 - hd / range) * 4;
    Vx += (hx / hd) * w;
    Vy += (hy / hd) * w;
    W += w;
  }

  const desired = W > 0 ? Math.atan2(Vy, Vx) : bearing;
  const ux = Math.cos(desired), uy = Math.sin(desired);
  let tSafe = Infinity;
  const candX = Math.abs(ux) > 1e-4 ? (ux > 0 ? (half - me.x) / ux : (-half - me.x) / ux) : Infinity;
  const candY = Math.abs(uy) > 1e-4 ? (uy > 0 ? (half - me.y) / uy : (-half - me.y) / uy) : Infinity;
  if (candX > 0 && candX < tSafe) tSafe = candX;
  if (candY > 0 && candY < tSafe) tSafe = candY;

  let err = wrap(desired - me.heading);
  let turn = clamp(err * 2.4 - me.omega * 0.35, -1, 1);
  let thrust = spd;
  if (Math.abs(err) > 1.2) thrust = Math.min(thrust, 0.1);
  else if (Math.abs(err) > 0.55) thrust = Math.min(thrust, 0.4);

  if (tSafe < 0.6) {
    thrust = -0.8;
    const cd = Math.hypot(me.x, me.y) || 1e-6;
    err = wrap(Math.atan2(-me.y, -me.x) - me.heading);
    turn = clamp(err * 2.4 - me.omega * 0.35, -1, 1);
  } else if (tSafe < 1.8 && thrust > 0) {
    thrust = Math.min(thrust, (tSafe - 0.5) * 0.9);
  }

  if (!Number.isFinite(thrust)) thrust = 0;
  if (!Number.isFinite(turn)) turn = 0;

  return {
    actions: { thrust: clamp(thrust, -1, 1), turn: clamp(turn, -1, 1) },
    memory: { orbit },
  };
}