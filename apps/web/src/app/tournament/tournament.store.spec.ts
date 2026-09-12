import { TestBed } from '@angular/core/testing';
import { type TournamentReport } from '../../../../../packages/tournament/exhibition.js';
import standings from '../../../../../packages/viewer/public/standings.json';
import { FakeWorkerService, fakeReplay, storeProviders } from '../../testing/fakes';
import { BotsStore } from '../core/bots.store';
import { ToastService } from '../core/toast.service';
import { WorkerService } from '../core/worker.service';
import { TournamentStore } from './tournament.store';

const published = standings as unknown as TournamentReport;
const running = (records: number): TournamentReport => ({
  ...published,
  status: 'running',
  records: published.records.slice(0, records),
});

describe('TournamentStore', () => {
  let store: TournamentStore;
  let bots: BotsStore;
  let worker: FakeWorkerService;
  let toast: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...storeProviders, { provide: WorkerService, useClass: FakeWorkerService }],
    });
    store = TestBed.inject(TournamentStore);
    bots = TestBed.inject(BotsStore);
    worker = TestBed.inject(WorkerService) as unknown as FakeWorkerService;
    toast = TestBed.inject(ToastService);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(published), { status: 200 }))),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('describes the roster in the chosen format', () => {
    expect(store.selected()).toHaveLength(bots.builtins.length);
    expect(store.description()).toMatch(/^\d+ rounds/);
    store.setFormat('round-robin');
    expect(store.description()).toMatch(/^10 seeds per pair/);
    store.setFormat('anything else');
    expect(store.format()).toBe('quick');
    store.toggle(2, false);
    store.toggle(2, false);
    expect(store.selected()).not.toContain(2);
    store.toggle(2, true);
    expect(store.selected()).toEqual(bots.builtins.map((_, i) => i));
    for (let i = 1; i < bots.builtins.length; i++) store.toggle(i, false);
    expect(store.description()).toBe('Select at least two controllers.');
    store.run();
    expect(worker.started).toHaveLength(0);
    expect(toast.message()).toBe('Select at least two controllers.');
  });

  it('runs the roster, follows the worker and keeps the replays to watch', () => {
    store.toggle(0, false);
    store.run();
    expect(worker.last.type).toBe('tournament');
    expect(worker.last.data['format']).toBe('quick');
    expect(worker.last.data['bots']).toHaveLength(bots.builtins.length - 1);
    expect(store.progress()?.value).toBe(0);
    worker.emit({
      type: 'progress',
      progress: 0.25,
      completed: 3,
      total: 12,
      round: 1,
      rounds: 4,
      pairing: [published.bots[0]!, published.bots[1]!],
    });
    expect(store.progress()?.value).toBe(0.25);
    expect(store.progress()?.message).toContain('3 / 12 matches');
    expect(store.progress()?.message).toContain(' vs ');
    worker.emit({
      type: 'tournament-gate',
      bot: published.bots[0]!,
      gate: { pass: true, checks: [] },
    });
    expect(store.gates()).toHaveLength(1);
    const replay = fakeReplay();
    worker.emit({ type: 'tournament-update', report: running(2), replay });
    expect(store.report()?.records).toHaveLength(2);
    expect(store.replays.get(1)).toBe(replay);
    worker.emit({ type: 'tournament', report: { ...published, status: 'complete' } });
    expect(store.report()?.status).toBe('complete');
    expect(store.progress()?.message).toContain('Tournament complete');
    expect(toast.message()).toBe('Tournament complete.');
    expect(worker.busy).toBe(false);
  });

  it('marks a stopped tournament as cancelled and a broken one as failed', () => {
    store.run();
    worker.emit({ type: 'tournament-update', report: running(5) });
    store.cancel();
    expect(worker.cancelled).toBe(1);
    worker.finish();
    expect(store.report()?.status).toBe('cancelled');
    expect(store.progress()?.message).toContain('Tournament cancelled · 5 /');
    store.run();
    expect(store.report()).toBeNull();
    worker.emit({ type: 'tournament-update', report: running(1) });
    worker.emit({ type: 'error', message: 'Worker died.' });
    expect(store.report()?.status).toBe('failed');
    expect(toast.error()).toBe(true);
    expect(toast.message()).toBe('Worker died.');
  });

  it('shows the published standings until a tournament replaces them', async () => {
    await store.loadPublished('standings.json');
    expect(store.report()?.published).toBe(true);
    expect(store.report()?.ranking).toHaveLength(published.ranking.length);
    await store.loadPublished('standings.json');
    expect(fetch).toHaveBeenCalledTimes(1);
    store.exportReport();
    const click = vi.mocked(HTMLAnchorElement.prototype.click);
    expect((click.mock.contexts.at(-1) as HTMLAnchorElement).download).toBe('RESULTS.md');
    store.run();
    expect(store.report()).toBeNull();
    worker.finish();
    expect(store.progress()?.message).toContain('stopped before any matches');
  });
});
