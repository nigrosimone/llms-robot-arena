import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { botName } from '../../../../../packages/bot-catalog.js';
import {
  FakeViewerService,
  FakeWorkerService,
  fakeReplay,
  storeProviders,
} from '../../testing/fakes';
import { BotsStore } from '../core/bots.store';
import { WorkerService } from '../core/worker.service';
import { ArenaPage } from './arena-page';
import { ArenaStore } from './arena.store';
import { ViewerService } from './viewer.service';

describe('ArenaPage', () => {
  let fixture: ComponentFixture<ArenaPage>;
  let el: HTMLElement;
  let store: ArenaStore;
  let bots: BotsStore;
  let worker: FakeWorkerService;
  let viewer: FakeViewerService;
  const text = (selector: string): string => el.querySelector(selector)?.textContent.trim() ?? '';
  const hidden = (selector: string): boolean =>
    el.querySelector<HTMLElement>(selector)!.hidden === true;

  beforeEach(async () => {
    history.replaceState(null, '', '/');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('["exhibition-1.json"]', { status: 200 }))),
    );
    TestBed.configureTestingModule({
      imports: [ArenaPage],
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
    fixture = TestBed.createComponent(ArenaPage);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the stage, starts the opening match and lists the replay library', async () => {
    expect(viewer.attached).not.toBeNull();
    expect(el.querySelector('#stage #viewport')).toBe(viewer.host);
    expect(worker.last.type).toBe('match');
    expect(hidden('#stage-loading')).toBe(false);
    expect(text('#record-label')).toBe('REPLAY');
    expect(text('#robot-name-0')).toBe(botName(bots.builtins[0]!));
    expect(text('#robot-name-1')).toBe(botName(bots.builtins[1]!));
    expect(el.querySelectorAll('#bot-a option')).toHaveLength(bots.builtins.length);
    await vi.waitFor(() => {
      expect(store.library()).toEqual(['exhibition-1.json']);
    });
    await fixture.whenStable();
    expect(hidden('#replay-library')).toBe(false);
    expect(el.querySelectorAll('#replay-library option')).toHaveLength(2);
    worker.emit({ type: 'replay', replay: fakeReplay({ seed: 21, mirrored: true }) });
    await fixture.whenStable();
    expect(hidden('#stage-loading')).toBe(true);
    expect(text('#current-mode')).toBe('Local exhibition');
    expect(text('#replay-seed')).toContain('21 · M');
    expect(text('#robot-name-0')).toBe('Baseline');
    expect(text('#robot-name-1')).toBe('Other');
    fixture.destroy();
    expect(viewer.attached).toBeNull();
  });

  it('drives the manual duel from the document keys and lets go on blur', async () => {
    worker.finish();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('#play-manual')!.click();
    worker.emit({
      type: 'live-start',
      arenaCells: [],
      initialFrame: [],
      bots: [
        { id: 'human', model: 'Human' },
        { id: bots.builtins[1]!.id, model: bots.builtins[1]!.model },
      ],
      seed: 0,
      mirrored: false,
      player: 0,
    });
    await fixture.whenStable();
    expect(hidden('#live-hud')).toBe(false);
    expect(text('#record-label')).toBe('LIVE');
    expect(text('#current-mode')).toBe('Manual duel');
    const key = (type: string, code: string): boolean =>
      document.dispatchEvent(new KeyboardEvent(type, { code, cancelable: true }));
    expect(key('keydown', 'KeyW')).toBe(false);
    expect(key('keydown', 'KeyZ')).toBe(true);
    key('keydown', 'ArrowRight');
    window.dispatchEvent(new Event('blur'));
    expect(worker.posted).toEqual([
      { type: 'input', thrust: 1, turn: 0 },
      { type: 'input', thrust: 1, turn: -1 },
      { type: 'input', thrust: 0, turn: 0 },
    ]);
    const seed = el.querySelector<HTMLInputElement>('#seed')!;
    seed.focus();
    key('keydown', 'KeyW');
    expect(worker.posted).toHaveLength(3);
    el.querySelector<HTMLButtonElement>('#live-stop')!.click();
    expect(worker.cancelled).toBe(1);
  });

  it('records and exports the replay on the stage', async () => {
    el.querySelector<HTMLButtonElement>('#record')!.click();
    expect(viewer.recorded).toHaveLength(0);
    worker.emit({ type: 'replay', replay: fakeReplay() });
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('#record')!.click();
    expect(viewer.recorded).toHaveLength(1);
    el.querySelector<HTMLButtonElement>('#export-replay')!.click();
    const click = vi.mocked(HTMLAnchorElement.prototype.click);
    expect((click.mock.contexts.at(-1) as HTMLAnchorElement).download).toBe(
      'llms-robot-arena-3.json',
    );
  });
});
