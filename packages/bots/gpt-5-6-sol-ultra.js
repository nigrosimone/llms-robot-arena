export function tick(s, memory) {
  const PI = Math.PI;
  const TAU = 2 * PI;
  const me = s.self;
  const foe = s.opponent;
  const cells = s.arena.cells;
  const half = s.arena.nextHalfExtent;

  function clamp(value, low, high) {
    return value < low ? low : value > high ? high : value;
  }

  function wrap(angle) {
    while (angle > PI) angle -= TAU;
    while (angle < -PI) angle += TAU;
    return angle;
  }

  function distanceSquared(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    return dx * dx + dy * dy;
  }

  function segmentPointDistanceSquared(x0, y0, x1, y1, px, py) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-9) return distanceSquared(x0, y0, px, py);
    const t = clamp(((px - x0) * dx + (py - y0) * dy) / lengthSquared, 0, 1);
    const qx = x0 + t * dx - px;
    const qy = y0 + t * dy - py;
    return qx * qx + qy * qy;
  }

  function segmentHitsSquare(x0, y0, x1, y1, cx, cy, squareHalf) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const minX = cx - squareHalf;
    const maxX = cx + squareHalf;
    const minY = cy - squareHalf;
    const maxY = cy + squareHalf;
    let enter = 0;
    let leave = 1;

    if (Math.abs(dx) < 1e-9) {
      if (x0 < minX || x0 > maxX) return false;
    } else {
      let a = (minX - x0) / dx;
      let b = (maxX - x0) / dx;
      if (a > b) {
        const t = a;
        a = b;
        b = t;
      }
      if (a > enter) enter = a;
      if (b < leave) leave = b;
      if (enter > leave) return false;
    }

    if (Math.abs(dy) < 1e-9) {
      if (y0 < minY || y0 > maxY) return false;
    } else {
      let a = (minY - y0) / dy;
      let b = (maxY - y0) / dy;
      if (a > b) {
        const t = a;
        a = b;
        b = t;
      }
      if (a > enter) enter = a;
      if (b < leave) leave = b;
      if (enter > leave) return false;
    }

    return true;
  }

  function pointSquareClearanceSquared(x, y, cell) {
    const h = cell.size * 0.5;
    const dx = Math.max(0, Math.abs(x - cell.x) - h);
    const dy = Math.max(0, Math.abs(y - cell.y) - h);
    return dx * dx + dy * dy;
  }

  function cellDanger(cell, horizon) {
    if (cell.state === 'inactive') return 0;
    if (cell.type === 'hole' || cell.state === 'hole') return 4;
    if (cell.type === 'collapse') return 4;
    if (cell.collapseIn !== null && cell.collapseIn <= horizon + 0.75) return 4;
    if (cell.type === 'flame') {
      if (cell.state === 'flaming') return 3;
      if (cell.state === 'warning') return 2.6;
      if (
        cell.state === 'safe' &&
        cell.timeUntilChange !== null &&
        cell.timeUntilChange <= horizon + 0.25
      ) {
        return 1.8;
      }
    }
    if (cell.integrity < 0.08) return 1.2;
    return 0;
  }

  function routePenalty(x0, y0, x1, y1, horizon) {
    let penalty = 0;
    for (let i = 0; i < riskCells.length; i += 1) {
      const cell = riskCells[i];
      const danger = cellDanger(cell, horizon);
      if (danger === 0) continue;
      const margin = danger >= 4 ? 0.17 : danger >= 1.8 ? 0.11 : 0.06;
      const hit = segmentHitsSquare(
        x0,
        y0,
        x1,
        y1,
        cell.x,
        cell.y,
        cell.size * 0.5 + margin,
      );
      const clearanceSquared = pointSquareClearanceSquared(x1, y1, cell);
      if (danger >= 4) {
        if (hit) penalty += 6000;
        if (clearanceSquared < 1.21) penalty += (1.1 - Math.sqrt(clearanceSquared)) * 32;
      } else if (danger >= 1.8) {
        if (hit) penalty += 220;
        if (clearanceSquared < 0.81) penalty += (0.9 - Math.sqrt(clearanceSquared)) * 18;
      } else {
        if (hit) penalty += 24;
        if (clearanceSquared < 0.4225) penalty += (0.65 - Math.sqrt(clearanceSquared)) * 8;
      }
    }
    return penalty;
  }

  const riskCells = [];
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (
      cell.state !== 'inactive' &&
      (cell.type === 'hole' ||
        cell.type === 'collapse' ||
        cell.type === 'flame' ||
        cell.state === 'hole' ||
        cell.collapseIn !== null ||
        cell.integrity < 0.08)
    ) {
      riskCells.push(cell);
    }
  }

  const old =
    memory !== null && typeof memory === 'object' && !Array.isArray(memory) && memory.v === 1
      ? memory
      : null;

  let side;
  if (old && (old.side === 1 || old.side === -1)) {
    side = old.side;
  } else {
    const cross = me.x * foe.y - me.y * foe.x;
    if (Math.abs(cross) > 1e-6) side = cross > 0 ? 1 : -1;
    else if (Math.abs(me.x - foe.x) > 1e-6) side = me.x < foe.x ? 1 : -1;
    else side = me.y <= foe.y ? 1 : -1;
  }

  const supportX = Math.floor(me.x);
  const supportY = Math.floor(me.y);
  const supportSince =
    old && old.supportX === supportX && old.supportY === supportY && typeof old.supportSince === 'number'
      ? old.supportSince
      : s.tick;

  let handledContact = old && typeof old.handledContact === 'number' ? old.handledContact : -1;
  let disengageUntil = old && typeof old.disengageUntil === 'number' ? old.disengageUntil : -1;
  const contact = s.lastContact;
  const contactActive = contact !== null && s.tick - contact.tick <= 1;
  const newContactEpisode = contactActive && !(old && old.contactActive === true);
  if (newContactEpisode) {
    handledContact = contact.tick;
    if (
      foe.status === 'active' &&
      ((contact.selfWedge && contact.opponentWedge) ||
        (contact.selfWedge && contact.closingSpeed < 2.85))
    ) {
      side = -side;
      disengageUntil = s.tick + 42;
    }
  }

  let pushX = 0;
  let pushY = 0;
  if (
    foe.status === 'flipped' &&
    old &&
    old.foeFlipped === true &&
    ((Math.abs(old.pushX) === 1 && old.pushY === 0) ||
      (Math.abs(old.pushY) === 1 && old.pushX === 0))
  ) {
    pushX = old.pushX;
    pushY = old.pushY;
  }

  const nextMemory = {
    v: 1,
    side,
    handledContact,
    disengageUntil,
    contactActive,
    supportX,
    supportY,
    supportSince,
    foeFlipped: foe.status === 'flipped',
    pushX,
    pushY,
  };

  if (me.status === 'flipped' || me.energy <= 0) {
    return { actions: { thrust: 0, turn: 0 }, memory: nextMemory };
  }

  const dxFoe = foe.x - me.x;
  const dyFoe = foe.y - me.y;
  const foeDistance = Math.max(1e-6, Math.sqrt(dxFoe * dxFoe + dyFoe * dyFoe));
  const bearingToFoe = Math.atan2(dyFoe, dxFoe);
  const bearingFoeToMe = Math.atan2(-dyFoe, -dxFoe);
  const selfAimError = Math.abs(wrap(bearingToFoe - me.heading));
  const foeAimError = Math.abs(wrap(bearingFoeToMe - foe.heading));
  const foeToMeX = -dxFoe / foeDistance;
  const foeToMeY = -dyFoe / foeDistance;
  const incomingSpeed =
    (foe.vx - me.vx) * foeToMeX + (foe.vy - me.vy) * foeToMeY;

  let targetX = foe.x;
  let targetY = foe.y;
  let desiredSpeed = 2.0;
  let allowReverse = false;
  let avoidFoe = false;
  let edgeMargin = 0.58;
  let lookLimit = 2.6;
  let mode = 'attack';

  let urgentCell = null;
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (cell.state === 'inactive') continue;
    const inside =
      Math.abs(me.x - cell.x) <= cell.size * 0.5 + 0.01 &&
      Math.abs(me.y - cell.y) <= cell.size * 0.5 + 0.01;
    if (!inside) continue;
    const collapseUrgent = cell.collapseIn !== null && cell.collapseIn < 1.45;
    const fireUrgent =
      cell.type === 'flame' && (cell.state === 'warning' || cell.state === 'flaming');
    if (cell.type === 'collapse' || collapseUrgent || fireUrgent || cell.integrity < 0.055) {
      urgentCell = cell;
      break;
    }
  }

  const outwardX = me.x >= 0 ? me.vx : -me.vx;
  const outwardY = me.y >= 0 ? me.vy : -me.vy;
  const marginX = 0.62 + 0.05 * Math.max(0, outwardX) * Math.max(0, outwardX);
  const marginY = 0.62 + 0.05 * Math.max(0, outwardY) * Math.max(0, outwardY);
  const edgeEmergency =
    half - Math.abs(me.x) < marginX ||
    half - Math.abs(me.y) < marginY ||
    Math.abs(me.x + me.vx * 0.45) > half - 0.48 ||
    Math.abs(me.y + me.vy * 0.45) > half - 0.48;

  if (urgentCell) {
    let escapeX = me.x - urgentCell.x;
    let escapeY = me.y - urgentCell.y;
    if (Math.abs(escapeX) + Math.abs(escapeY) < 0.08) {
      escapeX = -urgentCell.x;
      escapeY = -urgentCell.y;
      if (Math.abs(escapeX) + Math.abs(escapeY) < 0.08) {
        escapeX = side;
        escapeY = 0;
      }
    }
    if (Math.abs(escapeX) >= Math.abs(escapeY)) escapeY = 0;
    else escapeX = 0;
    const length = Math.max(1e-6, Math.sqrt(escapeX * escapeX + escapeY * escapeY));
    targetX = me.x + (escapeX / length) * 2.0;
    targetY = me.y + (escapeY / length) * 2.0;
    desiredSpeed = 3.8;
    allowReverse = true;
    mode = 'cell-escape';
  } else if (edgeEmergency) {
    targetX = clamp(-me.x * 0.35, -1.2, 1.2);
    targetY = clamp(-me.y * 0.35, -1.2, 1.2);
    desiredSpeed = 3.8;
    allowReverse = true;
    mode = 'edge-escape';
  } else {
    const directThreat =
      foe.status === 'active' &&
      me.status !== 'recovering' &&
      foeAimError < 0.7 &&
      foeDistance < 2.8 &&
      (incomingSpeed > 0.7 || foeDistance < 1.3);

    let charger = null;
    let chargerDistance = 1e9;
    let chargerScore = 1e9;
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      if (cell.type !== 'recharge' || cell.state === 'inactive') continue;
      if (cell.collapseIn !== null && cell.collapseIn < 2.2) continue;
      const d = Math.sqrt(distanceSquared(me.x, me.y, cell.x, cell.y));
      const eta = d / 2.0;
      const available =
        cell.state === 'ready' ||
        (cell.state === 'cooldown' &&
          cell.timeUntilChange !== null &&
          cell.timeUntilChange <= eta + 0.65);
      if (!available) continue;
      const boundaryCost =
        Math.max(0, Math.abs(cell.x) - (half - 0.7)) * 20 +
        Math.max(0, Math.abs(cell.y) - (half - 0.7)) * 20;
      const score = d + boundaryCost;
      if (score < chargerScore) {
        charger = cell;
        chargerDistance = d;
        chargerScore = score;
      }
    }

    const chargeThreshold = me.flipsTaken > 0 ? 195 : 165;
    const shouldCharge =
      charger !== null &&
      (me.energy < chargeThreshold || (me.energy < 215 && chargerDistance < 1.25));

    if (s.tick < disengageUntil && foe.status === 'active') {
      const tangentX = -dyFoe / foeDistance;
      const tangentY = dxFoe / foeDistance;
      targetX = foe.x + tangentX * side * 0.38;
      targetY = foe.y + tangentY * side * 0.38;
      desiredSpeed = 3.0;
      mode = 'wedge-slip';
    } else if (directThreat) {
      const lead = clamp(foeDistance / 12, 0.05, 0.18);
      const tangentX = -dyFoe / foeDistance;
      const tangentY = dxFoe / foeDistance;
      const offset = selfAimError < 0.5 ? 0.24 * side : 0;
      targetX = foe.x + foe.vx * lead + tangentX * offset;
      targetY = foe.y + foe.vy * lead + tangentY * offset;
      desiredSpeed = selfAimError < 0.55 ? 2.4 : 0.9;
      mode = 'wedge-defense';
    } else if (foe.status === 'flipped' && (me.energy > 22 || !shouldCharge)) {
      if (pushX === 0 && pushY === 0) {
        const right = half - foe.x;
        const left = half + foe.x;
        const top = half - foe.y;
        const bottom = half + foe.y;
        let best = right;
        pushX = 1;
        pushY = 0;
        if (left < best) {
          best = left;
          pushX = -1;
          pushY = 0;
        }
        if (top < best) {
          best = top;
          pushX = 0;
          pushY = 1;
        }
        if (bottom < best) {
          pushX = 0;
          pushY = -1;
        }
        nextMemory.pushX = pushX;
        nextMemory.pushY = pushY;
      }

      const relativeX = me.x - foe.x;
      const relativeY = me.y - foe.y;
      const along = relativeX * pushX + relativeY * pushY;
      const lateral = Math.abs(relativeX * -pushY + relativeY * pushX);
      const behind = along < -0.28 && lateral < 0.72;
      if (behind && foeDistance < 1.9) {
        targetX = foe.x + pushX * 0.25;
        targetY = foe.y + pushY * 0.25;
        desiredSpeed = me.energy > 45 ? 3.4 : 2.4;
        edgeMargin = 0.14;
        lookLimit = Math.max(0.55, foeDistance - 0.08);
        mode = 'push';
      } else {
        targetX = foe.x - pushX * 1.05;
        targetY = foe.y - pushY * 1.05;
        desiredSpeed = 2.4;
        avoidFoe = true;
        mode = 'push-stage';
      }
    } else if (shouldCharge) {
      const inside =
        Math.abs(me.x - charger.x) <= charger.size * 0.5 &&
        Math.abs(me.y - charger.y) <= charger.size * 0.5;
      if (inside && charger.state === 'ready') {
        let awayX = me.x - charger.x;
        let awayY = me.y - charger.y;
        if (Math.abs(awayX) + Math.abs(awayY) < 0.08) {
          awayX = -charger.x;
          awayY = -charger.y;
          if (Math.abs(awayX) + Math.abs(awayY) < 0.08) awayX = side;
        }
        const length = Math.max(1e-6, Math.sqrt(awayX * awayX + awayY * awayY));
        targetX = me.x + (awayX / length) * 1.15;
        targetY = me.y + (awayY / length) * 1.15;
        desiredSpeed = 1.8;
        mode = 'charger-exit';
      } else {
        targetX = charger.x;
        targetY = charger.y;
        desiredSpeed = chargerDistance < 0.8 ? 1.5 : 2.25;
        mode = 'recharge';
      }
    } else {
      const ahead =
        me.flipsTaken < foe.flipsTaken ||
        (me.flipsTaken === foe.flipsTaken && me.energy > foe.energy + 8);
      if (s.time > 105 && ahead) {
        const phase = side * s.time * 0.34;
        targetX = Math.cos(phase) * 1.05;
        targetY = Math.sin(phase) * 1.05;
        desiredSpeed = 1.25;
        avoidFoe = true;
        mode = 'late-defense';
      } else {
        const lead = clamp((foeDistance - 0.75) / 4.2, 0.08, 0.42);
        const predictedX = clamp(foe.x + foe.vx * lead, -half + 0.35, half - 0.35);
        const predictedY = clamp(foe.y + foe.vy * lead, -half + 0.35, half - 0.35);
        const exposed = foeAimError > 1.18;
        const recoveringSoon = foe.status === 'recovering' && foe.statusTimer < 0.42;

        if ((foe.status === 'active' || recoveringSoon) && exposed && foeDistance < 4.2) {
          targetX = predictedX;
          targetY = predictedY;
          const aim = Math.abs(wrap(Math.atan2(targetY - me.y, targetX - me.x) - me.heading));
          desiredSpeed = aim < 0.42 ? (me.energy > 60 ? 4.5 : 3.0) : 1.7;
          lookLimit = Math.max(0.7, foeDistance + 0.25);
          mode = 'charge';
        } else {
          const forwardX = Math.cos(foe.heading);
          const forwardY = Math.sin(foe.heading);
          const leftX = -forwardY;
          const leftY = forwardX;
          const sideOffset = 1.55;
          const rearOffset = 0.35;
          const preferredX = predictedX - forwardX * rearOffset + leftX * side * sideOffset;
          const preferredY = predictedY - forwardY * rearOffset + leftY * side * sideOffset;
          const alternateX = predictedX - forwardX * rearOffset - leftX * side * sideOffset;
          const alternateY = predictedY - forwardY * rearOffset - leftY * side * sideOffset;

          function stageScore(x, y, preferred) {
            const d = Math.sqrt(distanceSquared(me.x, me.y, x, y));
            const boundary =
              Math.max(0, Math.abs(x) - (half - 0.62)) * 35 +
              Math.max(0, Math.abs(y) - (half - 0.62)) * 35;
            return d + boundary - (preferred ? 0.18 : 0);
          }

          const preferredScore = stageScore(preferredX, preferredY, true);
          const alternateScore = stageScore(alternateX, alternateY, false);
          if (alternateScore + 0.35 < preferredScore) {
            side = -side;
            nextMemory.side = side;
            targetX = alternateX;
            targetY = alternateY;
          } else {
            targetX = preferredX;
            targetY = preferredY;
          }

          if (distanceSquared(me.x, me.y, targetX, targetY) < 0.42 * 0.42 && recoveringSoon) {
            targetX = predictedX;
            targetY = predictedY;
            desiredSpeed = me.energy > 60 ? 4.3 : 2.8;
            mode = 'charge';
          } else {
            desiredSpeed = foe.status === 'recovering' ? 1.8 : 2.2;
            avoidFoe = true;
            mode = 'flank';
          }
        }
      }
    }

    if (
      s.tick - supportSince > 240 &&
      mode !== 'push' &&
      mode !== 'charge' &&
      mode !== 'wedge-defense'
    ) {
      const centerX = supportX + 0.5;
      const centerY = supportY + 0.5;
      let leaveX = me.x - centerX;
      let leaveY = me.y - centerY;
      if (Math.abs(leaveX) + Math.abs(leaveY) < 0.1) {
        leaveX = -centerX;
        leaveY = -centerY;
        if (Math.abs(leaveX) + Math.abs(leaveY) < 0.1) leaveX = side;
      }
      if (Math.abs(leaveX) >= Math.abs(leaveY)) leaveY = 0;
      else leaveX = 0;
      const length = Math.max(1e-6, Math.sqrt(leaveX * leaveX + leaveY * leaveY));
      targetX = me.x + (leaveX / length) * 1.25;
      targetY = me.y + (leaveY / length) * 1.25;
      desiredSpeed = Math.max(desiredSpeed, 1.55);
      allowReverse = true;
      avoidFoe = false;
      mode = 'floor-move';
    }
  }

  const targetDx = targetX - me.x;
  const targetDy = targetY - me.y;
  const targetDistance = Math.max(1e-6, Math.sqrt(targetDx * targetDx + targetDy * targetDy));
  const desiredBearing = Math.atan2(targetDy, targetDx);
  const speed = Math.sqrt(me.vx * me.vx + me.vy * me.vy);
  let look = clamp(0.9 + speed * 0.42 + Math.abs(desiredSpeed) * 0.22, 0.8, 2.8);
  look = Math.min(look, lookLimit);
  if (mode !== 'charge' && mode !== 'push') look = Math.min(look, Math.max(0.5, targetDistance));
  const horizon = clamp(look / Math.max(1.0, speed + 1.0), 0.25, 1.35);

  const offsets = [
    0,
    side * 0.52,
    -side * 0.52,
    side * 1.08,
    -side * 1.08,
  ];
  let moveBearing = desiredBearing;
  let bestScore = -1e30;
  for (let i = 0; i < offsets.length; i += 1) {
    const angle = desiredBearing + offsets[i];
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const endX = me.x + me.vx * 0.22 + dirX * look;
    const endY = me.y + me.vy * 0.22 + dirY * look;
    let score = Math.cos(offsets[i]) * 7.0;
    score -= Math.abs(wrap(angle - me.heading)) * 0.32;
    score -= routePenalty(me.x, me.y, endX, endY, horizon);

    const overX = Math.max(0, Math.abs(endX) - (half - edgeMargin));
    const overY = Math.max(0, Math.abs(endY) - (half - edgeMargin));
    score -= (overX + overY) * 8000;
    const edgeClearance = half - Math.max(Math.abs(endX), Math.abs(endY));
    if (edgeClearance < 1.1) score -= (1.1 - edgeClearance) * 18;

    if (avoidFoe) {
      const foePathDistance = segmentPointDistanceSquared(
        me.x,
        me.y,
        endX,
        endY,
        foe.x,
        foe.y,
      );
      if (foePathDistance < 0.78 * 0.78) score -= 260;
      else if (foePathDistance < 1.15 * 1.15) score -= 14;
    }

    score -= i * 0.0001;
    if (score > bestScore) {
      bestScore = score;
      moveBearing = angle;
    }
  }

  let driveSign = 1;
  let faceBearing = moveBearing;
  if (allowReverse && Math.abs(wrap(moveBearing - me.heading)) > PI * 0.5) {
    driveSign = -1;
    faceBearing = wrap(moveBearing + PI);
  }

  const headingError = wrap(faceBearing - me.heading);
  let turn = clamp(2.6 * headingError - 0.55 * me.omega, -1, 1);
  const alignment = Math.max(0.08, Math.cos(headingError));
  let requestedSpeed = desiredSpeed * alignment * driveSign;

  if (mode !== 'charge' && mode !== 'push' && targetDistance < 0.85) {
    requestedSpeed *= clamp(targetDistance / 0.85, 0.18, 1);
  }

  const forwardSpeed = me.vx * Math.cos(me.heading) + me.vy * Math.sin(me.heading);
  let thrust = clamp((1.6 * forwardSpeed + 3.0 * (requestedSpeed - forwardSpeed)) / 8, -1, 1);

  if (me.energy < 70 && mode !== 'cell-escape' && mode !== 'edge-escape' && mode !== 'push') {
    thrust = clamp(thrust, -0.55, 0.55);
    turn = clamp(turn, -0.75, 0.75);
  }
  if (me.energy < 35 && mode !== 'cell-escape' && mode !== 'edge-escape') {
    thrust = clamp(thrust, -0.38, 0.38);
    turn = clamp(turn, -0.58, 0.58);
  }

  return {
    actions: {
      thrust: Number.isFinite(thrust) ? clamp(thrust, -1, 1) : 0,
      turn: Number.isFinite(turn) ? clamp(turn, -1, 1) : 0,
    },
    memory: nextMemory,
  };
}
