import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { botName, botDetails } from '../../../../../packages/bot-catalog.js';
import { robotColor } from '../../../../../packages/renderer/palette.js';
import { matchOutcome } from '../../../../../packages/renderer/recorder.js';
import type { Replay } from '../../../../../packages/renderer/arena.js';
import { Icon } from '../core/icons';
import { BotsStore } from '../core/bots.store';
import { ToastService } from '../core/toast.service';
import { clock, siteUrl } from '../core/url';
import { ArenaStore, coarsePointer } from './arena.store';
import { ViewerService } from './viewer.service';

const MARKED = ['flip', 'ring-out', 'hole', 'recharge', 'collapse-warning', 'collapse', 'eliminated'];

@Component({
  selector: 'arena-page',
  imports: [Icon],
  host: {
    id: 'panel-arena', class: 'panel',
    '(document:keydown)': 'onKeyDown($event)',
    '(document:keyup)': 'onKeyUp($event)',
    '(window:blur)': 'onBlur()',
  },
  templateUrl: './arena-page.html',
})
export class ArenaPage {
  protected readonly arena = inject(ArenaStore);
  protected readonly viewer = inject(ViewerService);
  protected readonly bots = inject(BotsStore);
  private readonly toast = inject(ToastService);
  protected readonly clock = clock;
  protected readonly Number = Number;
  protected readonly coarse = coarsePointer();
  protected readonly cameraView = signal<'auto' | string>('auto');
  protected readonly manualCamera = signal(false);
  protected readonly held = signal(new Set<string>());
  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');

  protected readonly cards = computed(() => this.arena.replay()?.bots ?? this.bots.builtins.slice(0, 2));
  protected readonly seedLabel = computed(() => {
    const r = this.arena.replay();
    return r ? `${String(r.seed).padStart(2, '0')} ${r.mirrored ? '· M' : ''}` : '00';
  });
  protected readonly notable = computed(() => (this.viewer.hud()?.events ?? []).filter((e: any) => e.type !== 'impact' || e.closingSpeed > 0.3));
  protected readonly marks = computed(() => {
    const r = this.arena.replay();
    if (!r?.result.ticks || this.arena.live()) return [];
    return r.events.filter((e) => MARKED.includes(e.type)).map((e) => ({ type: e.type, left: ((e.tick + 1) / r.result.ticks) * 100 }));
  });
  protected readonly hashLabel = computed(() => {
    const r = this.arena.replay(), time = this.viewer.hud()?.time ?? 0;
    const last = r?.stateHashes.filter((h) => h.tick <= time * 60).at(-1);
    return last ? 'SHA-256 ' + last.hash.slice(0, 12) + '…' : 'SHA-256 · HASH EVERY 60 TICKS';
  });
  protected readonly cameraHint = computed(() => {
    const view = this.cameraView();
    if (this.manualCamera()) return 'Drag to orbit · right-drag to pan · scroll or pinch to zoom';
    if (view === 'auto') return 'Auto camera · follows every robot';
    const bot = this.arena.replay()?.bots[Number(view)];
    return `Behind ${bot ? botName(bot) : 'robot'} · its closest rival stays in frame`;
  });

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      this.viewer.attach(this.viewport().nativeElement);
      this.arena.loadLibrary(siteUrl('replays.json'));
      this.arena.arm();
    });
    destroy.onDestroy(() => this.viewer.detach());
  }

  protected name = (bot: { model?: string }) => botName(bot as any);
  protected details = (bot: object) => botDetails(bot as any);
  protected letter = (i: number) => String.fromCharCode(65 + i);
  protected color = (i: number) => robotColor(i).css;
  protected outcome = (replay: Replay) => matchOutcome(replay);
  protected status(state?: { status: number; hole?: boolean; ringOut?: boolean }) {
    if (!state) return 'ACTIVE';
    return state.hole ? 'FELL THROUGH' : state.ringOut ? 'RING-OUT' : ['ACTIVE', 'FLIPPED', 'RECOVERING', 'OUT'][state.status];
  }
  protected eventLabel(e: any) {
    const bots = this.arena.replay()?.bots ?? [];
    const who = () => botName(bots[e.robot] ?? { model: 'Robot' });
    return e.type === 'collapse-warning' ? `Floor cell ${e.cell} unstable${e.cause === 'weight' ? ' under robot weight' : ''}: 3-second warning`
      : e.type === 'collapse' ? `Floor cell ${e.cell} collapsed${e.cause === 'weight' ? ' under robot weight' : ''}`
      : e.type === 'impact' ? `Impact · ${e.closingSpeed.toFixed(1)} m/s`
      : e.type === 'flip' ? `${who()} flipped`
      : e.type === 'ring-out' ? `${who()} out of the arena`
      : e.type === 'hole' ? `${who()} fell through a hole`
      : e.type === 'recharge' ? `${who()} recharged +${e.amount.toFixed(1)}`
      : e.type === 'fire-damage' ? `${who()} taking fire damage`
      : e.type === 'eliminated' ? `${who()} is out (${e.reason})`
      : e.type === 'recovery' ? `${who()} self-rights`
      : e.type === 'violation' ? `${who()}: ${e.reason}`
      : 'Engine violation';
  }
  protected setCameraView(value: string) {
    this.cameraView.set(value);
    this.viewer.viewer?.setCameraView(value === 'auto' ? 'auto' : Number(value));
  }
  protected setManualCamera(on: boolean) {
    this.manualCamera.set(on);
    this.viewer.viewer?.setManualCamera(on);
  }
  protected async fullscreen(stage: HTMLElement) {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch {
      this.toast.show('Fullscreen is unavailable in this browser.');
    }
  }
  protected record() {
    const replay = this.arena.replay();
    if (!replay) return this.toast.show('Simulate or import a match first.', true);
    this.viewer.record(replay);
  }
  protected async importFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (file) await this.arena.importFile(file);
    input.value = '';
  }
  protected openLibrary(name: string) {
    if (name) this.arena.openLibrary(name);
  }
  // Touch buttons feed the same held set as the keys: a finger down is a key down.
  protected touch(event: PointerEvent, control: string, down: boolean) {
    const button = event.currentTarget as HTMLButtonElement;
    if (down) {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
    }
    const held = new Set(this.held());
    down ? held.add(control) : held.delete(control);
    if (held.size !== this.held().size) {
      this.held.set(held);
      this.arena.key('touch:' + control, down);
    }
  }
  onKeyDown(e: KeyboardEvent) {
    if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement as Element)?.tagName ?? '')) return;
    if (this.arena.key(e.code, true)) e.preventDefault();
  }
  onKeyUp(e: KeyboardEvent) {
    this.arena.key(e.code, false);
  }
  onBlur() {
    this.arena.releaseAll();
    this.held.set(new Set());
  }
}
