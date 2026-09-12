import { Service, computed, effect, inject, signal } from '@angular/core';
import { NgSimpleStateBaseSignalStore, type NgSimpleStateStoreConfig } from 'ng-simple-state';
import {
  ENGINE_VERSION,
  SPEC as S,
  SPEC_VERSION,
  mulberry32,
} from '../../../../../packages/sim/spec.js';
import { parseReplay, stringifyReplay, type Replay } from '../../../../../packages/sim/replay.js';
import { digest } from '../../../../../packages/sim/index.js';
import { botName } from '../../../../../packages/bot-catalog.js';
import {
  matchSettingsSearch,
  readMatchSettings,
} from '../../../../../packages/viewer/match-link.js';
import {
  SHA_PREFIX,
  challengeFragment,
  challengeFromReplay,
  decodeChallenge,
  encodeChallenge,
  readChallenge,
  type Challenge,
} from '../../../../../packages/viewer/challenge-link.js';
import { matchOutcome } from '../../../../../packages/renderer/recorder.js';
import { track } from '../../../../../packages/viewer/analytics.js';
import { BotsStore, type Bot } from '../core/bots.store';
import { WorkerService } from '../core/worker.service';
import { ToastService } from '../core/toast.service';
import { type LiveStartMessage, type LiveTickMessage, type WorkerMessage } from '../core/messages';
import { ViewerService } from './viewer.service';
import { clock, download, siteUrl, updateUrl } from '../core/url';

export interface Loading {
  title: string;
  detail: string;
  progress: number | null;
  cancel: boolean;
}
export interface ArenaState {
  a: number;
  b: number;
  seed: number;
  mirrored: boolean;
  loading: Loading | null;
  live: boolean;
  // The settings to beat the challenge rebuilt from a link.
  challengeSettings: { seed: number; mirrored: boolean; bot: number } | null;
  library: string[];
}
// A live replay grows in place: its arrays are the ones the renderer reads.
interface LiveReplay extends Replay {
  floorLoads: number[];
}
const SEED_MAX = 4294967295;
const LIVE_PLAYER = 0;
const CONTROL_KEYS: Record<string, string> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  'touch:forward': 'forward',
  'touch:back': 'back',
  'touch:left': 'left',
  'touch:right': 'right',
};
const ABANDONED: Loading = {
  title: 'Match abandoned',
  detail: 'Simulate a match or start another manual duel.',
  progress: null,
  cancel: false,
};
/** True on a touch device, where the manual duel shows its buttons. */
export const coarsePointer = (): boolean => matchMedia('(pointer: coarse)').matches;
/** The progress line of a simulation. */
const simulationDetail = (progress: number): string =>
  `Simulation ${String(Math.round(progress * 100))}% · ${clock(progress * 120)} / 02:00`;

/**
 * The arena's slow state: settings, what is on the stage and how it got there.
 * Match operations run in the worker; the live stream feeds the renderer directly.
 */
@Service()
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
  // Replays live outside the store state: their frames are typed arrays,
  // which the dev-mode deep freeze of the state cannot handle, and the live
  // one grows in place while the renderer reads it.
  readonly replay = signal<Replay | null>(null);
  readonly challengeReplay = signal<Replay | null>(null);
  readonly library = this.selectState((s) => s.library);
  readonly busy = computed(() => this.worker.operation() !== null);
  readonly mode = computed(() => {
    const r = this.replay();
    if (!r) return '';
    switch (r.mode) {
      case 'one-shot':
        return 'One-shot benchmark';
      case 'iterative':
        return 'Iterative benchmark';
      case 'manual':
        return 'Manual duel';
      case 'rumble':
        return 'Royal rumble';
      default:
        return 'Local exhibition';
    }
  });
  readonly modeNote = computed(() => {
    const r = this.replay();
    if (!r)
      return 'Exhibitions use a deterministic budget. Controller provenance is recorded in each replay.';
    if (this.live())
      return 'You drive one robot in real time. Your inputs are logged with the replay, so it can be reproduced and shared.';
    if (r.mode === 'manual')
      return 'A human drove one robot in real time. The logged inputs reproduce the match from its seed; it is never ranked.';
    const budget =
      r.runtime?.['budgetMode'] === 'wall'
        ? '2 ms wall-clock budget.'
        : 'Deterministic instruction budget.';
    const provenance =
      r.mode === 'exhibition'
        ? 'Exhibition of the selected controllers. Provenance is recorded in exported metadata.'
        : 'See exported metadata for provenance.';
    return `${budget} ${provenance}`;
  });
  private liveReplay: LiveReplay | null = null;
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

  /** Store name for the devtools. */
  storeConfig(): NgSimpleStateStoreConfig<ArenaState> {
    return { storeName: 'arena' };
  }
  /** Called by the base constructor, before the injected fields exist. */
  initialState(): ArenaState {
    return {
      a: 0,
      b: 1,
      seed: 0,
      mirrored: false,
      loading: {
        title: 'Preparing replay',
        detail: 'Simulation comes before every frame.',
        progress: 0,
        cancel: false,
      },
      live: false,
      challengeSettings: null,
      library: [],
    };
  }

  /**
   * The opening match waits for the arena: a visitor who followed a link to
   * the rules should not pay for a simulation they are not looking at.
   */
  arm(): void {
    if (this.armed || this.replay()) return;
    this.armed = true;
    const challenge = readChallenge(location.hash);
    const requested = new URLSearchParams(location.search).get('replay');
    if (challenge) void this.openChallenge(challenge);
    else if (requested)
      this.loadReplayUrl(requested).catch((e: unknown) => {
        this.toast.show((e as Error).message + ' You can simulate a new match.', true);
      });
    else {
      this.applyMatchSettings();
      if (this.worker.busy) this.pendingOpening = true;
      else this.simulate();
    }
  }
  /** Reads the controllers, seed and spawn from the query string. */
  applyMatchSettings(): void {
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
  /** The seed field as an integer, or null with a toast. */
  private validSeed(): number | null {
    const seed = this.seed();
    if (!Number.isInteger(seed) || seed < 0 || seed > SEED_MAX) {
      this.toast.show('Enter an integer seed between 0 and 4294967295.', true);
      return null;
    }
    return seed;
  }
  /** Stops what is on the stage and shows the loading card. */
  private begin(title: string, detail: string, cancel: boolean): void {
    this.viewer.interrupt();
    if (this.viewer.viewer) this.viewer.viewer.playing = false;
    this.setState({ loading: { title, detail, progress: 0, cancel } });
  }
  /** Reports a failed operation; the previous replay stays if there was one. */
  private fail(message: string): void {
    this.toast.show(message, true);
    this.setState({ loading: this.replay() ? null : ABANDONED });
  }
  /** Updates the loading card. */
  private progress(progress: number, detail: string): void {
    const loading = this.loading();
    if (loading) this.setState({ loading: { ...loading, progress, detail } });
  }
  /** A simulation: the replay arrives whole when the worker is done. */
  private simulated(data: WorkerMessage): void {
    if (data.type === 'progress') this.progress(data.progress, simulationDetail(data.progress));
    if (data.type === 'replay') {
      this.loadReplay(data.replay, true);
      this.toast.show('Match computed. The replay is ready.');
    }
  }
  /** The two selected controllers, or null with a toast. */
  private pair(): [Bot, Bot] | null {
    const bots = this.bots.bots();
    const a = bots[this.a()],
      b = bots[this.b()];
    if (!a || !b) {
      this.toast.show('Select two controllers.', true);
      return null;
    }
    return [a, b];
  }

  /** Simulates the selected pair with the seed and spawn settings. */
  simulate(): void {
    if (this.worker.busy) {
      this.toast.show('Wait for the current operation or cancel it.');
      return;
    }
    const seed = this.validSeed(),
      pair = this.pair();
    if (seed === null || !pair) return;
    const [a, b] = pair,
      mirrored = this.mirrored();
    this.begin('Computing match', 'Starting the two isolated controllers…', true);
    // Only registered controllers can be reloaded from a link; local ones exist in this tab alone.
    const registered = this.bots.isRegistered(this.a()) && this.bots.isRegistered(this.b());
    updateUrl({
      search: registered ? matchSettingsSearch({ a: a.id, b: b.id, seed, mirrored }) : '',
    });
    this.worker.start(
      'match',
      { bots: [a, b], seed, mirrored },
      {
        onMessage: (data) => {
          this.simulated(data);
        },
        onError: (message) => {
          this.fail(message);
        },
      },
    );
  }
  /** Everyone at once. The arena holds twelve: a larger roster is drawn by the seed. */
  rumble(): void {
    if (this.worker.busy) {
      this.toast.show('Wait for the current operation or cancel it.');
      return;
    }
    const seed = this.validSeed();
    if (seed === null) return;
    const bots = this.bots.bots();
    if (bots.length < 3) {
      this.toast.show('A rumble needs at least three controllers.', true);
      return;
    }
    const roster = bots.length > 12 ? drawRoster(bots, 12, seed) : bots;
    this.begin('Computing rumble', `Starting ${String(roster.length)} isolated controllers…`, true);
    updateUrl({});
    if (roster !== bots)
      this.toast.show(
        `${String(bots.length)} controllers: seed ${String(seed)} draws ${String(roster.length)} of them.`,
      );
    this.worker.start(
      'match',
      { bots: roster, seed, mode: 'rumble' },
      {
        onMessage: (data) => {
          this.simulated(data);
        },
        onError: (message) => {
          this.fail(message);
        },
      },
    );
  }
  /** Stops the clip being rendered, or else the worker operation. */
  cancel(): void {
    if (this.viewer.clipRunning) {
      this.viewer.cancelClip();
      return;
    }
    if (this.worker.cancel()) this.toast.show('Operation canceled.');
  }

  /** Manual duel: the keyboard drives robot A, the selected controller drives B. */
  playManual(): void {
    if (this.worker.busy) {
      this.toast.show('Wait for the current operation or cancel it.');
      return;
    }
    const seed = this.validSeed();
    const bot = this.bots.bots()[this.b()];
    if (seed === null || !bot) return;
    this.previousReplay = this.live() ? this.previousReplay : this.replay();
    this.begin('Starting manual match', 'Loading the opposing controller…', false);
    updateUrl({});
    const control = coarsePointer() ? 'touch' : 'keyboard';
    const started = this.worker.start(
      'live',
      { bot, seed, mirrored: this.mirrored(), player: LIVE_PLAYER, control },
      {
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
      },
    );
    if (started) {
      this.setLive(true);
      track('play-started', botName(bot));
    }
  }
  /** Enters or leaves live mode: camera focus on the human, held keys cleared. */
  private setLive(active: boolean): void {
    this.setState({ live: active });
    this.viewer.viewer?.setFocus(active ? LIVE_PLAYER : null);
    if (!active) this.held.clear();
  }
  /**
   * The replay grows tick by tick while the match is played, so the renderer
   * and the cards keep using the ordinary replay format.
   */
  private beginLiveMatch(data: LiveStartMessage): void {
    this.liveReplay = {
      specVersion: SPEC_VERSION,
      engineVersion: ENGINE_VERSION,
      mode: 'manual',
      seed: data.seed,
      mirrored: data.mirrored,
      bots: data.bots,
      dt: S.DT,
      energyMax: S.ENERGY_MAX,
      arenaCells: data.arenaCells,
      floorLoads: [],
      initialFrame: data.initialFrame,
      frames: new Float32Array(7200 * 12),
      arenaExtents: new Float32Array(7200),
      events: [],
      stateHashes: [],
      result: { winner: null, reason: 'timeout', ticks: 0 },
      finalStates: [],
      violations: [0, 0],
      engineViolations: 0,
      runtime: {},
    };
    this.replay.set(this.liveReplay);
    this.challengeReplay.set(null);
    this.setState({ loading: null });
    this.viewer.load(this.liveReplay, { live: true });
    this.viewer.viewer?.setFocus(LIVE_PLAYER);
  }
  /** Writes one live tick into the growing replay. */
  private appendLiveTick(data: LiveTickMessage): void {
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
  /** Closes the live replay with the final result and offers the challenge link. */
  private finishLiveMatch(final: Replay): void {
    const r = this.liveReplay;
    this.liveReplay = null;
    if (!r) {
      this.loadReplay(final, true);
      return;
    }
    // Keep the object the renderer is already playing: the closing frames and
    // the fall animation continue without a reload.
    Object.assign(r, final);
    if (this.viewer.viewer) {
      this.viewer.viewer.live = false;
      this.viewer.viewer.playing = true;
    }
    this.replay.set({ ...r });
    this.setState({ live: false });
    this.setLive(false);
    const opponent = r.bots[1 - LIVE_PLAYER];
    track('play-finished', `${matchOutcome(r).title} ${opponent ? botName(opponent) : ''}`);
    // The address bar becomes the challenge link as soon as the match is over.
    if (this.shareable(r))
      void encodeChallenge(challengeFromReplay(r)).then((encoded) => {
        if (this.replay()?.stateHashes === r.stateHashes)
          updateUrl({ hash: challengeFragment(encoded) });
      });
  }
  /** Drops a live match that did not end; the previous replay comes back. */
  private abortLiveMatch(): void {
    this.liveReplay = null;
    if (this.viewer.viewer) {
      this.viewer.viewer.live = false;
      this.viewer.viewer.playing = false;
    }
    if (this.previousReplay) {
      this.loadReplay(this.previousReplay);
      return;
    }
    this.replay.set(null);
    this.setState({ loading: ABANDONED });
  }
  /** The human gives up the manual duel. */
  leaveLive(): void {
    if (this.worker.cancel()) this.toast.show('Manual match left.');
  }
  /** Keys and touch buttons feed one held set; every change is one input message. */
  key(code: string, down: boolean): boolean {
    if (!this.live() || !(code in CONTROL_KEYS)) return false;
    const size = this.held.size;
    if (down) this.held.add(code);
    else this.held.delete(code);
    if (this.held.size !== size) this.sendInput();
    return true;
  }
  /** Lets go of every control, like when the window loses focus. */
  releaseAll(): void {
    if (!this.held.size) return;
    this.held.clear();
    this.sendInput();
  }
  /** Sends the thrust and turn of the held controls to the live match. */
  private sendInput(): void {
    const held = (action: string) => [...this.held].some((c) => CONTROL_KEYS[c] === action);
    this.worker.post({
      type: 'input',
      thrust: (held('forward') ? 1 : 0) - (held('back') ? 1 : 0),
      turn: (held('left') ? 1 : 0) - (held('right') ? 1 : 0),
    });
  }

  /** Puts a replay on the stage. */
  loadReplay(replay: Replay, autoplay = false): void {
    this.replay.set(replay);
    this.setState({
      loading: this.viewer.available()
        ? null
        : {
            title: 'Replay ready. 3D graphics unavailable.',
            detail: 'Export the replay or open it in a browser with WebGL 2.',
            progress: null,
            cancel: false,
          },
    });
    this.viewer.load(replay, { autoplay });
  }
  /** Fetches a replay hosted with the site and puts it on the stage. */
  async loadReplayUrl(path: string): Promise<Replay> {
    const url = new URL(siteUrl(path));
    if (url.origin !== location.origin)
      throw new Error('The replay must be hosted on the same server.');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Replay unavailable.');
    const replay = parseReplay(await response.text());
    this.loadReplay(replay);
    this.setState({ loading: null });
    return replay;
  }
  /** Opens a replay from the library and records it in the address. */
  async openLibrary(name: string): Promise<void> {
    const path = './replays/' + encodeURIComponent(name);
    try {
      await this.loadReplayUrl(path);
      updateUrl({ search: '?' + new URLSearchParams({ replay: path }).toString() });
    } catch (error) {
      this.toast.show((error as Error).message, true);
    }
  }
  /** Loads a replay file chosen by the visitor. */
  async importFile(file: File): Promise<void> {
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Replay is too large (20 MB maximum).');
      this.loadReplay(parseReplay(await file.text()));
      this.toast.show('Replay imported. Press play.');
    } catch (error) {
      this.toast.show((error as Error).message, true);
    }
  }
  /** Downloads the replay on the stage as JSON. */
  exportReplay(): void {
    const replay = this.replay();
    if (replay) download(`llms-robot-arena-${String(replay.seed)}.json`, stringifyReplay(replay));
  }
  /** Same pairing, new draw: the seed decides spawn jitter and terrain layout. */
  randomMatch(): void {
    const replay = this.replay();
    const manual = replay?.mode === 'manual',
      rumble = replay?.mode === 'rumble';
    const bots = this.bots.bots();
    const indexes = (replay?.bots ?? []).map((b) => bots.findIndex((c) => c.id === b.id));
    const patch: Partial<ArenaState> = {
      seed: Math.floor(Math.random() * 4294967296),
      mirrored: Math.random() < 0.5,
    };
    const [first, second] = indexes;
    if (manual) {
      if (second !== undefined && second >= 0) patch.b = second;
    } else if (
      indexes.length === 2 &&
      first !== undefined &&
      second !== undefined &&
      first >= 0 &&
      second >= 0
    ) {
      patch.a = first;
      patch.b = second;
    }
    this.setState(patch);
    if (manual) this.playManual();
    else if (rumble) this.rumble();
    else this.simulate();
  }

  /** A manual duel against a registered controller, with its inputs logged. */
  shareable(r: Replay | null): boolean {
    if (r?.mode !== 'manual' || !r.inputs || r.bots.length !== 2) return false;
    const opponent = r.bots[1 - r.bots.findIndex((bot) => bot.id === 'human')];
    return this.bots.builtins.some((b) => b.id === opponent?.id);
  }
  /** Puts the challenge link in the address bar and on the clipboard. */
  async copyChallenge(): Promise<void> {
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
  /** Plays the same seed against the same controller as the open challenge. */
  beatChallenge(): void {
    const settings = this.getCurrentState().challengeSettings;
    if (!settings) return;
    this.setState({ seed: settings.seed, mirrored: settings.mirrored, b: settings.bot });
    track('challenge-beat');
    this.playManual();
  }
  /** A link with `#m=` rebuilds the match it describes before anything else. */
  async openChallenge(text: string): Promise<void> {
    const failed = (message: string, reason: string) => {
      track('challenge-opened', reason);
      this.setState({ loading: null });
      this.toast.show(message, true);
    };
    let c: Challenge;
    try {
      c = await decodeChallenge(text);
    } catch (error) {
      failed((error as Error).message + ' You can simulate a new match.', 'damaged');
      return;
    }
    const index = this.bots.builtins.findIndex((b) => b.id === c.botId);
    const bot = this.bots.builtins[index];
    if (!bot) {
      failed(
        `This challenge was played against "${c.botId}", a controller this arena does not have.`,
        'unknown bot',
      );
      return;
    }
    this.setState({
      seed: c.seed,
      mirrored: c.mirrored,
      b: index,
      challengeSettings: { seed: c.seed, mirrored: c.mirrored, bot: index },
    });
    const playable = ` You can still play the same seed against ${botName(bot)}: press "Play yourself vs Robot B".`;
    if (c.engineVersion !== ENGINE_VERSION) {
      failed(
        `This challenge was recorded with engine ${c.engineVersion}; this arena runs ${ENGINE_VERSION}, so the replay cannot be rebuilt.` +
          playable,
        'engine mismatch',
      );
      return;
    }
    if (digest(bot.source).slice(0, SHA_PREFIX) !== c.sha) {
      failed(
        `${botName(bot)} was updated after this match was played, so the replay cannot be rebuilt.` +
          playable,
        'controller updated',
      );
      return;
    }
    track('challenge-opened', 'ok');
    this.begin(
      'Rebuilding the challenge',
      `Replaying the logged inputs against ${botName(bot)}…`,
      true,
    );
    const inputs: (Challenge['inputs'] | undefined)[] = [];
    inputs[c.player] = c.inputs;
    this.worker.start(
      'resimulate',
      { bot, seed: c.seed, mirrored: c.mirrored, player: c.player, inputs },
      {
        onMessage: (data) => {
          if (data.type === 'progress')
            this.progress(data.progress, simulationDetail(data.progress));
          if (data.type === 'replay') {
            this.loadReplay(data.replay, true);
            this.challengeReplay.set(data.replay);
            this.toast.show('Challenge rebuilt from its input log. Beat it after the replay.');
          }
        },
        onError: (message) => {
          this.fail(message);
        },
      },
    );
  }
  /** Fetches the list of replays hosted with the site. */
  async loadLibrary(url: string): Promise<void> {
    const names: unknown = await fetch(url).then(
      (r) => (r.ok ? r.json() : []),
      () => [],
    );
    if (Array.isArray(names))
      this.setState({ library: names.filter((n): n is string => typeof n === 'string') });
  }
}

/** A seeded shuffle, keeping the first `count`. */
function drawRoster<T>(list: readonly T[], count: number, seed: number): T[] {
  const order = [...list],
    random = mulberry32(seed ^ 0x72756d62);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = order[i] as T,
      b = order[j] as T;
    order[i] = b;
    order[j] = a;
  }
  return order.slice(0, count);
}
