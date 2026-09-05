import { addFloorLoad, collapseSchedule, floorIndex } from "./floor.js";
import { isHole } from "./terrain.js";

export function stringifyReplay(r) {
  return JSON.stringify({
    ...r,
    frames: Array.from(r.frames),
    arenaExtents: Array.from(r.arenaExtents),
  });
}
export function parseReplay(text) {
  if (text.length > 20 * 1024 * 1024)
    throw new Error("Replay too large (maximum 20 MB).");
  const r = JSON.parse(text),
    count = r?.result?.ticks;
  if (
    !r ||
    !(
      (r.specVersion === "0.1.0-draft" &&
        ["0.1.0-r1", "0.1.0-r2"].includes(r.engineVersion)) ||
      (r.specVersion === "0.1.1-draft" && r.engineVersion === "0.1.1-r1") ||
      (r.specVersion === "0.2.0-draft" && r.engineVersion === "0.2.0-r1") ||
      (r.specVersion === "0.2.1-draft" && r.engineVersion === "0.2.1-r1") ||
      (r.specVersion === "0.2.2-draft" && r.engineVersion === "0.2.2-r1")
    ) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 7200 ||
    ![0, 1, null].includes(r.result.winner) ||
    !["ring-out", "hole", "flips", "disqualification", "timeout"].includes(
      r.result.reason,
    )
  )
    throw new Error("Invalid replay version or result.");
  const weightRules = r.specVersion === "0.2.2-draft";
  const collapseRules = r.specVersion === "0.2.1-draft" || weightRules;
  const terrainRules = r.specVersion === "0.2.0-draft" || collapseRules;
  const energyMax = terrainRules ? 300 : 100;
  if (terrainRules) {
    if (r.energyMax !== energyMax || !Array.isArray(r.arenaCells) || r.arenaCells.length > (weightRules ? 256 : 16))
      throw new Error("Missing arena cells or energy limit.");
    const ids = new Set(), positions = new Set();
    for (const cell of r.arenaCells) {
      if (!cell || typeof cell.id !== "string" || cell.id.length > 64 || ids.has(cell.id) ||
        !(weightRules ? ["recharge", "hole", "flame", "collapse", "floor"] : collapseRules ? ["recharge", "hole", "flame", "collapse"] : ["recharge", "hole", "flame"]).includes(cell.type) || cell.size !== 1 ||
        !Number.isFinite(cell.x) || !Number.isFinite(cell.y) ||
        !Number.isInteger(cell.x - 0.5) || !Number.isInteger(cell.y - 0.5) ||
        Math.abs(cell.x) > 7.5 || Math.abs(cell.y) > 7.5)
        throw new Error("Invalid arena cell.");
      ids.add(cell.id);
      if (weightRules && positions.has(floorIndex(cell))) throw new Error("Overlapping arena cells.");
      positions.add(floorIndex(cell));
      if (cell.type === "collapse" && (!Number.isInteger(cell.warningTick) ||
        !Number.isInteger(cell.collapseTick) || cell.warningTick < 0 ||
        cell.collapseTick - cell.warningTick !== 180 || cell.collapseTick >= 7200))
        throw new Error("Invalid collapse schedule.");
      if (cell.type === "flame") {
        if (!Array.isArray(cell.bursts) || cell.bursts.length > 40) throw new Error("Invalid flame schedule.");
        let previousEnd = -1;
        for (const burst of cell.bursts) {
          if (!burst || ![burst.warning, burst.start, burst.end].every(Number.isInteger) ||
            burst.warning <= previousEnd || burst.warning < 0 || burst.start - burst.warning !== 60 ||
            burst.end - burst.start !== 90 || burst.end > 8000)
            throw new Error("Invalid flame schedule.");
          previousEnd = burst.end;
        }
      }
    }
  } else if (r.result.reason === "hole") throw new Error("Invalid legacy result.");
  const floorWear = {};
  if (weightRules) {
    if (!Array.isArray(r.floorLoads) || r.floorLoads.length !== count * 2 ||
      !r.floorLoads.every(index => Number.isInteger(index) && index >= -1 && index < 256))
      throw new Error("Invalid floor loads.");
    const cells = new Map(r.arenaCells.map(cell => [floorIndex(cell), cell]));
    for (let tick = 0; tick < count; tick++) {
      for (const index of r.floorLoads.slice(tick * 2, tick * 2 + 2)) {
        if (index === -1) continue;
        const cell = cells.get(index);
        if (!cell || isHole(cell, tick, floorWear)) throw new Error("Invalid floor load on missing or open cell.");
        addFloorLoad(floorWear, index, tick);
      }
    }
  }
  if (
    !Array.isArray(r.frames) ||
    r.frames.length !== count * 12 ||
    !r.frames.every(Number.isFinite) ||
    !Array.isArray(r.arenaExtents) ||
    r.arenaExtents.length !== count ||
    !r.arenaExtents.every((n) => Number.isFinite(n) && n >= 3 && n <= 8)
  )
    throw new Error("Missing or invalid frames.");
  if (
    !Array.isArray(r.initialFrame) ||
    r.initialFrame.length !== 12 ||
    !r.initialFrame.every(Number.isFinite)
  )
    throw new Error("Invalid initial frame.");
  if (
    !Array.isArray(r.bots) ||
    r.bots.length !== 2 ||
    r.bots.some(
      (b) =>
        !b ||
        typeof b.id !== "string" ||
        typeof b.model !== "string" ||
        typeof b.codeSha256 !== "string" ||
        (b.provider != null && typeof b.provider !== "string") ||
        (b.thinking != null && typeof b.thinking !== "string") ||
        (b.harness != null && typeof b.harness !== "string") ||
        (b.provenance != null && typeof b.provenance !== "string"),
    )
  )
    throw new Error("Missing bot metadata.");
  if (
    !Array.isArray(r.events) ||
    r.events.length > 50000 ||
    r.events.some(
      (e) =>
        !e ||
        !Number.isInteger(e.tick) ||
        e.tick < 0 ||
        e.tick >= count ||
        ![
          "impact",
          "flip",
          "ring-out",
          "hole",
          "recharge",
          "fire-damage",
          "collapse-warning",
          "collapse",
          "recovery",
          "violation",
          "engine-violation",
        ].includes(e.type),
    )
  )
    throw new Error("Invalid events.");
  let previousTick = -1;
  for (const e of r.events) {
    if (e.tick < previousTick) throw new Error("Events are out of order.");
    previousTick = e.tick;
    if (!["impact", "collapse-warning", "collapse"].includes(e.type) && ![0, 1].includes(e.robot))
      throw new Error("Invalid event robot.");
    if (
      e.type === "impact" &&
      (!Number.isFinite(e.closingSpeed) ||
        e.closingSpeed < 0 ||
        e.closingSpeed > 14.01 ||
        !Number.isFinite(e.x) ||
        !Number.isFinite(e.y))
    )
      throw new Error("Invalid impact.");
    if (
      e.type === "flip" &&
      (!Array.isArray(e.axis) ||
        e.axis.length !== 2 ||
        !e.axis.every(Number.isFinite) ||
        Math.hypot(...e.axis) < 0.9 ||
        Math.hypot(...e.axis) > 1.1)
    )
      throw new Error("Invalid flip axis.");
    if (e.type === "violation" && typeof e.reason !== "string")
      throw new Error("Invalid violation.");
    if (["hole", "recharge", "fire-damage"].includes(e.type)) {
      const type = e.type === "fire-damage" ? "flame" : e.type;
      if (!terrainRules || !r.arenaCells.some(c => c.id === e.cell &&
        (type === "hole" ? isHole(c, e.tick, floorWear) : c.type === type && !isHole(c, e.tick, floorWear))))
        throw new Error("Invalid terrain event.");
      if (e.type === "recharge" && (!Number.isFinite(e.amount) || e.amount <= 0 || e.amount > 60 ||
        e.readyTick !== e.tick + 480)) throw new Error("Invalid recharge.");
      if (e.type === "fire-damage" && e.rate !== 30) throw new Error("Invalid fire damage.");
    }
    if (e.type === "collapse-warning" || e.type === "collapse") {
      if (!collapseRules || !r.arenaCells.some(c => {
        const schedule = collapseSchedule(c, floorWear);
        return c.id === e.cell && schedule &&
          e.tick === (e.type === "collapse-warning" ? schedule.warningTick : schedule.collapseTick) &&
          (!weightRules || e.cause === schedule.cause);
      }))
        throw new Error("Invalid collapse event.");
    }
  }
  if (!["exhibition", "one-shot", "iterative"].includes(r.mode))
    throw new Error("Invalid mode.");
  if (
    !Array.isArray(r.stateHashes) ||
    r.stateHashes.some(
      (h) =>
        !Number.isInteger(h.tick) ||
        typeof h.hash !== "string" ||
        !/^[a-f0-9]{64}$/.test(h.hash),
    )
  )
    throw new Error("Invalid hashes.");
  for (const frames of [r.initialFrame, r.frames])
    for (let i = 0; i < frames.length; i += 6)
      if (
        Math.abs(frames[i]) > 100 ||
        Math.abs(frames[i + 1]) > 100 ||
        Math.abs(frames[i + 2]) > Math.PI + 0.000001 ||
        frames[i + 3] < 0 ||
        frames[i + 3] > energyMax ||
        ![0, 1, 2].includes(frames[i + 4]) ||
        frames[i + 5] < 0 ||
        frames[i + 5] > 4.01
      )
        throw new Error("Invalid robot state.");
  if (
    !Array.isArray(r.finalStates) ||
    r.finalStates.length !== 2 ||
    !Array.isArray(r.violations) ||
    r.violations.length !== 2
  )
    throw new Error("Missing summary.");
  return {
    ...r,
    energyMax,
    arenaCells: terrainRules ? r.arenaCells : [],
    floorLoads: weightRules ? r.floorLoads : undefined,
    frames: new Float32Array(r.frames),
    arenaExtents: new Float32Array(r.arenaExtents),
  };
}
