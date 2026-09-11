// The renderer's contract for typed callers. The implementation is arena.js.
import type { MatchAudio } from "./audio.js";

export interface RobotState {
  x: number;
  y: number;
  heading: number;
  energy: number;
  status: number;
  statusTimer: number;
  out?: boolean;
}
export interface ViewerFrame {
  time: number;
  playing: boolean;
  states: RobotState[];
  half: number;
  flips: number[];
  events: object[];
  ended: boolean;
}
export interface Replay {
  specVersion: string;
  engineVersion: string;
  mode: string;
  seed: number;
  mirrored: boolean;
  bots: { id: string; model: string; codeSha256?: string; provider?: string | null }[];
  dt: number;
  energyMax: number;
  arenaCells: object[];
  floorLoads?: number[];
  initialFrame: number[];
  frames: Float32Array;
  arenaExtents: Float32Array;
  events: { type: string; tick: number; robot?: number }[];
  stateHashes: { tick: number; hash: string }[];
  result: { winner: number | null; reason: string; ticks: number; decision?: string; standings?: number[] };
  finalStates: RobotState[];
  violations: number[];
  engineViolations?: number;
  runtime?: Record<string, unknown>;
  inputs?: ([number, number][] | null)[];
}

export class ArenaViewer {
  constructor(container: HTMLElement, onFrame?: (frame: ViewerFrame) => void);
  replay: Replay | null;
  time: number;
  speed: number;
  playing: boolean;
  live: boolean;
  manualCamera: boolean;
  audio: MatchAudio | null;
  onFrame: ((frame: ViewerFrame) => void) | null;
  onRender: (() => void) | null;
  readonly renderer: { domElement: HTMLCanvasElement };
  readonly duration: number;
  readonly playbackDuration: number;
  load(replay: Replay, options?: { live?: boolean }): void;
  seek(t: number): void;
  toggle(): boolean;
  resetCamera(): void;
  clearCameraInertia(): void;
  setManualCamera(manual: boolean): void;
  setCameraView(view: "auto" | number, options?: { withRival?: boolean }): void;
  setFocus(index: number | null): void;
  setMinimumRows(rows: number): void;
  applySize(): void;
  beginOffline(width: number, height: number): void;
  renderAt(t: number, dt: number): HTMLCanvasElement;
  endOffline(): void;
  dispose(): void;
}
