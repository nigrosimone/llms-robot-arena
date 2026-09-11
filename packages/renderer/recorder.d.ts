import type { Replay, ViewerFrame } from "./arena.js";
export const INTRO_SECONDS: number;
export const OUTRO_SECONDS: number;
export const WIDTH: number;
export const HEIGHT: number;
export function recordingSupported(): boolean;
export function recordingFilename(replay: Replay | null, extension: string): string;
export function introCard(replay: Replay | null): { title: string; seed: string; robots: { label: string; name: string; provider: string; color: string }[] };
export function matchOutcome(replay: Replay | null): { title: string; reason: string };
export interface RecorderState { replay: Replay | null; frame: ViewerFrame | null; duration: number; intro?: number | null }
export function drawOverlay(ctx: CanvasRenderingContext2D, state: RecorderState): void;
export function drawIntro(ctx: CanvasRenderingContext2D, state: RecorderState, progress: number): void;
export class MatchRecorder {
  constructor(options: { source: () => HTMLCanvasElement; state: () => RecorderState; sound?: MediaStream | null });
  readonly recording: boolean;
  start(): void;
  capture(): void;
  stop(): Promise<{ blob: Blob; extension: string } | null>;
}
