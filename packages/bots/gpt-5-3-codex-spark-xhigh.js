export function tick(sensors, memory) {
  const me = sensors.self;
  const opp = sensors.opponent;
  const cells = sensors.arena.cells;

  const m = memory && typeof memory === 'object' && !Array.isArray(memory) ? memory : {};
  const side = m.side === -1 ? -1 : 1;
  const lastCellX = m.cellX === 'number' ? m.cellX : null;
  const lastCellY = m.cellY === 'number' ? m.cellY : null;
  const stayTicks = m.stayTicks === 'number' ? m.stayTicks : 0;

  const sx = me.x;
  const sy = me.y;
  const ox = opp.x;
  const oy = opp.y;

  const vx0 = ox - sx;
  const vy0 = oy - sy;
  const dist2 = vx0 * vx0 + vy0 * vy0;
  const dist = dist2 ? Math.sqrt(dist2) : 0;

  const oppHead = opp.heading;
  const oppBackX = -Math.cos(oppHead);
  const oppBackY = -Math.sin(oppHead);
  const oppSideX = -Math.sin(oppHead);
  const oppSideY = Math.cos(oppHead);

  let tx = vx0;
  let ty = vy0;

  if (dist < 2.6) {
    tx = (ox + oppBackX + oppSideX * 0.9 * side) - sx;
    ty = (oy + oppBackY + oppSideY * 0.9 * side) - sy;
  } else if (dist < 4.4) {
    tx = (ox + oppBackX * 1.2) - sx;
    ty = (oy + oppBackY * 1.2) - sy;
  }

  const half = sensors.arena.halfExtent - 1.0;
  if (sx > half) tx -= (sx - half) * 2.6;
  else if (sx < -half) tx += (-half - sx) * 2.6;
  if (sy > half) ty -= (sy - half) * 2.6;
  else if (sy < -half) ty += (-half - sy) * 2.6;

  let myCellX = Math.floor(sx);
  let myCellY = Math.floor(sy);
  if (myCellX < -8) myCellX = -8;
  else if (myCellX > 7) myCellX = 7;
  if (myCellY < -8) myCellY = -8;
  else if (myCellY > 7) myCellY = 7;

  const sameCell = myCellX === lastCellX && myCellY === lastCellY;
  const newStay = sameCell ? stayTicks + 1 : 1;

  let weakCellRepelX = 0;
  let weakCellRepelY = 0;

  const cellCount = cells ? cells.length : 0;
  for (let i = 0; i < cellCount; i++) {
    const c = cells[i];
    const dx = sx - c.x;
    const dy = sy - c.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 12.25) continue;
    if (d2 === 0) continue;

    const isHole = c.state === 'hole' || c.type === 'hole' || c.type === 'collapse';
    const isFlame = c.type === 'flame' && c.state === 'flaming';
    const isWarn = c.state === 'warning';

    if (isHole || isFlame || isWarn) {
      const w = isHole ? 0.05 : isFlame ? 0.04 : 0.03;
      const inv = w / d2;
      tx += dx * inv;
      ty += dy * inv;
    }

    if (Math.abs(sx - c.x) <= 0.5 && Math.abs(sy - c.y) <= 0.5) {
      const integ = c.integrity;
      if (typeof integ === 'number' && integ < 0.4) {
        const cx = c.x - 0.5;
        const cy = c.y - 0.5;
        weakCellRepelX += sx - cx;
        weakCellRepelY += sy - cy;
      }
      if (c.collapseIn !== null && typeof c.collapseIn === 'number' && c.collapseIn <= 2.5) {
        weakCellRepelX += (sx - c.x) * 0.14;
        weakCellRepelY += (sy - c.y) * 0.14;
      }
    }
  }

  tx += weakCellRepelX * 1.4;
  ty += weakCellRepelY * 1.4;

  if (newStay > 85 && me.status === 'active') {
    tx += (sx - opp.x) * 0.2;
    ty += (sy - opp.y) * 0.2;
  }

  let desired = Math.atan2(ty, tx);
  if (!Number.isFinite(desired)) desired = me.heading;

  let headingErr = desired - me.heading;
  if (headingErr > Math.PI) headingErr -= 6.283185307179586;
  if (headingErr < -Math.PI) headingErr += 6.283185307179586;

  let thrust = 0;
  let turn = 0;

  if (me.status === 'flipped') {
    thrust = 0;
    turn = 0;
  } else {
    const base = me.energy < 60 ? 0.4 : me.energy < 130 ? 0.72 : 1.0;
    const close = dist < 4.8 ? dist / 4.8 : 1;
    thrust = base * (0.3 + 0.7 * close);

    turn = headingErr * 2.15;
    if (turn > 1) turn = 1;
    else if (turn < -1) turn = -1;

    if (Math.abs(headingErr) > 1.1) thrust *= 0.55;

    if (dist < 0.95) {
      thrust = 0.55;
      turn = turn * 0.65;
    }

    const contact = sensors.lastContact;
    if (contact && contact.tick === sensors.tick) {
      if (contact.selfWedge && !contact.opponentWedge) {
        thrust *= 0.88;
      }
      if (!contact.selfWedge && contact.opponentWedge) {
        thrust = 0.2;
        turn = headingErr > 0 ? 0.9 : -0.9;
      }
    }

    if (me.status === 'recovering' && me.statusTimer > 0.2) {
      thrust *= 0.9;
      if (turn > 0) turn -= 0.07;
      else turn += 0.07;
      if (turn > 1) turn = 1;
      else if (turn < -1) turn = -1;
    }
  }

  if (thrust > 1) thrust = 1;
  else if (thrust < -1) thrust = -1;

  if (!Number.isFinite(thrust)) thrust = 0;
  if (!Number.isFinite(turn)) turn = 0;

  let nextSide = side;
  const contact = sensors.lastContact;
  if (contact && contact.tick === sensors.tick) {
    if (contact.selfWedge && !contact.opponentWedge) nextSide = sx < ox ? 1 : -1;
    if (!contact.selfWedge && contact.opponentWedge) nextSide = -side;
  }

  return {
    actions: { thrust, turn },
    memory: {
      side: nextSide,
      cellX: myCellX,
      cellY: myCellY,
      stayTicks: newStay,
    },
  };
}
