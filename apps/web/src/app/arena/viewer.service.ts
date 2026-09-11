// One renderer for the life of the app: its canvas host is attached to the
// arena page when the page exists and kept alive in between, so a replay keeps
// its frame, camera and sound across panels. Frames are sampled into signals
// at 10 Hz; the 60 Hz loop stays inside the renderer.
import { Injectable, signal } from '@angular/core';
import { ArenaViewer, type Replay, type ViewerFrame } from '../../../../../packages/renderer/arena.js';
import { MatchAudio } from '../../../../../packages/renderer/audio.js';
import { MatchRecorder, INTRO_SECONDS, OUTRO_SECONDS, recordingSupported, recordingFilename, introCard } from '../../../../../packages/renderer/recorder.js';
import { clipSupported, renderClip } from '../../../../../packages/renderer/clip.js';
import { track } from '../../../../../packages/viewer/analytics.js';
import { ToastService } from '../core/toast.service';
import { download } from '../core/url';

export interface Hud {
  time: number;
  playing: boolean;
  ended: boolean;
  half: number;
  collapseIn: number | null;
  states: { energy: number; status: number; flips: number; hole?: boolean; ringOut?: boolean; out?: boolean }[];
  events: any[];
}
export interface Intro {
  title: string;
  seed: string;
  robots: { label: string; name: string; provider: string; color: string }[];
}

@Injectable({ providedIn: 'root' })
export class ViewerService {
  readonly host = document.createElement('div');
  readonly available = signal(true);
  readonly hud = signal<Hud | null>(null);
  readonly intro = signal<Intro | null>(null);
  readonly recording = signal(false);
  readonly clipProgress = signal<{ phase: 'video' | 'sound'; done: number; total: number } | null>(null);
  readonly audible = signal(false);
  readonly audio = new MatchAudio();
  viewer: ArenaViewer | null = null;
  private lastFrame: ViewerFrame | null = null;
  private hudAt = 0;
  private introTimer: ReturnType<typeof setTimeout> | null = null;
  private introStart: number | null = null;
  private recorder: MatchRecorder | null = null;
  private recorderStop: ReturnType<typeof setTimeout> | null = null;
  private clipAbort: AbortController | null = null;

  constructor(private readonly toast: ToastService) {
    this.host.id = 'viewport';
    try {
      this.viewer = new ArenaViewer(this.host, (frame) => this.onFrame(frame));
      this.viewer.audio = this.audio;
    } catch {
      this.available.set(false);
    }
    // A browser only lets sound start after a gesture; the sound button is left
    // out so a click there does not both wake and mute it.
    const wake = (event: Event) => {
      if (!(event.target as Element | null)?.closest?.('#sound')) this.audio.resume();
    };
    addEventListener('pointerdown', wake, true);
    addEventListener('keydown', wake, true);
    this.audio.onchange = () => this.audible.set(this.audio.audible);
  }

  attach(container: HTMLElement) {
    container.appendChild(this.host);
    this.viewer?.applySize();
  }
  detach() {
    this.host.remove();
  }

  private onFrame(frame: ViewerFrame) {
    const edge = frame.ended !== this.lastFrame?.ended || frame.playing !== this.lastFrame?.playing;
    this.lastFrame = frame;
    const now = performance.now();
    if (!edge && now - this.hudAt < 100) return;
    this.hudAt = now;
    const collapsing = ((frame as any).cells ?? []).filter((c: any) => c.collapseIn != null);
    this.hud.set({
      time: frame.time,
      playing: frame.playing,
      ended: frame.ended,
      half: frame.half,
      collapseIn: collapsing.length ? Math.ceil(Math.min(...collapsing.map((c: any) => c.collapseIn))) : null,
      states: frame.states.map((r: any, i) => ({ energy: r.energy, status: r.status, flips: frame.flips[i], hole: r.hole, ringOut: r.ringOut, out: r.out })),
      events: frame.events,
    });
    if (frame.ended && this.recorder?.recording && this.recorderStop === null)
      this.recorderStop = setTimeout(() => this.finishRecording(), OUTRO_SECONDS * 1000);
  }
  get frame() {
    return this.lastFrame;
  }
  get duration() {
    return this.viewer?.duration ?? 0;
  }
  get playbackDuration() {
    return this.viewer?.playbackDuration ?? 0;
  }

  load(replay: Replay, { live = false, autoplay = false } = {}) {
    if (!this.viewer) return;
    this.viewer.load(replay, { live });
    if (autoplay) this.playWithIntro();
    else if (!live) this.viewer.playing = false;
  }
  // A few seconds of card before the action, then playback starts on its own.
  playWithIntro() {
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
  cancelIntro() {
    if (this.introTimer) clearTimeout(this.introTimer);
    this.introTimer = null;
    this.introStart = null;
    this.audio.intro = false;
    this.intro.set(null);
  }
  get introRunning() {
    return this.introTimer !== null;
  }
  // A new match cancels a running intro and closes the clip already recorded.
  interrupt() {
    this.cancelIntro();
    if (this.recorder?.recording) this.finishRecording();
    this.clipAbort?.abort();
  }
  toggle() {
    this.cancelIntro();
    this.viewer?.toggle();
  }
  seek(t: number) {
    this.cancelIntro();
    this.viewer?.seek(t);
  }
  step(direction: number, count = 1) {
    if (!this.viewer?.replay) return;
    this.cancelIntro();
    this.viewer.playing = false;
    this.viewer.seek((Math.round(Math.min(this.viewer.time, this.viewer.duration) * 60) + direction * count) / 60);
  }
  set speed(value: number) {
    if (this.viewer) this.viewer.speed = value;
  }
  setSound(on: boolean) {
    this.audio.setEnabled(on);
  }

  canRecord() {
    return Boolean(this.viewer) && (clipSupported() || recordingSupported());
  }
  // The offline clip when the browser can encode video, the real-time
  // recorder otherwise.
  async record(replay: Replay) {
    if (!this.viewer) return;
    if (clipSupported()) return this.renderClipFile(replay);
    if (!recordingSupported()) return this.toast.show('This browser cannot record video.', true);
    if (this.recorder?.recording) return this.finishRecording();
    this.audio.resume();
    const viewer = this.viewer;
    this.recorder = new MatchRecorder({
      source: () => viewer.renderer.domElement,
      state: () => ({
        replay, frame: this.lastFrame, duration: viewer.duration,
        intro: this.introStart === null ? null : Math.min(1, (performance.now() - this.introStart) / (INTRO_SECONDS * 1000)),
      }),
      sound: this.audio.stream,
    });
    try {
      this.recorder.start();
    } catch (error) {
      this.recorder = null;
      return this.toast.show((error as Error).message, true);
    }
    viewer.onRender = () => this.recorder?.capture();
    viewer.setMinimumRows(720);
    this.recording.set(true);
    this.playWithIntro();
    this.toast.show('Recording from the start. The video is saved when the match ends.');
  }
  async finishRecording() {
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
    if (!clip?.blob.size) return this.toast.show('Recording produced no video.', true);
    const name = recordingFilename(this.viewer?.replay ?? null, clip.extension);
    download(name, clip.blob, clip.blob.type);
    track('video-exported', clip.extension);
    this.toast.show('Video saved: ' + name);
  }
  private async renderClipFile(replay: Replay) {
    if (this.clipAbort) return this.toast.show('A clip is already being rendered.', true);
    const viewer = this.viewer!;
    this.audio.resume();
    this.interrupt();
    viewer.playing = false;
    this.clipAbort = new AbortController();
    this.clipProgress.set({ phase: 'video', done: 0, total: 1 });
    try {
      const clip = await renderClip({
        viewer, replay, audio: this.audio, signal: this.clipAbort.signal,
        frame: () => this.lastFrame,
        onProgress: (progress) => this.clipProgress.set(progress),
        playAudio: ({ signal }) => new Promise<void>((resolve, reject) => {
          this.clipProgress.set({ phase: 'sound', done: 0, total: 1 });
          this.playWithIntro();
          const poll = setInterval(() => {
            if (signal?.aborted) {
              clearInterval(poll);
              reject(Error('Clip cancelled.'));
            } else if (!viewer.playing && viewer.time >= viewer.playbackDuration && !this.introRunning) {
              clearInterval(poll);
              setTimeout(resolve, OUTRO_SECONDS * 1000);
            }
          }, 100);
        }),
      });
      const name = recordingFilename(replay, clip.extension);
      download(name, clip.blob, clip.blob.type);
      track('video-exported', clip.sound ? 'clip' : 'clip-silent');
      this.toast.show(`Video saved: ${name}${clip.sound ? '' : ' (without sound: this browser cannot encode it)'}`);
    } catch (error) {
      this.toast.show((error as Error).message, true);
    } finally {
      this.clipAbort = null;
      this.clipProgress.set(null);
    }
  }
  cancelClip() {
    this.clipAbort?.abort();
  }
  get clipRunning() {
    return this.clipAbort !== null;
  }
}
