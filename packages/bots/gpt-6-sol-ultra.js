export function tick(sensors, memory) {
  const me = sensors.self;
  const opponent = sensors.opponent;
  const half = sensors.arena.nextHalfExtent;
  const pi = Math.PI;
  const tau = 2 * pi;

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function angle(value) {
    while (value > pi) value -= tau;
    while (value < -pi) value += tau;
    return value;
  }

  function distance(x, y, xx, yy) {
    return Math.hypot(xx - x, yy - y);
  }

  function crosses(x0, y0, x1, y1, cell, padding) {
    const xlo = cell.x - 0.5 - padding;
    const xhi = cell.x + 0.5 + padding;
    const ylo = cell.y - 0.5 - padding;
    const yhi = cell.y + 0.5 + padding;
    let enter = 0;
    let leave = 1;
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (Math.abs(dx) < 1e-8) {
      if (x0 < xlo || x0 > xhi) return false;
    } else {
      let a = (xlo - x0) / dx;
      let b = (xhi - x0) / dx;
      if (a > b) { const tmp = a; a = b; b = tmp; }
      enter = Math.max(enter, a);
      leave = Math.min(leave, b);
    }
    if (Math.abs(dy) < 1e-8) {
      if (y0 < ylo || y0 > yhi) return false;
    } else {
      let a = (ylo - y0) / dy;
      let b = (yhi - y0) / dy;
      if (a > b) { const tmp = a; a = b; b = tmp; }
      enter = Math.max(enter, a);
      leave = Math.min(leave, b);
    }
    return enter <= leave;
  }

  const hazards = [];
  let charger = null;
  let chargerScore = 1e9;
  let currentIntegrity = 1;
  let currentCollapse = null;
  for (const cell of sensors.arena.cells) {
    if (cell.state === 'inactive') continue;
    if (cell.type === 'hole' || cell.collapseIn !== null || cell.type === 'collapse') {
      hazards.push(cell);
    }
    if (cell.type === 'recharge' && cell.state === 'ready' && cell.collapseIn === null) {
      const d = distance(me.x, me.y, cell.x, cell.y);
      if (d < chargerScore) {
        charger = cell;
        chargerScore = d;
      }
    }
    if (Math.floor(me.x) === Math.floor(cell.x) &&
        Math.floor(me.y) === Math.floor(cell.y)) {
      currentIntegrity = cell.integrity;
      currentCollapse = cell.collapseIn;
    }
  }

  const dx = opponent.x - me.x;
  const dy = opponent.y - me.y;
  const range = Math.hypot(dx, dy);
  const enemyBearing = Math.atan2(dy, dx);
  const enemyError = angle(enemyBearing - me.heading);
  const enemyFacing = Math.abs(angle(Math.atan2(-dy, -dx) - opponent.heading));
  const crossToEnemy = me.x * dy - me.y * dx;
  const orbit = memory && (memory.orbit === 1 || memory.orbit === -1) ?
    memory.orbit : (crossToEnemy > 0 ? -1 : 1);

  let goalX = 1.6 * Math.cos(sensors.time * 0.25);
  let goalY = 1.6 * Math.sin(sensors.time * 0.25);
  let goalKind = 0;
  if (Math.hypot(me.x, me.y) > 2.2) {
    goalX = 0;
    goalY = 0;
  }
  if (opponent.status === 'flipped' && range < 5.0) {
    goalX = opponent.x;
    goalY = opponent.y;
    goalKind = 1;
  } else if (me.energy < 120 && charger &&
             chargerScore < (me.energy < 60 ? 7.0 : 3.8) &&
             (opponent.energy === 0 || range > 4.0 || opponent.status !== 'active')) {
    goalX = charger.x;
    goalY = charger.y;
    goalKind = 2;
  } else if (opponent.status === 'active' && opponent.energy > 0) {
    const radius = Math.hypot(me.x, me.y);
    const ux = radius > 0.25 ? me.x / radius : -dx / (range + 0.01);
    const uy = radius > 0.25 ? me.y / radius : -dy / (range + 0.01);
    const radial = clamp((1.65 - radius) * 1.35, -2.8, 1.5);
    goalX = me.x - orbit * uy * 2.4 + ux * radial;
    goalY = me.y + orbit * ux * 2.4 + uy * radial;
    goalKind = 5;
  }

  if (currentCollapse !== null || currentIntegrity < 0.18) {
    let best = 1e9;
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const step of steps) {
      const xx = Math.floor(me.x) + 0.5 + step[0] * 1.2;
      const yy = Math.floor(me.y) + 0.5 + step[1] * 1.2;
      if (Math.abs(xx) > half - 0.5 || Math.abs(yy) > half - 0.5) continue;
      let blocked = false;
      for (const hazard of hazards) {
        if (Math.abs(xx - hazard.x) < 0.72 && Math.abs(yy - hazard.y) < 0.72) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const score = distance(me.x, me.y, xx, yy) +
        0.2 * distance(xx, yy, 0, 0) +
        (range < 2.0 ? 0.2 / (distance(xx, yy, opponent.x, opponent.y) + 0.2) : 0);
      if (score < best) {
        best = score;
        goalX = xx;
        goalY = yy;
        goalKind = 4;
      }
    }
  }

  goalX = clamp(goalX, -half + 0.55, half - 0.55);
  goalY = clamp(goalY, -half + 0.55, half - 0.55);

  let firstHazard = null;
  let firstDistance = 1e9;
  let routed = false;
  for (const hazard of hazards) {
    if (crosses(me.x, me.y, goalX, goalY, hazard, 0.18)) {
      const d = distance(me.x, me.y, hazard.x, hazard.y);
      if (d < firstDistance) {
        firstDistance = d;
        firstHazard = hazard;
      }
    }
  }
  if (firstHazard) {
    let best = 1e9;
    let waypointX = goalX;
    let waypointY = goalY;
    for (let i = -1; i <= 1; i += 2) {
      for (let j = -1; j <= 1; j += 2) {
        const xx = firstHazard.x + i * 0.8;
        const yy = firstHazard.y + j * 0.8;
        if (Math.abs(xx) > half - 0.4 || Math.abs(yy) > half - 0.4) continue;
        let blocked = false;
        for (const hazard of hazards) {
          if (crosses(me.x, me.y, xx, yy, hazard, 0.16) &&
              distance(me.x, me.y, hazard.x, hazard.y) > 0.7) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        const score = distance(me.x, me.y, xx, yy) +
          distance(xx, yy, goalX, goalY);
        if (score < best) {
          best = score;
          waypointX = xx;
          waypointY = yy;
        }
      }
    }
    if (best < 1e9) {
      goalX = waypointX;
      goalY = waypointY;
      routed = true;
    } else {
      goalX = clamp(me.x + 2 * (me.x - firstHazard.x), -half + 0.55, half - 0.55);
      goalY = clamp(me.y + 2 * (me.y - firstHazard.y), -half + 0.55, half - 0.55);
    }
  }

  const travelBearing = Math.atan2(goalY - me.y, goalX - me.x);
  let desiredHeading = travelBearing;
  let reverse = false;
  let travelError = angle(travelBearing - me.heading);
  if (Math.abs(travelError) > 1.85 && range > 2.0) {
    desiredHeading = angle(travelBearing + pi);
    reverse = true;
    travelError = angle(desiredHeading - me.heading);
  }
  let thrust = reverse ? -0.36 : 0.36;
  if (Math.abs(travelError) > 0.65) thrust *= 0.45;
  if (goalKind === 1 && Math.abs(enemyError) < 0.5) thrust = 0.9;
  if (goalKind === 5) {
    thrust = reverse ? -0.68 : 0.68;
    if (Math.abs(travelError) > 0.65) thrust *= 0.4;
    if (range < 1.1 && enemyFacing < 0.6 && Math.abs(enemyError) > 0.45) {
      desiredHeading = enemyBearing;
      thrust = 0.2;
    }
  }
  if (firstHazard && firstDistance < 2.0) {
    desiredHeading = reverse ? angle(travelBearing + pi) : travelBearing;
    thrust = Math.abs(travelError) < 0.7 ? (reverse ? -0.5 : 0.5) : 0.15;
  }
  if (goalKind === 2 && range > 2.1) thrust = reverse ? -0.55 : 0.55;
  if (goalKind === 4) thrust = reverse ? -0.55 : 0.55;

  let imminent = false;
  if (Math.hypot(me.vx, me.vy) > 0.7) {
    for (const hazard of hazards) {
      if (crosses(me.x, me.y,
                  me.x + me.vx * 0.95,
                  me.y + me.vy * 0.95, hazard, 0.24) &&
          (me.vx * (hazard.x - me.x) +
           me.vy * (hazard.y - me.y)) > 0) {
        imminent = true;
        if (!firstHazard || !routed) {
          desiredHeading = Math.atan2(me.y - hazard.y, me.x - hazard.x);
        } else {
          desiredHeading = reverse ? angle(travelBearing + pi) : travelBearing;
        }
        break;
      }
    }
  }
  if (imminent) {
    const forwardSpeed = me.vx * Math.cos(me.heading) +
      me.vy * Math.sin(me.heading);
    thrust = forwardSpeed >= 0 ? -0.85 : 0.85;
  }

  const edgeLimit = half - 0.85;
  const projectedX = me.x + me.vx * 0.65;
  const projectedY = me.y + me.vy * 0.65;
  if (Math.abs(projectedX) > edgeLimit || Math.abs(projectedY) > edgeLimit ||
      Math.abs(me.x) > edgeLimit || Math.abs(me.y) > edgeLimit) {
    const targetX = firstHazard ? goalX : 0;
    const targetY = firstHazard ? goalY : 0;
    desiredHeading = Math.atan2(targetY - me.y, targetX - me.x);
    const inward = Math.cos(me.heading) * (targetX - me.x) +
      Math.sin(me.heading) * (targetY - me.y);
    thrust = inward >= 0 ? 0.9 : -0.9;
  }

  const headingError = angle(desiredHeading - me.heading);
  const turn = clamp(2.8 * headingError - 0.85 * me.omega, -1, 1);
  if (me.status === 'flipped' || me.energy === 0) {
    thrust = 0;
  }
  return { actions: { thrust, turn }, memory: { orbit } };
}
