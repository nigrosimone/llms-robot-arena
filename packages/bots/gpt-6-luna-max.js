function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function wrapAngle(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

function unit(x, y) {
  const length = Math.sqrt(x * x + y * y);
  if (length < 1e-9) return { x: 0, y: 0, length: 0 };
  return { x: x / length, y: y / length, length };
}

function cellIsDangerous(cell) {
  if (cell.state === 'inactive') return false;
  if (cell.type === 'hole' || cell.state === 'hole') return true;
  if (cell.type === 'collapse' || cell.collapseIn !== null) return true;
  if (cell.type === 'flame' && (cell.state === 'flaming' || (cell.state === 'warning' && cell.timeUntilChange <= 0.8))) return true;
  return cell.integrity <= 0.12 && cell.type !== 'recharge';
}

function steerAroundCells(dx, dy, robot, sensors) {
  let direction = unit(dx, dy);
  if (direction.length < 1e-9) return { x: 0, y: 0, risk: 0 };

  let ax = direction.x;
  let ay = direction.y;
  let risk = 0;
  const cells = sensors.arena.cells;

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (!cellIsDangerous(cell)) continue;

    const ox = cell.x - robot.x;
    const oy = cell.y - robot.y;
    const along = ox * direction.x + oy * direction.y;
    if (along < -0.3 || along > 5.5) continue;

    const lateral = ox * direction.y - oy * direction.x;
    const lateralGap = Math.abs(lateral);
    const hardHole = cell.type === 'hole' || cell.state === 'hole';
    const radius = hardHole ? 1.65 : 1.35;
    if (lateralGap > radius + 0.4) continue;

    let side;
    if (lateralGap > 0.12) {
      side = lateral > 0 ? -1 : 1;
    } else {
      const parity = Math.floor((cell.x + 16) * 2 + (cell.y + 16) * 3);
      side = parity % 2 === 0 ? 1 : -1;
    }

    const proximity = clamp((5.5 - along) / 3.0, 0, 1);
    const clearance = clamp((radius + 0.4 - lateralGap) / (radius + 0.4), 0, 1);
    const strength = (hardHole ? 4.2 : 2.8) * proximity * clearance;
    risk = Math.max(risk, proximity * clearance);
    const px = -direction.y * side;
    const py = direction.x * side;
    ax += px * strength;
    ay += py * strength;

    const distance = Math.sqrt(ox * ox + oy * oy);
    if (distance < 1.5 && distance > 1e-6) {
      const push = (1.5 - distance) * (hardHole ? 2.2 : 1.5);
      ax -= (ox / distance) * push;
      ay -= (oy / distance) * push;
    }
  }

  const safeEdge = sensors.arena.halfExtent - 1.15;
  const edgeRange = 2.2;
  if (robot.x > safeEdge - edgeRange) ax -= clamp((robot.x - (safeEdge - edgeRange)) / edgeRange, 0, 1) * 2.5;
  if (robot.x < -safeEdge + edgeRange) ax += clamp((-safeEdge + edgeRange - robot.x) / edgeRange, 0, 1) * 2.5;
  if (robot.y > safeEdge - edgeRange) ay -= clamp((robot.y - (safeEdge - edgeRange)) / edgeRange, 0, 1) * 2.5;
  if (robot.y < -safeEdge + edgeRange) ay += clamp((-safeEdge + edgeRange - robot.y) / edgeRange, 0, 1) * 2.5;

  direction = unit(ax, ay);
  return { x: direction.x, y: direction.y, risk };
}

function chooseRecharge(sensors) {
  const robot = sensors.self;
  const limit = sensors.arena.halfExtent - 0.9;
  let chosen = null;
  let bestDistance = Infinity;

  for (let i = 0; i < sensors.arena.cells.length; i += 1) {
    const cell = sensors.arena.cells[i];
    if (cell.type !== 'recharge' || cell.state !== 'ready' || cell.collapseIn !== null) continue;
    if (cell.x < -limit || cell.x > limit || cell.y < -limit || cell.y > limit) continue;
    const dx = cell.x - robot.x;
    const dy = cell.y - robot.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      chosen = cell;
    }
  }
  return chosen;
}

export function tick(sensors, memory) {
  const robot = sensors.self;
  const opponent = sensors.opponent;
  const previousSide = memory && (memory.side === 1 || memory.side === -1) ? memory.side : null;
  let side = previousSide;

  if (side === null) {
    const relX = robot.x - opponent.x;
    const relY = robot.y - opponent.y;
    const cross = Math.cos(opponent.heading) * relY - Math.sin(opponent.heading) * relX;
    side = Math.abs(cross) > 0.15 ? (cross > 0 ? -1 : 1) : (robot.x + robot.y <= opponent.x + opponent.y ? 1 : -1);
  }

  if (robot.status === 'flipped' || robot.energy <= 0) {
    return { actions: { thrust: 0, turn: 0 }, memory: { side } };
  }

  const arenaLimit = sensors.arena.halfExtent - 1.2;
  const predictedX = opponent.x + clamp(opponent.vx * 0.22, -0.9, 0.9);
  const predictedY = opponent.y + clamp(opponent.vy * 0.22, -0.9, 0.9);
  const predictedHeading = wrapAngle(opponent.heading + clamp(opponent.omega * 0.18, -0.28, 0.28));
  const dxToOpponent = predictedX - robot.x;
  const dyToOpponent = predictedY - robot.y;
  const distance = Math.sqrt(dxToOpponent * dxToOpponent + dyToOpponent * dyToOpponent);

  let goalX;
  let goalY;
  let charging = false;
  const charger = robot.energy < 90 ? chooseRecharge(sensors) : null;

  if (charger) {
    goalX = charger.x;
    goalY = charger.y;
    charging = true;
  } else {
    const edgeX = Math.max(0, Math.abs(predictedX) - (sensors.arena.halfExtent - 2.7));
    const edgeY = Math.max(0, Math.abs(predictedY) - (sensors.arena.halfExtent - 2.7));
    let outwardX = predictedX;
    let outwardY = predictedY;

    if (edgeX > 0 || edgeY > 0) {
      if (edgeX >= edgeY) {
        outwardX = predictedX >= 0 ? 1 : -1;
        outwardY = 0;
      } else {
        outwardX = 0;
        outwardY = predictedY >= 0 ? 1 : -1;
      }
    } else {
      const outward = unit(outwardX, outwardY);
      if (outward.length > 1e-6) {
        outwardX = outward.x;
        outwardY = outward.y;
      } else {
        outwardX = Math.cos(predictedHeading);
        outwardY = Math.sin(predictedHeading);
      }
    }

    const relativeX = robot.x - predictedX;
    const relativeY = robot.y - predictedY;
    const relativeAngle = wrapAngle(Math.atan2(relativeY, relativeX) - predictedHeading);
    let approachX;
    let approachY;

    if (opponent.status === 'flipped' || edgeX > 0 || edgeY > 0) {
      approachX = -outwardX;
      approachY = -outwardY;
    } else if (Math.abs(relativeAngle) > 0.88) {
      const approach = unit(relativeX, relativeY);
      approachX = approach.x;
      approachY = approach.y;
    } else {
      const approachAngle = predictedHeading + side * 1.12;
      approachX = Math.cos(approachAngle);
      approachY = Math.sin(approachAngle);
    }

    goalX = predictedX - approachX * 0.38;
    goalY = predictedY - approachY * 0.38;
  }

  goalX = clamp(goalX, -arenaLimit, arenaLimit);
  goalY = clamp(goalY, -arenaLimit, arenaLimit);

  const goalDx = goalX - robot.x;
  const goalDy = goalY - robot.y;

  const desired = steerAroundCells(goalDx, goalDy, robot, sensors);
  const desiredBearing = Math.atan2(desired.y, desired.x);
  const headingError = wrapAngle(desiredBearing - robot.heading);
  const turn = clamp(1.85 * headingError - 0.62 * robot.omega, -1, 1);

  const speedAlong = robot.vx * desired.x + robot.vy * desired.y;
  const nearContact = !charging && distance < 2.0;
  const hazardSlowdown = clamp((desired.risk - 0.05) / 0.95, 0, 1);
  const normalSpeed = charging ? 3.5 : (nearContact ? 5.1 : 4.8);
  const desiredSpeed = normalSpeed - hazardSlowdown * 2.1;
  const speedCommand = clamp((desiredSpeed - speedAlong) * 0.48, 0, 1);

  let energyLimit;
  if (charging) {
    energyLimit = robot.energy < 55 ? 0.85 : 0.75;
  } else if (robot.energy > 125) {
    energyLimit = 1;
  } else if (robot.energy > 85) {
    energyLimit = 0.72;
  } else if (robot.energy > 50) {
    energyLimit = 0.5;
  } else {
    energyLimit = 0.34;
  }

  const alignment = Math.max(0, Math.cos(headingError));
  let thrust = Math.min(speedCommand, energyLimit) * alignment;
  if (nearContact && alignment > 0.72 && !charging && hazardSlowdown < 0.25) {
    thrust = Math.max(thrust, energyLimit);
  }
  if (Math.abs(headingError) > 1.35) thrust *= 0.18;

  const forwardSpeed = robot.vx * Math.cos(robot.heading) + robot.vy * Math.sin(robot.heading);
  if (desired.risk > 0.12 && Math.cos(headingError) > 0.35 && forwardSpeed > desiredSpeed + 0.2) {
    thrust = -Math.min(0.65, (forwardSpeed - desiredSpeed) * 0.34);
  }

  return {
    actions: { thrust: clamp(thrust, -1, 1), turn },
    memory: { side },
  };
}
