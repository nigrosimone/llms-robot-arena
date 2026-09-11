// One match worker at a time, like the current viewer: a simulation, a live
// match, a challenge rebuild, a gate check or a tournament. Messages are
// routed to whoever started the operation; the 60 Hz live stream included.
import { Injectable, signal } from '@angular/core';

export type Operation = 'match' | 'live' | 'resimulate' | 'gate' | 'tournament';
export interface OperationHandlers {
  onMessage: (data: any) => void;
  onError?: (message: string) => void;
  onFinish?: () => void;
}

@Injectable({ providedIn: 'root' })
export class WorkerService {
  readonly operation = signal<Operation | null>(null);
  private worker: Worker | null = null;
  private handlers: OperationHandlers | null = null;

  start(type: Operation, data: object, handlers: OperationHandlers) {
    if (this.worker) return false;
    this.operation.set(type);
    this.handlers = handlers;
    this.worker = new Worker(new URL('../../../../../packages/runtime/match-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'error') handlers.onError?.(data.message);
      else handlers.onMessage(data);
      // Terminal messages end the operation, as finishOperation does today.
      if (['replay', 'live-end', 'live-aborted', 'gate', 'tournament', 'error'].includes(data.type)) this.finish();
    };
    this.worker.onerror = (e) => {
      handlers.onError?.(e.message || 'An error occurred during execution.');
      this.finish();
    };
    this.worker.postMessage({ type, ...data });
    return true;
  }
  post(message: object) {
    this.worker?.postMessage(message);
  }
  cancel() {
    if (!this.worker) return false;
    this.worker.postMessage({ type: 'cancel' });
    return true;
  }
  private finish() {
    this.worker?.terminate();
    this.worker = null;
    const handlers = this.handlers;
    this.handlers = null;
    this.operation.set(null);
    handlers?.onFinish?.();
  }
  get busy() {
    return this.worker !== null;
  }
}
