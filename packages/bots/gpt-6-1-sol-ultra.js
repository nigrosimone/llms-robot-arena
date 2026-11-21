export function tick(sensors, memory) {
  const s = sensors;
  const a = s.self;
  const b = s.opponent;
  const cells = s.arena.cells;
  const pi = Math.PI;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const angle = v => Math.atan2(Math.sin(v), Math.cos(v));
  const distance = (x, y) => Math.hypot(x - a.x, y - a.y);
  const limit = s.arena.nextHalfExtent;
  const enemyDistance = distance(b.x, b.y);
  const enemyBearing = Math.atan2(b.y - a.y, b.x - a.x);
  const hazards = [];
  const obstacles = [];
  let support = null;

  for (const c of cells) {
    if (c.state === 'inactive') continue;
    if (Math.floor(a.x) === Math.floor(c.x) && Math.floor(a.y) === Math.floor(c.y)) support = c;
    if (c.type === 'hole' || (c.collapseIn !== null && c.collapseIn < 3.1)) {
      hazards.push(c);
      obstacles.push(c);
    } else if (c.type === 'flame') {
      obstacles.push(c);
    }
  }

  // Inclusive segment/square intersection also protects against corner crossings.
  function crosses(x, y, xx, yy, c, margin) {
    const dx = xx - x;
    const dy = yy - y;
    const r = 0.5 + margin;
    let lo = 0;
    let hi = 1;
    if (Math.abs(dx) < 0.000001) {
      if (Math.abs(x - c.x) > r) return false;
    } else {
      const t1 = (c.x - r - x) / dx;
      const t2 = (c.x + r - x) / dx;
      lo = Math.max(lo, Math.min(t1, t2));
      hi = Math.min(hi, Math.max(t1, t2));
    }
    if (Math.abs(dy) < 0.000001) {
      if (Math.abs(y - c.y) > r) return false;
    } else {
      const t1 = (c.y - r - y) / dy;
      const t2 = (c.y + r - y) / dy;
      lo = Math.max(lo, Math.min(t1, t2));
      hi = Math.min(hi, Math.max(t1, t2));
    }
    return lo <= hi;
  }

  function clear(x, y, xx, yy, margin) {
    if (Math.max(Math.abs(xx), Math.abs(yy)) > limit - margin - 0.2) return false;
    for (const h of obstacles) {
      // A warning under us is still solid: permit a direct escape from it.
      if (h.type !== 'hole' && Math.abs(x - h.x) < 0.51 && Math.abs(y - h.y) < 0.51) continue;
      if (crosses(x, y, xx, yy, h, margin)) return false;
    }
    return true;
  }

  const urgent = support !== null &&
    ((support.collapseIn !== null && support.collapseIn < 2.9) ||
      support.integrity < 0.13 || support.state === 'flaming' ||
      (support.type === 'flame' && support.state === 'warning'));

  let state = memory && typeof memory === 'object' && !Array.isArray(memory) ? memory : {};
  let path = Array.isArray(state.path) ? state.path : [];
  let goal = typeof state.goal === 'number' ? state.goal : -1;
  let mode = typeof state.mode === 'string' ? state.mode : 'patrol';
  let planned = typeof state.planned === 'number' ? state.planned : -100;
  const polar = Math.atan2(a.y, a.x);
  const direction = state.direction === -1 || state.direction === 1 ? state.direction :
    (Math.abs(angle(polar + pi / 2 - a.heading)) <= Math.abs(angle(polar - pi / 2 - a.heading)) ? 1 : -1);
  const gx = goal % 16 - 7.5;
  const gy = Math.floor(goal / 16) - 7.5;

  // A small public grid search supplies routes around holes without a long rollout.
  if (s.tick - planned >= 18 || path.length === 0 || goal < 0 || distance(gx, gy) < 0.4 || urgent) {
    const blocked = new Array(256).fill(false);
    const wear = new Array(256).fill(1);
    const kind = new Array(256).fill('floor');
    for (let i = 0; i < 256; i++) {
      const x = i % 16 - 7.5;
      const y = Math.floor(i / 16) - 7.5;
      if (Math.max(Math.abs(x), Math.abs(y)) > limit - 0.65) blocked[i] = true;
      if (b.status !== 'flipped' && b.energy > 10 && distance(x, y) > 1 &&
          Math.hypot(x - b.x - b.vx * 0.15, y - b.y - b.vy * 0.15) < 1.35) blocked[i] = true;
    }
    for (const c of cells) {
      const ix = Math.floor(c.x) + 8;
      const iy = Math.floor(c.y) + 8;
      if (ix < 0 || ix > 15 || iy < 0 || iy > 15) continue;
      const i = iy * 16 + ix;
      wear[i] = c.integrity;
      kind[i] = c.type;
      if (c.state === 'inactive' || c.type === 'hole' || c.type === 'flame' ||
          c.integrity < 0.16 || (c.collapseIn !== null && c.collapseIn < 4)) blocked[i] = true;
    }
    const ix = clamp(Math.floor(a.x) + 8, 0, 15);
    const iy = clamp(Math.floor(a.y) + 8, 0, 15);
    const start = iy * 16 + ix;
    const previous = new Array(256).fill(-1);
    const steps = new Array(256).fill(1000);
    const queue = [start];
    previous[start] = start;
    steps[start] = 0;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const x = i % 16;
      const y = Math.floor(i / 16);
      for (let direction = 0; direction < 4; direction++) {
        if ((direction === 0 && x === 0) || (direction === 1 && x === 15) ||
            (direction === 2 && y === 0) || (direction === 3 && y === 15)) continue;
        const j = i + (direction === 0 ? -1 : direction === 1 ? 1 : direction === 2 ? -16 : 16);
        if (blocked[j] || previous[j] >= 0) continue;
        previous[j] = i;
        steps[j] = steps[i] + 1;
        queue.push(j);
      }
    }

    let selected = -1;
    let best = 100000;
    if (a.energy < 225) {
      for (const c of cells) {
        if (c.type !== 'recharge' || c.state === 'inactive' ||
            (c.collapseIn !== null && c.collapseIn < 6)) continue;
        const i = (Math.floor(c.y) + 8) * 16 + Math.floor(c.x) + 8;
        if (i < 0 || i > 255 || blocked[i] || previous[i] < 0 || i === start) continue;
        const wait = c.state === 'ready' ? 0 : Math.max(0, (c.timeUntilChange || 0) - steps[i] * 0.8);
        const contest = Math.hypot(c.x - b.x, c.y - b.y) < 1.8 && b.status !== 'flipped' ? 2 : 0;
        const cost = steps[i] + wait * 1.2 + contest - (mode === 'charge' && i === goal ? 1.4 : 0);
        if (cost < best) {
          best = cost;
          selected = i;
        }
      }
      if (selected >= 0) mode = 'charge';
    }
    if (selected < 0) {
      mode = 'patrol';
      {
        best = 100000;
        const orbitRadius = Math.min(2.65, limit - 1.3);
        const orbitX = orbitRadius * Math.cos(polar + direction * 0.8);
        const orbitY = orbitRadius * Math.sin(polar + direction * 0.8);
        for (const i of queue) {
          const x = i % 16 - 7.5;
          const y = Math.floor(i / 16) - 7.5;
          const d = distance(x, y);
          if (i === start || d < 1.3 || d > 4.5 || kind[i] !== 'floor' ||
              Math.max(Math.abs(x), Math.abs(y)) > Math.min(2.5, limit - 1.2)) continue;
          const opponentGap = Math.hypot(x - b.x, y - b.y);
          const cost = 2 * Math.hypot(x - orbitX, y - orbitY) + 0.12 * steps[i] +
            (1 - wear[i]) * 3 + Math.max(0, 2 - opponentGap) * 4;
          if (cost < best) {
            best = cost;
            selected = i;
          }
        }
      }
    }
    if (selected < 0) {
      for (const i of queue) {
        if (i !== start && !blocked[i]) {
          selected = i;
          break;
        }
      }
    }
    path = [];
    if (selected >= 0) {
      let i = selected;
      for (let n = 0; n < 256 && i !== start; n++) {
        path.push(i);
        i = previous[i];
        if (i < 0) break;
      }
      path.reverse();
    }
    goal = selected;
    planned = s.tick;
  }

  let tx = a.x;
  let ty = a.y;
  for (let i = 0; i < path.length; i++) {
    const x = path[i] % 16 - 7.5;
    const y = Math.floor(path[i] / 16) - 7.5;
    const segmentLength = Math.hypot(x - a.x, y - a.y);
    const projection = segmentLength > 0 ? clamp(((b.x - a.x) * (x - a.x) +
      (b.y - a.y) * (y - a.y)) / (segmentLength * segmentLength), 0, 1) : 0;
    const enemyGap = Math.hypot(a.x + projection * (x - a.x) - b.x,
      a.y + projection * (y - a.y) - b.y);
    if (clear(a.x, a.y, x, y, 0.17) &&
        (b.status === 'flipped' || b.energy < 10 || enemyGap >= Math.min(1.25, enemyDistance - 0.05))) {
      tx = x;
      ty = y;
    } else break;
  }
  if (path.length === 0 && clear(a.x, a.y, a.x, a.y, 0.1)) {
    tx = a.x;
    ty = a.y;
  }

  let targetHeading = Math.atan2(ty - a.y, tx - a.x);
  let headingError = angle(targetHeading - a.heading);
  let sign = 1;
  if (Math.abs(headingError) > 1.8) {
    sign = -1;
    targetHeading = angle(targetHeading + pi);
    headingError = angle(targetHeading - a.heading);
  }
  let targetSpeed = sign * Math.min(1.35, Math.sqrt(4 * distance(tx, ty)));
  const defend = b.status !== 'flipped' && b.energy > 1 && !urgent &&
    clear(a.x, a.y, b.x, b.y, 0.2);
  if (defend) {
    targetHeading = enemyBearing;
    headingError = angle(targetHeading - a.heading);
  }

  if (Math.abs(headingError) > 1) targetSpeed = 0;
  else targetSpeed *= Math.max(0, Math.cos(headingError * 1.4));
  const longitudinal = a.vx * Math.cos(a.heading) + a.vy * Math.sin(a.heading);
  let turn = clamp(4.8 * headingError - 1.8 * a.omega, -1, 1);
  let thrust = clamp(0.2 * targetSpeed + 0.55 * (targetSpeed - longitudinal), -1, 1);
  if (defend) {
    const recentContact = s.lastContact !== null && s.tick - s.lastContact.tick < 24;
    thrust = Math.abs(headingError) < 0.45 ? (enemyDistance < 1.2 || recentContact ? 0.76 : 1) : 0.05;
  }

  const nearbyHazards = [];
  for (const c of hazards) {
    if (distance(c.x, c.y) < Math.hypot(a.vx, a.vy) * 0.7 + 1.5) nearbyHazards.push(c);
  }

  // Short, bounded predictions are a final braking guard around lethal geometry.
  function risk(throttle, steering) {
    let x = a.x;
    let y = a.y;
    let vx = a.vx;
    let vy = a.vy;
    let h = a.heading;
    let omega = a.omega;
    let cost = 0;
    for (let k = 0; k < 6; k++) {
      const dt = 0.1;
      omega += (5.4 * steering - 1.8 * omega) * dt;
      h += omega * dt;
      const cx = Math.cos(h);
      const cy = Math.sin(h);
      vx += (8 * throttle * cx - 1.6 * vx) * dt;
      vy += (8 * throttle * cy - 1.6 * vy) * dt;
      const forward = vx * cx + vy * cy;
      vx = forward * cx + (vx - forward * cx) * 0.003375;
      vy = forward * cy + (vy - forward * cy) * 0.003375;
      const nx = x + vx * dt;
      const ny = y + vy * dt;
      const edge = limit - Math.max(Math.abs(nx), Math.abs(ny));
      if (edge < 0.12) cost += 10000 + (0.12 - edge) * 10000;
      else if (edge < 0.65) cost += (0.65 - edge) * 8;
      for (const c of nearbyHazards) {
        if (c.type !== 'hole' && Math.abs(a.x - c.x) < 0.51 && Math.abs(a.y - c.y) < 0.51) continue;
        if (crosses(x, y, nx, ny, c, 0.1)) cost += 10000;
      }
      x = nx;
      y = ny;
    }
    return cost;
  }

  const nearDanger = Math.max(Math.abs(a.x), Math.abs(a.y)) > limit - 2.4 || nearbyHazards.length > 0;
  if (nearDanger) {
    const initialRisk = risk(thrust, turn);
    if (initialRisk > 0.5) {
      let best = initialRisk;
      let selectedThrust = thrust;
      let selectedTurn = turn;
      for (const candidateThrust of [-1, 0, 1]) {
        for (const candidateTurn of [turn, -1, 1]) {
          const cost = risk(candidateThrust, candidateTurn) +
            0.12 * Math.abs(candidateThrust - thrust) + 0.15 * Math.abs(candidateTurn - turn);
          if (cost < best) {
            best = cost;
            selectedThrust = candidateThrust;
            selectedTurn = candidateTurn;
          }
        }
      }
      thrust = selectedThrust;
      turn = selectedTurn;
    }
  }

  if (a.status === 'flipped' || a.energy <= 0) {
    thrust = 0;
    turn = 0;
  }
  return { actions: { thrust, turn }, memory: { goal, path, mode, planned, direction } };
}
