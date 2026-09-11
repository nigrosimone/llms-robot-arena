import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal('');
  readonly error = signal(false);
  readonly visible = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;
  show(message: string, error = false) {
    this.message.set(message);
    this.error.set(error);
    this.visible.set(true);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.visible.set(false), 5500);
  }
}
