// The arena's slow state: settings, what is on the stage and how it got there.
// Match operations run in the worker; the live stream feeds the renderer directly.
import { Injectable, computed, effect, inject } from '@angular/core';
import { NgSimpleStateBaseSignalStore, NgSimpleStateStoreConfig } from 'ng-simple-state';
import { SPEC as S, SPEC_VERSION, ENGINE_VERSION, mulberry32 } from '../../../../../packages/sim/spec.js';
import { stringifyReplay, parseReplay } from '../../../../../packages/sim/replay.js';
import { digest } from '../../../../../packages/sim/index.js';
import { botName } from '../../../../../packages/bot-catalog.js';
import { readMatchSettings, matchSettingsSearch } from '../../../../../packages/viewer/match-link.js';
import {
  SHA_PREFIX, challengeFromReplay, encodeChallenge, decodeChallenge, readChallenge, challengeFragment,
} from '../../../../../packages/viewer/challenge-link.js';
import { matchOutcome } from '../../../../../packages/renderer/recorder.js';
import { track } from '../../../../../packages/viewer/analytics.js';
import type { Replay } from '../../../../../packages/renderer/arena.js';
import { BotsStore, type Bot } from '../core/bots.store';
import { WorkerService } from '../core/worker.service';
import { ToastService } from '../core/toast.service';
import { ViewerService } from './viewer.service';
import { updateUrl, download, siteUrl } from '../core/url';

export interface ArenaState {
  a: number;
  b: number;
  seed: number;
  mirrored: boolean;
  loading: { title: string; detail: string; progress: number | null; cancel: boolean } | null;
  live: boolean;
  replay: Replay | null;
  // The replay rebuilt from a challenge link, and the settings to beat it.
  challengeReplay: Replay | null;
  challengeSettings: { seed: number; mirrored: boolean; bot: number } | null;
  library: string[];
}
const SEED_MAX = 4294967295;
const LIVE_PLAYER = 0;
const CONTROL_KEYS: Record<string, string> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  'touch:forward': 'forward', 'touch:back': 'back', 'touch:left': 'left', 'touch:right': 'right',
};
export const coarsePointer = () => matchMedia('(pointer: coarse)').matches;

@Injectable({ providedIn: 'root' })
export class ArenaStore extends NgSimpleStateBaseSignalStore<ArenaState> {
  private readonly bots = inject(BotsStore);
  private readonly worker = inject(WorkerService);
  private readonly toast = inject(ToastService);
  private readonly viewer = inject(ViewerService);
  readonly a = this.selectState((s) => s.a);
  readonly b = this.selectState((s) => s.b);
  readonly seed = this.selectState((s) => s.seed);
  readonly mirrored = this.selectState((s) => s.mirrored);
  readonly loading = this.selectState((s) => s.loading);
  readonly live = this.selectState((s) => s.live);
  readonly replay = this.selectState((s) => s.replay);
  readonly challengeReplay = this.selectState((s) => s.challengeReplay);
  readonly library = this.selectState((s) => s.library);
  readonly busy = computed(() => this.worker.operation() !== null);
  readonly mode = computed(() => {
    const r = this.replay();
    return !r ? '' : r.mode === 'one-shot' ? 'One-shot benchmark' : r.mode === 'iterative' ? 'Iterative benchmark'
      : r.mode === 'manual' ? 'Manual duel' : r.mode === 'rumble' ? 'Royal rumble' : 'Local exhibition';
  });
  readonly modeNote = computed(() => {
    const r = this.replay();
    if (!r) return 'Exhibitions use a deterministic budget. Controller provenance is recorded in each replay.';
    if (this.live()) return 'You drive one robot in real time. Your inputs are logged with the replay, so it can be reproduced and shared.';
    return r.mode === 'manual'
      ? 'A human drove one robot in real time. The logged inputs reproduce the match from its seed; it is never ranked.'
      : `${r.runtime?.['budgetMode'] === 'wall' ? '2 ms wall-clock budget.' : 'Deterministic instruction budget.'} ${r.mode === 'exhibition' ? 'Exhibition of the selected controllers. Provenance is recorded in exported metadata.' : 'See exported metadata for provenance.'}`;
  });
  private liveReplay: any = null;
  private previousReplay: Replay | null = null;
  private readonly held = new Set<string>();
  private armed = false;
  private pendingOpening = false;

  constructor() {
    super();
    // The opening match could not start while another operation (a gate, a
    // tournament) held the worker: it starts as soon as the worker is free.
    effect(() => {
      if (this.worker.operation() === null && this.pendingOpening) {
        this.pendingOpening = false;
        this.simulate();
      }
    });
  }

  storeConfig(): NgSimpleStateStoreConfig<ArenaState> {
    return { storeName: 'arena' };
  }
  initialState(): ArenaState {
    return {
      a: 0, b: 1, seed: 0, mirrored: false, loading: { title: 'Preparing replay', detail: 'Simulation comes before every frame.', progress: 0, cancel: false },
      live: false, replay: null, challengeReplay: null, challengeSettings: null, library: [],
    };
  }

  // The opening match waits for the arena: a visitor who followed a link to
  // the rules should not pay for a simulation they are not looking at.
  arm() {
    if (this.armed || this.replay()) return;
    this.armed = true;
    const challenge = readChallenge(location.hash);
    const requested = new URLSearchParams(location.search).get('replay');
    if (challenge) this.openChallenge(challenge);
    else if (requested) this.loadReplayUrl(requested).catch((e) => this.toast.show(e.message + ' You can simulate a new match.', true));
    else {
      this.applyMatchSettings();
      if (this.worker.busy) this.pendingOpening = true;
      else this.simulate();
    }
  }
  applyMatchSettings() {
    try {
      const settings = readMatchSettings(location.search, this.bots.bots());
      if (!settings) return;
      this.setState({
        ...(settings.a !== null ? { a: settings.a } : {}),
        ...(settings.b !== null ? { b: settings.b } : {}),
        ...(settings.seed !== null ? { seed: settings.seed } : {}),
        ...(settings.spawn !== null ? { mirrored: settings.spawn === 'mirror' } : {}),
      });
    } catch (error) {
      this.toast.show((error as Error).message + ' Default settings are used.', true);
    }
  }
  private validSeed() {
    const seed = this.seed();
    if (!Number.isInteger(seed) || seed < 0 || seed > SEED_MAX) {
      this.toast.show('Enter an integer seed between 0 and 4294967295.', true);
      return null;
    }
    return seed;
  }
  private begin(title: string, detail: string, cancel: boolean) {
    this.viewer.interrupt();
    if (this.viewer.viewer) this.viewer.viewer.playing = false;
    this.setState({ loading: { title, detail, progress: 0, cancel } });
  }
  private fail(message: string) {
    this.toast.show(message, true);
    this.setState({ loading: this.replay() ? null : { title: 'Match abandoned', detail: 'Simulate a match or start another manual duel.', progress: null, cancel: false } });
  }

  simulate() {
    if (this.worker.busy) return this.toast.show('Wait for the current operation or cancel it.');
    const seed = this.validSeed();
    if (seed === null) return;
    const bots = this.bots.bots(), a = this.a(), b = this.b(), mirrored = this.mirrored();
    this.begin('Computing match', 'Starting the two isolated controllers…', true);
    // Only registered controllers can be reloaded from a link; local ones exist in this tab alone.
    updateUrl({ search: this.bots.isRegistered(a) && this.bots.isRegistered(b) ? matchSettingsSearch({ a: bots[a].id, b: bots[b].id, seed, mirrored }) : '' });
    this.worker.start('match', { bots: [bots[a], bots[b]], seed, mirrored }, {
      onMessage: (data) => {
        if (data.type === 'progress') this.progress(data.progress, `Simulation ${Math.round(data.progress * 100)}% · ${clockOf(data.progress * 120)} / 02:00`);
        if (data.type === 'replay') {
          this.loadReplay(data.replay, true);
          this.toast.show('Match computed. The replay is ready.');
        }
      },
      onError: (message) => this.fail(message),
    });
  }
  // Everyone at once. The arena holds twelve: a larger roster is drawn by the seed.
  rumble() {
    if (this.worker.busy) return this.toast.show('Wait for the current operation or cancel it.');
    const seed = this.validSeed();
    if (seed === null) return;
    const bots = this.bots.bots();
    if (bots.length < 3) return this.toast.show('A rumble needs at least three controllers.', true);
    const roster = bots.length > 12 ? drawRoster(bots, 12, seed) : bots;
    this.begin('Computing rumble', `Starting ${roster.length} isolated controllers…`, true);
    updateUrl({});
    if (roster !== bots) this.toast.show(`${bots.length} controllers: seed ${seed} draws ${roster.length} of them.`);
    this.worker.start('match', { bots: roster, seed, mode: 'rumble' }, {
      onMessage: (data) => {
        if (data.type === 'progress') this.progress(data.progress, `Simulation ${Math.round(data.progress * 100)}% · ${clockOf(data.progress * 120)} / 02:00`);
        if (data.type === 'replay') {
          this.loadReplay(data.replay, true);
          this.toast.show('Match computed. The replay is ready.');
        }
      },
      onError: (message) => this.fail(message),
    });
  }
  private progress(progress: number, detail: string) {
    const loading = this.loading();
    if (loading) this.setState({ loading: { ...loading, progress, detail } });
  }
  cancel() {
    if (this.viewer.clipRunning) return this.viewer.cancelClip();
    if (this.worker.cancel()) this.toast.show('Operation canceled.');
  }

  // Manual duel: the keyboard drives robot A, the selected controller drives B.
  playManual() {
    if (this.worker.busy) return this.toast.show('Wait for the current operation or cancel it.');
    const seed = this.validSeed();
    if (seed === null) return;
    const bot = this.bots.bots()[this.b()];
    this.previousReplay = this.live() ? this.previousReplay : this.replay();
    this.begin('Starting manual match', 'Loading the opposing controller…', false);
    updateUrl({});
    const started = this.worker.start('live', { bot, seed, mirrored: this.mirrored(), player: LIVE_PLAYER, control: coarsePointer() ? 'touch' : 'keyboard' }, {
      onMessage: (data) => {
        if (data.type === 'live-start') this.beginLiveMatch(data);
        if (data.type === 'live-tick') this.appendLiveTick(data);
        if (data.type === 'live-end') this.finishLiveMatch(data.replay);
        if (data.type === 'live-aborted') this.abortLiveMatch();
      },
      onError: (message) => {
        this.toast.show(message, true);
        this.abortLiveMatch();
      },
      onFinish: () => {
        if (this.liveReplay) this.abortLiveMatch();
        this.setLive(false);
      },
    });
    if (started) {
      this.setLive(true);
      track('play-started', botName(bot));
    }
  }
  private setLive(active: boolean) {
    this.setState({ live: active });
    this.viewer.viewer?.setFocus(active ? LIVE_PLAYER : null);
    if (!active) this.held.clear();
  }
  // The replay grows tick by tick while the match is played, so the renderer
  // and the cards keep using the ordinary replay format.
  private beginLiveMatch(data: any) {
    this.liveReplay = {
      specVersion: SPEC_VERSION, engineVersion: ENGINE_VERSION, mode: 'manual', seed: data.seed, mirrored: data.mirrored,
      bots: data.bots, dt: S.DT, energyMax: S.ENERGY_MAX, arenaCells: data.arenaCells, floorLoads: [],
      initialFrame: data.initialFrame, frames: new Float32Array(7200 * 12), arenaExtents: new Float32Array(7200),
      events: [], stateHashes: [], result: { winner: null, reason: 'timeout', ticks: 0 }, finalStates: [],
      violations: [0, 0], engineViolations: 0, runtime: {},
    };
    this.setState({ replay: this.liveReplay, loading: null, challengeReplay: null });
    this.viewer.load(this.liveReplay, { live: true });
    this.viewer.viewer?.setFocus(LIVE_PLAYER);
  }
  private appendLiveTick(data: any) {
    const r = this.liveReplay;
    if (!r || data.tick > 7200) return;
    r.frames.set(data.frame, (data.tick - 1) * 12);
    r.arenaExtents[data.tick - 1] = data.extent;
    r.floorLoads.push(...data.loads);
    if (data.cells?.length) r.arenaCells.push(...data.cells);
    r.events.push(...data.events);
    r.stateHashes.push(...data.hashes);
    r.result.ticks = data.tick;
  }
  private finishLiveMatch(final: Replay) {
    const r = this.liveReplay;
    this.liveReplay = null;
    if (!r) return this.loadReplay(final, true);
    // Keep the object the renderer is already playing: the closing frames and
    // the fall animation continue without a reload.
    Object.assign(r, final);
    if (this.viewer.viewer) {
      this.viewer.viewer.live = false;
      this.viewer.viewer.playing = true;
    }
    this.setState({ replay: { ...r }, live: false });
    this.setLive(false);
    track('play-finished', `${matchOutcome(r).title} ${botName(r.bots[1 - LIVE_PLAYER])}`);
    // The address bar becomes the challenge link as soon as the match is over.
    if (this.shareable(r))
      encodeChallenge(challengeFromReplay(r)).then((encoded) => {
        if (this.replay()?.stateHashes === r.stateHashes) updateUrl({ hash: challengeFragment(encoded) });
      });
  }
  private abortLiveMatch() {
    this.liveReplay = null;
    if (this.viewer.viewer) {
      this.viewer.viewer.live = false;
      this.viewer.viewer.playing = false;
    }
    if (this.previousReplay) return this.loadReplay(this.previousReplay);
    this.setState({ replay: null, loading: { title: 'Match abandoned', detail: 'Simulate a match or start another manual duel.', progress: null, cancel: false } });
  }
  leaveLive() {
    if (this.worker.cancel()) this.toast.show('Manual match left.');
  }
  // Keys and touch buttons feed one held set; every change is one input message.
  key(code: string, down: boolean) {
    if (!this.live() || !CONTROL_KEYS[code]) return false;
    const size = this.held.size;
    down ? this.held.add(code) : this.held.delete(code);
    if (this.held.size !== size) this.sendInput();
    return true;
  }
  releaseAll() {
    if (!this.held.size) return;
    this.held.clear();
    this.sendInput();
  }
  private sendInput() {
    const held = (action: string) => [...this.held].some((c) => CONTROL_KEYS[c] === action);
    this.worker.post({ type: 'input', thrust: (held('forward') ? 1 : 0) - (held('back') ? 1 : 0), turn: (held('left') ? 1 : 0) - (held('right') ? 1 : 0) });
  }

  loadReplay(replay: Replay, autoplay = false) {
    this.setState({ replay, loading: this.viewer.available() ? null : { title: 'Replay ready. 3D graphics unavailable.', detail: 'Export the replay or open it in a browser with WebGL 2.', progress: null, cancel: false } });
    this.viewer.load(replay, { autoplay });
  }
  async loadReplayUrl(path: string) {
    const url = new URL(siteUrl(path));
    if (url.origin !== location.origin) throw Error('The replay must be hosted on the same server.');
    const response = await fetch(url);
    if (!response.ok) throw Error('Replay unavailable.');
    const replay = parseReplay(await response.text());
    this.loadReplay(replay);
    this.setState({ loading: null });
    return replay;
  }
  async openLibrary(name: string) {
    const path = './replays/' + encodeURIComponent(name);
    try {
      await this.loadReplayUrl(path);
      updateUrl({ search: '?' + new URLSearchParams({ replay: path }) });
    } catch (error) {
      this.toast.show((error as Error).message, true);
    }
  }
  async importFile(file: File) {
    try {
      if (file.size > 20 * 1024 * 1024) throw Error('Replay is too large (20 MB maximum).');
      this.loadReplay(parseReplay(await file.text()));
      this.toast.show('Replay imported. Press play.');
    } catch (error) {
      this.toast.show((error as Error).message, true);
    }
  }
  exportReplay() {
    const replay = this.replay();
    if (replay) download(`llms-robot-arena-${replay.seed}.json`, stringifyReplay(replay));
  }
  // Same pairing, new draw: the seed decides spawn jitter and terrain layout.
  randomMatch() {
    const replay = this.replay();
    const manual = replay?.mode === 'manual', rumble = replay?.mode === 'rumble';
    const bots = this.bots.bots();
    const indexes = (replay?.bots ?? []).map((b) => bots.findIndex((c) => c.id === b.id));
    const patch: Partial<ArenaState> = { seed: Math.floor(Math.random() * 4294967296), mirrored: Math.random() < 0.5 };
    if (manual) {
      if (indexes[1] >= 0) patch.b = indexes[1];
    } else if (indexes.length === 2 && indexes.every((i) => i >= 0)) {
      patch.a = indexes[0];
      patch.b = indexes[1];
    }
    this.setState(patch);
    if (manual) this.playManual();
    else if (rumble) this.rumble();
    else this.simulate();
  }

  // A manual duel against a registered controller, with its inputs logged.
  shareable(r: Replay | null) {
    if (r?.mode !== 'manual' || !r.inputs || r.bots.length !== 2) return false;
    const opponent = r.bots[1 - r.bots.findIndex((bot) => bot.id === 'human')];
    return this.bots.builtins.some((b) => b.id === opponent?.id);
  }
  async copyChallenge() {
    const replay = this.replay();
    if (!replay || !this.shareable(replay)) return;
    const url = new URL(location.href);
    url.search = '';
    url.hash = challengeFragment(await encodeChallenge(challengeFromReplay(replay)));
    history.replaceState(null, '', url);
    track('challenge-copied');
    try {
      await navigator.clipboard.writeText(url.href);
      this.toast.show('Challenge link copied. Paste it anywhere.');
    } catch {
      this.toast.show('The challenge link is in the address bar: copy it from there.', true);
    }
  }
  beatChallenge() {
    const settings = this.getCurrentState().challengeSettings;
    if (!settings) return;
    this.setState({ seed: settings.seed, mirrored: settings.mirrored, b: settings.bot });
    track('challenge-beat');
    this.playManual();
  }
  // A link with `#m=` rebuilds the match it describes before anything else.
  async openChallenge(text: string) {
    const failed = (message: string, reason: string) => {
      track('challenge-opened', reason);
      this.setState({ loading: null });
      this.toast.show(message, true);
    };
    let c;
    try {
      c = await decodeChallenge(text);
    } catch (error) {
      return failed((error as Error).message + ' You can simulate a new match.', 'damaged');
    }
    const index = this.bots.builtins.findIndex((b) => b.id === c.botId);
    const bot = this.bots.builtins[index];
    if (!bot) return failed(`This challenge was played against "${c.botId}", a controller this arena does not have.`, 'unknown bot');
    this.setState({ seed: c.seed, mirrored: c.mirrored, b: index, challengeSettings: { seed: c.seed, mirrored: c.mirrored, bot: index } });
    const playable = ` You can still play the same seed against ${botName(bot)}: press "Play yourself vs Robot B".`;
    if (c.engineVersion !== ENGINE_VERSION)
      return failed(`This challenge was recorded with engine ${c.engineVersion}; this arena runs ${ENGINE_VERSION}, so the replay cannot be rebuilt.` + playable, 'engine mismatch');
    if (digest(bot.source).slice(0, SHA_PREFIX) !== c.sha)
      return failed(`${botName(bot)} was updated after this match was played, so the replay cannot be rebuilt.` + playable, 'controller updated');
    track('challenge-opened', 'ok');
    this.begin('Rebuilding the challenge', `Replaying the logged inputs against ${botName(bot)}…`, true);
    const inputs: any[] = [];
    inputs[c.player] = c.inputs;
    this.worker.start('resimulate', { bot, seed: c.seed, mirrored: c.mirrored, player: c.player, inputs }, {
      onMessage: (data) => {
        if (data.type === 'progress') this.progress(data.progress, `Simulation ${Math.round(data.progress * 100)}% · ${clockOf(data.progress * 120)} / 02:00`);
        if (data.type === 'replay') {
          this.loadReplay(data.replay, true);
          this.setState({ challengeReplay: data.replay });
          this.toast.show('Challenge rebuilt from its input log. Beat it after the replay.');
        }
      },
      onError: (message) => this.fail(message),
    });
  }
  async loadLibrary(url: string) {
    const names = await fetch(url).then((r) => (r.ok ? r.json() : []), () => []);
    if (Array.isArray(names)) this.setState({ library: names.filter((n) => typeof n === 'string') });
  }
}

const clockOf = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function drawRoster<T>(list: readonly T[], count: number, seed: number) {
  const order = [...list], random = mulberry32(seed ^ 0x72756d62);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, count);
}
export type { Bot };
