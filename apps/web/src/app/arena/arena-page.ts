import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { botDetails, botName } from '../../../../../packages/bot-catalog.js';
import { robotColor } from '../../../../../packages/renderer/palette.js';
import { matchOutcome } from '../../../../../packages/renderer/recorder.js';
import { type Replay, type ReplayEvent } from '../../../../../packages/sim/replay.js';
import { AssistantCard } from '../core/assistant-card';
import { Icon } from '../core/icons';
import { BotsStore } from '../core/bots.store';
import { ToastService } from '../core/toast.service';
import { clock, inputChecked, inputValue, siteUrl } from '../core/url';
import { ArenaStore, coarsePointer } from './arena.store';
import { type HudRobot, ViewerService } from './viewer.service';

const MARKED = new Set([
  'flip',
  'ring-out',
  'hole',
  'recharge',
  'collapse-warning',
  'collapse',
  'eliminated',
]);
const STATUSES = ['ACTIVE', 'FLIPPED', 'RECOVERING', 'OUT'];

/** The arena panel: the stage with its HUD, the match settings and the replay tools. */
@Component({
  selector: 'app-arena-page',
  imports: [Icon, AssistantCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    id: 'panel-arena',
    class: 'panel',
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
  protected readonly value = inputValue;
  protected readonly checked = inputChecked;
  protected readonly coarse = coarsePointer();
  protected readonly cameraView = signal('auto');
  protected readonly manualCamera = signal(false);
  protected readonly held = signal(new Set<string>());
  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');

  protected readonly cards = computed(
    () => this.arena.replay()?.bots ?? this.bots.builtins.slice(0, 2),
  );
  protected readonly seedLabel = computed(() => {
    const r = this.arena.replay();
    return r ? `${String(r.seed).padStart(2, '0')} ${r.mirrored ? '· M' : ''}` : '00';
  });
  protected readonly notable = computed(() =>
    (this.viewer.hud()?.events ?? []).filter(
      (e) => e.type !== 'impact' || (e.closingSpeed ?? 0) > 0.3,
    ),
  );
  protected readonly marks = computed(() => {
    const r = this.arena.replay();
    if (!r?.result.ticks || this.arena.live()) return [];
    return r.events
      .filter((e) => MARKED.has(e.type))
      .map((e) => ({ type: e.type, left: ((e.tick + 1) / r.result.ticks) * 100 }));
  });
  protected readonly hashLabel = computed(() => {
    const r = this.arena.replay(),
      time = this.viewer.hud()?.time ?? 0;
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
      void this.arena.loadLibrary(siteUrl('replays.json'));
      this.arena.arm();
    });
    destroy.onDestroy(() => {
      this.viewer.detach();
    });
  }

  /** Display name of a controller. */
  protected name = (bot: { model?: string }): string => botName(bot);
  /** Provider line of a controller. */
  protected details = (bot: { provider?: string | null }): string => botDetails(bot);
  /** Robot letter: A, B, C... */
  protected letter = (i: number): string => String.fromCharCode(65 + i);
  /** Robot colour as CSS. */
  protected color = (i: number): string => robotColor(i).css;
  /** Winner and reason of a finished replay. */
  protected outcome = (replay: Replay): { title: string; reason: string } => matchOutcome(replay);
  /** The status word on a robot card. */
  protected status(state: HudRobot | undefined): string {
    if (!state) return 'ACTIVE';
    return state.hole
      ? 'FELL THROUGH'
      : state.ringOut
        ? 'RING-OUT'
        : (STATUSES[state.status] ?? 'ACTIVE');
  }
  /** One line of the event log. */
  protected eventLabel(e: ReplayEvent): string {
    const bots = this.arena.replay()?.bots ?? [];
    const who = (): string => {
      const bot = e.robot === undefined ? undefined : bots[e.robot];
      return bot ? botName(bot) : 'Robot';
    };
    const weight = e.cause === 'weight' ? ' under robot weight' : '';
    switch (e.type) {
      case 'collapse-warning':
        return `Floor cell ${e.cell ?? ''} unstable${weight}: 3-second warning`;
      case 'collapse':
        return `Floor cell ${e.cell ?? ''} collapsed${weight}`;
      case 'impact':
        return `Impact · ${(e.closingSpeed ?? 0).toFixed(1)} m/s`;
      case 'flip':
        return `${who()} flipped`;
      case 'ring-out':
        return `${who()} out of the arena`;
      case 'hole':
        return `${who()} fell through a hole`;
      case 'recharge':
        return `${who()} recharged +${(e.amount ?? 0).toFixed(1)}`;
      case 'fire-damage':
        return `${who()} taking fire damage`;
      case 'eliminated':
        return `${who()} is out (${e.reason ?? ''})`;
      case 'recovery':
        return `${who()} self-rights`;
      case 'violation':
        return `${who()}: ${e.reason ?? ''}`;
      default:
        return 'Engine violation';
    }
  }
  /** The glyph before an event line. */
  protected symbol(e: ReplayEvent): string {
    return e.type === 'impact' ? '×' : e.type === 'flip' ? '↻' : '·';
  }
  /** Auto camera or the camera behind one robot. */
  protected setCameraView(value: string): void {
    this.cameraView.set(value);
    this.viewer.viewer?.setCameraView(value === 'auto' ? 'auto' : Number(value));
  }
  /** Hands the camera to the mouse, or back to the automatic one. */
  protected setManualCamera(on: boolean): void {
    this.manualCamera.set(on);
    this.viewer.viewer?.setManualCamera(on);
  }
  /** Toggles fullscreen on the stage. */
  protected async fullscreen(stage: HTMLElement): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch {
      this.toast.show('Fullscreen is unavailable in this browser.');
    }
  }
  /** Exports the replay on the stage as a video. */
  protected record(): void {
    const replay = this.arena.replay();
    if (!replay) {
      this.toast.show('Simulate or import a match first.', true);
      return;
    }
    void this.viewer.record(replay);
  }
  /** Loads the chosen replay file and clears the input for the next one. */
  protected async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (file) await this.arena.importFile(file);
    input.value = '';
  }
  /** Opens a replay picked in the library select. */
  protected openLibrary(name: string): void {
    if (name) void this.arena.openLibrary(name);
  }
  /** Reads the seed field. */
  protected setSeed(event: Event): void {
    this.arena.setState({ seed: Number(inputValue(event)) });
  }
  /** Touch buttons feed the same held set as the keys: a finger down is a key down. */
  protected touch(event: PointerEvent, control: string, down: boolean): void {
    const button = event.currentTarget as HTMLButtonElement;
    if (down) {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
    }
    const held = new Set(this.held());
    if (down) held.add(control);
    else held.delete(control);
    if (held.size !== this.held().size) {
      this.held.set(held);
      this.arena.key('touch:' + control, down);
    }
  }
  /** Drives the manual duel from the keyboard, except while typing in a field. */
  onKeyDown(e: KeyboardEvent): void {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '')) return;
    if (this.arena.key(e.code, true)) e.preventDefault();
  }
  /** Releases a control key. */
  onKeyUp(e: KeyboardEvent): void {
    this.arena.key(e.code, false);
  }
  /** Releases everything when the window loses focus, so no key stays stuck. */
  onBlur(): void {
    this.arena.releaseAll();
    this.held.set(new Set());
  }
}
