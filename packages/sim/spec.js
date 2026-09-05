export const SPEC_VERSION = "0.2.2-draft";
export const ENGINE_VERSION = "0.2.2-r1";
export const SPEC = Object.freeze({
  DT: 1 / 60,
  MATCH_DURATION: 120,
  ARENA_HALF_EXTENT: 8,
  ARENA_MIN_HALF_EXTENT: 3,
  ARENA_SHRINK_START: 60,
  ARENA_SHRINK_RATE: 0.07,
  ROBOT_LENGTH: 0.8,
  ROBOT_WIDTH: 0.6,
  ROBOT_MASS: 100,
  ROBOT_INERTIA: 8.3333,
  ROBOT_RADIUS: 0.5,
  WEDGE_HALF_ANGLE: 0.6109,
  F_MAX: 800,
  C_LIN: 160,
  T_MAX: 45,
  C_ANG: 15,
  LATERAL_GRIP: 0.85,
  MAX_SPEED: 7,
  MAX_OMEGA: 4,
  ENERGY_MAX: 300,
  K_THRUST: 9,
  K_TURN: 3,
  K_IDLE: 0.5,
  CELL_SIZE: 1,
  RECHARGE_CELLS: 4,
  RECHARGE_AMOUNT: 60,
  RECHARGE_COOLDOWN: 8,
  HOLE_CELLS_MIN: 2,
  HOLE_CELLS_MAX: 3,
  FLAME_CELLS: 4,
  FLAME_DAMAGE: 30,
  FLAME_WARNING: 1,
  FLAME_DURATION: 1.5,
  FLAME_GAP_MIN: 4,
  FLAME_GAP_MAX: 8,
  COLLAPSE_CELLS: 4,
  COLLAPSE_WARNING: 3,
  COLLAPSE_FIRST_MIN: 20,
  COLLAPSE_FIRST_MAX: 30,
  COLLAPSE_GAP_MIN: 15,
  COLLAPSE_GAP_MAX: 25,
  FLOOR_LOAD_CAPACITY: 1200,
  FLOOR_WARNING: 3,
  K_IMPACT: 2.5,
  E_RIGHT: 25,
  FLIP_THRESHOLD: 2.6,
  FLIPS_TO_LOSE: 2,
  FLIP_RECOVERY: 4,
  FLIP_IMMUNITY: 1,
  LEVERAGE_FRONT: 0.6,
  LEVERAGE_SIDE: 1,
  LEVERAGE_REAR: 0.85,
  RESTITUTION_WEDGE: 0.4,
  TICK_BUDGET_MS: 2,
  INIT_BUDGET_MS: 50,
  MEMORY_MAX_BYTES: 65536,
  MAX_VIOLATIONS: 20,
});
export const halfExtent = (t) =>
  Math.max(
    SPEC.ARENA_MIN_HALF_EXTENT,
    SPEC.ARENA_HALF_EXTENT -
      SPEC.ARENA_SHRINK_RATE * Math.max(0, t - SPEC.ARENA_SHRINK_START),
  );
export const wrap = (a) => {
  const tau = Math.PI * 2;
  let v = ((((a + Math.PI) % tau) + tau) % tau) - Math.PI;
  return v === -Math.PI ? Math.PI : v;
};
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
