// What a closed match looks like on disk and in memory.
export interface RobotState {
  x: number;
  y: number;
  heading: number;
  energy: number;
  status: number;
  statusTimer: number;
  flipsTaken?: number;
}
export interface ReplayEvent {
  type: string;
  tick: number;
  robot?: number;
  cell?: string;
  cause?: string;
  reason?: string;
  amount?: number;
  closingSpeed?: number;
}
export interface MatchResult {
  winner: number | null;
  reason: string;
  ticks: number;
  decision?: string;
  standings?: number[];
}
export interface Replay {
  specVersion: string;
  engineVersion: string;
  mode: string;
  seed: number;
  mirrored: boolean;
  bots: { id: string; model: string; codeSha256?: string; provider?: string | null; thinking?: string | null; harness?: string | null; provenance?: string | null }[];
  dt: number;
  energyMax: number;
  arenaCells: object[];
  floorLoads?: number[];
  initialFrame: number[];
  frames: Float32Array;
  arenaExtents: Float32Array;
  events: ReplayEvent[];
  stateHashes: { tick: number; hash: string }[];
  result: MatchResult;
  finalStates: RobotState[];
  violations: number[];
  engineViolations?: number;
  runtime?: Record<string, unknown>;
  inputs?: ([number, number][] | null)[];
}
export function stringifyReplay(replay: Replay): string;
export function parseReplay(text: string): Replay;
