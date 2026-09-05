// @model gpt-6-astra-ultra
// Developed iteratively against local controllers; not a one-shot submission.
// One file, one export, all persistence in JSON memory.
// Priorities: remain on the platform, protect the wedge, bank energy, punish openings.
export function tick(s, memory) {
  const a = s.self,
    b = s.opponent;
  const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
  const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v));
  const m = memory && typeof memory === "object" ? memory : {};
  if (a.status === "flipped")
    return { actions: { thrust: 0, turn: 0 }, memory: { rest: true } };

  const dx = b.x - a.x,
    dy = b.y - a.y;
  const distance = Math.hypot(dx, dy),
    d2 = Math.max(0.16, dx * dx + dy * dy);
  const bearing = Math.atan2(dy, dx);
  const rvx = b.vx - a.vx,
    rvy = b.vy - a.vy;
  const closing = -(dx * rvx + dy * rvy) / Math.max(distance, 0.4);
  const los = clamp((dx * rvy - dy * rvx) / d2, -2.5, 2.5);
  const ca = Math.cos(a.heading),
    sa = Math.sin(a.heading);
  const forward = a.vx * ca + a.vy * sa;
  const half = s.arena.nextHalfExtent;
  const edge = half - Math.max(Math.abs(a.x), Math.abs(a.y));
  const futureEdge =
    half - Math.max(Math.abs(a.x + a.vx * 0.55), Math.abs(a.y + a.vy * 0.55));
  const radius = Math.hypot(a.x, a.y),
    opponentRadius = Math.hypot(b.x, b.y);
  const exposure = Math.abs(wrap(bearing + Math.PI - b.heading));
  const winning = a.flipsTaken < b.flipsTaken;
  const losing = a.flipsTaken > b.flipsTaken;
  const rest = a.energy < 32 || (m.rest === true && a.energy < 92);
  const imminent = distance < 1.35 || (distance < 3.2 && closing > 1.1);
  const panic = edge < 0.65 || futureEdge < 0.8;

  let target = bearing,
    speed = 0,
    track = los,
    attack = false;
  let reversing = false;
  // A compact central footprint leaves room to brake under the moving boundary.
  const homeRadius = Math.min(2, half - 1.5);
  const exposed = exposure > 1.1 && Math.abs(b.omega) < 2.4;
  const powerless = b.status === "flipped" || b.energy < 12;
  const canSpend = a.energy > (losing ? 24 : rest ? 88 : 76);
  const timeLeft = Math.max(0, 120 - s.time);
  const rechargeBudget = Math.max(0, timeLeft - 0.65) * 5.4;
  const mustScore =
    losing || (timeLeft < 14 && a.energy + rechargeBudget < b.energy - 4);
  const recentContact = s.lastContact && s.tick - s.lastContact.tick < 3;

  if (panic || (!imminent && radius > homeRadius && !powerless)) {
    target = Math.atan2(-a.y, -a.x);
    track = 0;
    speed = panic ? 3.2 : clamp((radius - homeRadius) * 1.4, 0.35, 2.8);
    let err = wrap(target - a.heading);
    if (Math.abs(err) > Math.PI / 2) {
      target = wrap(target + Math.PI);
      reversing = true;
    }
  } else if (
    !winning &&
    canSpend &&
    (powerless || (exposed && distance < 5.5) || mustScore)
  ) {
    attack = true;
    const lead = clamp((distance - 0.75) / 5, 0, 0.55);
    target = Math.atan2(dy + b.vy * lead, dx + b.vx * lead);
    track = los * 0.55;
    speed = powerless ? 3.8 : 4.7;
  } else if (
    winning &&
    b.status === "flipped" &&
    distance < 1.6 &&
    opponentRadius > half - 2 &&
    a.energy > 35
  ) {
    attack = true;
    speed = 3.4;
  } else if (
    distance < 1.15 &&
    (closing > 0.2 || (recentContact && futureEdge < 2)) &&
    radius > opponentRadius + 0.25 &&
    a.energy > 18
  ) {
    // Resist a shove towards the edge; do not continually ram a defended wedge.
    speed = 1;
  } else if (!imminent && radius > homeRadius * 0.6 && distance > 3.5) {
    target = Math.atan2(-a.y, -a.x);
    track = 0;
    speed = 0.24;
    if (Math.abs(wrap(target - a.heading)) > Math.PI / 2) {
      target = wrap(target + Math.PI);
      reversing = true;
    }
  }

  const error = wrap(target - a.heading);
  // Feed-forward line-of-sight motion and damping account for yaw inertia.
  let turn = clamp(3.2 * error + 1.3 * track - 1.12 * a.omega, -1, 1);
  const yawForecast = wrap(error + track * 0.35 - a.omega * 0.3);
  const tolerance = imminent ? 0.065 : attack ? 0.08 : 0.24;
  if (
    Math.abs(yawForecast) < tolerance &&
    Math.abs(a.omega) < (imminent ? 0.24 : 0.85)
  ) {
    turn = 0;
  }
  // Slow corrections can remain inside the explicitly allowed regeneration band.
  if (Math.abs(turn) <= 0.12 && !imminent) turn = clamp(turn, -0.049, 0.049);

  const alignment = Math.cos(error);
  let desired = speed * clamp((alignment - 0.2) / 0.8, 0, 1);
  if (reversing) desired = -desired;
  let thrust = clamp((1.6 * desired + 3.4 * (desired - forward)) / 8, -1, 1);
  if (speed === 0 && Math.abs(forward) < 0.28) thrust = 0;
  if (
    speed > 0 &&
    speed <= 0.25 &&
    Math.abs(error) < 0.2 &&
    Math.abs(forward) < 0.35
  )
    thrust = reversing ? -0.049 : 0.049;
  // A defended front is an energy trade, so do not burn a charge into it blindly.
  if (attack && !powerless && exposure < 0.72 && !mustScore && distance < 1.6)
    thrust = Math.min(thrust, 0.15);
  if (rest && !panic && !attack && !imminent && speed > 0.25)
    thrust = clamp(thrust, -0.32, 0.32);
  if (Math.abs(thrust) < 0.035) thrust = 0;
  // Even at the edge, accumulating a usable reserve beats spending each tiny
  // regeneration pulse immediately. This also breaks prolonged contact stalls.
  const emergencyRest =
    a.energy < 1 || (m.emergencyRest === true && a.energy < 5);
  if (emergencyRest) {
    thrust = 0;
    turn = 0;
  }
  return { actions: { thrust, turn }, memory: { rest, emergencyRest } };
}
