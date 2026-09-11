// The renderer's contract for typed callers. The implementation is arena.js.
import type { MatchAudio } from "./audio.js";

export type { Replay, RobotState } from "../sim/replay.js";
import type { Replay } from "../sim/replay.js";

export interface FrameState {
  energy: number;
  status: number;
  hole?: boolean;
  ringOut?: boolean;
  out?: boolean;
}
export interface ViewerFrame {
  time: number;
  playing: boolean;
  states: FrameState[];
  half: number;
  flips: number[];
  events: import("../sim/replay.js").ReplayEvent[];
  ended: boolean;
  cells?: { collapseIn?: number | null }[];
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
