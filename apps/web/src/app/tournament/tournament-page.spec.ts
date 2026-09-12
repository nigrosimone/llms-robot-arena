import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { botName } from '../../../../../packages/bot-catalog.js';
import { type TournamentReport } from '../../../../../packages/tournament/exhibition.js';
import standings from '../../../../../packages/viewer/public/standings.json';
import {
  FakeViewerService,
  FakeWorkerService,
  fakeReplay,
  storeProviders,
} from '../../testing/fakes';
import { ArenaStore } from '../arena/arena.store';
import { ViewerService } from '../arena/viewer.service';
import { BotsStore } from '../core/bots.store';
import { WorkerService } from '../core/worker.service';
import { TournamentPage } from './tournament-page';
import { TournamentStore } from './tournament.store';

const published = standings as unknown as TournamentReport;

describe('TournamentPage', () => {
  let fixture: ComponentFixture<TournamentPage>;
  let el: HTMLElement;
  let worker: FakeWorkerService;
  const rows = (selector: string): number => el.querySelectorAll(`${selector} tbody tr`).length;

  beforeEach(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(published), { status: 200 }))),
    );
    TestBed.configureTestingModule({
      imports: [TournamentPage],
      providers: [
        provideRouter([]),
        ...storeProviders,
        { provide: WorkerService, useClass: FakeWorkerService },
        { provide: ViewerService, useClass: FakeViewerService },
      ],
    });
    worker = TestBed.inject(WorkerService) as unknown as FakeWorkerService;
    fixture = TestBed.createComponent(TournamentPage);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => {
      expect(rows('#ranking-surface')).toBeGreaterThan(0);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the published standings with the style radars and the highlights', () => {
    expect(el.querySelector('#ranking-surface h2')?.textContent).toBe('Published standings');
    expect(el.querySelector('#ranking-surface .tag')?.textContent).toContain('PUBLISHED');
    expect(rows('#ranking-surface')).toBe(published.ranking.length);
    expect(el.querySelector('#ranking-surface tbody tr td:nth-child(2)')?.textContent).toContain(
      botName(published.ranking[0]!),
    );
    expect(el.querySelectorAll('#tournament-style svg polygon').length).toBeGreaterThan(0);
    expect(rows('#tournament-highlights')).toBeGreaterThan(0);
    expect(el.querySelector('#tournament-highlights a')?.getAttribute('href')).toMatch(
      /\?a=.*&b=.*&seed=\d+&spawn=/,
    );
    expect(rows('#tournament-matches')).toBe(0);
    const bots = TestBed.inject(BotsStore);
    expect(el.querySelectorAll('#tournament-bots input[type=checkbox]')).toHaveLength(
      bots.builtins.length,
    );
  });

  it('runs a tournament from the form and opens a played match in the arena', async () => {
    const select = el.querySelector<HTMLSelectElement>('#tournament-format')!;
    select.value = 'round-robin';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(el.querySelector('#tournament-description')?.textContent).toContain('10 seeds per pair');
    el.querySelector<HTMLButtonElement>('#run-tournament')!.click();
    await fixture.whenStable();
    expect(worker.last.type).toBe('tournament');
    expect(worker.last.data['format']).toBe('round-robin');
    expect(el.querySelector<HTMLButtonElement>('#run-tournament')!.disabled).toBe(true);
    const replay = fakeReplay();
    worker.emit({
      type: 'tournament-update',
      report: { ...published, status: 'running', records: published.records.slice(0, 1) },
      replay,
    });
    await fixture.whenStable();
    expect(el.querySelector('#ranking-surface h2')?.textContent).toBe('Provisional ranking');
    expect(rows('#tournament-matches')).toBe(1);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>('[data-watch-match="0"]')!.click();
    expect(TestBed.inject(ArenaStore).replay()).toBe(replay);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(TestBed.inject(TournamentStore).replays.get(0)).toBe(replay);
  });
});
