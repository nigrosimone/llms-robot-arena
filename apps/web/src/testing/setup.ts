// Runs before every spec file: the browser APIs jsdom lacks and the app touches.
import { afterEach, vi } from 'vitest';

// The pages rename their host element through `host: { id }`, so the TestBed
// no longer recognises its root elements and leaves them in the body.
afterEach(() => {
  for (const root of document.body.querySelectorAll(':scope > [id^="panel-"]')) root.remove();
});

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
// jsdom blobs cannot stream; the challenge links pipe them through a compressor.
if (typeof Blob.prototype.stream !== 'function') {
  Blob.prototype.stream = function stream(this: Blob): ReadableStream<Uint8Array<ArrayBuffer>> {
    const bytes = this.arrayBuffer();
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      async start(controller) {
        controller.enqueue(new Uint8Array(await bytes));
        controller.close();
      },
    });
  };
}
// Downloads: the blob URL is never fetched, the link is never followed.
URL.createObjectURL = vi.fn(() => 'blob:test');
URL.revokeObjectURL = vi.fn();
HTMLAnchorElement.prototype.click = vi.fn();
// Analytics never leave the test.
vi.stubGlobal('goatcounter', undefined);
