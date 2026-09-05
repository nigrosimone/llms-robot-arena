export class BotClient {
  constructor(worker) {
    this.worker = worker;
    this.pending = new Map();
    this.seq = 0;
    this.closed = false;
    const accept = (msg) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
    };
    if (worker.on) {
      worker.on("message", accept);
      worker.on("error", (e) => this.fail(e));
      worker.on("exit", (code) => {
        if (code && !this.closed) this.fail(new Error("Worker exited."));
      });
    } else {
      worker.onmessage = (e) => accept(e.data);
      worker.onerror = (e) =>
        this.fail(new Error(e.message ?? "Worker unavailable."));
    }
  }
  request(message) {
    if (this.closed) return Promise.reject(new Error("Worker closed."));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.fail(new Error("Worker is not responding."));
          this.close();
        },
        message.type === "init" ? 15000 : 3000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...message, id });
    });
  }
  fail(error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  close() {
    this.closed = true;
    this.fail(new Error("Operation cancelled."));
    this.worker.terminate();
  }
}
