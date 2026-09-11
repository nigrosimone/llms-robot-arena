import type { ArenaViewer, Replay, ViewerFrame } from "./arena.js";
import type { MatchAudio } from "./audio.js";
export function clipSupported(): boolean;
export function renderClip(options: {
  viewer: ArenaViewer;
  replay: Replay;
  frame: () => ViewerFrame | null;
  audio?: MatchAudio | null;
  playAudio?: ((context: { signal: AbortSignal | null }) => Promise<void>) | null;
  onProgress?: (progress: { phase: "video" | "sound"; done: number; total: number }) => void;
  signal?: AbortSignal | null;
  width?: number;
  height?: number;
  fps?: number;
}): Promise<{ blob: Blob; extension: string; sound: boolean }>;
