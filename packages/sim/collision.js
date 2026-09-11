import { SPEC as S, wrap } from "./spec.js";
import { sin, cos, atan2, hypot } from "./math.js";
const dot = (a, b) => a.x * b.x + a.y * b.y;
export function corners(r) {
  const c = cos(r.heading),
    s = sin(r.heading);
  return [
    [-0.4, -0.3],
    [0.4, -0.3],
    [0.4, 0.3],
    [-0.4, 0.3],
  ].map(([x, y]) => ({ x: r.x + c * x - s * y, y: r.y + s * x + c * y }));
}
function polygonClip(poly, clip) {
  for (let i = 0; i < 4; i++) {
    const a = clip[i],
      b = clip[(i + 1) % 4];
    const side = (p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const input = poly;
    poly = [];
    if (!input.length) break;
    let p = input[input.length - 1],
      sp = side(p);
    for (const q of input) {
      const sq = side(q);
      if (sq >= 0 !== sp >= 0) {
        const t = sp / (sp - sq);
        poly.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
      }
      if (sq >= 0) poly.push(q);
      p = q;
      sp = sq;
    }
  }
  return poly;
}
export function contact(a, b) {
  // Canonical hull order removes rounding differences when spawn sides swap.
  const aFirst =
    a.x < b.x ||
    (a.x === b.x && (a.y < b.y || (a.y === b.y && a.heading <= b.heading)));
  const hit = aFirst ? orderedContact(a, b) : orderedContact(b, a);
  if (hit && !aFirst) hit.n = { x: -hit.n.x, y: -hit.n.y };
  return hit;
}
function orderedContact(a, b) {
  if (hypot(b.x - a.x, b.y - a.y) > S.ROBOT_RADIUS * 2) return null;
  const pa = corners(a),
    pb = corners(b);
  const axes = [
    a.heading,
    a.heading + Math.PI / 2,
    b.heading,
    b.heading + Math.PI / 2,
  ];
  let depth = Infinity,
    n = null;
  for (const angle of axes) {
    const axis = { x: cos(angle), y: sin(angle) };
    const va = pa.map((p) => dot(p, axis)),
      vb = pb.map((p) => dot(p, axis));
    const loA = Math.min(...va),
      hiA = Math.max(...va),
      loB = Math.min(...vb),
      hiB = Math.max(...vb);
    if (hiA < loB || hiB < loA) return null;
    const overlap = Math.min(hiA - loB, hiB - loA);
    if (overlap < depth) {
      depth = overlap;
      n = axis;
    }
  }
  if ((b.x - a.x) * n.x + (b.y - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  const polygon = polygonClip(pa, pb);
  const c = polygon.length
    ? {
        x: polygon.reduce((v, p) => v + p.x, 0) / polygon.length,
        y: polygon.reduce((v, p) => v + p.y, 0) / polygon.length,
      }
    : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return { depth, n, c };
}
export function wedgeAngle(r, c) {
  return Math.abs(wrap(atan2(c.y - r.y, c.x - r.x) - r.heading));
}
export function leverage(angle) {
  return angle < (70 * Math.PI) / 180
    ? S.LEVERAGE_FRONT
    : angle < (145 * Math.PI) / 180
      ? S.LEVERAGE_SIDE
      : S.LEVERAGE_REAR;
}
// Every unordered pair is resolved once, in index order, so a rumble stays
// deterministic. With two robots this is the single (0, 1) pair as before.
export function resolveContact(robots, tick, events, lastContacts) {
  for (let i = 0; i < robots.length; i++)
    for (let j = i + 1; j < robots.length; j++)
      if (robots[i].status !== "out" && robots[j].status !== "out")
        resolvePair(robots, i, j, tick, events, lastContacts);
}
function resolvePair(all, i, j, tick, events, lastContacts) {
  const robots = [all[i], all[j]];
  const [a, b] = robots,
    hit = contact(a, b);
  if (!hit) return;
  const { n, c, depth } = hit;
  // Wedge tests and lever arms use the unseparated contact geometry.
  const angles = [wedgeAngle(a, c), wedgeAngle(b, c)];
  const wedges = angles.map(
    (v, i) => v <= S.WEDGE_HALF_ANGLE && robots[i].status !== "flipped",
  );
  const closingSpeed = Math.max(0, (a.vx - b.vx) * n.x + (a.vy - b.vy) * n.y);
  const arms = robots.map((r) => ({ x: c.x - r.x, y: c.y - r.y }));
  a.x -= (depth * n.x) / 2;
  a.y -= (depth * n.y) / 2;
  b.x += (depth * n.x) / 2;
  b.y += (depth * n.y) / 2;
  [i, j].forEach((robot, k) => {
    lastContacts[robot] = {
      tick,
      selfWedge: wedges[k],
      opponentWedge: wedges[1 - k],
      closingSpeed,
      x: c.x,
      y: c.y,
    };
  });
  if (closingSpeed > 0.02)
    events.push({ type: "impact", tick, x: c.x, y: c.y, closingSpeed, wedges });
  if (wedges[0] !== wedges[1]) {
    const attacker = wedges[0] ? 0 : 1,
      target = 1 - attacker,
      lev = leverage(angles[target]);
    const score = closingSpeed * cos(angles[attacker]) * lev;
    robots[attacker].energy = Math.max(
      0,
      robots[attacker].energy - S.K_IMPACT * closingSpeed * 0.4,
    );
    robots[target].energy = Math.max(
      0,
      robots[target].energy - S.K_IMPACT * closingSpeed * lev,
    );
    if (score >= S.FLIP_THRESHOLD && robots[target].status === "active") {
      const r = robots[target];
      r.status = "flipped";
      r.statusTimer = S.FLIP_RECOVERY;
      r.flipsTaken++;
      r._freshFlip = true;
      r.vx = 0;
      r.vy = 0;
      r.omega = 0;
      events.push({
        type: "flip",
        tick,
        robot: [i, j][target],
        attacker: [i, j][attacker],
        score,
        x: c.x,
        y: c.y,
        axis: [-n.y, n.x],
      });
    }
  } else {
    for (const r of robots)
      r.energy = Math.max(0, r.energy - S.K_IMPACT * closingSpeed);
  }
  // Inelastic hull contacts; only wedge against wedge has restitution 0.4.
  // Evaluate each body's contact velocity before subtraction. Re-associating the
  // four terms changes rounding when the robot labels are swapped.
  const relative =
    (a.vx - a.omega * arms[0].y - (b.vx - b.omega * arms[1].y)) * n.x +
    (a.vy + a.omega * arms[0].x - (b.vy + b.omega * arms[1].x)) * n.y;
  if (relative > 0) {
    const ra = arms[0].x * n.y - arms[0].y * n.x,
      rb = arms[1].x * n.y - arms[1].y * n.x;
    const j =
      ((1 + (wedges[0] && wedges[1] ? S.RESTITUTION_WEDGE : 0)) * relative) /
      (2 / S.ROBOT_MASS + (ra * ra + rb * rb) / S.ROBOT_INERTIA);
    a.vx -= (j * n.x) / S.ROBOT_MASS;
    a.vy -= (j * n.y) / S.ROBOT_MASS;
    a.omega -= (j * ra) / S.ROBOT_INERTIA;
    b.vx += (j * n.x) / S.ROBOT_MASS;
    b.vy += (j * n.y) / S.ROBOT_MASS;
    b.omega += (j * rb) / S.ROBOT_INERTIA;
  }
}
