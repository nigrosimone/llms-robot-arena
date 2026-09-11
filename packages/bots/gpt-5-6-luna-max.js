const PI = Math.PI;
const TAU = PI * 2;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function angleWrap(v) {
  while (v > PI) v -= TAU;
  while (v < -PI) v += TAU;
  return v;
}

function distance(x, y) {
  return Math.sqrt(x * x + y * y);
}

function numberOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function tick(s, memory) {
  const me = s.self;
  const foe = s.opponent;
  const arena = s.arena;
  const old = memory && typeof memory === 'object' && !Array.isArray(memory) ? memory : {};
  let side = old.side === -1 ? -1 : 1;
  let initialized = old.initialized === 1;
  let previousEnergy = numberOr(old.previousEnergy, me.energy);
  let lastContactTick = numberOr(old.lastContactTick, -100000);
  let chargeTick = numberOr(old.chargeTick, -100000);
  let threat = old.threat === 1 ? 1 : 0;
  let knownChargerX = numberOr(old.knownChargerX, 0);
  let knownChargerY = numberOr(old.knownChargerY, 0);
  let knownChargerAge = numberOr(old.knownChargerAge, 100000);
  let knownHazardX = numberOr(old.knownHazardX, 0);
  let knownHazardY = numberOr(old.knownHazardY, 0);
  let knownHazardRadius = numberOr(old.knownHazardRadius, 0);
  let knownHazardWeight = numberOr(old.knownHazardWeight, 0);
  let knownHazardAge = numberOr(old.knownHazardAge, 100000);

  const meCos = Math.cos(me.heading);
  const meSin = Math.sin(me.heading);
  const foeCos = Math.cos(foe.heading);
  const foeSin = Math.sin(foe.heading);
  const foeLeftX = -foeSin;
  const foeLeftY = foeCos;

  if (!initialized) {
    const rx = me.x - foe.x;
    const ry = me.y - foe.y;
    const cross = rx * foeSin - ry * foeCos;
    side = Math.abs(cross) > 0.05 ? (cross > 0 ? 1 : -1) : (me.x + me.y >= foe.x + foe.y ? 1 : -1);
    initialized = true;
  }

  if (s.lastContact && s.lastContact.tick > lastContactTick) {
    lastContactTick = s.lastContact.tick;
    if (s.lastContact.opponentWedge) {
      side = -side;
      threat = 1;
    } else if (s.lastContact.selfWedge) {
      threat = 0;
    }
  }
  if (me.energy > previousEnergy + 4) chargeTick = s.tick;
  previousEnergy = me.energy;
  const recentThreat = threat === 1 && s.tick - lastContactTick < 36;
  if (!recentThreat && s.tick - lastContactTick > 60) threat = 0;

  let chargerX = 0;
  let chargerY = 0;
  let chargerDistance = Infinity;
  let hazardX = 0;
  let hazardY = 0;
  const cells = arena.cells;
  if (cells.length > 0) {
      const cell = cells[s.tick % cells.length];
      if (cell.type === 'recharge' && cell.state === 'ready' && (cell.collapseIn === null || cell.collapseIn >= 2.5)) {
        const cx = cell.x - me.x;
        const cy = cell.y - me.y;
        const cd = distance(cx, cy);
      if (cd < chargerDistance) {
        chargerDistance = cd;
        chargerX = cell.x;
        chargerY = cell.y;
      }
      knownChargerX = cell.x;
      knownChargerY = cell.y;
      knownChargerAge = 0;
      }
      let radius = 0;
      let weight = 0;
      if (cell.type === 'hole' || cell.state === 'hole') {
        radius = 1.25;
        weight = 8;
      } else if (cell.type === 'collapse' || cell.state === 'warning' || (cell.collapseIn !== null && cell.collapseIn < 3.5)) {
        radius = 1.5;
        weight = 5;
      } else if (cell.type === 'flame' && cell.state === 'flaming') {
        radius = 1.4;
        weight = 5;
      }
      if (radius > 0 && cell.state !== 'inactive') {
        knownHazardX = cell.x;
        knownHazardY = cell.y;
        knownHazardRadius = radius;
        knownHazardWeight = weight;
        knownHazardAge = 0;
      }
  }
  knownHazardAge += 1;
  if (knownHazardAge < 60 && knownHazardRadius > 0) {
    let hx = me.x - knownHazardX;
    let hy = me.y - knownHazardY;
    const hd = distance(hx, hy);
    if (hd < knownHazardRadius) {
      if (hd < 1e-8) {
        hx = -meCos;
        hy = -meSin;
      }
      const hn = distance(hx, hy);
      const amount = knownHazardWeight * (knownHazardRadius - hd) / knownHazardRadius;
      hazardX += hx / hn * amount;
      hazardY += hy / hn * amount;
    }
  }
  knownChargerAge += 1;
  if (chargerDistance === Infinity && knownChargerAge < 600) {
    chargerX = knownChargerX;
    chargerY = knownChargerY;
    chargerDistance = distance(chargerX - me.x, chargerY - me.y);
  }

  const savedMemory = {
    initialized: initialized ? 1 : 0,
    side,
    previousEnergy,
    lastContactTick,
    chargeTick,
    threat,
    knownChargerX,
    knownChargerY,
    knownChargerAge,
    knownHazardX,
    knownHazardY,
    knownHazardRadius,
    knownHazardWeight,
    knownHazardAge,
  };
  if (me.status === 'flipped' || me.energy <= 0) {
    return { actions: { thrust: 0, turn: 0 }, memory: savedMemory };
  }

  const toFoeX = foe.x - me.x;
  const toFoeY = foe.y - me.y;
  const foeDistance = distance(toFoeX, toFoeY);
  const foeEdgeDistance = arena.halfExtent - Math.max(Math.abs(foe.x), Math.abs(foe.y));
  const energyLow = me.energy < 88;
  const justCharged = s.tick - chargeTick < 30;
  const urgent = foe.status !== 'active' || foe.flipsTaken > 0 || foeEdgeDistance < 2.4;
  const charge = chargerDistance < Infinity && s.time < 112 && energyLow && !justCharged && !(foeDistance < 2.6 && urgent && me.energy > 32);

  let mode = 0;
  if (charge) mode = 1;
  else if (urgent) mode = 2;

  let goalX = foe.x;
  let goalY = foe.y;
  let attackX = toFoeX;
  let attackY = toFoeY;
  let outX;
  let outY;
  if (Math.abs(foe.x) >= Math.abs(foe.y)) {
    outX = foe.x >= 0 ? 1 : -1;
    outY = 0;
  } else {
    outX = 0;
    outY = foe.y >= 0 ? 1 : -1;
  }
  if (Math.abs(foe.x) < 0.25 && Math.abs(foe.y) < 0.25) {
    const rd = distance(me.x - foe.x, me.y - foe.y);
    if (rd > 1e-8) {
      outX = (me.x - foe.x) / rd;
      outY = (me.y - foe.y) / rd;
    } else {
      outX = side;
      outY = 0;
    }
  }

  if (mode === 1) {
    goalX = chargerX;
    goalY = chargerY;
    const lx = foe.x - chargerX;
    const ly = foe.y - chargerY;
    const ld = distance(lx, ly);
    const leaveX = ld > 1e-8 ? lx / ld : meCos;
    const leaveY = ld > 1e-8 ? ly / ld : meSin;
    if (distance(chargerX - me.x, chargerY - me.y) < 0.85) {
      goalX += leaveX * 1.45;
      goalY += leaveY * 1.45;
    }
    attackX = goalX - me.x;
    attackY = goalY - me.y;
  } else if (mode === 2) {
    goalX = foe.x - outX * 0.82 + foe.vx * 0.12;
    goalY = foe.y - outY * 0.82 + foe.vy * 0.12;
    attackX = outX;
    attackY = outY;
  } else {
    const rx = me.x - foe.x;
    const ry = me.y - foe.y;
    const rd = distance(rx, ry);
    const front = rd > 1e-8 ? (rx * foeCos + ry * foeSin) / rd : -1;
    let approachX = -foeCos;
    let approachY = -foeSin;
    if (front > 0.18 || recentThreat) {
      approachX = side * foeLeftX;
      approachY = side * foeLeftY;
    } else if (front > -0.35) {
      const mx = -foeCos * 0.55 + side * foeLeftX * 0.85;
      const my = -foeSin * 0.55 + side * foeLeftY * 0.85;
      const md = distance(mx, my);
      if (md > 1e-8) {
        approachX = mx / md;
        approachY = my / md;
      }
    }
    const lead = foeDistance > 3 ? 0.28 : 0.16;
    if (foeDistance > 2.5 && !recentThreat) {
      goalX = foe.x + foe.vx * lead;
      goalY = foe.y + foe.vy * lead;
    } else {
      goalX = foe.x + approachX * 0.86 + foe.vx * lead;
      goalY = foe.y + approachY * 0.86 + foe.vy * lead;
    }
  }

  const safeEdge = arena.halfExtent - 1.8;
  const edgeMargin = safeEdge - Math.max(Math.abs(me.x), Math.abs(me.y));
  let edgeX = 0;
  let edgeY = 0;
  if (Math.abs(me.x) > safeEdge - 2) {
    const push = 2 + (Math.abs(me.x) - safeEdge + 2) * 3.5;
    edgeX = -(me.x >= 0 ? 1 : -1) * push;
    if (me.vx * me.x > 0) edgeX *= 1.5;
  }
  if (Math.abs(me.y) > safeEdge - 2) {
    const push = 2 + (Math.abs(me.y) - safeEdge + 2) * 3.5;
    edgeY = -(me.y >= 0 ? 1 : -1) * push;
    if (me.vy * me.y > 0) edgeY *= 1.5;
  }

  let gx = goalX - me.x;
  let gy = goalY - me.y;
  const gd = distance(gx, gy);
  if (gd > 1e-8) {
    gx /= gd;
    gy /= gd;
  } else {
    gx = meCos;
    gy = meSin;
  }
  let navX = gx * 1.45 + hazardX * 1.35 + edgeX * 1.1;
  let navY = gy * 1.45 + hazardY * 1.35 + edgeY * 1.1;
  if (foeDistance < 1.65 && mode === 0) {
    const fd = foeDistance > 1e-8 ? foeDistance : 1;
    navX = toFoeX / fd * 1.8 + hazardX * 1.5 + edgeX * 1.25;
    navY = toFoeY / fd * 1.8 + hazardY * 1.5 + edgeY * 1.25;
  } else if (foeDistance < 1.65 && mode === 2) {
    navX = outX * 1.9 + hazardX * 1.4 + edgeX * 1.25;
    navY = outY * 1.9 + hazardY * 1.4 + edgeY * 1.25;
  }

  let desiredHeading = Math.atan2(navY, navX);
  if (foeDistance < 1.45 && mode === 2 && edgeMargin > 0.45) {
    desiredHeading = Math.atan2(outY * 1.5 + hazardY, outX * 1.5 + hazardX);
  } else if (foeDistance < 1.25 && mode === 0 && edgeMargin > 0.3) {
    desiredHeading = Math.atan2(attackY * 1.7 + hazardY, attackX * 1.7 + hazardX);
  }
  if (edgeMargin < 0.7 && (edgeX !== 0 || edgeY !== 0)) {
    desiredHeading = Math.atan2(edgeY + hazardY, edgeX + hazardX);
  }

  const headingError = angleWrap(desiredHeading - me.heading);
  const turn = clamp(headingError * 1.9 - me.omega * 0.62, -1, 1);
  const forwardSpeed = me.vx * meCos + me.vy * meSin;
  const speed = distance(me.vx, me.vy);
  let desiredSpeed = mode === 1 ? (gd > 2 ? 3.7 : 2.2) : mode === 2 ? (foeDistance > 2.3 ? 4.2 : 3) : (foeDistance > 3.2 ? 4.3 : foeDistance < 1.8 ? 2.8 : 3.7);
  if (edgeMargin < 0.35) desiredSpeed = Math.min(desiredSpeed, 1.2);
  if (Math.abs(headingError) > 1.15) desiredSpeed = Math.min(desiredSpeed, 0.8);
  if (me.status === 'recovering') desiredSpeed = Math.min(desiredSpeed, 2.4);

  let thrust = clamp((desiredSpeed - forwardSpeed) * 0.32, -0.85, 0.88);
  if (Math.abs(headingError) > 1.35 && speed < 1) thrust = 0;
  if (edgeMargin < 0.8 && me.vx * edgeX + me.vy * edgeY < 0) thrust = -0.9;
  if (me.energy < 38) thrust = clamp(thrust, -0.35, 0.5);
  else if (me.energy < 70) thrust = clamp(thrust, -0.55, 0.68);

  return {
    actions: { thrust: clamp(thrust, -1, 1), turn: clamp(turn, -1, 1) },
    memory: savedMemory,
  };
}
