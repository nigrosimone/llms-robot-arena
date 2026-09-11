export function eventCue(event: { type: string }): { cue: string; strength?: number } | null;
export class MatchAudio {
  constructor(volume?: number);
  enabled: boolean;
  intro: boolean;
  onchange: (() => void) | null;
  readonly ctx: AudioContext | null;
  readonly audible: boolean;
  readonly stream: MediaStream | null;
  resume(): AudioContext | null;
  setEnabled(on: boolean): void;
  restartTrack(offset?: number): void;
  reset(): void;
  startCapture(onData: (channels: Float32Array[], at: number, sampleRate: number) => void): number | null;
  stopCapture(): void;
}
