// baseline
// Very basic bot
export function tick(s, m) {
  const dx = s.opponent.x - s.self.x;
  const dy = s.opponent.y - s.self.y;
  const bearing = Math.atan2(dy, dx);
  let err = bearing - s.self.heading;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  return {
    actions: {
      turn: Math.max(-1, Math.min(1, err * 1.5)),
      thrust: Math.abs(err) < 0.3 ? 0.8 : 0.2,
    },
    memory: m,
  };
}
