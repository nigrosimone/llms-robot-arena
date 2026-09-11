import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { botName, botDetails } from '../../../../../packages/bot-catalog.js';
import { STYLE_AXES, formatStyleValue, styleLabel, styleProfiles } from '../../../../../packages/tournament/style.js';
import { INDEX_TERMS, compositeIndex } from '../../../../../packages/tournament/composite.js';
import { highlights, highlightLabel } from '../../../../../packages/tournament/spectacle.js';
import { Icon } from '../core/icons';
import { BotsStore } from '../core/bots.store';
import { clock, siteUrl } from '../core/url';
import { GateResult } from '../lab/gate';
import { ArenaStore } from '../arena/arena.store';
import { TournamentStore } from './tournament.store';

@Component({
  selector: 'tournament-page',
  imports: [Icon, GateResult],
  host: { id: 'panel-tournament', class: 'panel' },
  templateUrl: './tournament-page.html',
})
export class TournamentPage {
  protected readonly tournament = inject(TournamentStore);
  protected readonly bots = inject(BotsStore);
  private readonly arena = inject(ArenaStore);
  private readonly router = inject(Router);
  protected readonly clock = clock;
  protected readonly axes = STYLE_AXES as { key: string; label: string; short?: string }[];
  protected readonly terms = INDEX_TERMS as { key: string; label: string; weight: number }[];
  protected readonly formatStyleValue = formatStyleValue;
  protected readonly styleLabel = styleLabel;
  protected readonly gateLabel = (gate: any) => (gate.pass ? 'Passed' : (gate.eligible ?? gate.pass) ? 'Ready for exhibition' : 'Check failed');

  constructor() {
    this.tournament.loadPublished(siteUrl('standings.json'));
  }
  protected name = (bot: object) => botName(bot as any);
  protected details = (bot: object) => botDetails(bot as any);
  protected readonly heading = computed(() => {
    const report = this.tournament.report();
    if (!report) return null;
    const format = report.format === 'quick' ? 'QUICK ROUNDS' : 'ROUND ROBIN';
    return {
      title: report.published ? 'Published standings' : report.status === 'complete' ? 'Final ranking' : 'Provisional ranking',
      tag: report.published
        ? `PUBLISHED · ${report.records.length} MATCHES · ${format}${report.generatedAt ? ' · ' + report.generatedAt.slice(0, 10) : ''}`
        : `${report.records.length} / ${report.totalMatches} MATCHES · ${format} · ${String(report.status).toUpperCase()}`,
    };
  });
  protected readonly profiles = computed(() => {
    const report = this.tournament.report();
    return report ? styleProfiles(report.ranking) : null;
  });
  protected readonly highlightRows = computed(() => {
    const report = this.tournament.report();
    return report ? highlights(report).map((h: any) => ({ ...h, ...highlightLabel(report, h) })) : [];
  });
  protected readonly index = computed(() => {
    const report = this.tournament.report();
    return report ? compositeIndex(report) : null;
  });
  protected readonly code = computed(() => {
    const report = this.tournament.report();
    if (!report) return [];
    const order = new Map<string, number>(report.ranking.map((row: any, i: number) => [row.id, i]));
    return (report.bots ?? []).filter((bot: any) => bot.code).sort((x: any, y: any) => (order.get(x.id) ?? Infinity) - (order.get(y.id) ?? Infinity));
  });
  protected readonly matches = computed(() => {
    const report = this.tournament.report();
    return report && !report.published ? report.records.map((r: any, i: number) => ({ ...r, index: i })).reverse() : [];
  });
  // One radar per controller: the axes are scaled against the rest of the
  // roster, so the shape compares controllers instead of measuring them.
  protected radar(profile: Record<string, number>) {
    const point = (index: number, radius: number) => {
      const angle = (Math.PI * 2 * index) / this.axes.length - Math.PI / 2;
      return [60 + radius * Math.cos(angle), 60 + radius * Math.sin(angle)];
    };
    const ring = (radius: number) => this.axes.map((_, i) => point(i, radius).map((n) => n.toFixed(1)).join(',')).join(' ');
    return {
      outer: ring(46),
      inner: ring(23),
      shape: this.axes.map((axis, i) => point(i, 12 + 34 * Math.min(1, Math.max(0, profile[axis.key]))).map((n) => n.toFixed(1)).join(',')).join(' '),
      spokes: this.axes.map((_, i) => point(i, 46).map((n) => n.toFixed(1))),
      labels: this.axes.map((axis, i) => {
        const [x, y] = point(i, 54);
        const anchor = x > 61 ? 'start' : x < 59 ? 'end' : 'middle';
        const dx = anchor === 'start' ? 4 : anchor === 'end' ? -4 : 0;
        const dy = y > 61 ? 8 : y < 59 ? 0 : 3;
        return { x: (x + dx).toFixed(1), y: (y + dy).toFixed(1), anchor, text: axis.short ?? axis.label };
      }),
    };
  }
  protected watch(index: number) {
    const replay = this.tournament.replays.get(index);
    if (!replay) return;
    this.arena.loadReplay(replay, true);
    this.router.navigateByUrl('/');
  }
  protected result(r: any) {
    const report = this.tournament.report();
    return r.score === 0.5 ? 'Draw' : botName(report.bots[r.score === 1 ? r.a : r.b]) + ' wins';
  }
}
