function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function wrap(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

// 2 is a lethal or soon-to-be lethal tile; 1 is a tile worth routing around.
function cellKind(cell) {
  if (cell.state === "inactive") return 0;
  if (
    cell.type === "hole" ||
    cell.state === "hole" ||
    cell.type === "collapse" ||
    cell.collapseIn != null
  ) {
    return 2;
  }
  if (cell.type === "flame") return 1;
  if (typeof cell.integrity === "number" && cell.integrity < 0.12) return 1;
  return 0;
}

function segmentHitsBox(ax, ay, bx, by, cell, padding) {
  const minX = cell.x - 0.5 - padding;
  const maxX = cell.x + 0.5 + padding;
  const minY = cell.y - 0.5 - padding;
  const maxY = cell.y + 0.5 + padding;
  const dx = bx - ax;
  const dy = by - ay;
  let entry = 0;
  let exit = 1;

  if (Math.abs(dx) < 0.000001) {
    if (ax < minX || ax > maxX) return false;
  } else {
    let t1 = (minX - ax) / dx;
    let t2 = (maxX - ax) / dx;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    entry = Math.max(entry, t1);
    exit = Math.min(exit, t2);
    if (entry > exit) return false;
  }

  if (Math.abs(dy) < 0.000001) {
    if (ay < minY || ay > maxY) return false;
  } else {
    let t1 = (minY - ay) / dy;
    let t2 = (maxY - ay) / dy;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    entry = Math.max(entry, t1);
    exit = Math.min(exit, t2);
    if (entry > exit) return false;
  }
  return exit >= 0 && entry <= 1;
}

function hardRouteClear(ax, ay, bx, by, cells) {
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (cellKind(cell) !== 2) continue;
    // A controller may need to exit an announced tile it already occupies.
    if (Math.abs(ax - cell.x) <= 0.5 && Math.abs(ay - cell.y) <= 0.5) continue;
    if (segmentHitsBox(ax, ay, bx, by, cell, 0.72)) return false;
  }
  return true;
}

// If a direct line crosses a known dangerous cell, take a two-corner detour.
function routedGoal(ax, ay, gx, gy, cells, limit) {
  let blocked = -1;
  let firstAlongPath = 2;
  const pathX = gx - ax;
  const pathY = gy - ay;
  const pathLengthSquared = pathX * pathX + pathY * pathY;

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    const kind = cellKind(cell);
    if (kind !== 2) continue;
    const padding = 0.72;
    if (Math.abs(ax - cell.x) <= 0.5 && Math.abs(ay - cell.y) <= 0.5) {
      continue;
    }
    if (!segmentHitsBox(ax, ay, gx, gy, cell, padding)) continue;
    const along = pathLengthSquared > 0.000001
      ? ((cell.x - ax) * pathX + (cell.y - ay) * pathY) / pathLengthSquared
      : 0;
    if (along < firstAlongPath) {
      firstAlongPath = along;
      blocked = i;
    }
  }

  if (blocked < 0) return { x: gx, y: gy, detour: false };

  const obstacle = cells[blocked];
  const pathLength = Math.sqrt(pathLengthSquared);
  if (pathLength < 0.0001) return { x: gx, y: gy, detour: false };
  const pathUnitX = pathX / pathLength;
  const pathUnitY = pathY / pathLength;
  const perpendicularX = -pathUnitY;
  const perpendicularY = pathUnitX;
  const sideOffset = (ax - obstacle.x) * perpendicularX + (ay - obstacle.y) * perpendicularY;
  let side = sideOffset > 0.08 ? 1 : sideOffset < -0.08 ? -1 : 1;
  if (Math.abs(sideOffset) <= 0.08) {
    if (perpendicularX * -obstacle.x + perpendicularY * -obstacle.y < 0) side = -1;
  }
  const clearance = cellKind(obstacle) === 2 ? 1.42 : 1.22;
  const along = Math.abs(sideOffset) > clearance * 0.7 ? clearance : -clearance;
  let candidateX = clamp(
    obstacle.x + pathUnitX * along + perpendicularX * side * clearance,
    -limit,
    limit,
  );
  let candidateY = clamp(
    obstacle.y + pathUnitY * along + perpendicularY * side * clearance,
    -limit,
    limit,
  );
  if (!hardRouteClear(ax, ay, candidateX, candidateY, cells)) {
    side = -side;
    candidateX = clamp(
      obstacle.x + pathUnitX * along + perpendicularX * side * clearance,
      -limit,
      limit,
    );
    candidateY = clamp(
      obstacle.y + pathUnitY * along + perpendicularY * side * clearance,
      -limit,
      limit,
    );
    if (!hardRouteClear(ax, ay, candidateX, candidateY, cells)) {
      const inwardX = clamp(ax * 0.35, -limit, limit);
      const inwardY = clamp(ay * 0.35, -limit, limit);
      if (hardRouteClear(ax, ay, inwardX, inwardY, cells)) {
        return { x: inwardX, y: inwardY, detour: true };
      }
      return { x: ax, y: ay, detour: true };
    }
  }
  return { x: candidateX, y: candidateY, detour: true };
}

export function tick(sensors, memory) {
  const me = sensors.self;
  const opponent = sensors.opponent;
  const cells = sensors.arena.cells;
  const halfExtent = Math.min(sensors.arena.halfExtent, sensors.arena.nextHalfExtent);
  const innerLimit = Math.max(1.2, halfExtent - 0.95);
  let side = 1;
  if (
    memory &&
    typeof memory === "object" &&
    !Array.isArray(memory) &&
    (memory.side === 1 || memory.side === -1)
  ) {
    side = memory.side;
  }

  if (me.status === "flipped" || me.energy <= 0) {
    return { actions: { thrust: 0, turn: 0 }, memory: { side } };
  }

  let chargerX = 0;
  let chargerY = 0;
  let chargerDistance = Infinity;
  let dangerX = 0;
  let dangerY = 0;
  let onDanger = false;
  let hardDistanceSelfSquared = Infinity;
  let hardDistanceOpponentSquared = Infinity;

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (cell.state === "inactive") continue;
    const dx = me.x - cell.x;
    const dy = me.y - cell.y;
    const selfDistanceSquared = dx * dx + dy * dy;
    const opponentDX = opponent.x - cell.x;
    const opponentDY = opponent.y - cell.y;
    const opponentDistanceSquared = opponentDX * opponentDX + opponentDY * opponentDY;
    const kind = cellKind(cell);

    if (kind === 2) {
      hardDistanceSelfSquared = Math.min(hardDistanceSelfSquared, selfDistanceSquared);
      hardDistanceOpponentSquared = Math.min(hardDistanceOpponentSquared, opponentDistanceSquared);
    }

    const unsafeUnderSelf =
      Math.abs(dx) <= 0.52 &&
      Math.abs(dy) <= 0.52 &&
      (kind === 2 ||
        (cell.type === "flame" &&
          (cell.state === "flaming" || cell.state === "warning")) ||
        (typeof cell.integrity === "number" && cell.integrity < 0.16));
    if (unsafeUnderSelf) {
      onDanger = true;
      dangerX = cell.x;
      dangerY = cell.y;
    }

    if (
      cell.type === "recharge" &&
      cell.state === "ready" &&
      cell.collapseIn == null &&
      (typeof cell.integrity !== "number" || cell.integrity >= 0.16) &&
      Math.abs(cell.x) < innerLimit &&
      Math.abs(cell.y) < innerLimit
    ) {
      const selfDistance = Math.sqrt(selfDistanceSquared);
      const opponentDistance = Math.sqrt(opponentDistanceSquared);
      const contestCost = opponentDistance < 1.25 ? 0.6 : 0;
      const score = selfDistance + contestCost + 0.02 * (cell.x * cell.x + cell.y * cell.y);
      if (score < chargerDistance) {
        chargerDistance = score;
        chargerX = cell.x;
        chargerY = cell.y;
      }
    }
  }

  const toOpponentX = opponent.x - me.x;
  const toOpponentY = opponent.y - me.y;
  const opponentDistance = Math.hypot(toOpponentX, toOpponentY);
  const bearingToOpponent = opponentDistance > 0.0001
    ? Math.atan2(toOpponentY, toOpponentX)
    : me.heading;
  const selfFacingOpponent = Math.abs(wrap(bearingToOpponent - me.heading));
  const opponentFacingSelf = Math.abs(wrap(bearingToOpponent + Math.PI - opponent.heading));
  const selfEdgeMargin = halfExtent - Math.max(Math.abs(me.x), Math.abs(me.y));
  const opponentEdgeMargin = halfExtent - Math.max(Math.abs(opponent.x), Math.abs(opponent.y));
  let outwardSpeed = 0;
  if (me.x > 0) outwardSpeed = Math.max(outwardSpeed, me.vx);
  else if (me.x < 0) outwardSpeed = Math.max(outwardSpeed, -me.vx);
  if (me.y > 0) outwardSpeed = Math.max(outwardSpeed, me.vy);
  else if (me.y < 0) outwardSpeed = Math.max(outwardSpeed, -me.vy);

  const edgeEmergency = selfEdgeMargin < 1.15 + 0.32 * Math.max(0, outwardSpeed);
  const lowEnergy =
    me.energy < 108 ||
    (me.energy < 160 &&
      (opponent.energy > me.energy + 36 || sensors.time > 78)) ||
    (me.energy < 145 && me.flipsTaken > opponent.flipsTaken);
  const criticalEnergy = me.energy < 48;
  const opponentClosing = opponentDistance > 0.0001
    ? ((opponent.vx - me.vx) * (-toOpponentX / opponentDistance) +
      (opponent.vy - me.vy) * (-toOpponentY / opponentDistance))
    : 0;
  const wedgeThreat =
    opponent.status === "active" &&
    opponentFacingSelf < 0.70 &&
    opponentDistance < (me.flipsTaken > 0 ? 3.8 : 3.0) &&
    selfFacingOpponent > 0.46 &&
    (opponentDistance < 2.15 || opponentClosing > 0.25);
  const battleSafe =
    selfEdgeMargin > 1.5 &&
    opponentEdgeMargin > 1.25 &&
    hardDistanceSelfSquared > 2.1025 &&
    hardDistanceOpponentSquared > 1.3225;
  const pushSafe =
    selfEdgeMargin > 1.5 &&
    hardDistanceSelfSquared > 2.1025 &&
    hardDistanceOpponentSquared > 1.3225;
  const decisivePush = opponent.status === "flipped" && !criticalEnergy && pushSafe;
  const flipLead = me.flipsTaken < opponent.flipsTaken;
  const energyLead = me.energy > opponent.energy + 55;

  let goalX = 0;
  let goalY = 0;
  let mode = "stage";

  if (onDanger || hardDistanceSelfSquared < 0.9025) {
    let awayX = me.x - dangerX;
    let awayY = me.y - dangerY;
    if (!onDanger) {
      for (let i = 0; i < cells.length; i += 1) {
        const cell = cells[i];
        if (cellKind(cell) !== 2) continue;
        const dx = me.x - cell.x;
        const dy = me.y - cell.y;
        if (dx * dx + dy * dy < hardDistanceSelfSquared + 0.02) {
          awayX = dx;
          awayY = dy;
          dangerX = cell.x;
          dangerY = cell.y;
          break;
        }
      }
    }
    if (Math.hypot(awayX, awayY) < 0.1) {
      awayX = -me.x;
      awayY = -me.y;
    }
    if (Math.hypot(awayX, awayY) < 0.1) {
      awayX = Math.cos(me.heading);
      awayY = Math.sin(me.heading);
    }
    const awayLength = Math.hypot(awayX, awayY);
    goalX = me.x + (awayX / awayLength) * 2.2 - me.x * 0.22;
    goalY = me.y + (awayY / awayLength) * 2.2 - me.y * 0.22;
    mode = "escape";
  } else if (edgeEmergency) {
    goalX = me.x * 0.18;
    goalY = me.y * 0.18;
    mode = "edge";
  } else if (lowEnergy && chargerDistance < Infinity && !decisivePush) {
    const distanceToCharger = Math.hypot(chargerX - me.x, chargerY - me.y);
    if (distanceToCharger < 0.72) {
      let exitX = me.x - chargerX;
      let exitY = me.y - chargerY;
      if (Math.hypot(exitX, exitY) < 0.12) {
        exitX = Math.cos(me.heading);
        exitY = Math.sin(me.heading);
      }
      const exitLength = Math.hypot(exitX, exitY);
      goalX = chargerX + (exitX / exitLength) * 1.28;
      goalY = chargerY + (exitY / exitLength) * 1.28;
    } else {
      goalX = chargerX;
      goalY = chargerY;
    }
    mode = "charge";
  } else if (decisivePush) {
    let outX = 0;
    let outY = 0;
    if (Math.abs(opponent.x) > Math.abs(opponent.y) && Math.abs(opponent.x) > 0.25) {
      outX = opponent.x > 0 ? 1 : -1;
    } else if (Math.abs(opponent.y) > 0.25) {
      outY = opponent.y > 0 ? 1 : -1;
    } else {
      outX = Math.cos(me.heading);
      outY = Math.sin(me.heading);
    }
    const innerSide = (me.x - opponent.x) * outX + (me.y - opponent.y) * outY < -0.42;
    if (innerSide) {
      goalX = opponent.x + outX * 0.9;
      goalY = opponent.y + outY * 0.9;
    } else {
      goalX = opponent.x - outX * 1.35;
      goalY = opponent.y - outY * 1.35;
    }
    mode = "push";
  } else if (wedgeThreat) {
    goalX = opponent.x;
    goalY = opponent.y;
    mode = "defend";
  } else if (
    (flipLead && sensors.time > 42) ||
    (energyLead && sensors.time > 88)
  ) {
    const orbit = sensors.tick * 0.024 + side * 0.75;
    goalX = Math.cos(orbit) * 1.65;
    goalY = Math.sin(orbit) * 1.65;
    mode = "guard";
  } else {
    const forwardX = Math.cos(opponent.heading);
    const forwardY = Math.sin(opponent.heading);
    const leftX = -forwardY;
    const leftY = forwardX;
    const leftGoalX = opponent.x - forwardX * 1.9 + leftX * 0.86;
    const leftGoalY = opponent.y - forwardY * 1.9 + leftY * 0.86;
    const rightGoalX = opponent.x - forwardX * 1.9 - leftX * 0.86;
    const rightGoalY = opponent.y - forwardY * 1.9 - leftY * 0.86;
    const savedGoalX = side > 0 ? leftGoalX : rightGoalX;
    const savedGoalY = side > 0 ? leftGoalY : rightGoalY;
    if (Math.abs(savedGoalX) > innerLimit || Math.abs(savedGoalY) > innerLimit) {
      side = side > 0 ? -1 : 1;
    }

    const sideGoalX = side > 0 ? leftGoalX : rightGoalX;
    const sideGoalY = side > 0 ? leftGoalY : rightGoalY;
    const vulnerableAspect = opponentFacingSelf > 1.02;
    const canStrike =
      opponent.status === "active" &&
      vulnerableAspect &&
      selfFacingOpponent < 0.34 &&
      opponentDistance > 1.18 &&
      opponentDistance < 4.35 &&
      battleSafe;
    if (canStrike) {
      goalX = opponent.x + opponent.vx * 0.12;
      goalY = opponent.y + opponent.vy * 0.12;
      mode = "strike";
    } else {
      goalX = sideGoalX;
      goalY = sideGoalY;
      mode = "stage";
    }
  }

  const goalLimit = mode === "push" ? Math.max(1.2, halfExtent - 0.78) : innerLimit;
  goalX = clamp(goalX, -goalLimit, goalLimit);
  goalY = clamp(goalY, -goalLimit, goalLimit);
  const route = mode === "escape"
    ? { x: goalX, y: goalY, detour: false }
    : routedGoal(me.x, me.y, goalX, goalY, cells, innerLimit);
  goalX = route.x;
  goalY = route.y;

  const goalDX = goalX - me.x;
  const goalDY = goalY - me.y;
  const goalDistance = Math.hypot(goalDX, goalDY);
  const targetHeading = goalDistance > 0.0001 ? Math.atan2(goalDY, goalDX) : me.heading;
  const headingError = wrap(targetHeading - me.heading);
  const headingMagnitude = Math.abs(headingError);
  let turn = clamp(2.35 * headingError - 0.34 * me.omega, -1, 1);

  let cruiseSpeed = 2.1;
  if (mode === "escape" || mode === "edge") cruiseSpeed = 3.25;
  else if (mode === "charge") cruiseSpeed = 2.65;
  else if (mode === "push") cruiseSpeed = 4.15;
  else if (mode === "strike") cruiseSpeed = 4.05;
  else if (mode === "defend") cruiseSpeed = 1.15;
  else if (mode === "guard") cruiseSpeed = 1.35;
  if (route.detour && mode !== "escape" && mode !== "edge") cruiseSpeed = Math.min(cruiseSpeed, 2.2);

  let desiredSpeed = cruiseSpeed;
  if (mode !== "strike" && mode !== "push") {
    const brakingDistance = Math.max(0, goalDistance - 0.22);
    desiredSpeed = Math.min(cruiseSpeed, Math.sqrt(7 * brakingDistance + 0.16));
  }
  const forwardSpeed = me.vx * Math.cos(me.heading) + me.vy * Math.sin(me.heading);
  let thrust = clamp(desiredSpeed * 0.2 + (desiredSpeed - forwardSpeed) * 0.24, -0.82, 1);

  if (headingMagnitude > 1.15) thrust = Math.min(thrust, forwardSpeed > 1.7 ? -0.28 : 0.04);
  else if (headingMagnitude > 0.68) thrust = Math.min(thrust, 0.18);

  if (mode === "defend") {
    if (headingMagnitude > 0.42) thrust = 0;
    else if (selfEdgeMargin > 1.65) thrust = -0.34;
    else thrust = 0.05;
  }

  if ((mode === "edge" || mode === "escape") && selfEdgeMargin < 1.55 && outwardSpeed > 0.45) {
    thrust = Math.min(thrust, -0.58);
  }

  if (me.status === "recovering" && mode === "strike") {
    // Recovery is flip-immune, but avoid an expensive uncontrolled ram.
    thrust = Math.min(thrust, 0.52);
  }

  turn = clamp(turn, -1, 1);
  thrust = clamp(thrust, -1, 1);
  return { actions: { thrust, turn }, memory: { side } };
}
