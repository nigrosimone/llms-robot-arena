import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { botDetails, botName } from '../../../../../packages/bot-catalog.js';
import {
  STYLE_AXES,
  formatStyleValue,
  styleLabel,
  styleProfiles,
} from '../../../../../packages/tournament/style.js';
import { INDEX_TERMS, compositeIndex } from '../../../../../packages/tournament/composite.js';
import { highlightLabel, highlights } from '../../../../../packages/tournament/spectacle.js';
import { type MatchRecord } from '../../../../../packages/tournament/ranking.js';
import { Icon } from '../core/icons';
import { BotsStore } from '../core/bots.store';
import { clock, inputChecked, inputValue, siteUrl } from '../core/url';
import { GateResult, gateLabel } from '../lab/gate';
import { ArenaStore } from '../arena/arena.store';
import { TournamentStore } from './tournament.store';

interface Radar {
  outer: string;
  inner: string;
  shape: string;
  spokes: string[][];
  labels: { x: string; y: string; anchor: string; text: string }[];
}

/** The tournament panel: roster, progress, ranking, style radars and highlights. */
@Component({
  selector: 'app-tournament-page',
  imports: [Icon, GateResult],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { id: 'panel-tournament', class: 'panel' },
  templateUrl: './tournament-page.html',
})
export class TournamentPage {
  protected readonly tournament = inject(TournamentStore);
  protected readonly bots = inject(BotsStore);
  private readonly arena = inject(ArenaStore);
  private readonly router = inject(Router);
  protected readonly clock = clock;
  protected readonly value = inputValue;
  protected readonly checked = inputChecked;
  protected readonly axes = STYLE_AXES;
  protected readonly terms = INDEX_TERMS;
  protected readonly formatStyleValue = formatStyleValue;
  protected readonly styleLabel = styleLabel;
  protected readonly gateLabel = gateLabel;

  constructor() {
    void this.tournament.loadPublished(siteUrl('standings.json'));
  }
  /** Display name of a controller. */
  protected name = (bot: { model?: string }): string => botName(bot);
  /** Provider line of a controller. */
  protected details = (bot: { provider?: string | null }): string => botDetails(bot);
  protected readonly heading = computed(() => {
    const report = this.tournament.report();
    if (!report) return null;
    const format = report.format === 'quick' ? 'QUICK ROUNDS' : 'ROUND ROBIN';
    const date = report.generatedAt ? ' · ' + report.generatedAt.slice(0, 10) : '';
    return {
      title: report.published
        ? 'Published standings'
        : report.status === 'complete'
          ? 'Final ranking'
          : 'Provisional ranking',
      tag: report.published
        ? `PUBLISHED · ${String(report.records.length)} MATCHES · ${format}${date}`
        : `${String(report.records.length)} / ${String(report.totalMatches)} MATCHES · ${format} · ${report.status.toUpperCase()}`,
    };
  });
  protected readonly profiles = computed(() => {
    const report = this.tournament.report();
    return report ? styleProfiles(report.ranking) : null;
  });
  protected readonly highlightRows = computed(() => {
    const report = this.tournament.report();
    return report ? highlights(report).map((h) => ({ ...h, ...highlightLabel(report, h) })) : [];
  });
  protected readonly index = computed(() => {
    const report = this.tournament.report();
    return report ? compositeIndex(report) : null;
  });
  protected readonly code = computed(() => {
    const report = this.tournament.report();
    if (!report) return [];
    const order = new Map(report.ranking.map((row, i) => [row.id, i]));
    return report.bots
      .flatMap((bot) => (bot.code ? [{ ...bot, code: bot.code }] : []))
      .sort((x, y) => (order.get(x.id) ?? Infinity) - (order.get(y.id) ?? Infinity));
  });
  protected readonly matches = computed(() => {
    const report = this.tournament.report();
    return report && !report.published
      ? report.records.map((r, i) => ({ ...r, index: i })).reverse()
      : [];
  });
  /**
   * One radar per controller: the axes are scaled against the rest of the
   * roster, so the shape compares controllers instead of measuring them.
   */
  protected radar(profile: Record<string, number>): Radar {
    const point = (index: number, radius: number): [number, number] => {
      const angle = (Math.PI * 2 * index) / this.axes.length - Math.PI / 2;
      return [60 + radius * Math.cos(angle), 60 + radius * Math.sin(angle)];
    };
    const ring = (radius: number): string =>
      this.axes
        .map((_, i) =>
          point(i, radius)
            .map((n) => n.toFixed(1))
            .join(','),
        )
        .join(' ');
    return {
      outer: ring(46),
      inner: ring(23),
      shape: this.axes
        .map((axis, i) =>
          point(i, 12 + 34 * Math.min(1, Math.max(0, profile[axis.key] ?? 0)))
            .map((n) => n.toFixed(1))
            .join(','),
        )
        .join(' '),
      spokes: this.axes.map((_, i) => point(i, 46).map((n) => n.toFixed(1))),
      labels: this.axes.map((axis, i) => {
        const [x, y] = point(i, 54);
        const anchor = x > 61 ? 'start' : x < 59 ? 'end' : 'middle';
        const dx = anchor === 'start' ? 4 : anchor === 'end' ? -4 : 0;
        const dy = y > 61 ? 8 : y < 59 ? 0 : 3;
        return {
          x: (x + dx).toFixed(1),
          y: (y + dy).toFixed(1),
          anchor,
          text: axis.short ?? axis.label,
        };
      }),
    };
  }
  /** Opens a tournament replay in the arena. */
  protected watch(index: number): void {
    const replay = this.tournament.replays.get(index);
    if (!replay) return;
    this.arena.loadReplay(replay, true);
    void this.router.navigateByUrl('/');
  }
  /** The outcome of a match in words. */
  protected result(r: MatchRecord): string {
    const bot = this.tournament.report()?.bots[r.score === 1 ? r.a : r.b];
    return r.score === 0.5 ? 'Draw' : `${bot ? botName(bot) : 'Robot'} wins`;
  }
  /** Name of the controller at a report index. */
  protected botAt(index: number): string {
    const bot = this.tournament.report()?.bots[index];
    return bot ? botName(bot) : 'Robot';
  }
}
