// Spike: the arena panel inside an Angular component. It answers the questions
// a migration cannot answer on paper - can the three.js viewer, the match
// worker and the QuickJS sandbox live in this build, and does the page still
// prerender to static HTML for GitHub Pages.
import {
  Component,
  ElementRef,
  afterNextRender,
  signal,
  viewChild,
} from '@angular/core';

type Bot = { id: string; model: string; source: string; extension: string };

@Component({
  selector: 'app-arena-stage',
  template: `
    <header>
      <h1>Arena spike</h1>
      <p>{{ status() }}</p>
    </header>
    <div class="stage" #stage></div>
    <footer>
      <button type="button" (click)="simulate()" [disabled]="busy() || !ready()">
        Simulate match
      </button>
      <span>{{ detail() }}</span>
    </footer>
  `,
  styles: `
    :host { display: block; max-width: 1100px; margin: 40px auto; padding: 0 24px;
      font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; color: #e6edf1; }
    .stage { aspect-ratio: 16 / 9; background: #0b0f13; border: 1px solid #252d31;
      border-radius: 6px; overflow: hidden; margin: 20px 0; }
    footer { display: flex; gap: 16px; align-items: center; }
    button { padding: 10px 18px; border-radius: 4px; border: 0; background: #c3f66b;
      font: inherit; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.4; cursor: wait; }
  `,
})
export class ArenaStage {
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  protected readonly status = signal('Server rendered. The viewer starts in the browser.');
  protected readonly detail = signal('');
  protected readonly busy = signal(false);
  protected readonly ready = signal(false);
  private viewer: { load(replay: unknown): void; playing: boolean } | null = null;
  private bots: Bot[] = [];

  constructor() {
    // Nothing here runs on the server: three.js needs a canvas, the workers
    // need the browser.
    afterNextRender(async () => {
      try {
        const [{ ArenaViewer }, bots] = await Promise.all([
          import('../../../../packages/viewer/arena.js') as Promise<any>,
          fetch('bots.json').then((r) => r.json() as Promise<Bot[]>),
        ]);
        this.bots = bots;
        this.viewer = new ArenaViewer(this.stage().nativeElement, () => {});
        this.ready.set(true);
        this.status.set('Viewer ready.');
        this.simulate();
      } catch (error) {
        this.status.set('The viewer could not start: ' + (error as Error).message);
      }
    });
  }

  protected simulate() {
    if (this.busy() || !this.viewer) return;
    this.busy.set(true);
    this.status.set('Simulating a match in the worker.');
    const worker = new Worker(
      new URL('../../../../packages/runtime/match-worker.js', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        this.detail.set(`Simulation ${Math.round(data.progress * 100)}%`);
        return;
      }
      if (data.type === 'error') {
        this.status.set('The match failed: ' + data.message);
        this.detail.set('');
      }
      if (data.type === 'replay') {
        this.status.set(
          `${this.bots[0].model} vs ${this.bots[1].model} · ${data.replay.result.reason}`,
        );
        this.detail.set(`${data.replay.result.ticks} ticks simulated`);
        this.viewer!.load(data.replay);
        this.viewer!.playing = true;
      }
      worker.terminate();
      this.busy.set(false);
    };
    worker.postMessage({
      type: 'match',
      bots: this.bots.slice(0, 2),
      seed: 7,
      mirrored: false,
    });
  }
}
