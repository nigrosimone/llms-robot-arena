import { createMatch, sensorsFor } from "../sim/index.js";
import { SPEC as S, mulberry32, halfExtent } from "../sim/spec.js";
import { floorIndex, floorCapacity } from "../sim/floor.js";
import { cellSnapshots } from "../sim/terrain.js";
export function fixtures() {
  const rng = mulberry32(314159),
    m = createMatch(0),
    out = [];
  for (let i = 0; i < 200; i++) {
    const s = sensorsFor(m, 0);
    const collapse = m.cells.find(cell => cell.type === "collapse");
    s.tick = i % 40 === 0 ? collapse.warningTick : i % 40 === 1 ? collapse.collapseTick : i * 31;
    s.time = s.tick / 60;
    const floor = { id: "floor-136", type: "floor", x: 0.5, y: 0.5, size: 1 };
    const worn = i % 3 === 0 ? m.cells.find(c => c.type === "recharge") : i % 3 === 1 ? m.cells.find(c => c.type === "flame") : floor;
    const wear = { [floorIndex(worn)]: i % 2 === 0
      ? { load: floorCapacity(), warningTick: Math.max(0, s.tick - 30), collapseTick: Math.max(0, s.tick - 30) + 180 }
      : { load: floorCapacity() * 0.75 } };
    s.arena = {
      halfExtent: i % 9 === 0 ? 3 : halfExtent(s.time),
      nextHalfExtent: i % 9 === 0 ? 3 : halfExtent(s.time + s.dt),
      cells: cellSnapshots([...m.cells, floor], s.tick, i % 9 === 0 ? 3 : halfExtent(s.time),
        i % 4 === 0 ? { "recharge-0": s.tick + 120 } : {}, wear),
    };
    for (const r of [s.self, s.opponent]) {
      r.x = (rng() - 0.5) * s.arena.halfExtent * 2;
      r.y = (rng() - 0.5) * s.arena.halfExtent * 2;
      r.heading = (rng() - 0.5) * Math.PI * 2;
      r.vx = (rng() - 0.5) * 8;
      r.vy = (rng() - 0.5) * 8;
      r.omega = (rng() - 0.5) * 6;
      r.energy = i % 10 === 0 ? 0 : i % 10 === 1 ? S.ENERGY_MAX : rng() * S.ENERGY_MAX;
      r.status = ["active", "flipped", "recovering"][i % 3];
      r.statusTimer = r.status === "active" ? 0 : rng();
      r.flipsTaken = i % 2;
    }
    if (i % 7 === 0) {
      s.opponent.x = s.self.x;
      s.opponent.y = s.self.y;
    }
    if (i % 2 === 0)
      s.lastContact = {
        tick: Math.max(0, s.tick - 1),
        selfWedge: true,
        opponentWedge: false,
        closingSpeed: rng() * 7,
        x: 0,
        y: 0,
      };
    out.push(s);
  }
  return out;
}
