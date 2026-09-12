import { Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SITE } from '../../../../../packages/site/content.js';
import { type GateVerdict } from '../../../../../packages/tournament/exhibition.js';
import { track } from '../../../../../packages/viewer/analytics.js';
import { ArenaStore } from '../arena/arena.store';
import { BotsStore } from './bots.store';
import { ToastService } from './toast.service';
import { liveUrl } from './url';

export type AssistantStatus = 'off' | 'connecting' | 'connected' | 'unavailable';
export interface AssistantOffer {
  id: number;
  name: string;
  model: string | null;
  source: string;
  gate: GateVerdict;
}
export interface AssistantActivity {
  at: number;
  kind: string;
  summary: string;
}
type ServerMessage =
  | { type: 'session'; code: string; mcp: string; idleMinutes: number }
  | { type: 'activity'; kind: string; summary: string }
  | ({ type: 'controller' } & AssistantOffer);

/**
 * The session an outside assistant works in: a code shown in the page, the
 * live server's events, and the controller waiting for the visitor to accept.
 * The socket lives with the tab; the server keeps nothing.
 */
@Service()
export class AssistantService {
  readonly status = signal<AssistantStatus>('off');
  readonly code = signal('');
  readonly mcp = signal('');
  readonly activity = signal<AssistantActivity[]>([]);
  readonly offer = signal<AssistantOffer | null>(null);
  readonly arrived = signal(0);
  /** What the visitor pastes into the assistant. */
  readonly invitation = computed(() =>
    this.code()
      ? `Join llms-robot-arena session ${this.code()} through the MCP server ${this.mcp()} and build me a controller.`
      : '',
  );
  private socket: WebSocket | null = null;
  private readonly bots = inject(BotsStore);
  private readonly arena = inject(ArenaStore);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  /** Opens a session on the live server; the page shows the code it answers with. */
  connect(): void {
    if (this.socket) return;
    this.status.set('connecting');
    const socket = new WebSocket(liveUrl(SITE.live).replace(/^http/, 'ws') + '/session');
    this.socket = socket;
    socket.onmessage = (event: MessageEvent<string>) => {
      this.receive(JSON.parse(event.data) as ServerMessage);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.status.set(this.code() ? 'off' : 'unavailable');
      this.code.set('');
      this.offer.set(null);
    };
    socket.onerror = () => {
      socket.close();
    };
  }
  /** Ends the session; a pushed controller not yet accepted is dropped. */
  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.status.set('off');
    this.code.set('');
    this.offer.set(null);
  }
  /** Keeps the pushed controller: it joins the Bot Lab and plays Baseline at once. */
  accept(): void {
    const offer = this.offer();
    if (!offer) return;
    this.decide(offer.id, true);
    const model = offer.model?.trim() ?? '';
    const index = this.bots.add({
      id: this.bots.customId(),
      model: this.freeName(offer.name),
      provider: model || 'Assistant',
      harness: 'MCP',
      provenance: 'iterative',
      source: offer.source,
    });
    this.arrived.update((n) => n + 1);
    track('assistant-accepted', model || 'unknown model');
    const baseline = this.bots.builtins.findIndex((b) => b.provenance === 'reference');
    this.arena.setState({ a: index, b: baseline < 0 ? 0 : baseline });
    this.toast.show(`${offer.name} arrived from your assistant. Match against Baseline starting.`);
    void this.router.navigateByUrl('/').then(() => {
      this.arena.simulate();
    });
  }
  /** Declines the pushed controller; the assistant is told. */
  reject(): void {
    const offer = this.offer();
    if (!offer) return;
    this.decide(offer.id, false);
    this.toast.show(`${offer.name} was rejected.`);
  }
  /** Tells the server, and through it the assistant, what the visitor chose. */
  private decide(id: number, accepted: boolean): void {
    this.offer.set(null);
    this.socket?.send(JSON.stringify({ type: 'decision', id, accepted }));
  }
  /** One message from the live server. */
  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'session':
        this.code.set(message.code);
        this.mcp.set(message.mcp);
        this.status.set('connected');
        this.activity.set([]);
        track('assistant-connected');
        break;
      case 'activity':
        this.activity.update((list) =>
          [{ at: Date.now(), kind: message.kind, summary: message.summary }, ...list].slice(0, 6),
        );
        break;
      case 'controller':
        this.offer.set({
          id: message.id,
          name: message.name,
          model: message.model,
          source: message.source,
          gate: message.gate,
        });
        this.toast.show(`${message.name} is waiting for you: accept it to put it in the arena.`);
        break;
    }
  }
  /** A second push with the same name becomes "Name (2)". */
  private freeName(name: string): string {
    const taken = new Set(this.bots.bots().map((b) => b.model));
    let candidate = name;
    for (let n = 2; taken.has(candidate); n++) candidate = `${name} (${String(n)})`;
    return candidate;
  }
}
