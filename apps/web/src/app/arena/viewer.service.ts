import { Service, inject, signal } from '@angular/core';
import {
  ArenaViewer,
  type Replay,
  type ViewerFrame,
} from '../../../../../packages/renderer/arena.js';
import { MatchAudio } from '../../../../../packages/renderer/audio.js';
import {
  INTRO_SECONDS,
  MatchRecorder,
  OUTRO_SECONDS,
  introCard,
  recordingFilename,
  recordingSupported,
} from '../../../../../packages/renderer/recorder.js';
import { clipSupported, renderClip } from '../../../../../packages/renderer/clip.js';
import { track } from '../../../../../packages/viewer/analytics.js';
import { ToastService } from '../core/toast.service';
import { download } from '../core/url';

export interface HudRobot {
  energy: number;
  status: number;
  flips: number;
  hole: boolean;
  ringOut: boolean;
  out: boolean;
}
export interface Hud {
  time: number;
  playing: boolean;
  ended: boolean;
  half: number;
  collapseIn: number | null;
  states: HudRobot[];
  events: ViewerFrame['events'];
}
export type Intro = ReturnType<typeof introCard>;
export interface ClipProgress {
  phase: 'video' | 'sound';
  done: number;
  total: number;
}

/**
 * One renderer for the life of the app: its canvas host is attached to the
 * arena page when the page exists and kept alive in between, so a replay keeps
 * its frame, camera and sound across panels. Frames are sampled into signals
 * at 10 Hz; the 60 Hz loop stays inside the renderer.
 */
@Service()
export class ViewerService {
  readonly host = document.createElement('div');
  readonly available = signal(true);
  readonly hud = signal<Hud | null>(null);
  readonly intro = signal<Intro | null>(null);
  readonly recording = signal(false);
  readonly clipProgress = signal<ClipProgress | null>(null);
  readonly audible = signal(false);
  readonly audio = new MatchAudio();
  viewer: ArenaViewer | null = null;
  private readonly toast = inject(ToastService);
  private lastFrame: ViewerFrame | null = null;
  private hudAt = 0;
  private introTimer: ReturnType<typeof setTimeout> | null = null;
  private introStart: number | null = null;
  private recorder: MatchRecorder | null = null;
  private recorderStop: ReturnType<typeof setTimeout> | null = null;
  private clipAbort: AbortController | null = null;

  constructor() {
    this.host.id = 'viewport';
    try {
      this.viewer = new ArenaViewer(this.host, (frame) => {
        this.onFrame(frame);
      });
      this.viewer.audio = this.audio;
    } catch {
      this.available.set(false);
    }
    // A browser only lets sound start after a gesture; the sound button is left
    // out so a click there does not both wake and mute it.
    const wake = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element && target.closest('#sound'))) this.audio.resume();
    };
    addEventListener('pointerdown', wake, true);
    addEventListener('keydown', wake, true);
    this.audio.onchange = () => {
      this.audible.set(this.audio.audible);
    };
  }

  /** Puts the canvas host inside the arena page. */
  attach(container: HTMLElement): void {
    container.appendChild(this.host);
    this.viewer?.applySize();
  }
  /** Takes the canvas host out of the page, keeping the renderer alive. */
  detach(): void {
    this.host.remove();
  }

  /** Samples the renderer frames into the HUD signal, at once on play and end edges. */
  private onFrame(frame: ViewerFrame): void {
    const edge = this.isEdge(frame);
    this.lastFrame = frame;
    const now = performance.now();
    if (!edge && now - this.hudAt < 100) return;
    this.hudAt = now;
    const collapsing = (frame.cells ?? []).flatMap((c) =>
      c.collapseIn == null ? [] : [c.collapseIn],
    );
    this.hud.set({
      time: frame.time,
      playing: frame.playing,
      ended: frame.ended,
      half: frame.half,
      collapseIn: collapsing.length ? Math.ceil(Math.min(...collapsing)) : null,
      states: frame.states.map((r, i) => ({
        energy: r.energy,
        status: r.status,
        flips: frame.flips[i] ?? 0,
        hole: r.hole ?? false,
        ringOut: r.ringOut ?? false,
        out: r.out ?? false,
      })),
      events: frame.events,
    });
    if (frame.ended && this.recorder?.recording && this.recorderStop === null)
      this.recorderStop = setTimeout(() => void this.finishRecording(), OUTRO_SECONDS * 1000);
  }
  /** True when playback started, stopped or ended since the previous frame. */
  private isEdge(frame: ViewerFrame): boolean {
    const last = this.lastFrame;
    if (!last) return true;
    return frame.ended !== last.ended || frame.playing !== last.playing;
  }
  get frame(): ViewerFrame | null {
    return this.lastFrame;
  }
  get duration(): number {
    return this.viewer?.duration ?? 0;
  }
  get playbackDuration(): number {
    return this.viewer?.playbackDuration ?? 0;
  }

  /** Loads a replay in the renderer, paused unless it is live or autoplay is asked. */
  load(replay: Replay, { live = false, autoplay = false } = {}): void {
    if (!this.viewer) return;
    this.viewer.load(replay, { live });
    if (autoplay) this.playWithIntro();
    else if (!live) this.viewer.playing = false;
  }
  /** A few seconds of card before the action, then playback starts on its own. */
  playWithIntro(): void {
    if (!this.viewer?.replay) return;
    this.cancelIntro();
    this.viewer.playing = false;
    this.viewer.seek(0);
    this.audio.restartTrack();
    this.intro.set(introCard(this.viewer.replay));
    this.introStart = performance.now();
    this.audio.intro = true;
    this.introTimer = setTimeout(() => {
      this.cancelIntro();
      if (this.viewer) this.viewer.playing = true;
    }, INTRO_SECONDS * 1000);
  }
  /** Drops the intro card and its timer. */
  cancelIntro(): void {
    if (this.introTimer) clearTimeout(this.introTimer);
    this.introTimer = null;
    this.introStart = null;
    this.audio.intro = false;
    this.intro.set(null);
  }
  get introRunning(): boolean {
    return this.introTimer !== null;
  }
  /** A new match cancels a running intro and closes the clip already recorded. */
  interrupt(): void {
    this.cancelIntro();
    if (this.recorder?.recording) void this.finishRecording();
    this.clipAbort?.abort();
  }
  /** Play or pause. */
  toggle(): void {
    this.cancelIntro();
    this.viewer?.toggle();
  }
  /** Jumps to a time in seconds. */
  seek(t: number): void {
    this.cancelIntro();
    this.viewer?.seek(t);
  }
  /** Pauses and moves by whole ticks. */
  step(direction: number, count = 1): void {
    if (!this.viewer?.replay) return;
    this.cancelIntro();
    this.viewer.playing = false;
    this.viewer.seek(
      (Math.round(Math.min(this.viewer.time, this.viewer.duration) * 60) + direction * count) / 60,
    );
  }
  set speed(value: number) {
    if (this.viewer) this.viewer.speed = value;
  }
  /** Mutes or unmutes the match audio. */
  setSound(on: boolean): void {
    this.audio.setEnabled(on);
  }

  /** True when this browser can export a video in some way. */
  canRecord(): boolean {
    return this.viewer !== null && (clipSupported() || recordingSupported());
  }
  /** The offline clip when the browser can encode video, the real-time recorder otherwise. */
  async record(replay: Replay): Promise<void> {
    if (!this.viewer) return;
    if (clipSupported()) return this.renderClipFile(replay);
    if (!recordingSupported()) {
      this.toast.show('This browser cannot record video.', true);
      return;
    }
    if (this.recorder?.recording) return this.finishRecording();
    this.audio.resume();
    const viewer = this.viewer;
    this.recorder = new MatchRecorder({
      source: () => viewer.renderer.domElement,
      state: () => ({
        replay,
        frame: this.lastFrame,
        duration: viewer.duration,
        intro:
          this.introStart === null
            ? null
            : Math.min(1, (performance.now() - this.introStart) / (INTRO_SECONDS * 1000)),
      }),
      sound: this.audio.stream,
    });
    try {
      this.recorder.start();
    } catch (error) {
      this.recorder = null;
      this.toast.show((error as Error).message, true);
      return;
    }
    viewer.onRender = () => this.recorder?.capture();
    viewer.setMinimumRows(720);
    this.recording.set(true);
    this.playWithIntro();
    this.toast.show('Recording from the start. The video is saved when the match ends.');
  }
  /** Stops the real-time recorder and saves what it captured. */
  async finishRecording(): Promise<void> {
    if (this.recorderStop) clearTimeout(this.recorderStop);
    this.recorderStop = null;
    const active = this.recorder;
    this.recorder = null;
    if (!active?.recording) return;
    this.recording.set(false);
    const clip = await active.stop();
    if (this.viewer) {
      this.viewer.onRender = null;
      this.viewer.setMinimumRows(0);
    }
    if (!clip?.blob.size) {
      this.toast.show('Recording produced no video.', true);
      return;
    }
    const name = recordingFilename(this.viewer?.replay ?? null, clip.extension);
    download(name, clip.blob, clip.blob.type);
    track('video-exported', clip.extension);
    this.toast.show('Video saved: ' + name);
  }
  /** Renders the replay offline at 1080p60, then plays it once more for the sound. */
  private async renderClipFile(replay: Replay): Promise<void> {
    if (this.clipAbort || !this.viewer) {
      this.toast.show('A clip is already being rendered.', true);
      return;
    }
    const viewer = this.viewer;
    this.audio.resume();
    this.interrupt();
    viewer.playing = false;
    this.clipAbort = new AbortController();
    this.clipProgress.set({ phase: 'video', done: 0, total: 1 });
    try {
      const clip = await renderClip({
        viewer,
        replay,
        audio: this.audio,
        signal: this.clipAbort.signal,
        frame: () => this.lastFrame,
        onProgress: (progress) => {
          this.clipProgress.set(progress);
        },
        playAudio: ({ signal }) =>
          new Promise<void>((resolve, reject) => {
            this.clipProgress.set({ phase: 'sound', done: 0, total: 1 });
            this.playWithIntro();
            const poll = setInterval(() => {
              if (signal?.aborted) {
                clearInterval(poll);
                reject(new Error('Clip cancelled.'));
              } else if (
                !viewer.playing &&
                viewer.time >= viewer.playbackDuration &&
                !this.introRunning
              ) {
                clearInterval(poll);
                setTimeout(resolve, OUTRO_SECONDS * 1000);
              }
            }, 100);
          }),
      });
      const name = recordingFilename(replay, clip.extension);
      download(name, clip.blob, clip.blob.type);
      track('video-exported', clip.sound ? 'clip' : 'clip-silent');
      this.toast.show(
        `Video saved: ${name}${clip.sound ? '' : ' (without sound: this browser cannot encode it)'}`,
      );
    } catch (error) {
      this.toast.show((error as Error).message, true);
    } finally {
      this.clipAbort = null;
      this.clipProgress.set(null);
    }
  }
  /** Aborts the offline clip. */
  cancelClip(): void {
    this.clipAbort?.abort();
  }
  get clipRunning(): boolean {
    return this.clipAbort !== null;
  }
}
