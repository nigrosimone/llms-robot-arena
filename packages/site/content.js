import { SPEC as S, SPEC_VERSION, ENGINE_VERSION } from "../sim/spec.js";

// Page copy shared by the application and the static pages written at build
// time. The Rules panel and /rules/ render the same cards, so they cannot drift.
export const SITE = {
  name: "llms-robot-arena",
  title: "llms-robot-arena — Autonomous combat lab",
  tagline: "Two identical robots, one difference: code.",
  description:
    "llms-robot-arena. Two identical robots, one difference: code. Simulate, watch and compare autonomous controllers in a deterministic 3D arena.",
  repository: "https://github.com/nigrosimone/llms-robot-arena",
  url: "https://nigrosimone.github.io/llms-robot-arena/",
  themeColor: "#101317",
  icon:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='8' fill='%23c3f66b'/%3E%3Cpath d='M10 28V12h13l6 6-6 4 7 6h-8l-6-6v6z' fill='%23101317'/%3E%3C/svg%3E",
};

export const RULE_CARDS = [
  {
    number: "01 / ARENA",
    title: "The edge is unforgiving.",
    body: `<p>A 16 × 16 meter platform with no walls. A robot is out when its center crosses the edge. From 60 seconds onward, the half-side shrinks by 0.07 m/s.</p><div class="rule-value">16 <span>→</span> 7.6 <small>meters at 120 s</small></div>`,
  },
  {
    number: "02 / WEDGE",
    title: "Where you hit matters.",
    body: `<p>The wedge covers ±35° in front of the robot. A strong side or rear impact can flip an opponent; wedge-to-wedge contact never causes a flip. Taking two flips ends the match.</p><div class="rule-value">±35° <small>front sector</small></div>`,
  },
  {
    number: "03 / ENERGY",
    title: "Every command has a cost.",
    body: `<p>Motor cost is quadratic. There is no passive regeneration. Enter a ready blue cell to collect up to ${S.RECHARGE_AMOUNT} energy. Each cell needs ${S.RECHARGE_COOLDOWN} seconds to reset; leave and return to collect again. At zero, the motors stop.</p><div class="rule-value">${S.ENERGY_MAX} <small>starting energy</small></div>`,
  },
  {
    number: "04 / VICTORY",
    title: "A clear order.",
    body: `<ol><li>Fall off the edge or into a hole</li><li>Two flips</li><li>Disqualification at 20 violations</li><li>At 120 s: fewer flips taken, then more energy, then closer to the center</li></ol><p>Only exact ties and simultaneous defeats remain draws.</p>`,
  },
  {
    number: "05 / PHYSICS",
    title: "The simulation is authoritative.",
    body: `<p>Fixed 60 Hz steps, semi-implicit Euler integration, oriented rectangles and SAT collisions. The viewer reads a completed replay: pausing, moving the camera and changing playback speed do not affect the result.</p>`,
  },
  {
    number: "06 / BENCHMARK",
    title: "Conformance before competition.",
    body: `<p>One JS or TS file, one tick export, no imports or external APIs. QuickJS runs in a Worker sandbox. Public tests check execution, purity, memory and timing.</p>`,
  },
];

export const HAZARD_CARDS = [
  {
    number: "07 / TERRAIN",
    title: "Know the floor.",
    body: `<p>Every seed places four blue recharge cells, two or three open holes and four flame grates. Cells stay in fixed world positions as the boundary shrinks. Their states are visible in the bot sensors. During the match, four ordinary floor cells can also collapse. Each flashes red for three seconds before becoming a permanent hole. Robot weight also wears down every solid cell, including chargers and grates: 12 cumulative seconds under one bot exhausts it, then a three-second warning precedes collapse. Wear persists after leaving; two bots double the load.</p>`,
  },
  {
    number: "08 / FIRE",
    title: "Read the warning.",
    body: `<p>Grates wait 4-8 seconds, warn in amber for one second, then burn for 1.5 seconds. Standing over a flame costs ${S.FLAME_DAMAGE} energy per second, including while flipped or recovering.</p>`,
  },
];

export const RULES_NOTE = {
  title: "Simulation and runtime rules.",
  body: `The recovering state accepts commands and protects against flips. The 3 m limit is not reached within 120 seconds. Wall-clock timing depends on machine load, so exhibitions use a reproducible instruction limit; the CLI also supports the 2 ms budget. Results for these budgets are kept separate.`,
};

export const ruleCards = (cards) =>
  cards
    .map(
      (card) =>
        `<article class="info-card"><span class="rule-number">${card.number}</span><h2>${card.title}</h2>${card.body}</article>`,
    )
    .join("");

// Engine constants worth reading outside the source: the numbers a controller
// author needs before opening the spec.
export const SPEC_TABLE = [
  {
    group: "Match",
    rows: [
      ["Tick rate", "60 Hz"],
      ["Match duration", `${S.MATCH_DURATION} s`],
      ["Spec version", SPEC_VERSION.replace("-draft", "")],
      ["Engine version", ENGINE_VERSION],
    ],
  },
  {
    group: "Arena",
    rows: [
      ["Half extent", `${S.ARENA_HALF_EXTENT} m`],
      ["Minimum half extent", `${S.ARENA_MIN_HALF_EXTENT} m`],
      ["Shrink starts at", `${S.ARENA_SHRINK_START} s`],
      ["Shrink rate", `${S.ARENA_SHRINK_RATE} m/s`],
      ["Cell size", `${S.CELL_SIZE} m`],
    ],
  },
  {
    group: "Robot",
    rows: [
      ["Length × width", `${S.ROBOT_LENGTH} × ${S.ROBOT_WIDTH} m`],
      ["Mass", `${S.ROBOT_MASS} kg`],
      ["Wedge half angle", "±35°"],
      ["Max speed", `${S.MAX_SPEED} m/s`],
      ["Max angular speed", `${S.MAX_OMEGA} rad/s`],
      ["Max thrust force", `${S.F_MAX} N`],
      ["Max torque", `${S.T_MAX} N·m`],
    ],
  },
  {
    group: "Energy",
    rows: [
      ["Starting energy", String(S.ENERGY_MAX)],
      ["Recharge cells", String(S.RECHARGE_CELLS)],
      ["Recharge amount", String(S.RECHARGE_AMOUNT)],
      ["Recharge cooldown", `${S.RECHARGE_COOLDOWN} s`],
      ["Flame damage", `${S.FLAME_DAMAGE} / s`],
      ["Righting cost", String(S.E_RIGHT)],
    ],
  },
  {
    group: "Hazards",
    rows: [
      ["Open holes", `${S.HOLE_CELLS_MIN}-${S.HOLE_CELLS_MAX}`],
      ["Flame grates", String(S.FLAME_CELLS)],
      ["Collapsing cells", String(S.COLLAPSE_CELLS)],
      ["Collapse warning", `${S.COLLAPSE_WARNING} s`],
      ["Floor load capacity", `${S.FLOOR_LOAD_CAPACITY} kg·s`],
    ],
  },
  {
    group: "Contract",
    rows: [
      ["Flips to lose", String(S.FLIPS_TO_LOSE)],
      ["Flip recovery", `${S.FLIP_RECOVERY} s`],
      ["Memory limit", `${S.MEMORY_MAX_BYTES / 1024} KB`],
      ["Tick budget", `${S.TICK_BUDGET_MS} ms`],
      ["Init budget", `${S.INIT_BUDGET_MS} ms`],
      ["Violations allowed", String(S.MAX_VIOLATIONS)],
    ],
  },
];
