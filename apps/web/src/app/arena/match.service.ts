// The arena state that changes slowly lives in signals; the 60 Hz stream from
// the worker goes straight to the viewer, never through the framework.
import { Injectable, signal, computed } from '@angular/core';
import { ArenaViewer } from '../../../../../packages/viewer/arena.js';
import { parseReplay } from '../../../../../packages/sim/replay.js';
import { SPEC as S, SPEC_VERSION, ENGINE_VERSION } from '../../../../../packages/sim/spec.js';
import { readMatchSettings, matchSettingsSearch } from '../../../../../packages/viewer/match-link.js';
import { botName, botDetails } from '../../../../../packages/bot-catalog.js';
import { BOTS } from '../../generated/bots';

export type Bot = (typeof BOTS)[number];
export interface Hud {
  time: number;
  playing: boolean;
  ended: boolean;
  robots: { name: string; energy: number; status: number }[];
}
type Status = 'idle' | 'simulating' | 'live' | 'ready';

const SEED_MAX = 4294967295;
const CONTROL_KEYS: Record<string, string> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};

@Injectable({ providedIn: 'root' })
export class MatchService {
  readonly bots = BOTS as readonly Bot[];
  readonly a = signal(0);
  readonly b = signal(1);
  readonly seed = signal(0);
  readonly mirrored = signal(false);
  readonly status = signal<Status>('idle');
  readonly progress = signal(0);
  readonly message = signal('');
  readonly replay = signal<any>(null);
  readonly hud = signal<Hud | null>(null);
  readonly live = computed(() => this.status() === 'live');
  readonly busy = computed(() => this.status() === 'simulating' || this.status() === 'live');
  readonly names = computed(() => this.bots.map((bot) => `${botName(bot)} / ${botDetails(bot)}`));

  private viewer: any = null;
  private worker: Worker | null = null;
  private liveReplay: any = null;
  private lastFrame: any = null;
  private hudAt = 0;
  private readonly held = new Set<string>();

  constructor() {
    try {
      const settings = readMatchSettings(location.search, this.bots);
      if (settings) {
        if (settings.a !== null) this.a.set(settings.a);
        if (settings.b !== null) this.b.set(settings.b);
        if (settings.seed !== null) this.seed.set(settings.seed);
        if (settings.spawn !== null) this.mirrored.set(settings.spawn === 'mirror');
      }
    } catch (error) {
      this.message.set((error as Error).message);
    }
  }

  // Mounted once by the arena page; frames are sampled into the HUD at 10 Hz.
  mount(container: HTMLElement) {
    this.viewer = new ArenaViewer(container, (frame: any) => this.onFrame(frame));
    // Coming back to the panel: the replay outlives the page, the canvas does not.
    if (this.replay()) this.viewer.load(this.replay());
    return this.viewer;
  }
  unmount() {
    this.cancel();
    this.viewer?.dispose?.();
    this.viewer = null;
  }
  private onFrame(frame: any) {
    const ended = frame.ended && !this.lastFrame?.ended;
    this.lastFrame = frame;
    const now = performance.now();
    if (now - this.hudAt < 100 && !ended && frame.playing === this.hud()?.playing) return;
    this.hudAt = now;
    const replay = this.replay() ?? this.liveReplay;
    this.hud.set({
      time: frame.time,
      playing: frame.playing,
      ended: frame.ended,
      robots: frame.states.map((state: any, i: number) => ({
        name: botName(replay?.bots?.[i] ?? { model: '?' }),
        energy: state.energy,
        status: state.status,
      })),
    });
  }

  simulate() {
    if (this.worker || !this.viewer) return;
    const seed = this.validSeed();
    if (seed === null) return;
    const [a, b] = [this.bots[this.a()], this.bots[this.b()]];
    history.replaceState(null, '', matchSettingsSearch({ a: a.id, b: b.id, seed, mirrored: this.mirrored() }));
    this.status.set('simulating');
    this.progress.set(0);
    this.viewer.playing = false;
    this.start({ type: 'match', bots: [a, b], seed, mirrored: this.mirrored() });
  }
  // One robot from the keyboard: the replay grows tick by tick inside the
  // viewer while the HUD only sees the sampled frames.
  playManual() {
    if (this.worker || !this.viewer) return;
    const seed = this.validSeed();
    if (seed === null) return;
    this.status.set('live');
    this.start({ type: 'live', bot: this.bots[this.b()], seed, mirrored: this.mirrored(), player: 0, control: 'keyboard' });
    this.viewer.setFocus(0);
  }
  cancel() {
    this.worker?.postMessage({ type: 'cancel' });
    this.finish();
  }
  private validSeed() {
    const seed = this.seed();
    if (!Number.isInteger(seed) || seed < 0 || seed > SEED_MAX) {
      this.message.set(`Enter an integer seed between 0 and ${SEED_MAX}.`);
      return null;
    }
    return seed;
  }
  private start(data: object) {
    this.worker = new Worker(new URL('../../../../../packages/runtime/match-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => this.onMessage(data);
    this.worker.onerror = (e) => {
      this.message.set(e.message || 'The worker failed.');
      this.finish();
    };
    this.worker.postMessage(data);
  }
  private onMessage(data: any) {
    switch (data.type) {
      case 'progress':
        this.progress.set(data.progress);
        return;
      case 'replay':
        this.replay.set(data.replay);
        this.viewer.load(data.replay);
        this.viewer.playing = true;
        this.finish();
        return;
      case 'live-start':
        this.liveReplay = {
          specVersion: SPEC_VERSION, engineVersion: ENGINE_VERSION, mode: 'manual', seed: data.seed, mirrored: data.mirrored,
          bots: data.bots, dt: S.DT, energyMax: S.ENERGY_MAX, arenaCells: data.arenaCells, floorLoads: [],
          initialFrame: data.initialFrame, frames: new Float32Array(7200 * 12), arenaExtents: new Float32Array(7200),
          events: [], stateHashes: [], result: { winner: null, reason: 'timeout', ticks: 0 }, finalStates: [],
          violations: [0, 0], engineViolations: 0, runtime: {},
        };
        this.replay.set(null);
        this.viewer.load(this.liveReplay, { live: true });
        return;
      case 'live-tick': {
        const r = this.liveReplay;
        if (!r || data.tick > 7200) return;
        r.frames.set(data.frame, (data.tick - 1) * 12);
        r.arenaExtents[data.tick - 1] = data.extent;
        r.floorLoads.push(...data.loads);
        if (data.cells?.length) r.arenaCells.push(...data.cells);
        r.events.push(...data.events);
        r.stateHashes.push(...data.hashes);
        r.result.ticks = data.tick;
        return;
      }
      case 'live-end': {
        const r = this.liveReplay;
        this.liveReplay = null;
        Object.assign(r, data.replay);
        this.replay.set(r);
        this.viewer.live = false;
        this.viewer.playing = true;
        this.finish();
        return;
      }
      case 'live-aborted':
        this.liveReplay = null;
        this.viewer.live = false;
        this.viewer.playing = false;
        this.finish();
        return;
      case 'error':
        this.message.set(data.message);
        this.finish();
        return;
    }
  }
  private finish() {
    this.worker?.terminate();
    this.worker = null;
    this.held.clear();
    this.viewer?.setFocus(null);
    this.status.set(this.replay() ? 'ready' : 'idle');
  }

  // Keyboard: the held keys become one input message to the worker per change.
  key(code: string, down: boolean) {
    if (!this.live() || !CONTROL_KEYS[code]) return false;
    const before = this.held.size;
    down ? this.held.add(code) : this.held.delete(code);
    if (this.held.size === before && down) return true;
    const held = (action: string) => [...this.held].some((c) => CONTROL_KEYS[c] === action);
    this.worker?.postMessage({
      type: 'input',
      thrust: (held('forward') ? 1 : 0) - (held('back') ? 1 : 0),
      turn: (held('left') ? 1 : 0) - (held('right') ? 1 : 0),
    });
    return true;
  }

  // Playback: thin calls into the viewer, the frame loop stays inside it.
  toggle() { this.viewer?.toggle(); }
  seek(t: number) { this.viewer?.seek(t); }
  set speed(value: number) { if (this.viewer) this.viewer.speed = value; }
  get duration() { return this.viewer?.duration ?? 0; }
  importReplay(text: string) {
    const replay = parseReplay(text);
    this.replay.set(replay);
    this.viewer.load(replay);
    this.status.set('ready');
  }
}
