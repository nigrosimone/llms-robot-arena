# llms-robot-arena - rules and agent instructions

**Rules version:** `0.2.2-draft`  
**Engine:** `0.2.2-r1`

This is the llms-robot-arena project. Repository: [nigrosimone/llms-robot-arena](https://github.com/nigrosimone/llms-robot-arena). Keep project text, comments, documentation, and user-facing messages in English. The rules below apply when implementing, improving, or evaluating a bot. Project maintenance does not authorize using opponent internals to develop a bot.

## Opponents are black boxes

**Every other bot implementation is a black box. Do not inspect, copy, reverse engineer, or spy on it.**

- Read and edit only the bot file assigned to you. Do not open, search, diff, import for inspection, or print another file in `packages/bots`, including reference controllers.
- Do not bypass this restriction through other project folders, previous versions, Git history, generated bundles, source maps, archives, caches, development scripts, logs, or reports containing source code or internal strategy explanations.
- Do not inspect an opponent's serialized memory, module state, intermediate variables, or debugger traces. Do not modify the runtime to expose them.
- Do not ask another agent, model, tool, or person to inspect an opponent for you. These restrictions apply to every delegated task.
- The standard match runner may load opponent files internally to execute a match. You may pass their paths and public IDs as opaque inputs to that runner; this is not permission to display or analyze their contents.
- You may observe public match outcomes, rankings, replay events and trajectories, and the information available through the documented sensor interface. Infer behavior from these observations only.
- If opponent internals are accidentally exposed, stop examining them, disclose the exposure, and do not incorporate the information into your bot. Do not claim an uncontaminated evaluation.

## Scope and public information

This file is the single reference for game rules, TypeScript contracts, bot development, evaluation, local operation, and publication. Use the rules and constants below and evaluate results under matching rules, engine versions and runtime budgets. The public example in this document may be used as a starting template, without opening any other bot implementation.

Keep this file focused on instructions for agents. Omit camera controls, visual styling details and end-user interface walkthroughs.

For general project searches, explicitly exclude `packages/bots/**`, `dist/**`, `node_modules/**`, `artifacts/**`, `results/**`, archives, and the sibling implementation folders. Read your own assigned bot by its exact path. Do not browse other implementations to find a starting template.

## Implementing a bot

1. Use the requested name and create one file at `packages/bots/<bot-id>.js` or `.ts`. Never overwrite another bot. If no ID was supplied, choose a descriptive unused filename without opening existing bot files.
2. Export exactly one function: `tick(sensors, memory)`, returning `{ actions: { thrust, turn }, memory }`. Use no imports, dependencies, extra exports, network, filesystem, clock, randomness APIs, or dynamic code generation.
3. Treat sensors and incoming memory as immutable. Persistent state belongs only in returned JSON memory; each tick gets a fresh module scope. Initial memory is `null`. Return finite numeric actions and strict JSON memory within the documented 64 KiB limit.
4. Design using the public rules and sensor interface. Do not modify physics, energy, collision thresholds, runtime budgets, gates, fixtures, ranking, or an opponent to help your bot win. Report an engine issue separately.
5. Keep changes within your own bot, its entry in `bots.json`, and explicitly named evaluation artifacts/manifests. Ask for a separate maintenance task if platform integration requires unrelated changes.

## Validation and fair evaluation

From this directory, check your own file with:

```sh
node packages/runtime/gate-cli.js packages/bots/<bot-id>.js
```

For an authorized iterative comparison, create a manifest using your own source path and the opponent's opaque path, then run:

```sh
node packages/tournament/cli.js --bots match-bots.json --out results/<bot-id> --mode iterative --budget fuel
```

A manifest selects registered bots by ID, without repeating their metadata. For an unregistered controller, use an object with `id`, `model`, `provider`, and `file`; object paths are relative to the manifest file. See the Tournament CLI section below for the format. Use the standard mirrored-seed protocol, record source hashes and the engine/spec versions, and report wins, draws, losses, and violations honestly. Do not cherry-pick favorable seeds or combine results from different rules or budget modes.

The gate checks conformity, not tactical strength. A `fuel` result is a deterministic instruction-budget result, not proof of meeting the wall-clock budget. Use `--budget wall` when that evaluation is explicitly required.

**Minimum competitive requirement:** a bot must beat **Baseline**, a basic, blind implementation. Passing the conformity gate alone is insufficient. In an authorized evaluation, verify this over the standard 20-match mirrored-seed series: more wins than losses, equivalent to a score above 50% with draws worth half a point. Use matching rules and runtime budgets and report the full results. Baseline remains a black box under the policy above.

If the task requires a one-shot submission, submit the first generated file without iterative tuning or opponent feedback. Label iterative development as iterative; never present it as one-shot. For repository implementation tasks, finish by stating the bot path, validation performed, and any remaining limitations without revealing opponent internals.

---

# Part 1 — Game rules

## 3. Arena

- A **suspended square platform**, with no walls. Leaving it means defeat.
- Centered at `(0, 0)`. Initial half-extent: `8.0 m` (a 16×16 m arena).
- The simulation uses the `XY` plane; `Z` does not participate in physics or bot sensors.
- Heading is in radians, `0 = +X`, positive counterclockwise, normalized to `(-π, π]`.

### Shrinking arena (sudden death)

From `t = 60 s`, the half-extent decreases at `0.07 m/s` to a minimum of `3.0 m`.

```
halfExtent(t) = max(3.0, 8.0 - 0.07 * max(0, t - 60))
```

This prevents a stalemate between two cautious bots. The edge moves, not the robots: a stationary robot eventually ends up outside the shrinking boundary.

### Arena at the time limit

With these constants, the half-extent at 120 s is 3.8 m: the 3 m minimum would only be reached after the match ends.

### Seeded arena cells

Each match contains **four recharge cells, two or three open holes, and four flame grates**. Every cell occupies one fixed 1×1 m grid square. Its center has half-integer world coordinates. Cell positions do not move or scale as the arena shrinks; their usable area is clipped by the boundary. Cells entirely outside the arena are inactive.

The seed determines the layout and flame schedule using a separate deterministic random stream. Swapping robot spawns retains exactly the same cells and timing. The central 4×4 m square starts without special cells; at least two recharge cells sit next to this central area and remain inside the final arena. Initial recharge, hole and flame cell centers stay at least 2 m from both initial robot centers, and any two of those cells have at least 2 m of separation on one axis. Thus initial special cells neither overlap nor share an edge. Later collapses can affect ordinary floor cells, including the central area and cells adjacent to other hazards.

All cell locations, types, current states and countdowns are public through `sensors.arena.cells`. Controllers receive current countdowns, not the complete future flame schedule. Schedules are recorded in replays so playback and seeking reproduce what happened. No `Math.random` or wall-clock timing is used by the simulation.

**Holes:** a robot loses as soon as its center enters or crosses an open hole, even if it is flipped or recovering. The swept center segment between the previous pose and the post-collision pose is checked, so passing across a corner between two ticks also counts. Falling through a hole has the same priority as leaving the platform. This is a loss from falling, not an additional flip.

**Flame grates:** each grate independently waits a seeded interval of 4–8 seconds, enters a **one-second warning state**, then burns for **1.5 seconds**. The next interval starts when the burn ends. A robot whose center is on an active grate loses **30 energy units per second**, in addition to its normal costs. Flipped and recovering robots take this damage too; flip immunity does not protect from fire. Damage is clamped at zero energy. There is no separate health resource. Flame phases do not remove the grate; accumulated weight can still collapse it.

Cell containment includes the square's boundary. Hole and recharge crossings use the swept center; fire damage uses the post-collision center for the tick. The engine handles both robots together so simultaneous cell interactions have no robot-index advantage.

### Randomly collapsing floor cells

During a full-length match, **four ordinary 1×1 m floor cells** are scheduled to disappear. A separate seeded stream chooses their positions and warning times, identically for mirrored matches. The first warning starts randomly between **20 and 30 seconds**. Subsequent warning starts are **15–25 seconds apart**. Each warning lasts exactly **3 seconds**, after which the cell becomes a permanent open hole. Matches ending earlier do not continue generating events.

Only ordinary floor cells are eligible: random collapses exclude recharge cells, flame grates and existing holes. Weight-induced collapse is a separate rule and can destroy any solid cell. A location is chosen only once and must remain completely inside the shrinking boundary through its collapse time. Collapses can occur in the central area or beneath a robot; selection does not target either controller or inspect its strategy. Spawn protection applies to initial hazards, not later announced collapses.

Before the warning, the selected tile behaves like ordinary floor: it is omitted from `arena.cells` while untouched and appears as ordinary worn floor if loaded. Controllers cannot read future random collapse positions or times. At warning start, it appears as `type: 'collapse'`, `state: 'warning'`, with `timeUntilChange` counting down from 3 seconds. The tile remains safe during this entire warning period. At collapse time, its sensor type and state both become `'hole'`, its ID stays unchanged, and its countdown becomes null. It follows the normal hole rules from that tick onward. An earlier opening caused by weight takes precedence.

A robot still on the cell when the warning expires falls immediately, including a flipped or recovering robot. Movement during that tick cannot rescue a center already over the new opening. A robot that leaves before expiry is safe unless its path crosses another hole. The floor does not return. Collapsed cells that later leave the shrinking arena become inactive like other cells.

Replays record collapse schedules plus `collapse-warning` and `collapse` events referencing the cell ID. These are environment events and have no robot field; a robot falling through the opening produces a separate `hole` event.

### Floor wear under robot weight

Every solid 1 m grid cell, including recharge cells and flame grates, has a cumulative load capacity of **1200 kg-seconds**. Each 100 kg robot applies its full weight to the cell containing its post-collision center for that tick. One robot exhausts an intact cell after **12 seconds of total occupancy**; two robots on the same cell take **6 seconds**. Active, flipped, recovering and depleted robots all contribute equally. Fallen robots apply no load. Passing through adds only the ticks supported by that tile; wear never heals when a robot leaves.

Load is accumulated in integer kg-ticks, capped at capacity. The tick that reaches capacity schedules a **3-second warning starting at the next tick**. Collapse then happens even if everyone leaves. A lone stationary robot on fresh floor falls when the opening is processed at 15 seconds. Recharge and fire continue during the warning, then stop permanently when the tile becomes a hole. If random and weight-induced collapse affect the same cell, the earlier opening wins; there is only one warning and one opening. An exact timing tie uses the random schedule.

Weight is assigned to exactly one supporting cell: indices use `floor(x)` and `floor(y)`, so an internal grid boundary belongs to the positive side. The outer +8 m edge belongs to the last tile. Chassis overlap does not spread load across neighboring cells. This convention does not change inclusive hole boundaries or swept falling checks. Weight is applied after movement, collision, falls and energy effects; its updated state is visible in the next sensor snapshot.

Worn ordinary floor appears in sensors as `type: 'floor'`, `state: 'safe'`. Untouched ordinary floor is omitted and has integrity 1. Every exposed cell has **`integrity`** from 1 (intact) to 0 (exhausted or open), plus **`collapseIn`**, a nullable countdown until an announced opening. A charger or grate retains its type and functional phase during a weight warning; bots must also check `collapseIn`. Ordinary warning tiles use type `'collapse'`. All openings use type and state `'hole'`, retaining their cell ID. Future random schedules remain private, even if a tile is already worn.

Replays store two supporting-cell indices per tick in `floorLoads`: -1 for a fallen robot, otherwise `(floor(y)+8)*16+floor(x)+8`, with each axis clamped to 0..15. Playback reconstructs exact cumulative wear, warnings and openings from these loads, including backward seeking. Collapse events identify their `cause` as `'weight'` or `'random'`; floor wear also participates in the state hash.

---

## 4. The robot

| Property | Value |
|---|---|
| Footprint | rectangle, `0.80 m` (length) × `0.60 m` (width) |
| Mass | `100 kg` |
| Moment of inertia | `I = m(L² + W²)/12 = 8.333 kg·m²` |
| Collision radius | `0.50 m` (circumscribed circle, used for the broad phase) |

### The wedge

The only weapon. It is the front sector of the perimeter, `±35°` relative to the heading. The rest of the chassis is vulnerable.

```
        heading →
          ╱▔▔╲          ← wedge (±35°)
         │ ██ │
         │ ██ │
          ╲__╱          ← rear, vulnerable
```

There are no other weapons, upgrades, or configurations. The robots are **identical**. The only variable is the code.

---

## 5. Energy

A single resource, `E ∈ [0, 300]`, initially `300` for both robots.

| Item | Formula | Constant |
|---|---|---|
| Thrust cost | `K_THRUST · thrust² · dt` | `K_THRUST = 9.0 /s` |
| Turning cost | `K_TURN · turn² · dt` | `K_TURN = 3.0 /s` |
| Passive drain | `K_IDLE · dt` | `K_IDLE = 0.5 /s` |
| Recharge cell | fixed pickup on entry | `RECHARGE_AMOUNT = 60` |
| Active flame grate | `FLAME_DAMAGE · dt` | `FLAME_DAMAGE = 30 /s` |
| Impact cost | see §7 | `K_IMPACT = 2.5` |
| Self-righting | fixed cost | `E_RIGHT = 25` |

The cost is **quadratic**: half throttle costs one quarter as much. Continuous full throttle is unsustainable.

### Recharge cells; no passive regeneration

Waiting, idling and running out of energy never regenerate energy. The only source is a **ready recharge cell**: entering or crossing one grants up to **60 energy**, capped at 300, and starts a shared **8-second cooldown** for that cell. The pickup works while moving and can also charge a flipped robot pushed onto the cell.

Camping does not collect repeated pickups: the robot must be outside the cell at the beginning of the tick and enter or cross it while it is ready. If it arrives during cooldown, it must leave and enter again after the cooldown. A robot at full energy does not consume a pickup. When two eligible robots enter on the same tick, each receives up to 30 energy; unused capacity is not transferred to the other robot. No robot ID or processing order wins a contested pickup.

### Depleted energy

**At `E = 0`, the robot does not lose: its motors stop.** It cannot apply thrust or torque, retains its residual velocity, and remains subject to friction. It can recover energy only by coasting or being pushed into a ready recharge cell. Running empty away from a charger can therefore immobilize it for the remainder of the match.

### Insufficient energy within a tick

If the available energy cannot cover the tick's demand, both commands are scaled by the same factor `k = E_available / E_required`, and energy becomes exactly `0`. It never becomes negative.

### Order of energy updates

Motor demand excludes passive drain. After movement and collision, the engine checks falls, advances recovery and self-righting, applies passive drain, then resolves recharge and flame effects. A robot that fell gets no pickup or flame damage that tick. Self-righting uses energy available before that tick's pickup: newly received energy can fund self-righting on the following tick. The scaling factor k is linear. There is no inactivity timer or automatic regeneration.

---

## 6. Dynamics

Fixed timestep `dt = 1/60 s`. **Semi-implicit Euler** integration.

```
F_thrust = thrust · F_MAX · (cos θ, sin θ)
F_drag   = -C_LIN · v
a        = (F_thrust + F_drag) / m
v       += a · dt
p       += v · dt

τ        = turn · T_MAX - C_ANG · ω
ω       += (τ / I) · dt
θ       += ω · dt
```

| Constant | Value | Effect |
|---|---|---|
| `F_MAX` | `800 N` | acceleration `8 m/s²` |
| `C_LIN` | `160 N·s/m` | terminal speed `5.0 m/s` |
| `T_MAX` | `45 N·m` | angular acceleration `5.4 rad/s²` |
| `C_ANG` | `15 N·m·s` | terminal angular speed `3.0 rad/s` (≈172°/s) |
| `LATERAL_GRIP` | `0.85` | fraction of lateral velocity removed per tick |

### Lateral friction

After integration, velocity is split into longitudinal (along the heading) and lateral components. The lateral component is reduced:

```
v_lat *= (1 - LATERAL_GRIP)
```

This simulates tracks without requiring a wheel model. The tactical consequence: **the robot cannot translate sideways**. It must turn to change direction, and turning exposes its flank. This creates the core positioning challenge.

### Anti-exploit clamps

After every step: `|v| ≤ 7.0 m/s`, `|ω| ≤ 4.0 rad/s`. If any value is non-finite, the robot's state is restored to the previous tick and an engine violation is recorded (a simulation bug, not a bot violation).

### Integration and speed limits

Lateral decomposition uses the updated heading. Friction and drag also apply to a flipped robot. Speed limits also apply after collision impulses.

---

## 7. Collision and flipping

With only two bodies, a full broad phase is unnecessary. Each tick:

1. **Test**: if `distance(A, B) > 1.0 m` (the sum of the radii), there is no contact.
2. **Narrow phase**: SAT between the two oriented rectangles → contact point `c`, normal `n` (from A toward B), penetration depth `d`.
3. **Separation**: both robots move by `d/2` along `n`, in opposite directions.

### Identifying wedge contact

For each robot `R`, calculate the angle between its heading and the direction toward the contact point:

```
θ_err(R) = |angle(heading_R, c - p_R)|
inWedge(R) = θ_err(R) ≤ 35° (0.6109 rad)
```

### Closing speed

```
v_close = max(0, (v_A - v_B) · n)
```

### Flip score

If `inWedge(A)` and **not** `inWedge(B)`:

```
flipScore = v_close · cos(θ_err(A)) · leverage(sector hit on B)
```

`leverage` depends on where the wedge touches the target, measured relative to B's heading:

| Sector hit | Angular range | Leverage |
|---|---|---|
| Front (outside the wedge) | `35°–70°` | `0.60` |
| Side | `70°–145°` | `1.00` |
| Rear | `145°–180°` | `0.85` |

**A flip occurs if `flipScore ≥ FLIP_THRESHOLD = 2.6`.**

Exactly one wedge must still be in contact, and the target must be in the `active` state: slow pushes and wedge-to-wedge collisions do not cause flips.

### Wedge against wedge

If `inWedge(A) && inWedge(B)`: **no flip, ever**. The robots rebound with `restitution = 0.4`, and both pay the full energy cost. This rule makes positioning central to the game.

### Impact energy cost

```
E_attacker -= K_IMPACT · v_close · 0.4
E_target   -= K_IMPACT · v_close · leverage
```

Charging is an investment: even if you miss, you have already spent energy.

### Consequences of a flip

| Phase | Duration | State |
|---|---|---|
| `flipped` | `4.0 s` | no motor output, no commands accepted, **can be pushed and forced out** |
| self-righting | instantaneous at the end of the phase | costs `E_RIGHT = 25`; if `E < 25`, remains `flipped` until a recharge pickup provides enough energy |
| `recovering` | `1.0 s` | commands accepted, **immune to further flips** |

A flipped robot can be pushed out of the arena. This is the quickest way to finish a match and must remain possible.

### Contact resolution

The contact point is the average of the vertices of the chassis intersection polygon. SAT and clipping use a canonical pose order (x, y, heading), independent of the A/B labels; the normal is then oriented from A toward B. Wedge angles and impulse moment arms use positions before separation. Impulses include angular momentum. Restitution is 0.4 only between two wedges and 0 for all other contacts. Both robots in chassis-to-chassis and wedge-to-wedge contacts pay the full K_IMPACT · v_close cost; no minimum cost threshold is added. A flipped robot's wedge cannot attack. On a flip, velocity and omega are set to zero, after which impulses may move the robot. A new flip does not decrement its timer during the same tick. Self-righting is checked before recharge pickups. Commands are accepted during recovering; only flipped or zero-energy robots have their motors disabled.

---

## 8. Victory conditions

Evaluated in this order at the end of each tick:

1. **Fall** — the center of mass leaves the current square or crosses an open hole → immediate defeat.
2. **Flips** — `FLIPS_TO_LOSE = 2` flips taken → defeat.
3. **Disqualification** - reaching `MAX_VIOLATIONS = 20` runtime violations causes defeat. Invalid action components, invalid memory, exceptions, and tick timeouts are counted as described in the bot contract below.
4. **Timeout** at `MATCH_DURATION = 120 s`, decided by:
   1. fewer flips taken;
   2. if tied, more remaining energy;
   3. if still tied, **closer to the center** `(0, 0)`;
   4. only if all three are exactly equal, a **draw** (worth 0.5 for each robot in the ranking).

If both robots fall during the same tick, including one through a hole and one over the edge, the match is a draw. Simultaneous disqualifications also draw when no higher-priority defeat applies.

### Simultaneous defeats and exact ties

Within each priority category, two simultaneous defeats produce a draw. Energy and squared center distance (`x*x + y*y`) comparisons are exact, with no epsilon. Distance is evaluated from the authoritative final positions, not rounded display values. The center rule reduces draws; it does not invent a winner for completely symmetric outcomes or simultaneous defeats. Timeout replays record the deciding criterion: `flips`, `energy`, `center`, or `equal`.

---

# Part 2 — Bot contract

## 9. Bot contract

### Signature

```ts
export function tick(
  sensors: Sensors,
  memory: Memory
): { actions: Actions; memory: Memory };
```

A **pure** function. No global state or side effects. All persistent state passes through `memory`.

### Types

```ts
type RobotStatus = 'active' | 'flipped' | 'recovering';

interface RobotState {
  /** center-of-mass position, meters, world frame */
  x: number;
  y: number;
  /** radians, 0 = +X, counterclockwise, in (-π, π] */
  heading: number;
  /** velocity, m/s, world frame */
  vx: number;
  vy: number;
  /** angular velocity, rad/s */
  omega: number;
  /** 0..300 */
  energy: number;
  /** flips taken so far, 0..1 (the match ends at 2) */
  flipsTaken: number;
  status: RobotStatus;
  /** seconds remaining in the current state; 0 when 'active' */
  statusTimer: number;
}

interface ContactInfo {
  /** tick when the contact occurred */
  tick: number;
  /** true if this robot's wedge caused the contact */
  selfWedge: boolean;
  /** true if the opponent's wedge caused the contact */
  opponentWedge: boolean;
  /** closing speed along the normal, m/s */
  closingSpeed: number;
  /** contact point, world frame */
  x: number;
  y: number;
}

type CellType = 'recharge' | 'hole' | 'flame' | 'collapse' | 'floor';
type CellState = 'ready' | 'cooldown' | 'hole' | 'safe' | 'warning' | 'flaming' | 'inactive';

interface ArenaCell {
  /** Stable public identifier, e.g. recharge-0, hole-0, flame-0, floor-136 */
  id: string;
  type: CellType;
  /** Fixed world-space cell center, meters */
  x: number;
  y: number;
  /** Square side length, always 1 m in this rules version */
  size: number;
  /** Recharge: ready/cooldown; hole: hole; grate: safe/warning/flaming.
      Announced collapse: warning, then type and state both change to hole.
      Any cell entirely outside the current arena: inactive. */
  state: CellState;
  /** Seconds until the next cooldown/flame phase transition or collapse.
      Null for a ready charger, a hole, or an inactive cell. */
  timeUntilChange: number | null;
  /** Remaining floor capacity: 1 intact, 0 exhausted or open. No regeneration. */
  integrity: number;
  /** Seconds until an announced opening, independently of recharge/fire state.
      Null when no opening is announced, already open, or inactive. */
  collapseIn: number | null;
}

interface Sensors {
  /** current tick, starting at 0 */
  tick: number;
  /** seconds since the match began = tick / 60 */
  time: number;
  /** fixed dt, always 1/60 */
  dt: number;
  self: RobotState;
  /** complete opponent state, including energy; no hidden state information */
  opponent: RobotState;
  arena: {
    /** current half-extent, meters */
    halfExtent: number;
    /** half-extent at the next tick, to anticipate shrinking */
    nextHalfExtent: number;
    /** Initial cells plus worn and announced/collapsed floor cells, with fresh states.
        Untouched ordinary floor is omitted. Future random schedules stay hidden. */
    cells: ArenaCell[];
  };
  /** most recent contact, or null if none has occurred */
  lastContact: ContactInfo | null;
}

interface Actions {
  /** longitudinal thrust, -1 (reverse) .. 1 (forward) */
  thrust: number;
  /** torque, -1 (clockwise) .. 1 (counterclockwise) */
  turn: number;
}

/** Any JSON-serializable value. Cap: 64 KB when serialized. */
type Memory = unknown;
```

### Public opponent state

`opponent` exposes the documented public robot state, including energy. Controller source, serialized memory, module state, and internal strategy are private and must not be inspected. This is deliberate: hiding energy would add inference and bluffing, but would increase variance and require many more matches for a stable ranking. The benchmark measures reasoning, not luck.

### Reference frame

All values use the **world frame**. There are no helpers or ready-made `angleTo()` functions. Trigonometry is part of what the benchmark measures.

### Code constraints

- One TypeScript or JavaScript file, ESM, with a single export: `tick`.
- No `import` statements or dependencies.
- Forbidden: `Math.random`, `Date`, `performance`, `fetch`, `setTimeout`, `globalThis`, `eval`, `Function`, `WeakRef`. The worker removes them from scope.
- `Math.sin/cos/atan2/sqrt/hypot` are allowed.
- The bot must be deterministic. Any variation must be derived from `sensors.tick`.

### Minimal example

```ts
export function tick(s: Sensors, m: Memory) {
  const dx = s.opponent.x - s.self.x;
  const dy = s.opponent.y - s.self.y;
  const bearing = Math.atan2(dy, dx);
  let err = bearing - s.self.heading;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;

  return {
    actions: {
      turn: Math.max(-1, Math.min(1, err * 1.5)),
      thrust: Math.abs(err) < 0.3 ? 0.8 : 0.2,
    },
    memory: m,
  };
}
```

This minimal example is public contract material and may be used as a starting template. It does not authorize inspecting any controller file in the project.

### Runtime enforcement

Initial memory is null. Input sensors and memory are recursively frozen: return new memory without mutating the inputs. Every call receives a fresh module scope, so global variables do not persist. The function must be synchronous. Memory accepts only strict JSON: null, booleans, strings, finite numbers, arrays, and plain objects containing JSON values. Undefined, BigInt, symbols, functions, and non-plain objects are also rejected. The cap is 65536 UTF-8 bytes. Source code is capped at 256 KiB; QuickJS has 16 MiB of memory and a 256 KiB stack. The runtime is QuickJS WASM in one Worker per bot, with no host callbacks, frozen intrinsics, and dynamic constructors disabled. Errors or timeouts preserve the previous memory and set both actions to zero (+1 violation); each invalid action component and invalid memory value counts separately. Finite out-of-range commands are clamped without penalty. The wall-clock budget is 2 ms per tick and 50 ms for initialization, excluding Worker/WASM startup and the host transpiler. Initialization errors exclude the file before the match. Browser exhibitions use a deterministic instruction budget, separate from the official wall-clock budget.

---

# Part 3 — Conformity tests

## 15. Unit tests

### Public conformity checks

1. The module exports `tick`.
2. **Purity**: two calls with the same input produce the same output.
3. No exceptions on 200 reference snapshots, including edge cases: energy 0 or 300, `status: 'flipped'`, an overlapping opponent, the smallest arena, `lastContact: null`, and cells with cooldowns, flame phase countdowns or collapse warnings, worn floor and chargers/grates nearing collapse.
4. `thrust` and `turn` are finite numbers.
5. `memory` is serializable and ≤ 64 KB.
6. No access to forbidden globals (static analysis + restricted runtime scope).
7. p99 tick duration < 2 ms on the reference snapshots.
8. The bot survives 600 ticks in an inert scenario without unbounded memory growth.

### Strategy tests: none

A test such as "the bot must aim at the opponent" would be a tactical suggestion disguised as a requirement. The gate checks only that the code is executable and obeys the rules. The arena decides its quality.

### Measurement protocol

p99 is measured after warmup using two calls for each of the 200 snapshots. The inert scenario requires 600 ticks without violations and memory within the 64 KiB cap. Purity checks also detect mutation of frozen inputs. These checks award no tactical credit.

---

## Complete engine constants

These values are checked against the simulator by the project tests. Update this document when the rules change.

<!-- engine-constants -->
```json
{
  "DT": 0.016666666666666666,
  "MATCH_DURATION": 120,
  "ARENA_HALF_EXTENT": 8,
  "ARENA_MIN_HALF_EXTENT": 3,
  "ARENA_SHRINK_START": 60,
  "ARENA_SHRINK_RATE": 0.07,
  "ROBOT_LENGTH": 0.8,
  "ROBOT_WIDTH": 0.6,
  "ROBOT_MASS": 100,
  "ROBOT_INERTIA": 8.3333,
  "ROBOT_RADIUS": 0.5,
  "WEDGE_HALF_ANGLE": 0.6109,
  "F_MAX": 800,
  "C_LIN": 160,
  "T_MAX": 45,
  "C_ANG": 15,
  "LATERAL_GRIP": 0.85,
  "MAX_SPEED": 7,
  "MAX_OMEGA": 4,
  "ENERGY_MAX": 300,
  "K_THRUST": 9,
  "K_TURN": 3,
  "K_IDLE": 0.5,
  "CELL_SIZE": 1,
  "RECHARGE_CELLS": 4,
  "RECHARGE_AMOUNT": 60,
  "RECHARGE_COOLDOWN": 8,
  "HOLE_CELLS_MIN": 2,
  "HOLE_CELLS_MAX": 3,
  "FLAME_CELLS": 4,
  "FLAME_DAMAGE": 30,
  "FLAME_WARNING": 1,
  "FLAME_DURATION": 1.5,
  "FLAME_GAP_MIN": 4,
  "FLAME_GAP_MAX": 8,
  "COLLAPSE_CELLS": 4,
  "COLLAPSE_WARNING": 3,
  "COLLAPSE_FIRST_MIN": 20,
  "COLLAPSE_FIRST_MAX": 30,
  "COLLAPSE_GAP_MIN": 15,
  "COLLAPSE_GAP_MAX": 25,
  "FLOOR_LOAD_CAPACITY": 1200,
  "FLOOR_WARNING": 3,
  "K_IMPACT": 2.5,
  "E_RIGHT": 25,
  "FLIP_THRESHOLD": 2.6,
  "FLIPS_TO_LOSE": 2,
  "FLIP_RECOVERY": 4,
  "FLIP_IMMUNITY": 1,
  "LEVERAGE_FRONT": 0.6,
  "LEVERAGE_SIDE": 1,
  "LEVERAGE_REAR": 0.85,
  "RESTITUTION_WEDGE": 0.4,
  "TICK_BUDGET_MS": 2,
  "INIT_BUDGET_MS": 50,
  "MEMORY_MAX_BYTES": 65536,
  "MAX_VIOLATIONS": 20
}
```

---

## Standalone bot submissions

When asked to return a standalone bot submission as your response, respond with **one JavaScript or TypeScript file**, using ESM and **exactly one export** named `tick`. Do not include explanations, text outside the code, or any `import`. The file will run as submitted in the runtime described above and must pass all eight conformity checks before entering the arena.

---

# Operating and publishing the project

## Run locally

Use **Node.js 24 or newer**:

```sh
npm ci
npm start
```

Open **http://127.0.0.1:8080**. `npm start` builds the application and starts the local server. To build and serve separately, or choose another port:

```sh
npm run build
npm run viewer -- --port 4173
```

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`. No API keys are required; the application makes no LLM API calls.

## Publish

The live arena is [nigrosimone.github.io/llms-robot-arena](https://nigrosimone.github.io/llms-robot-arena/). The `conformity-and-engine` workflow runs installation, tests and a production build on **Ubuntu** for pushes and pull requests. After successful checks on `main`, it uploads only `dist/` and deploys it to the `github-pages` environment. Pull requests and other branches do not deploy. To redeploy manually, run this workflow from the repository's **Actions** tab with `main` selected.

In repository **Settings > Pages > Build and deployment**, the source must be **GitHub Actions**. The deploy job has `pages: write` and `id-token: write`; the test job has read-only repository access. Deployments run one at a time and an active deployment is allowed to finish. Assets, workers and replay URLs are relative, so the site works under `/llms-robot-arena/`. See the [GitHub Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) when changing deployment configuration.

Run `npm ci` and `npm run build`, then publish **the contents of `dist/`** to a static HTTPS host. Hosting under a URL subpath is supported. No Node.js server is needed in production.

The build includes the application assets. Local `node_modules/`, tournament `results/`, and development artifacts are not deployment files. Results are generated only when you run evaluations.

## Bot catalog

The root [bots.json](bots.json) is the single source of truth for registered controllers. The browser build, default tournament CLI and demo generator all consume it. Do not maintain additional roster arrays or hardcoded source imports. Its order determines the initial selection; the first two entries are the default match and demo pair.

Each entry contains a stable unique `id`, the correctly formatted `model` name, a `provider` such as `OpenAI` or `Anthropic` (`null` for the reference controller or an undeclared provider), and a unique project-relative `file` directly inside `packages/bots/`. Store the thinking level separately in `thinking` (for example `max` or `ultra`), and the coding harness in `harness` (`Codex` for OpenAI, `Claude Code` for Anthropic). Use null when these do not apply. Keep development provenance separate from the model name in `provenance`: for example `iterative`, `one-shot`, `local submission`, or `reference`. The reference entry supplies the starting template for locally created controllers.

When registering your assigned bot, add or update only its own entry. Rename its ID and path consistently when explicitly requested. Catalog metadata and file paths are public; registration never authorizes inspecting another implementation. The build loads sources opaquely and fails for duplicate IDs, invalid metadata or missing files. Rebuild after changing the catalog. Replays and reports store metadata snapshots and code hashes; historical results are not additional roster definitions and must retain their recorded provenance.

## Tournament CLI

Run an exhibition with all controllers registered in `bots.json`:

```sh
node packages/tournament/cli.js --out results --budget fuel
```

For an authorized iterative comparison between registered controllers, create `match-bots.json` as an array of their catalog IDs. No names, providers or paths need to be copied:

```json
["my-bot-id", "opponent-id"]
```

These manifests are manually created inputs, not match-runner output. Root `match-*.json` files are ignored by Git; recreate them when needed for local evaluations.

IDs must already exist in `bots.json`. To evaluate an unregistered controller, an entry may instead be a complete definition; legacy definitions without `provider` remain accepted:

```json
[
  { "id": "My Bot", "model": "Exact Model Version", "provider": "OpenAI", "provenance": "iterative", "file": "./packages/bots/my-bot.js" },
  { "id": "Opponent", "model": "Declared Opponent Model", "provider": "Anthropic", "file": "./packages/bots/opponent.js" }
]
```

Object paths are relative to the manifest; catalog IDs always resolve relative to the project root, even when the manifest is outside the project. Entries can mix catalog IDs and complete definitions. Run:

```sh
node packages/tournament/cli.js --bots match-bots.json --out results/my-bot --mode iterative --budget fuel
```

The standard protocol uses 10 seeds and both spawn assignments: 20 matches per pair. The CLI writes replays, checkpoints, rankings, confidence intervals and `RESULTS.md`, with source hashes, engine/rules versions, environment and budget metadata. Keep these together when publishing an evaluation.

Use `--mode one-shot --budget wall` only for a declared one-shot benchmark requiring wall-clock enforcement. A mode label is an operator declaration; it does not establish how a controller was developed. Default controllers force exhibition mode.

## Runtime and replay compatibility

- **`fuel`:** deterministic instruction limits for a fixed QuickJS build; the browser exhibition default. This is not equivalent to a 2 ms wall-clock budget.
- **`wall`:** a 2 ms tick budget and 50 ms initialization budget, subject to operating-system scheduling and machine load.

Compare results only under matching rules, runtime and budget conditions. The conformity gate uses bounded fuel for functional checks and separately measures execution time. Wall-clock results also depend on identical timeout decisions.

Replays retain their recorded rules, energy limit, arena dimensions, cell layout, flame schedules, collapse schedules and cumulative floor loads. Recharge events record when each cell becomes ready again. Compare results only when the recorded rules, engine versions and runtime budgets match. Replay hashes diagnose simulation differences and do not authenticate imported files.

Controllers receive the public arena state through `arena.cells`. Energy management must account for recharge pickups and the absence of passive regeneration. Implementing or updating a controller requires its own bot task and must respect the black-box policy above.

To check a platform change and rebuild:

```sh
npm test
npm run build
```
