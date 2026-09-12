import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { botDetails, botName } from '../../../../../packages/bot-catalog.js';
import { controllerFilename } from '../../../../../packages/viewer/controllers.js';
import { CONTRACT_CARD } from '../../../../../packages/site/content.js';
import { type GateVerdict } from '../../../../../packages/tournament/exhibition.js';
import { AssistantCard } from '../core/assistant-card';
import { Icon } from '../core/icons';
import { BotsStore } from '../core/bots.store';
import { ToastService } from '../core/toast.service';
import { WorkerService } from '../core/worker.service';
import { download, inputValue } from '../core/url';
import { GateResult } from './gate';

/**
 * The Bot Lab: one controller edited at a time, checked in the worker, kept
 * in this tab and downloadable. Edits are state, the textarea is the source.
 */
@Component({
  selector: 'app-lab-page',
  imports: [Icon, GateResult, AssistantCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { id: 'panel-lab', class: 'panel' },
  templateUrl: './lab-page.html',
})
export class LabPage {
  protected readonly bots = inject(BotsStore);
  protected readonly worker = inject(WorkerService);
  private readonly toast = inject(ToastService);
  protected readonly contract = CONTRACT_CARD;
  protected readonly value = inputValue;
  protected readonly editing = signal(0);
  protected readonly source = signal('');
  protected readonly model = signal('');
  protected readonly provider = signal('');
  protected readonly unsaved = signal(false);
  protected readonly checking = signal(false);
  protected readonly gate = signal<GateVerdict | null>(null);
  protected readonly failure = signal('');
  protected readonly lineNumbers = computed(() =>
    Array.from({ length: this.source().split('\n').length }, (_, i) => i + 1).join('\n'),
  );
  protected readonly filename = computed(() => controllerFilename(this.model()));
  private readonly editor = viewChild.required<ElementRef<HTMLTextAreaElement>>('editor');

  constructor() {
    this.load(0);
  }
  /** Display name of a controller. */
  protected name = (bot: { model?: string }): string => botName(bot);
  /** Provider line of a controller. */
  protected details = (bot: { provider?: string | null }): string => botDetails(bot);
  /** Puts the controller at `index` in the editor, dropping unsaved edits. */
  protected load(index: number): void {
    const bot = this.bots.bots()[index];
    if (!bot) return;
    this.editing.set(index);
    this.source.set(bot.source);
    this.model.set(botName(bot));
    this.provider.set(bot.provider ?? '');
    this.unsaved.set(false);
    this.gate.set(null);
    this.failure.set('');
  }
  /** Records a change of the source. */
  protected edit(value: string): void {
    this.source.set(value);
    this.unsaved.set(true);
  }
  /** Records a change of the model or provider field. */
  protected touch(field: 'model' | 'provider', event: Event): void {
    this[field].set(inputValue(event));
    this.unsaved.set(true);
  }
  /** Tab inserts two spaces instead of leaving the textarea. */
  protected tab(e: KeyboardEvent, el: HTMLTextAreaElement): void {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
    this.edit(el.value);
  }
  /** Starts a new controller from the reference one. */
  protected create(): void {
    const template = this.bots.builtins.find((bot) => bot.provenance === 'reference');
    if (!template) {
      this.toast.show('No reference controller is registered.', true);
      return;
    }
    const count = this.bots.bots().length - this.bots.builtins.length + 1;
    const index = this.bots.add({
      id: this.bots.customId(),
      model: 'Custom controller ' + String(count),
      provider: null,
      provenance: 'iterative',
      source: template.source,
    });
    this.load(index);
    this.toast.show('Controller created from the reference controller.');
  }
  /** Keeps the edits in the tab as a custom controller, or downloads them as a file. */
  protected save(asFile = false): void {
    if (asFile) {
      download(this.filename(), this.editor().nativeElement.value, 'text/plain');
      return;
    }
    const bots = this.bots.bots(),
      editing = this.editing();
    const current = bots[editing];
    if (!current) return;
    let model = this.model().trim();
    if (!model) {
      this.toast.show('Enter a model name.', true);
      return;
    }
    if (this.bots.isRegistered(editing) && model === botName(current)) model += ' (custom)';
    if (bots.some((bot, i) => i !== editing && botName(bot) === model)) {
      this.toast.show('This name is already in use.', true);
      return;
    }
    const copy = {
      id: this.bots.isRegistered(editing) ? this.bots.customId() : current.id,
      model,
      provider: this.provider() || null,
      provenance: 'iterative',
      source: this.source(),
    };
    let index = editing;
    if (this.bots.isRegistered(editing)) index = this.bots.add(copy);
    else this.bots.replace(editing, copy);
    this.load(index);
    this.toast.show(
      'Controller is ready in the match selectors. Download the file to keep a copy.',
    );
  }
  /** Runs the conformance gate on the source in the worker. */
  protected check(): void {
    if (this.worker.busy) {
      this.toast.show('Wait for the current operation or cancel it.');
      return;
    }
    this.checking.set(true);
    this.failure.set('');
    this.worker.start(
      'gate',
      { source: this.source() },
      {
        onMessage: (data) => {
          if (data.type === 'gate') this.gate.set(data.gate);
        },
        onError: (message) => {
          this.failure.set(message);
          this.toast.show(message, true);
        },
        onFinish: () => {
          this.checking.set(false);
        },
      },
    );
  }
}
