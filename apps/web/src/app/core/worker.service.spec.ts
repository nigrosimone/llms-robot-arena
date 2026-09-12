import { TestBed } from '@angular/core/testing';
import { type WorkerMessage } from './messages';
import { type OperationHandlers, WorkerService } from './worker.service';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;
  constructor(readonly url: URL) {
    FakeWorker.instances.push(this);
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  receive(data: WorkerMessage): void {
    this.onmessage!({ data } as MessageEvent<WorkerMessage>);
  }
}

describe('WorkerService', () => {
  let service: WorkerService;
  let handlers: OperationHandlers & {
    messages: WorkerMessage[];
    errors: string[];
    finished: number;
  };

  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    service = TestBed.inject(WorkerService);
    handlers = {
      messages: [],
      errors: [],
      finished: 0,
      onMessage: (data) => {
        handlers.messages.push(data);
      },
      onError: (message) => {
        handlers.errors.push(message);
      },
      onFinish: () => {
        handlers.finished++;
      },
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs one operation at a time in a fresh worker', () => {
    expect(service.start('match', { seed: 4 }, handlers)).toBe(true);
    expect(service.busy).toBe(true);
    expect(service.operation()).toBe('match');
    const worker = FakeWorker.instances[0]!;
    // The bundler rewrites the worker URL: only its name is stable.
    expect(String(worker.url)).toMatch(/worker/);
    expect(worker.posted).toEqual([{ type: 'match', seed: 4 }]);
    expect(service.start('gate', {}, handlers)).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('routes messages to the owner and ends on a terminal one', () => {
    service.start('match', {}, handlers);
    const worker = FakeWorker.instances[0]!;
    worker.receive({ type: 'progress', progress: 0.5 });
    expect(handlers.messages).toEqual([{ type: 'progress', progress: 0.5 }]);
    expect(service.busy).toBe(true);
    service.post({ type: 'input', thrust: 1, turn: 0 });
    expect(worker.posted.at(-1)).toEqual({ type: 'input', thrust: 1, turn: 0 });
    worker.receive({ type: 'gate', gate: { pass: true, checks: [] } });
    expect(handlers.messages).toHaveLength(2);
    expect(handlers.finished).toBe(1);
    expect(worker.terminated).toBe(true);
    expect(service.busy).toBe(false);
    expect(service.operation()).toBeNull();
  });

  it('reports errors from the message and from the worker itself', () => {
    service.start('match', {}, handlers);
    FakeWorker.instances[0]!.receive({ type: 'error', message: 'Controller crashed.' });
    expect(handlers.errors).toEqual(['Controller crashed.']);
    expect(handlers.finished).toBe(1);
    service.start('live', {}, handlers);
    FakeWorker.instances[1]!.onerror!({ message: '' } as ErrorEvent);
    expect(handlers.errors).toEqual(['Controller crashed.', 'An error occurred during execution.']);
    expect(handlers.finished).toBe(2);
    expect(service.busy).toBe(false);
  });

  it('cancels only a running operation', () => {
    expect(service.cancel()).toBe(false);
    service.start('tournament', {}, handlers);
    expect(service.cancel()).toBe(true);
    expect(FakeWorker.instances[0]!.posted.at(-1)).toEqual({ type: 'cancel' });
    expect(service.busy).toBe(true);
  });
});
