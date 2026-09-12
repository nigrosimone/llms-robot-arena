import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ArenaStore } from '../arena/arena.store';
import { ViewerService } from '../arena/viewer.service';
import { FakeViewerService, FakeWorkerService, storeProviders } from '../../testing/fakes';
import { AssistantService } from './assistant.service';
import { BotsStore } from './bots.store';
import { ToastService } from './toast.service';
import { WorkerService } from './worker.service';

class FakeSocket {
  static last: FakeSocket | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(text: string): void {
    this.sent.push(text);
  }
  close(): void {
    this.closed = true;
    this.onclose?.();
  }
  receive(message: object): void {
    this.onmessage!({ data: JSON.stringify(message) });
  }
}
const GATE = { pass: true, checks: [] };

describe('AssistantService', () => {
  let service: AssistantService;
  let bots: BotsStore;
  let worker: FakeWorkerService;
  let toast: ToastService;

  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
    sessionStorage.clear();
    history.replaceState(null, '', '/lab/');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        ...storeProviders,
        { provide: WorkerService, useClass: FakeWorkerService },
        { provide: ViewerService, useClass: FakeViewerService },
      ],
    });
    service = TestBed.inject(AssistantService);
    bots = TestBed.inject(BotsStore);
    worker = TestBed.inject(WorkerService) as unknown as FakeWorkerService;
    toast = TestBed.inject(ToastService);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens a session on the live server and shows the code and the invitation', () => {
    service.connect();
    expect(service.status()).toBe('connecting');
    const socket = FakeSocket.last!;
    expect(socket.url).toBe('wss://live.llms-robot-arena.sndesign.it/session');
    socket.receive({
      type: 'session',
      code: 'K7QM2X',
      mcp: 'https://live.example/mcp',
      idleMinutes: 30,
    });
    expect(service.status()).toBe('connected');
    expect(service.code()).toBe('K7QM2X');
    expect(service.invitation()).toContain('session K7QM2X');
    expect(service.invitation()).toContain('https://live.example/mcp');
    socket.receive({ type: 'activity', kind: 'gate', summary: 'Gate passed' });
    expect(service.activity().map((a) => a.summary)).toEqual(['Gate passed']);
    service.disconnect();
    expect(socket.closed).toBe(true);
    expect(service.status()).toBe('off');
    expect(service.code()).toBe('');
  });

  it('points at a local server with ?live= and reports an unreachable one', () => {
    history.replaceState(null, '', '/lab/?live=http://127.0.0.1:8787/');
    service.connect();
    expect(FakeSocket.last!.url).toBe('ws://127.0.0.1:8787/session');
    FakeSocket.last!.onerror!();
    expect(service.status()).toBe('unavailable');
    history.replaceState(null, '', '/lab/');
    service.connect();
    expect(FakeSocket.last!.url).toBe('ws://127.0.0.1:8787/session');
  });

  it('a pushed controller waits for the visitor, then joins the lab and fights Baseline', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    service.connect();
    const socket = FakeSocket.last!;
    socket.receive({
      type: 'session',
      code: 'ABCDEF',
      mcp: 'https://live.example/mcp',
      idleMinutes: 30,
    });
    socket.receive({
      type: 'controller',
      id: 3,
      name: 'Cornerhawk',
      model: 'Test model',
      source: '// bot',
      gate: GATE,
    });
    expect(service.offer()?.name).toBe('Cornerhawk');
    expect(toast.message()).toContain('Cornerhawk is waiting for you');
    expect(bots.bots()).toHaveLength(bots.builtins.length);
    service.accept();
    expect(socket.sent).toEqual([JSON.stringify({ type: 'decision', id: 3, accepted: true })]);
    expect(service.offer()).toBeNull();
    const added = bots.bots().at(-1)!;
    expect(added).toMatchObject({
      model: 'Cornerhawk',
      provider: 'Test model',
      harness: 'MCP',
      provenance: 'iterative',
      source: '// bot',
    });
    const arena = TestBed.inject(ArenaStore);
    expect(arena.a()).toBe(bots.bots().length - 1);
    expect(bots.builtins[arena.b()]?.provenance).toBe('reference');
    expect(navigate).toHaveBeenCalledWith('/');
    await vi.waitFor(() => {
      expect(worker.last.type).toBe('match');
    });
    expect((worker.last.data['bots'] as { source: string }[])[0]?.source).toBe('// bot');
    socket.receive({
      type: 'controller',
      id: 4,
      name: 'Cornerhawk',
      model: null,
      source: '// v2',
      gate: GATE,
    });
    service.reject();
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: 'decision', id: 4, accepted: false }));
    expect(toast.message()).toBe('Cornerhawk was rejected.');
    socket.receive({
      type: 'controller',
      id: 5,
      name: 'Cornerhawk',
      model: null,
      source: '// v2',
      gate: GATE,
    });
    worker.finish();
    service.accept();
    expect(bots.bots().at(-1)?.model).toBe('Cornerhawk (2)');
    expect(bots.bots().at(-1)?.provider).toBe('Assistant');
  });
});
