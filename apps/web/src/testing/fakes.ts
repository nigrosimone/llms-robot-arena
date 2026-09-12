// Stand-ins for the worker and the renderer, the two things a spec cannot run.
import { signal } from '@angular/core';
import { provideNgSimpleState } from 'ng-simple-state';
import { type Replay } from '../../../../packages/sim/replay.js';
import { type ClipProgress, type Hud, type Intro } from '../app/arena/viewer.service';
import { type WorkerMessage } from '../app/core/messages';
import { TERMINAL, type Operation, type OperationHandlers } from '../app/core/worker.service';

/** Records what was started and delivers messages like the worker would. */
export class FakeWorkerService {
  readonly operation = signal<Operation | null>(null);
  readonly started: { type: Operation; data: Record<string, unknown> }[] = [];
  readonly posted: object[] = [];
  cancelled = 0;
  private handlers: OperationHandlers | null = null;

  start(type: Operation, data: object, handlers: OperationHandlers): boolean {
    if (this.handlers) return false;
    this.operation.set(type);
    this.handlers = handlers;
    this.started.push({ type, data: data as Record<string, unknown> });
    return true;
  }
  post(message: object): void {
    this.posted.push(message);
  }
  cancel(): boolean {
    if (!this.handlers) return false;
    this.cancelled++;
    return true;
  }
  get busy(): boolean {
    return this.handlers !== null;
  }
  get last(): { type: Operation; data: Record<string, unknown> } {
    const last = this.started.at(-1);
    if (!last) throw new Error('Nothing was started.');
    return last;
  }
  emit(message: WorkerMessage): void {
    const handlers = this.handlers;
    if (!handlers) throw new Error('No operation is running.');
    if (message.type === 'error') handlers.onError?.(message.message);
    else handlers.onMessage(message);
    if (TERMINAL.has(message.type)) this.finish();
  }
  finish(): void {
    const handlers = this.handlers;
    this.handlers = null;
    this.operation.set(null);
    handlers?.onFinish?.();
  }
}

/** What the arena store and page touch of the three.js viewer. */
export class FakeArenaViewer {
  playing = false;
  live = false;
  speed = 1;
  time = 0;
  duration = 0;
  playbackDuration = 0;
  focus: number | null = null;
  cameraView: string | number = 'auto';
  manualCamera = false;
  replay: Replay | null = null;
  setFocus(index: number | null): void {
    this.focus = index;
  }
  setCameraView(view: string | number): void {
    this.cameraView = view;
  }
  setManualCamera(on: boolean): void {
    this.manualCamera = on;
  }
  toggle(): void {
    this.playing = !this.playing;
  }
  seek(t: number): void {
    this.time = t;
  }
}

/** The renderer service without a renderer: loads are recorded, signals are open. */
export class FakeViewerService {
  readonly host = Object.assign(document.createElement('div'), { id: 'viewport' });
  readonly available = signal(true);
  readonly hud = signal<Hud | null>(null);
  readonly intro = signal<Intro | null>(null);
  readonly recording = signal(false);
  readonly clipProgress = signal<ClipProgress | null>(null);
  readonly audible = signal(false);
  readonly loaded: { replay: Replay; live: boolean; autoplay: boolean }[] = [];
  viewer: FakeArenaViewer | null = new FakeArenaViewer();
  interrupted = 0;
  clipRunning = false;
  clipsCancelled = 0;
  attached: HTMLElement | null = null;
  recorded: Replay[] = [];
  sound: boolean | null = null;
  speed = 1;

  attach(container: HTMLElement): void {
    container.appendChild(this.host);
    this.attached = container;
  }
  detach(): void {
    this.host.remove();
    this.attached = null;
  }
  load(replay: Replay, { live = false, autoplay = false } = {}): void {
    this.loaded.push({ replay, live, autoplay });
    if (this.viewer) this.viewer.replay = replay;
  }
  interrupt(): void {
    this.interrupted++;
  }
  cancelIntro(): void {
    this.intro.set(null);
  }
  playWithIntro(): void {
    if (this.viewer) this.viewer.playing = true;
  }
  toggle(): void {
    this.viewer?.toggle();
  }
  seek(t: number): void {
    this.viewer?.seek(t);
  }
  step(): void {
    if (this.viewer) this.viewer.playing = false;
  }
  setSound(on: boolean): void {
    this.sound = on;
  }
  canRecord(): boolean {
    return true;
  }
  record(replay: Replay): Promise<void> {
    this.recorded.push(replay);
    return Promise.resolve();
  }
  cancelClip(): void {
    this.clipsCancelled++;
  }
  get duration(): number {
    return this.viewer?.duration ?? 0;
  }
  get playbackDuration(): number {
    return this.viewer?.playbackDuration ?? 0;
  }
  readonly frame = null;
  get introRunning(): boolean {
    return this.intro() !== null;
  }
}

/** A replay with only what the stores read; frames are empty. */
export function fakeReplay(patch: Partial<Replay> = {}): Replay {
  return {
    specVersion: '0.2',
    engineVersion: '0.2.2-r2',
    mode: 'exhibition',
    seed: 3,
    mirrored: false,
    bots: [
      { id: 'baseline', model: 'Baseline' },
      { id: 'other', model: 'Other' },
    ],
    dt: 1 / 60,
    energyMax: 100,
    arenaCells: [],
    initialFrame: [],
    frames: new Float32Array(0),
    arenaExtents: new Float32Array(0),
    events: [],
    stateHashes: [],
    result: { winner: 0, reason: 'ring-out', ticks: 600 },
    finalStates: [],
    violations: [0, 0],
    ...patch,
  };
}

/** The providers a store spec needs besides the fakes. */
export const storeProviders = [provideNgSimpleState({})];
