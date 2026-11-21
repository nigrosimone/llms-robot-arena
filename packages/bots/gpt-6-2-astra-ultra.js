function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function angleError(target, heading) {
  const delta = target - heading;
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

// Distance a center can travel on a ray before reaching the rim or a hazard.
function clearance(robot, ux, uy, rim, hazards, limit) {
  if (Math.abs(ux) > 0.00001) {
    limit = Math.min(limit, (Math.sign(ux) * rim - robot.x) / ux);
  }
  if (Math.abs(uy) > 0.00001) {
    limit = Math.min(limit, (Math.sign(uy) * rim - robot.y) / uy);
  }
  for (const cell of hazards) {
    const x = cell.x - robot.x;
    const y = cell.y - robot.y;
    const pad = 0.67;
    if (Math.abs(x) <= pad && Math.abs(y) <= pad) {
      // Inside the safety margin or standing on a warning tile: allow escape.
      if (Math.abs(x) >= Math.abs(y) ? x * ux <= 0 : y * uy <= 0) continue;
      return 0;
    }
    let enter = 0;
    let leave = limit;
    if (Math.abs(ux) > 0.00001) {
      enter = Math.max(enter, (x - Math.sign(ux) * pad) / ux);
      leave = Math.min(leave, (x + Math.sign(ux) * pad) / ux);
    } else if (Math.abs(x) > pad) continue;
    if (Math.abs(uy) > 0.00001) {
      enter = Math.max(enter, (y - Math.sign(uy) * pad) / uy);
      leave = Math.min(leave, (y + Math.sign(uy) * pad) / uy);
    } else if (Math.abs(y) > pad) continue;
    if (enter <= leave) limit = enter;
  }
  return Math.max(0, limit);
}

export function tick(sensors, memory) {
  const { opponent, arena } = sensors;
  const robot = sensors.self;
  if (robot.status === 'flipped' || robot.energy === 0) {
    return { actions: { thrust: 0, turn: 0 }, memory: null };
  }

  const rim = arena.nextHalfExtent - 0.25;
  const dx = opponent.x - robot.x;
  const dy = opponent.y - robot.y;
  const distance = Math.hypot(dx, dy);
  const hazards = [];
  let worn = false;
  let charger = null;
  let chargerCost = Infinity;
  for (const cell of arena.cells) {
    if (cell.state === 'inactive') continue;
    const cx = cell.x - robot.x;
    const cy = cell.y - robot.y;
    const onCell = Math.abs(cx) <= 0.5 && Math.abs(cy) <= 0.5;
    const opening = cell.collapseIn != null || cell.type === 'hole';
    if (onCell && (opening || cell.integrity < 0.22)) worn = true;
    const hot = cell.type === 'flame' && cell.state !== 'safe';
    if ((opening || hot) && Math.abs(cx) < 5 && Math.abs(cy) < 5) {
      hazards.push(cell);
    }
    if (cell.type !== 'recharge' || cell.state !== 'ready' || opening || onCell) continue;
    if (Math.max(Math.abs(cell.x), Math.abs(cell.y)) > rim - 0.25) continue;
    const cost = Math.hypot(cx, cy) + 2 * (1 - cell.integrity);
    if (cost < chargerCost) {
      chargerCost = cost;
      charger = cell;
    }
  }

  // Lead only until contact. A rapidly turning opponent travels less far
  // along its current velocity than one driving straight.
  const lead = clamp((distance - 0.8) / 4, 0, 0.65) / (1 + 0.4 * Math.abs(opponent.omega));
  let goalX = clamp(opponent.x + lead * opponent.vx, -rim, rim);
  let goalY = clamp(opponent.y + lead * opponent.vy, -rim, rim);
  let pursuing = true;
  const rechargeAt = sensors.time > 105 ? 263 : 208;
  if (charger && robot.energy < rechargeAt && (distance > 2.8 || robot.energy < 85)) {
    goalX = charger.x;
    goalY = charger.y;
    pursuing = false;
  }

  let escapeUntil = memory ? memory.escapeUntil : 0;
  let escapeX = memory ? memory.escapeX : 0;
  let escapeY = memory ? memory.escapeY : 0;
  if (worn && sensors.tick >= escapeUntil) {
    // Cross a tile boundary before the three-second opening warning expires.
    const inward = Math.atan2(-robot.y, -robot.x);
    escapeX = clamp(robot.x + 2.4 * Math.cos(inward), -rim, rim);
    escapeY = clamp(robot.y + 2.4 * Math.sin(inward), -rim, rim);
    escapeUntil = sensors.tick + 110;
  }
  if (sensors.tick < escapeUntil) {
    goalX = escapeX;
    goalY = escapeY;
    pursuing = false;
  }

  const bearing = Math.atan2(goalY - robot.y, goalX - robot.x);
  const goalDistance = Math.hypot(goalX - robot.x, goalY - robot.y);
  const look = clamp(goalDistance, 1.1, 3.8);
  let course = bearing;
  let side = memory ? memory.side : 0;
  const room = clearance(robot, Math.cos(bearing), Math.sin(bearing), rim, hazards, look);
  if (room < look - 0.02) {
    // Prefer a short clear detour. Remember the side to avoid alternating at
    // opposite corners of the same blocked tile on successive ticks.
    let best = room - 0.04 * Math.abs(angleError(course, robot.heading));
    let bestSide = side;
    for (const offset of [0.45, -0.45, 0.85, -0.85, 1.35, -1.35, 1.9, -1.9, 2.65, -2.65]) {
      const candidate = bearing + offset;
      const free = clearance(robot, Math.cos(candidate), Math.sin(candidate), rim, hazards, look);
      const sign = Math.sign(offset);
      const score = free - 0.52 * Math.abs(offset)
        - 0.04 * Math.abs(angleError(candidate, robot.heading)) + (sign === side ? 0.14 : 0);
      if (score > best) {
        best = score;
        course = candidate;
        bestSide = sign;
      }
    }
    side = bestSide;
  } else {
    side = 0;
  }

  let error = angleError(course, robot.heading);
  const direction = !pursuing && Math.abs(error) > 1.8 ? -1 : 1;
  if (direction < 0) error = angleError(course + Math.PI, robot.heading);
  const turn = clamp(3.8 * error - 1.1 * robot.omega, -1, 1);
  const forwardX = Math.cos(robot.heading);
  const forwardY = Math.sin(robot.heading);
  const speed = robot.vx * forwardX + robot.vy * forwardY;
  const driveRoom = clearance(robot, direction * forwardX, direction * forwardY, rim, hazards, 4);
  const aligned = Math.max(0, Math.cos(error));
  let cruise = pursuing ? 4.65 : 3.0;
  if (robot.energy < 150) cruise = pursuing ? 3.25 : 2.25;
  if (!pursuing) cruise = Math.min(cruise, 0.75 + 1.6 * goalDistance);
  // Leave braking distance along the actual heading while steering onto
  // the selected route. Drag assists the tracks under reverse thrust.
  const speedLimit = Math.sqrt(10 * Math.max(0, driveRoom - 0.08));
  const desired = direction * Math.min(cruise * aligned * aligned, speedLimit);
  const thrust = clamp(desired / 5 + 0.9 * (desired - speed), -1, 1);
  return {
    actions: { thrust, turn },
    memory: { side, escapeUntil, escapeX, escapeY },
  };
}
