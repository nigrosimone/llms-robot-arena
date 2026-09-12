import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a message for a few seconds and a new one restarts the clock', () => {
    const toast = TestBed.inject(ToastService);
    expect(toast.visible()).toBe(false);
    toast.show('Saved.');
    expect(toast.message()).toBe('Saved.');
    expect(toast.error()).toBe(false);
    expect(toast.visible()).toBe(true);
    vi.advanceTimersByTime(5000);
    toast.show('Failed.', true);
    expect(toast.error()).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(toast.visible()).toBe(true);
    vi.advanceTimersByTime(600);
    expect(toast.visible()).toBe(false);
  });
});
