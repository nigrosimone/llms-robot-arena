// Presentation layers above the deck at z=0. The robot's wedge starts at
// z=0.025, so even the highest floor decoration stays below its leading edge.
export const GROUND = Object.freeze({
  grid: 0.002,
  decal: 0.003,
  pad: 0.004,
  inlay: 0.006,
  trim: 0.008,
  wear: 0.009,
  effect: 0.011,
});
