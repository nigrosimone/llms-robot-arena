export function tick(s, m) {
  const dx = s.opponent.x - s.self.x;
  const dy = s.opponent.y - s.self.y;
  const distance = Math.hypot(dx, dy);
  const bearing = Math.atan2(dy, dx);

  let err = bearing - s.self.heading;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;

  const energy = s.self.energy;
  const halfExt = s.arena.halfExtent;

  let closestRecharge = null;
  let minRechargeDistance = Infinity;
  for (const cell of s.arena.cells) {
    if (cell.type === 'recharge' && cell.state === 'ready') {
      const cdx = cell.x - s.self.x;
      const cdy = cell.y - s.self.y;
      const cdist = Math.hypot(cdx, cdy);
      if (cdist < minRechargeDistance) {
        minRechargeDistance = cdist;
        closestRecharge = { x: cell.x, y: cell.y };
      }
    }
  }

  let shouldRecharge = (energy < 100 && closestRecharge && minRechargeDistance < 6) ||
                       (energy < 30 && closestRecharge);

  let targetBearing = bearing;
  if (shouldRecharge && closestRecharge) {
    targetBearing = Math.atan2(closestRecharge.y - s.self.y, closestRecharge.x - s.self.x);
  }

  let targetErr = targetBearing - s.self.heading;
  while (targetErr > Math.PI) targetErr -= 2 * Math.PI;
  while (targetErr < -Math.PI) targetErr += 2 * Math.PI;

  let thrust = 0;
  if (s.self.status === 'active') {
    const absErr = Math.abs(targetErr);
    if (shouldRecharge && closestRecharge) {
      if (absErr < 0.5) thrust = 0.9;
      else if (absErr < 1.0) thrust = 0.5;
      else thrust = 0.2;
    } else {
      if (absErr < 0.3) thrust = energy > 150 ? 1.0 : (energy > 80 ? 0.8 : 0.5);
      else if (absErr < 0.6) thrust = 0.5;
      else thrust = 0.2;
    }

    if (Math.abs(s.self.x) > halfExt - 1.5 || Math.abs(s.self.y) > halfExt - 1.5) {
      thrust *= 0.5;
    }
  }

  let turn = Math.max(-1, Math.min(1, targetErr * 1.5));

  return {
    actions: { thrust, turn },
    memory: null,
  };
}
