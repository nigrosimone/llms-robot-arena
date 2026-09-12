import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { botName } from '../../../../../packages/bot-catalog.js';
import { controllerFilename } from '../../../../../packages/viewer/controllers.js';
import { FakeWorkerService, storeProviders } from '../../testing/fakes';
import { BotsStore } from '../core/bots.store';
import { ToastService } from '../core/toast.service';
import { WorkerService } from '../core/worker.service';
import { LabPage } from './lab-page';

describe('LabPage', () => {
  let fixture: ComponentFixture<LabPage>;
  let el: HTMLElement;
  let bots: BotsStore;
  let worker: FakeWorkerService;
  let toast: ToastService;
  const query = (selector: string): HTMLElement => {
    const found = el.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`Missing ${selector}`);
    return found;
  };
  const type = (selector: string, value: string): void => {
    const input = query(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [LabPage],
      providers: [...storeProviders, { provide: WorkerService, useClass: FakeWorkerService }],
    });
    bots = TestBed.inject(BotsStore);
    worker = TestBed.inject(WorkerService) as unknown as FakeWorkerService;
    toast = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(LabPage);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });

  it('opens the first controller in the editor', () => {
    const first = bots.builtins[0]!;
    expect((query('#code-editor') as HTMLTextAreaElement).value).toBe(first.source);
    expect(query('#editor-filename').textContent).toBe(controllerFilename(botName(first)));
    expect((query('#edit-bot') as HTMLSelectElement).options).toHaveLength(bots.builtins.length);
    expect(query('#unsaved').hidden).toBe(true);
  });

  it('creates a controller from the reference one and saves it under a free name', async () => {
    const count = bots.builtins.length;
    query('#new-bot').click();
    await fixture.whenStable();
    expect(bots.bots()).toHaveLength(count + 1);
    expect((query('#bot-name') as HTMLInputElement).value).toBe('Custom controller 1');
    expect(toast.message()).toBe('Controller created from the reference controller.');
    type('#code-editor', '// edited');
    await fixture.whenStable();
    expect(query('#unsaved').hidden).toBe(false);
    type('#bot-name', '');
    query('#save-bot').click();
    expect(toast.message()).toBe('Enter a model name.');
    type('#bot-name', botName(bots.builtins[0]!));
    query('#save-bot').click();
    expect(toast.message()).toBe('This name is already in use.');
    type('#bot-name', 'My robot');
    query('#save-bot').click();
    await fixture.whenStable();
    expect(bots.bots()).toHaveLength(count + 1);
    expect(bots.bots()[count]).toMatchObject({ model: 'My robot', source: '// edited' });
    expect(query('#unsaved').hidden).toBe(true);
    expect(toast.message()).toContain('ready in the match selectors');
  });

  it('saving a registered controller keeps it as a copy', async () => {
    type('#code-editor', '// mine');
    query('#save-bot').click();
    await fixture.whenStable();
    const copy = bots.bots().at(-1)!;
    expect(bots.bots()).toHaveLength(bots.builtins.length + 1);
    expect(copy.model).toBe(botName(bots.builtins[0]!) + ' (custom)');
    expect(copy.id).toBe('custom-1');
    expect(bots.builtins[0]!.source).not.toBe('// mine');
  });

  it('checks the source in the worker and shows the verdict', async () => {
    query('#run-gate').click();
    await fixture.whenStable();
    expect(worker.last.type).toBe('gate');
    expect(worker.last.data['source']).toBe(bots.builtins[0]!.source);
    expect(query('#gate-results').textContent).toContain('Checking');
    worker.emit({
      type: 'gate',
      gate: {
        pass: false,
        eligible: true,
        checks: [
          { name: 'Purity', pass: true },
          { name: 'Timing', pass: false, required: false, detail: 'p99 3.1 ms' },
        ],
      },
    });
    await fixture.whenStable();
    expect(query('.gate-verdict').textContent).toContain('Ready for exhibition');
    expect(el.querySelectorAll('.gate-check')).toHaveLength(2);
    expect(query('.gate-check.advisory').textContent).toContain('timing advisory');
    expect(query('.gate-advisory').textContent).toContain('timing is advisory');
    query('#run-gate').click();
    worker.emit({ type: 'error', message: 'Syntax error.' });
    await fixture.whenStable();
    expect(query('.gate-fail').textContent).toBe('Syntax error.');
  });
});
