export function tick(sensors, memory) {
  const a = sensors["self"];
  const b = sensors.opponent;

  if (a.status === "flipped" || a.energy <= 0.01) {
    return { actions: { thrust: 0, turn: 0 }, memory: null };
  }

  let tx = b.x;
  let ty = b.y;
  const h = sensors.arena.nextHalfExtent;
  const edge = h - 1.15;

  if (a.x > edge || a.x < -edge || a.y > edge || a.y < -edge) {
    tx = 0;
    ty = 0;
  } else if (b.status === "flipped" || b.energy <= 0.01) {
    tx = b.x * 1.35;
    ty = b.y * 1.35;
  }

  const gy = ty - a.y;
  const gx = tx - a.x;
  const ay = gy < 0 ? -gy : gy;
  let goal;
  let ratio;
  if (gx >= 0) {
    ratio = (gx - ay) / (gx + ay + 0.000001);
    goal = 0.7853981633974483 - 0.7853981633974483 * ratio;
  } else {
    ratio = (gx + ay) / (ay - gx + 0.000001);
    goal = 2.356194490192345 - 0.7853981633974483 * ratio;
  }
  if (gy < 0) goal = -goal;
  let err = goal - a.heading;
  if (err > 3.141592653589793) err -= 6.283185307179586;
  else if (err <= -3.141592653589793) err += 6.283185307179586;
  const ae = err < 0 ? -err : err;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  let thrust = a.energy > 65 ? 0.7 : 0.34;

  if (d2 < 14 && a.energy > 40) thrust = 1.0;
  if (ae > 1.55) thrust *= 0.1;
  else if (ae > 0.9) thrust *= 0.35;
  else if (ae > 0.42) thrust *= 0.68;

  let turn = err * 2.7 - a.omega * 0.4;
  if (turn > 1) turn = 1;
  else if (turn < -1) turn = -1;

  return {
    actions: { thrust: thrust, turn: turn },
    memory: null,
  };
}
