export function tick(s, memory) {
  const me = s.self, foe = s.opponent, cells = s.arena.cells;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const dx = foe.x - me.x, dy = foe.y - me.y;
  const dist = Math.hypot(dx, dy);
  let aim = Math.atan2(dy, dx);
  let emergency = false;
  const limit = s.arena.nextHalfExtent - 1.0;
  const px = me.x + me.vx * 0.45, py = me.y + me.vy * 0.45;
  if (Math.abs(px) > limit || Math.abs(py) > limit) {
    aim = Math.atan2(-me.y, -me.x);
    emergency = true;
  }
  let best = -1e9, selected = aim;
  for (let k = 0; k < 13; k++) {
    const offset = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.32;
    const angle = aim + offset;
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const horizon = Math.min(2.0, Math.max(1.1, dist));
    const tx = me.x + horizon * ux, ty = me.y + horizon * uy;
    let score = -Math.abs(offset) * 2 - Math.abs(wrap(angle - me.heading)) * 0.15;
    if (Math.abs(tx) > limit || Math.abs(ty) > limit) score -= 12;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.state === 'inactive') continue;
      const hole = c.type === 'hole' || c.state === 'hole';
      const warning = c.type === 'collapse' || c.collapseIn !== null;
      const fire = c.type === 'flame' && (c.state === 'flaming' || c.state === 'warning');
      if (!hole && !warning && !fire) continue;
      const margin = hole ? 0.23 : 0.08;
      const minX = c.x - 0.5 - margin, maxX = c.x + 0.5 + margin;
      const minY = c.y - 0.5 - margin, maxY = c.y + 0.5 + margin;
      const inside = me.x >= minX && me.x <= maxX && me.y >= minY && me.y <= maxY;
      let lo = 0, hi = 1;
      if (Math.abs(tx - me.x) < 0.00001) { if (me.x < minX || me.x > maxX) continue; }
      else { const a = (minX - me.x) / (tx - me.x), b = (maxX - me.x) / (tx - me.x); lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
      if (Math.abs(ty - me.y) < 0.00001) { if (me.y < minY || me.y > maxY) continue; }
      else { const a = (minY - me.y) / (ty - me.y), b = (maxY - me.y) / (ty - me.y); lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
      if (lo <= hi && hi >= 0 && lo <= 1) {
        if (inside && !hole) {
          if (tx >= minX && tx <= maxX && ty >= minY && ty <= maxY) score -= 5;
        } else score -= hole ? 30 : warning ? 20 : 5;
      }
    }
    if (score > best) { best = score; selected = angle; }
  }
  const error = wrap(selected - me.heading);
  const turn = clamp(2.6 * error - 0.75 * me.omega, -1, 1);
  let thrust = Math.abs(error) < 0.55 ? 1 : Math.abs(error) < 1.1 ? 0.35 : 0;
  if (dist > 4 && !emergency) thrust *= 0.8;
  if (best < -10) thrust = 0;
  return { actions: { thrust, turn }, memory: null };
}
