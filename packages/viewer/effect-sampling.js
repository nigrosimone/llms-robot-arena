// Cinematic effects sample only recorded poses and public terrain snapshots.
// Sampling by replay time keeps trails stable across frame rates and seeking.
export function poseAt(replay, robotIndex, time) {
  const stride = replay.initialFrame.length;
  const robots = stride / 6;
  if (!Number.isInteger(robotIndex) || robotIndex < 0 || robotIndex >= robots)
    return null;

  const rawTick = Math.max(0, Math.min(replay.result.ticks, time * 60));
  // A seconds-to-ticks round trip can land just below a frame boundary.
  const tick = Math.abs(rawTick - Math.round(rawTick)) < 1e-9
    ? Math.round(rawTick) : rawTick;
  const lo = Math.floor(tick);
  const hi = Math.min(replay.result.ticks, lo + 1);
  const alpha = tick - lo;
  const a = lo === 0 ? replay.initialFrame : replay.frames;
  const b = hi === 0 ? replay.initialFrame : replay.frames;
  const ai = robotIndex * 6 + (lo === 0 ? 0 : (lo - 1) * stride);
  const bi = robotIndex * 6 + (hi === 0 ? 0 : (hi - 1) * stride);
  const headingDelta = Math.atan2(
    Math.sin(b[bi + 2] - a[ai + 2]),
    Math.cos(b[bi + 2] - a[ai + 2]),
  );
  return {
    x: a[ai] + (b[bi] - a[ai]) * alpha,
    y: a[ai + 1] + (b[bi + 1] - a[ai + 1]) * alpha,
    heading: a[ai + 2] + headingDelta * alpha,
    energy: a[ai + 3] + (b[bi + 3] - a[ai + 3]) * alpha,
    status: a[ai + 4],
  };
}

// Fire events are sparse damage notifications, not a continuous occupancy
// signal. A robot on an active grate burns even when its battery is empty.
export function robotHeat(state, cells, events, robotIndex, time) {
  if (!state || state.out || state.ringOut || state.status === 3) return 0;
  for (const cell of cells) {
    if (cell.type !== "flame" || cell.state !== "flaming") continue;
    const half = cell.size / 2;
    if (Math.abs(state.x - cell.x) <= half && Math.abs(state.y - cell.y) <= half)
      return 1;
  }

  let latest = -Infinity;
  for (const event of events) {
    if (event.type !== "fire-damage" || event.robot !== robotIndex) continue;
    const at = (event.tick + 1) / 60;
    if (at <= time && at > latest) latest = at;
  }
  return Math.max(0, Math.min(1, 1 - (time - latest) / 0.35));
}
