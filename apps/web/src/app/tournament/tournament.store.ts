import { Service, computed, inject } from '@angular/core';
import { NgSimpleStateBaseSignalStore, type NgSimpleStateStoreConfig } from 'ng-simple-state';
import {
  exhibitionSchedule,
  type GateVerdict,
  type TournamentFormat,
  type TournamentReport,
} from '../../../../../packages/tournament/exhibition.js';
import { renderReport } from '../../../../../packages/tournament/report.js';
import { botName, type BotMetadata } from '../../../../../packages/bot-catalog.js';
import { type Replay } from '../../../../../packages/sim/replay.js';
import { BotsStore } from '../core/bots.store';
import { BOTS } from '../../generated/bots';
import { WorkerService } from '../core/worker.service';
import { ToastService } from '../core/toast.service';
import { download } from '../core/url';

export interface TournamentState {
  format: TournamentFormat;
  selected: number[];
  report: TournamentReport | null;
  gates: { bot: BotMetadata; gate: GateVerdict }[];
  progress: { value: number; message: string } | null;
}

/**
 * The tournament panel: the roster to run, the report as it grows in the
 * worker, and the published standings shown until the visitor runs their own.
 */
@Service()
export class TournamentStore extends NgSimpleStateBaseSignalStore<TournamentState> {
  private readonly bots = inject(BotsStore);
  private readonly worker = inject(WorkerService);
  private readonly toast = inject(ToastService);
  readonly format = this.selectState((s) => s.format);
  readonly selected = this.selectState((s) => s.selected);
  readonly report = this.selectState((s) => s.report);
  readonly gates = this.selectState((s) => s.gates);
  readonly progress = this.selectState((s) => s.progress);
  readonly running = computed(() => this.worker.operation() === 'tournament');
  readonly description = computed(() => {
    const count = this.selected().length;
    if (count < 2) return 'Select at least two controllers.';
    const schedule = exhibitionSchedule(count, this.format());
    return schedule.format === 'quick'
      ? `${String(schedule.rounds)} rounds · different opponents · mirrored spawns · ${String(schedule.matches.length)} matches${count % 2 ? ' · rotating byes, no points' : ''}`
      : `10 seeds per pair · mirrored spawns · ${String(schedule.matches.length)} matches`;
  });
  // Completed replays stay watchable until the next tournament or reload.
  readonly replays = new Map<number, Replay>();
  private published: TournamentReport | null = null;

  /** Store name for the devtools. */
  storeConfig(): NgSimpleStateStoreConfig<TournamentState> {
    return { storeName: 'tournament' };
  }
  /** Called by the base constructor, before the injected fields exist. */
  initialState(): TournamentState {
    return {
      format: 'quick',
      selected: BOTS.map((_, i) => i),
      report: null,
      gates: [],
      progress: null,
    };
  }
  /** Picks the format from the select; anything unknown falls back to quick. */
  setFormat(format: string): void {
    this.setState({ format: format === 'round-robin' ? 'round-robin' : 'quick' });
  }
  /** Adds or removes a controller from the roster to run. */
  toggle(index: number, on: boolean): void {
    this.setState((s) => ({
      selected: on
        ? [...new Set([...s.selected, index])].sort((a, b) => a - b)
        : s.selected.filter((i) => i !== index),
    }));
  }
  /** Standings published with the repository; starting a tournament replaces them. */
  async loadPublished(url: string): Promise<void> {
    if (this.published) return;
    const published: unknown = await fetch(url).then(
      (r) => (r.ok ? r.json() : null),
      () => null,
    );
    if (!isReport(published) || !published.ranking.length) return;
    this.published = { ...published, published: true };
    if (!this.report()) this.setState({ report: this.published });
  }
  /** Runs the selected roster in the worker, gates first, then the schedule. */
  run(): void {
    const bots = this.bots.bots();
    const selected = this.selected().flatMap((i) => {
      const bot = bots[i];
      return bot ? [bot] : [];
    });
    if (selected.length < 2) {
      this.toast.show('Select at least two controllers.', true);
      return;
    }
    if (this.worker.busy) {
      this.toast.show('Wait for the current operation or cancel it.');
      return;
    }
    this.replays.clear();
    this.setState({
      report: null,
      gates: [],
      progress: { value: 0, message: 'Running controller conformance gates…' },
    });
    this.worker.start(
      'tournament',
      { bots: selected, format: this.format() },
      {
        onMessage: (data) => {
          if (data.type === 'progress') {
            const pairing = (data.pairing ?? []).map((b) => botName(b)).join(' vs ');
            const message =
              data.message ??
              `${String(data.completed)} / ${String(data.total)} matches completed · Round ${String(data.round)} / ${String(data.rounds)} · ${pairing}`;
            this.setState({ progress: { value: data.progress, message } });
          }
          if (data.type === 'tournament-gate')
            this.setState((s) => ({ gates: [...s.gates, { bot: data.bot, gate: data.gate }] }));
          if (data.type === 'tournament-update') {
            if (data.replay) this.replays.set(data.report.records.length - 1, data.replay);
            this.setState({ report: data.report });
          }
          if (data.type === 'tournament') {
            this.setState({
              report: data.report,
              progress: {
                value: 1,
                message: `Tournament complete · ${String(data.report.records.length)} matches`,
              },
            });
            this.toast.show('Tournament complete.');
          }
        },
        onError: (message) => {
          const report = this.report();
          if (report) this.setState({ report: { ...report, status: 'failed' } });
          this.toast.show(message, true);
        },
        onFinish: () => {
          const report = this.report();
          if (report && !report.published) {
            const status = report.status === 'running' ? 'cancelled' : report.status;
            this.setState({
              report: { ...report, status },
              progress: {
                value: this.progress()?.value ?? 0,
                message: `Tournament ${status} · ${String(report.records.length)} / ${String(report.totalMatches)} matches completed`,
              },
            });
          } else if (!report)
            this.setState({
              progress: { value: 0, message: 'Tournament stopped before any matches were played.' },
            });
        },
      },
    );
  }
  /** Stops the running tournament; the report keeps the matches played so far. */
  cancel(): void {
    if (this.worker.cancel()) this.toast.show('Operation canceled.');
  }
  /** Downloads the report as RESULTS.md. */
  exportReport(): void {
    const report = this.report();
    if (report) download('RESULTS.md', renderReport(report), 'text/markdown');
  }
  /** Downloads the report as JSON. */
  exportRanking(): void {
    const report = this.report();
    if (report) download('llms-robot-arena-tournament.json', JSON.stringify(report, null, 2));
  }
}

/** Enough of a shape check to trust a fetched standings file. */
const isReport = (value: unknown): value is TournamentReport =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { ranking?: unknown }).ranking);
