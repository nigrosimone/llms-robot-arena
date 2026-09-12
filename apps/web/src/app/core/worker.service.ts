import { Service, signal } from '@angular/core';
import { type WorkerMessage } from './messages';

export type Operation = 'match' | 'live' | 'resimulate' | 'gate' | 'tournament';
export interface OperationHandlers {
  onMessage: (data: WorkerMessage) => void;
  onError?: (message: string) => void;
  onFinish?: () => void;
}
export const TERMINAL = new Set<WorkerMessage['type']>([
  'replay',
  'live-end',
  'live-aborted',
  'gate',
  'tournament',
  'error',
]);

/**
 * One match worker at a time: a simulation, a live match, a challenge rebuild,
 * a gate check or a tournament. Messages are routed to whoever started the
 * operation, the 60 Hz live stream included.
 */
@Service()
export class WorkerService {
  readonly operation = signal<Operation | null>(null);
  private worker: Worker | null = null;
  private handlers: OperationHandlers | null = null;

  /** Starts an operation in a fresh worker; false when one is already running. */
  start(type: Operation, data: object, handlers: OperationHandlers): boolean {
    if (this.worker) return false;
    this.operation.set(type);
    this.handlers = handlers;
    this.worker = new Worker(
      new URL('../../../../../packages/runtime/match-worker.js', import.meta.url),
      {
        type: 'module',
      },
    );
    this.worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === 'error') handlers.onError?.(data.message);
      else handlers.onMessage(data);
      // Terminal messages end the operation, as finishOperation does today.
      if (TERMINAL.has(data.type)) this.finish();
    };
    this.worker.onerror = (e) => {
      handlers.onError?.(e.message || 'An error occurred during execution.');
      this.finish();
    };
    this.worker.postMessage({ type, ...data });
    return true;
  }
  /** Sends a message to the running operation, like live inputs. */
  post(message: object): void {
    this.worker?.postMessage(message);
  }
  /** Asks the running operation to stop; false when nothing is running. */
  cancel(): boolean {
    if (!this.worker) return false;
    this.worker.postMessage({ type: 'cancel' });
    return true;
  }
  /** Terminates the worker and tells the owner that the operation is over. */
  private finish(): void {
    this.worker?.terminate();
    this.worker = null;
    const handlers = this.handlers;
    this.handlers = null;
    this.operation.set(null);
    handlers?.onFinish?.();
  }
  get busy(): boolean {
    return this.worker !== null;
  }
}
