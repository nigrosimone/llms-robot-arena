import { Component, DestroyRef, ElementRef, afterNextRender, inject, viewChild, HostListener } from '@angular/core';
import { MatchService } from './match.service';

const clock = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

@Component({
  selector: 'arena-page',
  template: `
    @let hud = match.hud();
    @let replay = match.replay();
    <div class="page-heading"><div><div class="eyebrow">AUTONOMOUS COMBAT LAB <span>/ 01</span></div><h1>The arena decides<span>.</span></h1></div></div>
    <div class="arena-layout">
      <div class="match-surface">
        <div class="stage">
          <div class="stage-header">
            <div class="record-tag"><span class="record-dot"></span><span>{{ match.live() ? 'LIVE' : 'REPLAY' }}</span> <span>SEED {{ match.seed() }}{{ match.mirrored() ? ' · M' : '' }}</span></div>
            <div class="stage-clock"><b>{{ clock(hud?.time ?? 0) }}</b><span>/ {{ clock(match.duration || 120) }}</span></div>
          </div>
          <div #viewport id="viewport"></div>
          @if (match.status() === 'simulating') {
            <div class="stage-loading"><span class="loader"></span><b>Computing match</b><span>Simulation {{ (match.progress() * 100).toFixed(0) }}%</span><progress [value]="match.progress()" max="1"></progress><button class="button outline" (click)="match.cancel()">Cancel</button></div>
          }
          @if (hud?.ended && replay) {
            <div class="result-banner"><span class="eyebrow">MATCH COMPLETE</span><strong>{{ outcome(replay) }}</strong><span>{{ replay.result.reason }} · {{ clock(match.duration) }}</span><div class="result-actions"><button class="button accent" (click)="match.seek(0); match.toggle()">Watch again</button></div></div>
          }
          @if (match.live()) {
            <div class="live-hud"><strong>YOU DRIVE ROBOT A</strong><span class="keys"><b>W</b> <b>S</b> thrust · <b>A</b> <b>D</b> turn</span><button class="button quiet" (click)="match.cancel()">Leave match</button></div>
          }
        </div>
        <div class="playback">
          <button class="play-button" [disabled]="!replay || match.live()" (click)="match.toggle()">{{ hud?.playing ? '❚❚' : '▶' }}</button>
          <span class="mono">{{ clock(hud?.time ?? 0) }}</span>
          <div class="scrubber"><input type="range" min="0" [max]="match.duration || 120" step="any" [value]="hud?.time ?? 0" [disabled]="!replay || match.live()" (input)="match.seek(+$any($event.target).value)"></div>
          <span class="mono secondary">{{ clock(match.duration || 120) }}</span>
          <select (change)="match.speed = +$any($event.target).value"><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select>
        </div>
        <div class="robot-stats">
          @for (robot of hud?.robots ?? []; track $index) {
            <article class="robot-card" [class]="'robot-card robot-' + $index"><div class="robot-ident"><div><span class="eyebrow">ROBOT {{ $index === 0 ? 'A' : 'B' }}</span><h2>{{ robot.name }}</h2></div><span class="status-tag">{{ ['ACTIVE', 'FLIPPED', 'RECOVERING', 'OUT'][robot.status] }}</span></div><div class="energy-row"><span>Energy</span><strong>{{ robot.energy.toFixed(0) }}</strong></div></article>
          }
        </div>
      </div>
      <aside class="match-sidebar">
        <div class="side-head"><h2>Set up match</h2></div>
        <div class="side-body">
          <label class="field-label">ROBOT A</label>
          <select class="bot-select" [selectedIndex]="match.a()" (change)="match.a.set(+$any($event.target).value)" [disabled]="match.busy()">
            @for (name of match.names(); track $index) { <option [value]="$index">{{ name }}</option> }
          </select>
          <label class="field-label">ROBOT B</label>
          <select class="bot-select" [selectedIndex]="match.b()" (change)="match.b.set(+$any($event.target).value)" [disabled]="match.busy()">
            @for (name of match.names(); track $index) { <option [value]="$index">{{ name }}</option> }
          </select>
          <div class="seed-row">
            <div><label class="field-label">SEED</label><input type="number" min="0" max="4294967295" step="1" [value]="match.seed()" (input)="match.seed.set(+$any($event.target).value)"></div>
            <div><label class="field-label">SPAWN</label><select [value]="match.mirrored() ? 'mirror' : 'normal'" (change)="match.mirrored.set($any($event.target).value === 'mirror')"><option value="normal">Standard</option><option value="mirror">Mirrored</option></select></div>
          </div>
          <button class="button accent run-button" [disabled]="match.busy()" (click)="match.simulate()">Simulate match</button>
          <button class="button outline run-button" [disabled]="match.busy()" (click)="match.playManual()">Play yourself vs Robot B</button>
          @if (match.message()) { <p class="field-note">{{ match.message() }}</p> }
        </div>
        <div class="mode-box"><span class="eyebrow">SPIKE</span><p>Angular 22 zoneless over the existing sim, runtime and three.js viewer. The 60 Hz stream never touches a signal.</p></div>
      </aside>
    </div>
  `,
})
export class ArenaPage {
  protected readonly match = inject(MatchService);
  protected readonly clock = clock;
  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      this.match.mount(this.viewport().nativeElement);
      // The opening match, like the current viewer.
      if (!this.match.replay()) this.match.simulate();
    });
    destroy.onDestroy(() => this.match.unmount());
  }
  protected outcome(replay: any) {
    const winner = replay.result.winner;
    return winner === null ? 'Draw.' : `${this.match.hud()?.robots[winner]?.name ?? 'Robot'} wins.`;
  }
  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    if (this.match.key(e.code, true)) e.preventDefault();
  }
  @HostListener('document:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent) {
    this.match.key(e.code, false);
  }
}
