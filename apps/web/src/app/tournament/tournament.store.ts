// The tournament panel: the roster to run, the report as it grows in the
// worker, and the published standings shown until the visitor runs their own.
import { Injectable, computed, inject } from '@angular/core';
import { NgSimpleStateBaseSignalStore, NgSimpleStateStoreConfig } from 'ng-simple-state';
import { exhibitionSchedule } from '../../../../../packages/tournament/exhibition.js';
import { renderReport } from '../../../../../packages/tournament/report.js';
import { botName } from '../../../../../packages/bot-catalog.js';
import { BotsStore } from '../core/bots.store';
import { BOTS } from '../../generated/bots';
import { WorkerService } from '../core/worker.service';
import { ToastService } from '../core/toast.service';
import { download } from '../core/url';
import type { Gate } from '../lab/gate';

export interface TournamentState {
  format: 'quick' | 'round-robin';
  selected: number[];
  report: any | null;
  gates: { bot: any; gate: Gate }[];
  progress: { value: number; message: string } | null;
  status: string;
}

@Injectable({ providedIn: 'root' })
export class TournamentStore extends NgSimpleStateBaseSignalStore<TournamentState> {
  private readonly bots = inject(BotsStore);
  private readonly worker = inject(WorkerService);
  private readonly toast = inject(ToastService);
  readonly format = this.selectState((s) => s.format);
  readonly selected = this.selectState((s) => s.selected);
  readonly report = this.selectState((s) => s.report);
  readonly gates = this.selectState((s) => s.gates);
  readonly progress = this.selectState((s) => s.progress);
  readonly status = this.selectState((s) => s.status);
  readonly running = computed(() => this.worker.operation() === 'tournament');
  readonly description = computed(() => {
    const count = this.selected().length;
    if (count < 2) return 'Select at least two controllers.';
    const schedule = exhibitionSchedule(count, this.format());
    return schedule.format === 'quick'
      ? `${schedule.rounds} rounds · different opponents · mirrored spawns · ${schedule.matches.length} matches${count % 2 ? ' · rotating byes, no points' : ''}`
      : `10 seeds per pair · mirrored spawns · ${schedule.matches.length} matches`;
  });
  // Completed replays stay watchable until the next tournament or reload.
  readonly replays = new Map<number, any>();
  private published: any = null;

  storeConfig(): NgSimpleStateStoreConfig<TournamentState> {
    return { storeName: 'tournament' };
  }
  initialState(): TournamentState {
    // Called by the base constructor, before the injected fields exist.
    return { format: 'quick', selected: BOTS.map((_, i) => i), report: null, gates: [], progress: null, status: '' };
  }
  toggle(index: number, on: boolean) {
    this.setState((s) => ({ selected: on ? [...new Set([...s.selected, index])].sort((a, b) => a - b) : s.selected.filter((i) => i !== index) }));
  }
  // Standings published with the repository; starting a tournament replaces them.
  async loadPublished(url: string) {
    if (this.published) return;
    const published = await fetch(url).then((r) => (r.ok ? r.json() : null), () => null);
    if (!published?.ranking?.length) return;
    this.published = { ...published, published: true };
    if (!this.report()) this.setState({ report: this.published });
  }
  run() {
    const bots = this.bots.bots();
    const selected = this.selected().map((i) => bots[i]).filter(Boolean);
    if (selected.length < 2) return this.toast.show('Select at least two controllers.', true);
    if (this.worker.busy) return this.toast.show('Wait for the current operation or cancel it.');
    this.replays.clear();
    this.setState({ report: null, gates: [], progress: { value: 0, message: 'Running controller conformance gates…' }, status: '' });
    this.worker.start('tournament', { bots: selected, format: this.format() }, {
      onMessage: (data) => {
        if (data.type === 'progress')
          this.setState({ progress: { value: data.progress, message: data.message ?? `${data.completed} / ${data.total} matches completed · Round ${data.round} / ${data.rounds} · ${data.pairing.map((b: any) => botName(b)).join(' vs ')}` } });
        if (data.type === 'tournament-gate') this.setState((s) => ({ gates: [...s.gates, { bot: data.bot, gate: data.gate }] }));
        if (data.type === 'tournament-update') {
          if (data.replay) this.replays.set(data.report.records.length - 1, data.replay);
          this.setState({ report: data.report });
        }
        if (data.type === 'tournament') {
          this.setState({ report: data.report, progress: { value: 1, message: `Tournament complete · ${data.report.records.length} matches` } });
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
          this.setState({ report: { ...report, status }, progress: { value: this.progress()?.value ?? 0, message: `Tournament ${status} · ${report.records.length} / ${report.totalMatches} matches completed` } });
        } else if (!report) this.setState({ progress: { value: 0, message: 'Tournament stopped before any matches were played.' } });
      },
    });
  }
  cancel() {
    if (this.worker.cancel()) this.toast.show('Operation canceled.');
  }
  exportReport() {
    const report = this.report();
    if (report) download('RESULTS.md', renderReport(report), 'text/markdown');
  }
  exportRanking() {
    const report = this.report();
    if (report) download('llms-robot-arena-tournament.json', JSON.stringify(report, null, 2));
  }
}
