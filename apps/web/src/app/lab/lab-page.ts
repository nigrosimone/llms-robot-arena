// The Bot Lab: one controller edited at a time, checked in the worker, kept
// in this tab and downloadable. Edits are state, the textarea is the source.
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { botName, botDetails } from '../../../../../packages/bot-catalog.js';
import { controllerFilename } from '../../../../../packages/viewer/controllers.js';
import { CONTRACT_CARD } from '../../../../../packages/site/content.js';
import { Icon } from '../core/icons';
import { BotsStore } from '../core/bots.store';
import { ToastService } from '../core/toast.service';
import { WorkerService } from '../core/worker.service';
import { download } from '../core/url';
import { GateResult, gateLabel } from './gate';

@Component({
  selector: 'lab-page',
  imports: [Icon, GateResult],
  host: { id: 'panel-lab', class: 'panel' },
  template: `
    <div class="page-heading"><div><div class="eyebrow">CONTROLLER WORKSPACE <span>/ 02</span></div><h1>Your code. Your robot<span>.</span></h1></div><button id="new-bot" class="button accent" (click)="create()"><svg icon="plus"></svg>New controller</button></div>
    <div class="lab-layout"><div class="editor-panel"><div class="editor-toolbar"><select id="edit-bot" aria-label="Controller to edit" [value]="editing()" (change)="load(+$any($event.target).value)">@for (option of bots.options(); track option.index) {<option [value]="option.index" [selected]="option.index === editing()">{{ name(option.bot) }} / {{ details(option.bot) }}</option>}</select></div><div class="editor-file"><svg icon="code" [size]="16"></svg><span id="editor-filename">{{ filename() }}</span><span id="unsaved" class="unsaved" [hidden]="!unsaved()">Unsaved changes</span></div><div class="editor-body"><pre id="line-numbers" aria-hidden="true" #lines>{{ lineNumbers() }}</pre><textarea id="code-editor" aria-label="Controller source" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" #editor [value]="source()" (input)="edit(editor.value)" (scroll)="lines.scrollTop = editor.scrollTop" (keydown)="tab($event, editor)"></textarea></div><div class="editor-footer"><input id="bot-name" aria-label="Model name" placeholder="Model name" maxlength="80" [value]="model()" (input)="model.set($any($event.target).value); unsaved.set(true)"><select id="bot-provider" aria-label="Model provider" [value]="provider()" (change)="provider.set($any($event.target).value); unsaved.set(true)"><option value="">No provider</option><option>OpenAI</option><option>Anthropic</option></select><button id="download-bot" class="button outline" (click)="save(true)"><svg icon="download"></svg>.js file</button><button id="save-bot" class="button accent" (click)="save()">Save controller</button></div></div>
      <aside class="lab-sidebar"><div class="info-card" [innerHTML]="contract"></div><div class="info-card gate-card"><div class="eyebrow">CONFORMANCE GATE</div><h2>Validate the contract.</h2><p>200 snapshots and 600 inert ticks. These checks offer no combat advice.</p><button id="run-gate" class="button outline full-width" [disabled]="worker.operation() !== null" (click)="check()"><svg icon="check"></svg>Check controller</button><div id="gate-results" aria-live="polite">
        @if (checking()) {<p class="gate-running"><span class="loader"></span>Checking 200 snapshots and 600 ticks…</p>}
        @else if (failure()) {<p class="gate-fail">{{ failure() }}</p>}
        @else if (gate()) {<gate-result [gate]="gate()!" />}
      </div></div><p class="side-hint">Edits here are iterative experimentation. For a one-shot benchmark, follow AGENTS.md and use the project CLI.</p></aside>
    </div>
  `,
})
export class LabPage {
  protected readonly bots = inject(BotsStore);
  protected readonly worker = inject(WorkerService);
  private readonly toast = inject(ToastService);
  protected readonly contract = CONTRACT_CARD;
  protected readonly editing = signal(0);
  protected readonly source = signal('');
  protected readonly model = signal('');
  protected readonly provider = signal('');
  protected readonly unsaved = signal(false);
  protected readonly checking = signal(false);
  protected readonly gate = signal<any>(null);
  protected readonly failure = signal('');
  protected readonly lineNumbers = computed(() => Array.from({ length: this.source().split('\n').length }, (_, i) => i + 1).join('\n'));
  protected readonly filename = computed(() => controllerFilename(this.model()));
  private readonly editor = viewChild.required<ElementRef<HTMLTextAreaElement>>('editor');

  constructor() {
    this.load(0);
  }
  protected name = (bot: object) => botName(bot as any);
  protected details = (bot: object) => botDetails(bot as any);
  protected load(index: number) {
    const bot = this.bots.bots()[index];
    if (!bot) return;
    this.editing.set(index);
    this.source.set(bot.source);
    this.model.set(botName(bot as any));
    this.provider.set(bot.provider ?? '');
    this.unsaved.set(false);
    this.gate.set(null);
    this.failure.set('');
  }
  protected edit(value: string) {
    this.source.set(value);
    this.unsaved.set(true);
  }
  protected tab(e: KeyboardEvent, el: HTMLTextAreaElement) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
    this.edit(el.value);
  }
  protected create() {
    const template = this.bots.builtins.find((bot) => bot.provenance === 'reference');
    if (!template) return this.toast.show('No reference controller is registered.', true);
    const count = this.bots.bots().length - this.bots.builtins.length + 1;
    const index = this.bots.add({ id: this.bots.customId(), model: 'Custom controller ' + count, provider: null, provenance: 'iterative', source: template.source });
    this.load(index);
    this.toast.show('Controller created from the reference controller.');
  }
  protected save(asFile = false) {
    if (asFile) return download(this.filename(), this.editor().nativeElement.value, 'text/plain');
    const bots = this.bots.bots(), editing = this.editing();
    let model = this.model().trim();
    if (!model) return this.toast.show('Enter a model name.', true);
    if (this.bots.isRegistered(editing) && model === botName(bots[editing] as any)) model += ' (custom)';
    if (bots.some((bot, i) => i !== editing && botName(bot as any) === model)) return this.toast.show('This name is already in use.', true);
    const copy = { id: this.bots.isRegistered(editing) ? this.bots.customId() : bots[editing].id, model, provider: this.provider() || null, provenance: 'iterative', source: this.source() };
    const index = this.bots.isRegistered(editing) ? this.bots.add(copy) : (this.bots.replace(editing, copy), editing);
    this.load(index);
    this.toast.show('Controller is ready in the match selectors. Download the file to keep a copy.');
  }
  protected check() {
    if (this.worker.busy) return this.toast.show('Wait for the current operation or cancel it.');
    this.checking.set(true);
    this.failure.set('');
    this.worker.start('gate', { source: this.source() }, {
      onMessage: (data) => data.type === 'gate' && this.gate.set(data.gate),
      onError: (message) => {
        this.failure.set(message);
        this.toast.show(message, true);
      },
      onFinish: () => this.checking.set(false),
    });
  }
}
export { gateLabel };
