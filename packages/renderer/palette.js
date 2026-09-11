// One colour per robot, shared by the 3D shells, the labels and the UI cards.
// The first two keep the historical duel colours.
export const ROBOT_PALETTE = [
  { mesh: 0xafd965, css: "#c3f179" },
  { mesh: 0xf09163, css: "#ee956b" },
  { mesh: 0x6fc3e8, css: "#7fd0f2" },
  { mesh: 0xd98ee0, css: "#e49bea" },
  { mesh: 0xe8d06a, css: "#f2dc7c" },
  { mesh: 0x6fd9a4, css: "#82e6b3" },
  { mesh: 0x9c93ef, css: "#aaa2f7" },
  { mesh: 0xe87f84, css: "#f28f94" },
  { mesh: 0x8fb0c9, css: "#a3c2d9" },
  { mesh: 0xd0a071, css: "#dcae80" },
  { mesh: 0x7fdad4, css: "#93e7e1" },
  { mesh: 0xc7e06a, css: "#d5ea82" },
];
export const robotColor = (i) => ROBOT_PALETTE[i % ROBOT_PALETTE.length];
