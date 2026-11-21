const FINAL_HALF_EXTENT = 3.8;

function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function angleError(target, heading) {
  let error = (target - heading) % (2 * Math.PI);
  if (error > Math.PI) error -= 2 * Math.PI;
  if (error < -Math.PI) error += 2 * Math.PI;
  return error;
}

function intersectsCell(x, y, toX, toY, cell, radius) {
  const startX = x - cell.x;
  const startY = y - cell.y;
  const endX = toX - cell.x;
  const endY = toY - cell.y;
  if (Math.min(startX, endX) > radius || Math.max(startX, endX) < -radius ||
      Math.min(startY, endY) > radius || Math.max(startY, endY) < -radius) {
    return false;
  }
  const dx = endX - startX;
  const dy = endY - startY;
  return Math.abs(startX * dy - startY * dx) <= radius * (Math.abs(dx) + Math.abs(dy));
}

function clearRoute(robot, x, y, hazards, margin, avoidFire = true) {
  for (const cell of hazards) {
    if (!avoidFire && cell.fire) continue;
    const radius = cell.radius + margin;
    if (!intersectsCell(robot.x, robot.y, x, y, cell, radius)) continue;

    // A warning or a padded hazard can already contain us. Permit a path out.
    const startGap = Math.max(Math.abs(robot.x - cell.x), Math.abs(robot.y - cell.y));
    const endGap = Math.max(Math.abs(x - cell.x), Math.abs(y - cell.y));
    if (startGap <= radius && endGap > startGap &&
        ((!cell.open && startGap <= cell.radius) ||
          !intersectsCell(robot.x, robot.y, x, y, cell, cell.radius))) {
      continue;
    }
    return false;
  }
  return true;
}

function readArena(robot, cells) {
  const hazards = [];
  const chargers = [];
  let support = null;
  const tileX = Math.min(7, Math.floor(robot.x));
  const tileY = Math.min(7, Math.floor(robot.y));
  for (const cell of cells) {
    if (cell.state === 'inactive') continue;
    if (cell.x === tileX + 0.5 && cell.y === tileY + 0.5) support = cell;
    const open = cell.state === 'hole';
    const fire = cell.type === 'flame' && cell.collapseIn === null;
    if (open || cell.collapseIn !== null || fire) {
      hazards.push({ x: cell.x, y: cell.y, radius: cell.size / 2, open, fire });
    } else if (cell.type === 'recharge' && cell.state === 'ready') {
      chargers.push(cell);
    }
  }
  return { hazards, chargers, support };
}

function chooseParking(robot, opponent, cells, hazards, frontX, frontY) {
  const tiles = [];
  for (const cell of cells) {
    const index = Math.floor(cell.x) + 8 + 16 * (Math.floor(cell.y) + 8);
    tiles[index] = cell;
  }

  let best = null;
  let bestScore = Infinity;
  const tileX = Math.floor(robot.x);
  const tileY = Math.floor(robot.y);
  const centerX = clamp(tileX, -4, 3);
  const centerY = clamp(tileY, -4, 3);
  for (let i = Math.max(-4, centerX - 2); i <= Math.min(3, centerX + 2); i++) {
    for (let j = Math.max(-4, centerY - 2); j <= Math.min(3, centerY + 2); j++) {
      if (i === tileX && j === tileY) continue;
      const cell = tiles[i + 8 + 16 * (j + 8)];
      const integrity = cell?.integrity ?? 1;
      if (integrity < 0.40 || cell?.type === 'flame') continue;

      const x = i + 0.5;
      const y = j + 0.5;
      const dx = x - robot.x;
      const dy = y - robot.y;
      const distance = Math.hypot(dx, dy);
      const alignment = Math.abs(dx * frontX + dy * frontY) / distance;
      const opponentGap = Math.hypot(x - opponent.x, y - opponent.y);
      const crowding = Math.max(0, 2.2 - opponentGap);
      const outer = Math.max(0, Math.max(Math.abs(x), Math.abs(y)) - 2.5);
      const score = distance + 2.2 * (1 - integrity) + 0.65 * (1 - alignment) +
        0.08 * (x * x + y * y) + 0.9 * outer + 1.5 * crowding;
      if (score < bestScore && clearRoute(robot, x, y, hazards, 0.22)) {
        bestScore = score;
        best = { x, y, charge: false };
      }
    }
  }
  return best;
}

function chooseCharger(robot, opponent, chargers, hazards, halfExtent) {
  let best = null;
  let bestScore = Infinity;
  for (const cell of chargers) {
    const limit = Math.min(halfExtent - 0.9, FINAL_HALF_EXTENT - 0.3);
    if (Math.max(Math.abs(cell.x), Math.abs(cell.y)) > limit) continue;
    if (Math.abs(cell.x - robot.x) <= 0.5 && Math.abs(cell.y - robot.y) <= 0.5) continue;
    const distance = Math.hypot(cell.x - robot.x, cell.y - robot.y);
    const opponentGap = Math.hypot(cell.x - opponent.x, cell.y - opponent.y);
    const score = distance + Math.max(0, 2.4 - opponentGap) * 2;
    if (score < bestScore && clearRoute(robot, cell.x, cell.y, hazards, 0.25)) {
      bestScore = score;
      best = { x: cell.x, y: cell.y, charge: true };
    }
  }
  return best;
}

function edgeClear(robot, x, y, limit) {
  return Math.abs(x) <= Math.max(limit, Math.abs(robot.x)) &&
    Math.abs(y) <= Math.max(limit, Math.abs(robot.y));
}

function safeThrust(robot, frontX, frontY, speed, thrust, hazards, halfExtent) {
  const limit = halfExtent - 0.21;
  if (Math.abs(speed) > 0.15) {
    const stopTime = 0.25 + 0.20 / Math.abs(speed);
    const x = robot.x + robot.vx * stopTime;
    const y = robot.y + robot.vy * stopTime;
    if (!edgeClear(robot, x, y, limit) || !clearRoute(robot, x, y, hazards, 0.09, false)) {
      return -Math.sign(speed);
    }
  }

  if (thrust * speed < 0 && Math.abs(speed) > 0.15) return thrust;
  const probe = Math.sign(thrust) * (0.27 + 0.24 * Math.abs(speed));
  const x = robot.x + frontX * probe;
  const y = robot.y + frontY * probe;
  if (!edgeClear(robot, x, y, limit) || !clearRoute(robot, x, y, hazards, 0.07, false)) {
    return clamp(-0.65 * speed);
  }
  return thrust;
}

export function tick(sensors, memory) {
  const { opponent, arena, time, tick } = sensors;
  const robot = sensors.self;
  if (robot.status === 'flipped' || robot.energy <= 0) {
    return { actions: { thrust: 0, turn: 0 }, memory: null };
  }

  const frontX = Math.cos(robot.heading);
  const frontY = Math.sin(robot.heading);
  const speed = robot.vx * frontX + robot.vy * frontY;
  const { hazards, chargers, support } = readArena(robot, arena.cells);
  const dx = opponent.x - robot.x;
  const dy = opponent.y - robot.y;
  const distance = Math.hypot(dx, dy);
  const opponentClosing = -(opponent.vx * dx + opponent.vy * dy) / Math.max(0.1, distance);
  const threat = opponent.status !== 'flipped' && distance < 2.8 &&
    (opponentClosing > 0.75 || distance < 1.2);
  const warning = support !== null && support.collapseIn !== null;
  const onFire = support?.type === 'flame';
  const nearShrink = Math.max(Math.abs(robot.x), Math.abs(robot.y)) > arena.halfExtent - 1.0;
  const escape = warning || onFire || nearShrink;
  const relocate = escape || (support?.integrity ?? 1) < 0.47;

  let goal = memory?.goal ?? null;
  if (goal !== null) {
    const arrived = goal.charge
      ? Math.abs(goal.x - robot.x) <= 0.5 && Math.abs(goal.y - robot.y) <= 0.5
      : Math.hypot(goal.x - robot.x, goal.y - robot.y) < 0.16;
    if (arrived || (goal.charge && !chargers.some(cell => cell.x === goal.x && cell.y === goal.y)) ||
        !clearRoute(robot, goal.x, goal.y, hazards, 0.15)) {
      goal = null;
    }
  }

  if (goal === null && !escape && !threat &&
      (robot.energy < 239 || (time > 96 && robot.energy + 2 < opponent.energy))) {
    goal = chooseCharger(robot, opponent, chargers, hazards, arena.halfExtent);
  }
  if (goal === null && relocate && (escape || tick % 6 === 0)) {
    goal = chooseParking(robot, opponent, arena.cells, hazards, frontX, frontY);
  }

  const lead = Math.min(0.24, distance * 0.18);
  const bearing = Math.atan2(dy + opponent.vy * lead, dx + opponent.vx * lead);
  const guardError = angleError(bearing, robot.heading);
  let turnError = guardError;
  let desiredSpeed = 0;
  const opponentBearing = Math.atan2(-dy, -dx);
  const exposed = Math.abs(angleError(opponentBearing, opponent.heading + 0.16 * opponent.omega));
  const losingOnFlips = robot.flipsTaken > opponent.flipsTaken;
  const attack = goal === null && !relocate && opponent.status === 'active' &&
    robot.energy > 50 && distance > 0.65 && distance < 4.2 && Math.abs(guardError) < 0.43 &&
    exposed > 1.23 && (opponentClosing > -0.9 || speed + opponentClosing > 2.7) &&
    (distance > 1.55 || speed + opponentClosing > 2.1 || losingOnFlips) &&
    edgeClear(robot, opponent.x, opponent.y, arena.halfExtent - 1.45) &&
    clearRoute(robot, opponent.x, opponent.y, hazards, 0.47);

  if (goal !== null && (!threat || escape)) {
    const goalX = goal.x - robot.x;
    const goalY = goal.y - robot.y;
    const error = angleError(Math.atan2(goalY, goalX), robot.heading);
    const direction = Math.abs(error) <= Math.PI / 2 ? 1 : -1;
    turnError = direction === 1 ? error : angleError(error + Math.PI, 0);
    const alignment = clamp(1 - Math.abs(turnError) / 1.08, 0, 1);
    const cruise = escape ? 1.85 : goal.charge ? 1.85 : 1.2;
    desiredSpeed = direction * Math.min(cruise, 1.8 * Math.hypot(goalX, goalY)) * alignment;
  } else if (attack) {
    desiredSpeed = 4.65 * (1 - Math.abs(guardError) * 0.6);
  } else if (threat && opponentClosing > 2.1 && Math.abs(guardError) < 0.52) {
    desiredSpeed = -0.75;
  } else if (distance > 5.5 && goal === null && !escape && Math.abs(turnError) < 0.10) {
    turnError = 0;
  }

  const turn = clamp(1.85 * turnError - 0.56 * robot.omega);
  const thrust = clamp(desiredSpeed / 5 + 0.63 * (desiredSpeed - speed));
  return {
    actions: { thrust: safeThrust(robot, frontX, frontY, speed, thrust, hazards, arena.nextHalfExtent), turn },
    memory: goal === null ? null : { goal },
  };
}
