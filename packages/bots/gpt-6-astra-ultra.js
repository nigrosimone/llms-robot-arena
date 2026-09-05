// @model gpt-6-astra-ultra
// Iterative development using public sensors and opaque match opponents.
// Rules 0.2.2: permanent floor wear, announced collapses, finite energy.
export function tick(s, memory) {
  const a = s.self, b = s.opponent;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrap = v => Math.atan2(Math.sin(v), Math.cos(v));
  const m = memory && typeof memory === "object" ? memory : {};
  if (a.status === "flipped" || a.energy <= 0)
    return { actions: { thrust: 0, turn: 0 }, memory: null };

  const half = Math.min(s.arena.halfExtent, s.arena.nextHalfExtent) - 0.34;
  const cells = s.arena.cells || [];
  const grid = [], integrity = [];
  const hazards = [], chargers = [];
  const index = (x, y) => clamp(Math.floor(y) + 8, 0, 15) * 16 + clamp(Math.floor(x) + 8, 0, 15);
  const px = i => i % 16 - 7.5, py = i => Math.floor(i / 16) - 7.5;
  const start = index(a.x, a.y);
  let urgent = Math.max(Math.abs(a.x), Math.abs(a.y)) > half - 0.3;
  for (let ci = 0; ci < cells.length; ci++) {
    const c = cells[ci];
    const i = index(c.x, c.y), wear = c.integrity == null ? 1 : c.integrity;
    integrity[i] = wear;
    if (c.state === "inactive") continue;
    const falling = c.collapseIn != null || c.type === "collapse";
    if (c.type === "hole" || falling || c.type === "flame") {
      grid[i] = 1;
      hazards.push([c.x, c.y, c.size * 0.5 + 0.23, c.type === "hole" ? 0 : 1]);
    } else if (wear < 0.24) grid[i] = 1;
    if (i === start && (falling || wear < 0.4 || c.type === "flame")) urgent = true;
    if (c.type === "hole" && Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y)) < 0.95)
      urgent = true;
    if (c.type === "recharge" && !falling && wear > 0.26) chargers.push(c);
  }

  // Swept segments, rather than endpoint tests, avoid clipping hole corners.
  // From a warning tile we may depart; a padded hole may only be escaped outward.
  function clear(x, y, u, v) {
    if (Math.max(Math.abs(u), Math.abs(v)) > half) return false;
    for (let hi = 0; hi < hazards.length; hi++) {
      const h = hazards[hi];
      const hx = h[0], hy = h[1], r = h[2];
      if (Math.max(x, u) < hx - r || Math.min(x, u) > hx + r ||
          Math.max(y, v) < hy - r || Math.min(y, v) > hy + r) continue;
      if (Math.abs(x - hx) < r && Math.abs(y - hy) < r) {
        if (h[3] === 1 || (x - hx) * (u - x) + (y - hy) * (v - y) > 0) continue;
        return false;
      }
      let enter = 0, leave = 1;
      const dx = u - x, dy = v - y;
      if (Math.abs(dx) > 0.000001) {
        const q = (hx - r - x) / dx, w = (hx + r - x) / dx;
        enter = Math.max(enter, Math.min(q, w)); leave = Math.min(leave, Math.max(q, w));
      } else if (Math.abs(x - hx) > r) continue;
      if (Math.abs(dy) > 0.000001) {
        const q = (hy - r - y) / dy, w = (hy + r - y) / dy;
        enter = Math.max(enter, Math.min(q, w)); leave = Math.min(leave, Math.max(q, w));
      } else if (Math.abs(y - hy) > r) continue;
      if (enter <= leave) return false;
    }
    return true;
  }

  // Navigation treats the other chassis as an obstacle; a deliberate attack
  // alone may route through it. This avoids spending the battery in a traffic jam.
  function routeClear(x, y, u, v, attack) {
    if (!clear(x, y, u, v)) return false;
    if (attack) return true;
    const dx = u - x, dy = v - y, ex = b.x - x, ey = b.y - y;
    const startDistance = ex * ex + ey * ey;
    if (startDistance < 1.3) return ex * dx + ey * dy < -0.01;
    const t = clamp((ex * dx + ey * dy) / Math.max(0.0001, dx * dx + dy * dy), 0, 1);
    return (ex - t * dx) * (ex - t * dx) + (ey - t * dy) * (ey - t * dy) > 1.3;
  }

  const dx = b.x - a.x, dy = b.y - a.y;
  const distance = Math.hypot(dx, dy), bearing = Math.atan2(dy, dx);
  const exposure = Math.abs(wrap(bearing + Math.PI - b.heading));
  const closing = -(dx * (b.vx - a.vx) + dy * (b.vy - a.vy)) / Math.max(0.2, distance);
  const enemyAway = (dx * b.vx + dy * b.vy) / Math.max(0.2, distance);
  const ownToward = (dx * a.vx + dy * a.vy) / Math.max(0.2, distance);
  // Resist an actual advancing shove; do not chase a retreating wedge until empty.
  const pressure = (enemyAway < -0.5 && ownToward < -0.3) ||
    (m.pressure === true && distance < 1.4 && enemyAway < 0.55);
  const powerless = b.status === "flipped" || b.energy < 12;
  // A flip deficit cannot be repaired by hoarding energy at the time limit.
  const finish = a.flipsTaken > b.flipsTaken && s.time > 75;
  const charge = a.energy < (finish ? 95 : 210) ||
    (m.mode === "charge" && a.energy < (finish ? 170 : 265));
  // Resist a sustained frontal shove before doing any route search.
  // A dangerous supporting tile still takes precedence over holding contact.
  if (!urgent && (!charge || pressure) && !powerless && distance < 1.25 && exposure < 1.1 &&
      clear(a.x, a.y, a.x + a.vx * 0.55, a.y + a.vy * 0.55) &&
      clear(a.x, a.y, a.x + Math.cos(bearing) * 0.55, a.y + Math.sin(bearing) * 0.55)) {
    const slip = pressure && a.energy < 225 ? (m.side === -1 ? -0.22 : 0.22) : 0;
    const error = wrap(bearing + slip - a.heading);
    const forward = a.vx * Math.cos(a.heading) + a.vy * Math.sin(a.heading);
    const tracking = clamp((dx * (b.vy - a.vy) - dy * (b.vx - a.vx)) /
      Math.max(0.25, distance * distance), -3, 3);
    return { actions: {
      thrust: clamp((5.8 * 4.5 * Math.max(0, Math.cos(error)) - 4.2 * forward) / 8, -1, 1),
      turn: clamp(error * 3.6 + tracking - a.omega * 1.25, -1, 1)
    }, memory: { mode: "guard", pressure } };
  }
  const side = m.side === -1 ? -1 : 1;
  let goal = Array.isArray(m.goal) && m.goal.length === 2 ? m.goal : [0, 0];
  let nav = Array.isArray(m.nav) && m.nav.length === 2 ? m.nav : goal;
  let mode = typeof m.mode === "string" ? m.mode : "move";
  let planned = Number.isFinite(m.planned) ? m.planned : -100;
  const mustPlan = s.tick - planned >= 12 || planned > s.tick ||
    Math.hypot(nav[0] - a.x, nav[1] - a.y) < 0.25 ||
    !routeClear(a.x, a.y, nav[0], nav[1], mode === "attack") || (urgent && mode !== "escape");

  let nextSide = side;
  if (mustPlan) {
    let best = -100000, chosen = start, chosenSide = side;
    function offer(x, y, value, kind, direction) {
      const i = index(x, y);
      if (grid[i] || Math.max(Math.abs(x), Math.abs(y)) > half) return;
      if (Math.hypot(x - a.x, y - a.y) < 0.38 && kind !== "attack") return;
      if ((x !== px(i) || y !== py(i)) && !routeClear(px(i), py(i), x, y, kind === "attack")) return;
      const travel = Math.hypot(x - a.x, y - a.y) + (routeClear(a.x, a.y, x, y, kind === "attack") ? 0 : 3);
      const score = value - travel * 1.65 - (1 - (integrity[i] == null ? 1 : integrity[i])) * 4 -
        1.4 / Math.max(0.3, half - Math.max(Math.abs(x), Math.abs(y))) +
        (mode === kind && Math.hypot(x - goal[0], y - goal[1]) < 0.8 ? 0.8 : 0);
      if (score > best) {
        best = score; goal = [x, y]; chosen = i; mode = kind; chosenSide = direction || side;
      }
    }

    if (!urgent) {
      for (let ci = 0; ci < chargers.length; ci++) {
        const c = chargers[ci];
        if (Math.abs(a.x - c.x) <= 0.55 && Math.abs(a.y - c.y) <= 0.55) continue;
        const travel = Math.max(0.5, Math.hypot(c.x - a.x, c.y - a.y) / 2.3);
        const wait = c.state === "ready" ? 0 : Math.max(0, (c.timeUntilChange || 0) - travel);
        const enemyNear = Math.hypot(c.x - b.x, c.y - b.y);
        offer(c.x, c.y, (charge ? 30 + Math.max(0, 120 - a.energy) * 0.2 : a.energy < 260 ? 7 : -30) -
          wait * 5 - (enemyNear < 1.3 && !powerless ? 5 : 0), "charge", side);
      }
      const rearAttack = finish && b.energy < 50 && b.status !== "flipped";
      if (a.energy > 48 && (powerless || exposure > 1.05) && distance < 5.5 &&
          (!rearAttack || exposure > 1.05)) {
        const lead = clamp((distance - 0.8) / 5, 0, 0.3);
        offer(b.x + b.vx * lead, b.y + b.vy * lead,
          charge && a.energy < 100 ? 6 : 26 + (powerless ? 5 : 0), "attack", side);
      }
      const cb = Math.cos(b.heading), sb = Math.sin(b.heading);
      if (rearAttack)
        offer(b.x - cb * 2.2, b.y - sb * 2.2, 29, "flank", side);
      for (const direction of [side, -side]) {
        offer(b.x - cb * 0.35 - sb * direction * 2.15,
          b.y - sb * 0.35 + cb * direction * 2.15,
          14 + (direction === side ? 1.1 : 0), "flank", direction);
      }
    }
    // Moving between fresh cells avoids accumulating a stationary load.
    for (let k = 0; k < (urgent ? 8 : best > 3 ? 0 : 4); k++) {
      const angle = k * Math.PI / (urgent ? 4 : 2);
      const x = Math.floor(a.x + Math.cos(angle) * 2) + 0.5;
      const y = Math.floor(a.y + Math.sin(angle) * 2) + 0.5;
      const i = index(x, y);
      if (integrity[i] != null && integrity[i] < 0.5) continue;
      const enemyDistance = Math.hypot(x - b.x, y - b.y);
      offer(x, y, (urgent ? 26 : 3) - Math.abs(enemyDistance - 2.6) * 0.8 -
        Math.hypot(x, y) * 0.2, urgent ? "escape" : "move", side);
    }
    // Flood only when the selected route is obstructed. Stop as soon as the
    // target is reached, with at most 48 expansions. A reachable frontier
    // becomes a waypoint if the complete route needs another planning tick.
    const parent = [], queue = [start];
    parent[start] = start;
    if (!routeClear(a.x, a.y, goal[0], goal[1], mode === "attack")) {
      for (let head = 0; head < queue.length && head < 48 && parent[chosen] == null; head++) {
        const i = queue[head];
        for (let direction = 0; direction < 4; direction++) {
          const j = i + (direction === 0 ? -1 : direction === 1 ? 1 : direction === 2 ? -16 : 16);
          if (j < 0 || j > 255 || (direction < 2 && Math.floor(i / 16) !== Math.floor(j / 16)) ||
            grid[j] || parent[j] != null || (mode !== "attack" && (px(j) - b.x) ** 2 + (py(j) - b.y) ** 2 < 1.3) || Math.abs(px(j)) > half || Math.abs(py(j)) > half) continue;
          parent[j] = i; queue.push(j);
        }
      }
      if (parent[chosen] == null) {
        let closest = 10000;
        for (let qi = 0; qi < queue.length; qi++) {
          const i = queue[qi];
          if (i === start && queue.length > 1) continue;
          const d = Math.hypot(px(i) - goal[0], py(i) - goal[1]);
          if (d < closest) { closest = d; chosen = i; }
        }
        goal = [px(chosen), py(chosen)];
      }
    }
    const path = [goal];
    let cursor = chosen;
    for (let k = 0; k < 256 && cursor !== start && cursor >= 0; k++) {
      path.push([px(cursor), py(cursor)]); cursor = parent[cursor] == null ? start : parent[cursor];
    }
    path.push([px(start), py(start)]);
    nav = [px(start), py(start)];
    for (let pi = 0; pi < path.length; pi++) {
      const point = path[pi];
      if (routeClear(a.x, a.y, point[0], point[1], mode === "attack")) { nav = point; break; }
    }
    planned = s.tick;
    nextSide = chosenSide;
  }

  let target = Math.atan2(nav[1] - a.y, nav[0] - a.x);
  const remaining = Math.hypot(nav[0] - a.x, nav[1] - a.y);
  let reverse = false;
  const attacking = mode === "attack" && clear(a.x, a.y, b.x, b.y) && !urgent;
  if (attacking && distance < 2.5) target = bearing;
  if (!attacking) {
    const guardWeight = !powerless && distance < 4 ? 1.2 : 0;
    const forwardCost = Math.abs(wrap(target - a.heading)) * 0.65 + guardWeight * Math.abs(wrap(target - bearing));
    const reverseCost = Math.abs(wrap(target + Math.PI - a.heading)) * 0.65 +
      guardWeight * Math.abs(wrap(target + Math.PI - bearing)) + 0.16;
    if (reverseCost < forwardCost) { target = wrap(target + Math.PI); reverse = true; }
  }
  let speed = attacking ? (powerless ? 3.4 : 4.4) : urgent ? 3.2 : a.energy < 65 ? 1.8 : 3;
  if (!attacking) speed = Math.min(speed, remaining < 0.12 ? 0 : Math.max(0.45, remaining * 2.5));
  if (reverse) speed = -Math.min(speed, charge || urgent ? 3.4 : 2.5);
  // Meet an incoming wedge with our own while braking, unless the floor requires departure.
  let guarding = false;
  if (!urgent && !charge && !powerless && distance < 2.7 && closing > 0.65 && exposure < 1.05) {
    target = bearing;
    speed = Math.abs(wrap(bearing - a.heading)) > 0.45 || a.energy < 100 ? -1.2 : 0.35;
    guarding = true;
  }
  const error = wrap(target - a.heading);
  const forward = a.vx * Math.cos(a.heading) + a.vy * Math.sin(a.heading);
  const tracking = attacking || guarding ? clamp((dx * (b.vy - a.vy) - dy * (b.vx - a.vx)) /
    Math.max(0.25, distance * distance), -3, 3) : 0;
  let turn = clamp(error * 3.6 + tracking - a.omega * 1.25, -1, 1);
  const desired = speed * clamp((Math.cos(error) - 0.15) / 0.85, 0, 1);
  let thrust = clamp((1.6 * desired + 4.2 * (desired - forward)) / 8, -1, 1);
  // Reserve enough stopping distance for drift, moving edges, and newly announced holes.
  if (Math.hypot(a.vx, a.vy) > 0.25 &&
      !clear(a.x, a.y, a.x + a.vx * 0.55, a.y + a.vy * 0.55))
    thrust = clamp(-forward * 0.9, -1, 1);
  if (Math.abs(turn) < 0.018) turn = 0;
  if (Math.abs(thrust) < 0.015) thrust = 0;
  return { actions: { thrust, turn }, memory: { mode, goal, nav, planned, side: nextSide } };
}
