import { Service, signal } from '@angular/core';

/** The one toast line at the bottom of the page. */
@Service()
export class ToastService {
  readonly message = signal('');
  readonly error = signal(false);
  readonly visible = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Shows a message for a few seconds, replacing the previous one. */
  show(message: string, error = false): void {
    this.message.set(message);
    this.error.set(error);
    this.visible.set(true);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.visible.set(false);
    }, 5500);
  }
}
