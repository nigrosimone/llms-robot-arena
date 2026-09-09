import { SPEC as S, wrap } from "../sim/spec.js";

// Play style measured from the recorded frames of a duel: no extra simulation,
// and the replay itself never has to be stored.
export const STYLE_METRICS = [
  "closingShare",
  "approachSpeed",
  "facingShare",
  "proximityShare",
  "contactShare",
  "engagementRate",
  "wedgeShare",
  "speed",
  "turnRate",
  "idleShare",
  "edgeShare",
  "spendRate",
  "recharges",
  "burns",
];

// Radar axes, normalized over the roster because these numbers only mean
// something next to the other controllers.
export const STYLE_AXES = [
  { key: "aggression", label: "Aggression", metric: "closingShare", percent: true },
  { key: "pressure", label: "Pressure", metric: "proximityShare", percent: true },
  { key: "wedge", label: "Wedge control", metric: "wedgeShare", percent: true },
  { key: "mobility", label: "Mobility", metric: "speed", unit: " m/s", digits: 2 },
  { key: "edge", label: "Edge play", metric: "edgeShare", percent: true },
  { key: "burn", label: "Energy burn", metric: "spendRate", unit: "/s", digits: 1 },
];

export function formatStyleValue(axis, style) {
  const value = style?.[axis.metric];
  if (!Number.isFinite(value)) return "—";
  return axis.percent
    ? Math.round(value * 100) + "%"
    : value.toFixed(axis.digits) + axis.unit;
}

const FIELDS = 6;
const IDLE_SPEED = 0.2;
const CLOSING_SPEED = 0.1;
const NEAR_DISTANCE = 1.5;
const EDGE_FRACTION = 0.75;

export function matchStyle(replay) {
  const robots = replay.bots.length,
    ticks = replay.result.ticks;
  if (robots !== 2 || !ticks || !(replay.frames?.length >= ticks * robots * FIELDS))
    return null;
  const dt = replay.dt ?? S.DT,
    duration = ticks * dt;
  const at = (tick, robot, field) =>
    tick < 0
      ? replay.initialFrame[robot * FIELDS + field]
      : replay.frames[(tick * robots + robot) * FIELDS + field];
  const totals = [0, 1].map(() => ({
    closing: 0, approach: 0, facing: 0, near: 0, idle: 0, edge: 0,
    travel: 0, turn: 0, spend: 0,
  }));
  for (let tick = 0; tick < ticks; tick++) {
    const extent = replay.arenaExtents[tick] ?? S.ARENA_HALF_EXTENT;
    for (const i of [0, 1]) {
      const t = totals[i],
        x = at(tick, i, 0), y = at(tick, i, 1), heading = at(tick, i, 2);
      const vx = (x - at(tick - 1, i, 0)) / dt,
        vy = (y - at(tick - 1, i, 1)) / dt;
      const speed = Math.hypot(vx, vy);
      t.travel += speed * dt;
      t.turn += Math.abs(wrap(heading - at(tick - 1, i, 2)));
      t.spend += Math.max(0, at(tick - 1, i, 3) - at(tick, i, 3));
      if (speed < IDLE_SPEED) t.idle++;
      if (Math.max(Math.abs(x), Math.abs(y)) > EDGE_FRACTION * extent) t.edge++;
      const dx = at(tick, 1 - i, 0) - x, dy = at(tick, 1 - i, 1) - y,
        distance = Math.hypot(dx, dy) || 1e-9;
      const approach = (vx * dx + vy * dy) / distance;
      if (approach > CLOSING_SPEED) t.closing++;
      t.approach += Math.max(0, approach);
      if (Math.abs(wrap(Math.atan2(dy, dx) - heading)) <= S.WEDGE_HALF_ANGLE) t.facing++;
      if (distance < NEAR_DISTANCE) t.near++;
    }
  }
  // Contact fires once per tick while the robots touch, so pushing sequences are
  // separated by half a second of daylight before they count as a new engagement.
  const impacts = replay.events.filter((e) => e.type === "impact");
  const engagements = impacts.filter(
    (e, i) => i === 0 || e.tick - impacts[i - 1].tick > 30,
  ).length;
  const count = (type, robot) =>
    replay.events.filter((e) => e.type === type && e.robot === robot).length;
  return [0, 1].map((i) => {
    const t = totals[i],
      share = (value) => value / ticks;
    return round({
      closingShare: share(t.closing),
      approachSpeed: t.approach / ticks,
      facingShare: share(t.facing),
      proximityShare: share(t.near),
      contactShare: share(impacts.length),
      engagementRate: engagements / (duration / 60),
      wedgeShare: impacts.length
        ? impacts.filter((e) => e.wedges?.[i]).length / impacts.length
        : 0,
      speed: t.travel / duration,
      turnRate: t.turn / duration,
      idleShare: share(t.idle),
      edgeShare: share(t.edge),
      spendRate: t.spend / duration,
      recharges: count("recharge", i),
      burns: count("fire-damage", i),
    });
  });
}

const round = (stats) =>
  Object.fromEntries(
    Object.entries(stats).map(([key, value]) => [key, Math.round(value * 1e4) / 1e4]),
  );

export function meanStyle(samples) {
  const rows = samples.filter(Boolean);
  if (!rows.length) return null;
  return round(
    Object.fromEntries(
      STYLE_METRICS.map((metric) => [
        metric,
        rows.reduce((sum, row) => sum + (row[metric] ?? 0), 0) / rows.length,
      ]),
    ),
  );
}

// Every axis is scaled against the highest value in the roster: the shape is a
// fingerprint of how a controller plays, not a score.
export function styleProfiles(ranking) {
  if (!ranking.length || !ranking.every((r) => r.style)) return null;
  return ranking.map((r) =>
    Object.fromEntries(
      STYLE_AXES.map((axis) => {
        const values = ranking.map((row) => row.style[axis.metric]);
        const value = r.style[axis.metric];
        const best = Math.max(...values);
        return [axis.key, best === 0 ? 1 : value / best];
      }),
    ),
  );
}

// The axis a controller stands out on, used as a one-word profile.
export function styleLabel(profile) {
  const [axis] = STYLE_AXES.map((a) => [a, profile[a.key]]).sort((x, y) => y[1] - x[1])[0];
  return axis.label;
}
