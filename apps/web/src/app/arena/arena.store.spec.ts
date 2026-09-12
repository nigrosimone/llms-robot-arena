import { TestBed } from '@angular/core/testing';
import { ENGINE_VERSION } from '../../../../../packages/sim/spec.js';
import { digest } from '../../../../../packages/sim/index.js';
import { SHA_PREFIX, encodeChallenge } from '../../../../../packages/viewer/challenge-link.js';
import {
  FakeViewerService,
  FakeWorkerService,
  fakeReplay,
  storeProviders,
} from '../../testing/fakes';
import { BotsStore } from '../core/bots.store';
import { ToastService } from '../core/toast.service';
import { WorkerService } from '../core/worker.service';
import { ArenaStore } from './arena.store';
import { ViewerService } from './viewer.service';

describe('ArenaStore', () => {
  let store: ArenaStore;
  let bots: BotsStore;
  let worker: FakeWorkerService;
  let viewer: FakeViewerService;
  let toast: ToastService;

  beforeEach(() => {
    history.replaceState(null, '', '/');
    TestBed.configureTestingModule({
      providers: [
        ...storeProviders,
        { provide: WorkerService, useClass: FakeWorkerService },
        { provide: ViewerService, useClass: FakeViewerService },
      ],
    });
    store = TestBed.inject(ArenaStore);
    bots = TestBed.inject(BotsStore);
    worker = TestBed.inject(WorkerService) as unknown as FakeWorkerService;
    viewer = TestBed.inject(ViewerService) as unknown as FakeViewerService;
    toast = TestBed.inject(ToastService);
  });

  describe('simulate', () => {
    it('runs the selected pair in the worker and writes the match link', () => {
      store.setState({ a: 2, b: 0, seed: 42, mirrored: true });
      store.simulate();
      expect(worker.last.type).toBe('match');
      expect(worker.last.data['seed']).toBe(42);
      expect(worker.last.data['mirrored']).toBe(true);
      expect((worker.last.data['bots'] as { id: string }[]).map((b) => b.id)).toEqual([
        bots.builtins[2]!.id,
        bots.builtins[0]!.id,
      ]);
      expect(store.loading()?.title).toBe('Computing match');
      expect(store.loading()?.cancel).toBe(true);
      expect(location.search).toContain('seed=42');
      expect(location.search).toContain('spawn=mirror');
      worker.emit({ type: 'progress', progress: 0.5 });
      expect(store.loading()?.progress).toBe(0.5);
      expect(store.loading()?.detail).toContain('50%');
      const replay = fakeReplay();
      worker.emit({ type: 'replay', replay });
      expect(store.replay()).toBe(replay);
      expect(store.loading()).toBeNull();
      expect(viewer.loaded).toEqual([{ replay, live: false, autoplay: true }]);
      expect(toast.message()).toBe('Match computed. The replay is ready.');
      expect(worker.busy).toBe(false);
    });

    it('refuses a bad seed and a busy worker', () => {
      store.setState({ seed: -1 });
      store.simulate();
      expect(worker.started).toHaveLength(0);
      expect(toast.error()).toBe(true);
      expect(toast.message()).toContain('integer seed');
      store.setState({ seed: 1 });
      worker.start('gate', {}, { onMessage: () => undefined });
      store.simulate();
      expect(worker.started.map((s) => s.type)).toEqual(['gate']);
      expect(toast.message()).toContain('Wait for the current operation');
    });

    it('keeps the previous replay when the worker fails', () => {
      const previous = fakeReplay();
      store.loadReplay(previous);
      store.simulate();
      worker.emit({ type: 'error', message: 'Controller crashed.' });
      expect(store.replay()).toBe(previous);
      expect(store.loading()).toBeNull();
      expect(toast.message()).toBe('Controller crashed.');
    });

    it('shows the abandoned card when there was nothing on the stage', () => {
      store.simulate();
      worker.emit({ type: 'error', message: 'Controller crashed.' });
      expect(store.loading()?.title).toBe('Match abandoned');
    });
  });

  describe('rumble', () => {
    it('draws twelve from a larger roster by the seed', () => {
      store.setState({ seed: 7 });
      store.rumble();
      const roster = worker.last.data['bots'] as { id: string }[];
      expect(worker.last.data['mode']).toBe('rumble');
      expect(roster).toHaveLength(Math.min(12, bots.builtins.length));
      if (bots.builtins.length > 12) expect(toast.message()).toContain('draws 12');
      expect(new Set(roster.map((b) => b.id)).size).toBe(roster.length);
      worker.finish();
      store.rumble();
      expect(worker.last.data['bots']).toEqual(roster);
    });
  });

  describe('cancel', () => {
    it('stops the clip first, otherwise the worker', () => {
      store.simulate();
      store.cancel();
      expect(worker.cancelled).toBe(1);
      expect(toast.message()).toBe('Operation canceled.');
      viewer.clipRunning = true;
      store.cancel();
      expect(viewer.clipsCancelled).toBe(1);
      expect(worker.cancelled).toBe(1);
    });
  });

  describe('manual duel', () => {
    const startLive = (): void => {
      store.setState({ b: 1, seed: 5, mirrored: true });
      store.playManual();
      worker.emit({
        type: 'live-start',
        arenaCells: [],
        initialFrame: [],
        bots: [
          { id: 'human', model: 'Human' },
          {
            id: bots.builtins[1]!.id,
            model: bots.builtins[1]!.model,
            codeSha256: digest(bots.builtins[1]!.source),
          },
        ],
        seed: 5,
        mirrored: true,
        player: 0,
      });
    };

    it('drives robot A with the keys and logs every change as one input', () => {
      expect(store.key('KeyW', true)).toBe(false);
      startLive();
      expect(worker.last.type).toBe('live');
      expect(worker.last.data['player']).toBe(0);
      expect(worker.last.data['control']).toBe('keyboard');
      expect(store.live()).toBe(true);
      expect(viewer.viewer?.focus).toBe(0);
      expect(store.key('KeyW', true)).toBe(true);
      expect(store.key('ArrowLeft', true)).toBe(true);
      expect(store.key('KeyW', true)).toBe(true);
      expect(store.key('KeyX', true)).toBe(false);
      expect(store.key('KeyW', false)).toBe(true);
      store.releaseAll();
      store.releaseAll();
      expect(worker.posted).toEqual([
        { type: 'input', thrust: 1, turn: 0 },
        { type: 'input', thrust: 1, turn: 1 },
        { type: 'input', thrust: 0, turn: 1 },
        { type: 'input', thrust: 0, turn: 0 },
      ]);
    });

    it('grows the replay tick by tick, then closes it as a shareable challenge', async () => {
      startLive();
      const live = store.replay()!;
      expect(live.mode).toBe('manual');
      expect(viewer.loaded.at(-1)).toEqual({ replay: live, live: true, autoplay: false });
      worker.emit({
        type: 'live-tick',
        tick: 1,
        frame: new Float32Array(12),
        extent: 1,
        loads: [],
        events: [{ type: 'impact', tick: 1 }],
        hashes: [],
      });
      expect(live.result.ticks).toBe(1);
      expect(live.events).toHaveLength(1);
      const final = fakeReplay({
        mode: 'manual',
        seed: 5,
        mirrored: true,
        bots: live.bots,
        inputs: [[[0, 7]], null],
        stateHashes: [{ tick: 60, hash: 'abc' }],
        result: { winner: 0, reason: 'ring-out', ticks: 300 },
      });
      worker.emit({ type: 'live-end', replay: final });
      expect(store.live()).toBe(false);
      expect(store.replay()?.result).toEqual(final.result);
      expect(store.shareable(store.replay())).toBe(true);
      expect(viewer.viewer?.live).toBe(false);
      expect(viewer.viewer?.playing).toBe(true);
      await vi.waitFor(() => {
        expect(location.hash).toMatch(/^#m=/);
      });
    });

    it('brings the previous replay back when the duel is abandoned', () => {
      const previous = fakeReplay();
      store.loadReplay(previous);
      startLive();
      expect(store.replay()).not.toBe(previous);
      store.leaveLive();
      expect(worker.cancelled).toBe(1);
      worker.emit({ type: 'live-aborted' });
      expect(store.live()).toBe(false);
      expect(store.replay()).toBe(previous);
      expect(store.shareable(previous)).toBe(false);
    });
  });

  describe('challenge links', () => {
    const challenge = (patch: Record<string, unknown> = {}): Promise<string> => {
      const bot = bots.builtins[1]!;
      return encodeChallenge({
        engineVersion: ENGINE_VERSION,
        seed: 9,
        mirrored: false,
        player: 0,
        botId: bot.id,
        sha: digest(bot.source).slice(0, SHA_PREFIX),
        inputs: [[0, 7]],
        ...patch,
      });
    };

    it('rebuilds the match from the logged inputs, then plays the same seed', async () => {
      await store.openChallenge(await challenge());
      expect(worker.last.type).toBe('resimulate');
      expect(worker.last.data['seed']).toBe(9);
      expect((worker.last.data['inputs'] as unknown[])[0]).toEqual([[0, 7]]);
      expect(store.b()).toBe(1);
      expect(store.seed()).toBe(9);
      expect(store.loading()?.title).toBe('Rebuilding the challenge');
      const replay = fakeReplay({ mode: 'manual' });
      worker.emit({ type: 'replay', replay });
      expect(store.challengeReplay()).toBe(replay);
      expect(toast.message()).toContain('Challenge rebuilt');
      store.beatChallenge();
      expect(worker.last.type).toBe('live');
      expect(worker.last.data['seed']).toBe(9);
    });

    it('explains a damaged link, an unknown controller and another engine', async () => {
      await store.openChallenge('not-a-challenge');
      expect(toast.error()).toBe(true);
      expect(toast.message()).toContain('You can simulate a new match');
      await store.openChallenge(await challenge({ botId: 'nobody' }));
      expect(toast.message()).toContain('a controller this arena does not have');
      await store.openChallenge(await challenge({ engineVersion: '0.0.1' }));
      expect(toast.message()).toContain('engine 0.0.1');
      expect(toast.message()).toContain('press "Play yourself vs Robot B"');
      await store.openChallenge(await challenge({ sha: '0000000000000000' }));
      expect(toast.message()).toContain('was updated after this match');
      expect(worker.started).toHaveLength(0);
      expect(store.loading()).toBeNull();
    });
  });

  describe('opening match', () => {
    it('starts when the arena is shown and waits for a busy worker', () => {
      worker.start('gate', {}, { onMessage: () => undefined });
      store.arm();
      expect(worker.started.map((s) => s.type)).toEqual(['gate']);
      worker.finish();
      TestBed.tick();
      expect(worker.started.map((s) => s.type)).toEqual(['gate', 'match']);
      store.arm();
      expect(worker.started).toHaveLength(2);
    });

    it('reads the match settings from the address', () => {
      const [a, b] = [bots.builtins[2]!, bots.builtins[1]!];
      history.replaceState(null, '', `/?a=${a.id}&b=${b.id}&seed=11&spawn=mirror`);
      store.arm();
      expect(store.a()).toBe(2);
      expect(store.b()).toBe(1);
      expect(store.seed()).toBe(11);
      expect(store.mirrored()).toBe(true);
      expect(worker.last.type).toBe('match');
    });
  });

  describe('random match', () => {
    it('keeps the pairing and the mode, draws a new seed', () => {
      const ids = [bots.builtins[1]!.id, bots.builtins[0]!.id];
      store.loadReplay(fakeReplay({ bots: ids.map((id) => ({ id, model: id })) }));
      store.randomMatch();
      expect(store.a()).toBe(1);
      expect(store.b()).toBe(0);
      expect(worker.last.type).toBe('match');
      worker.finish();
      store.loadReplay(fakeReplay({ mode: 'rumble' }));
      store.randomMatch();
      expect(worker.last.data['mode']).toBe('rumble');
    });
  });

  it('refuses an oversized replay file', async () => {
    await store.importFile(new File([new Uint8Array(21 * 1024 * 1024)], 'big.json'));
    expect(toast.message()).toContain('too large');
    expect(store.replay()).toBeNull();
  });
});
