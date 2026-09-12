// Browser sessions: a short code shown in the page, the sockets listening to
// it, the budget of work an assistant may spend on it, and the controllers
// waiting for the visitor to accept them.
import { randomInt } from "node:crypto";

// No I, L, O, 0 or 1: the code is read aloud and typed into a chat.
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
const MINUTE = 60_000;

export class Sessions {
  constructor({
    idleMinutes = 30,
    perIp = 3,
    callsPerMinute = 30,
    matchesPerTenMinutes = 60,
    decisionSeconds = 45,
    now = Date.now,
  } = {}) {
    this.idle = idleMinutes * MINUTE;
    this.perIp = perIp;
    this.callsPerMinute = callsPerMinute;
    this.matchesPerTenMinutes = matchesPerTenMinutes;
    this.decisionSeconds = decisionSeconds;
    this.now = now;
    this.byCode = new Map();
  }
  // Ordinary limits fit a person iterating with one assistant; the message
  // says which one was hit, because the assistant reads it.
  open(ip) {
    const mine = [...this.byCode.values()].filter((s) => s.ip === ip);
    if (mine.length >= this.perIp)
      throw new Error(`Too many open sessions from this address (${this.perIp}).`);
    let code;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    } while (this.byCode.has(code));
    const session = {
      code,
      ip,
      opened: this.now(),
      touched: this.now(),
      sockets: new Set(),
      calls: [],
      matches: [],
      pending: new Map(),
      nextPush: 1,
    };
    this.byCode.set(code, session);
    return session;
  }
  // Unknown and expired codes read the same to the assistant.
  get(code) {
    const session = this.byCode.get(String(code ?? "").toUpperCase().trim());
    if (!session) return null;
    if (this.now() - session.touched > this.idle) {
      this.close(session.code, "expired");
      return null;
    }
    session.touched = this.now();
    return session;
  }
  attach(code, socket) {
    const session = this.get(code);
    if (!session) return null;
    session.sockets.add(socket);
    return session;
  }
  detach(code, socket) {
    const session = this.byCode.get(code);
    if (!session) return;
    session.sockets.delete(socket);
    // The page is gone: nothing can accept a controller any more.
    if (session.sockets.size === 0) this.close(code, "closed");
  }
  emit(code, event) {
    const session = this.byCode.get(code);
    if (!session) return false;
    const text = JSON.stringify(event);
    for (const socket of session.sockets) socket.send(text);
    return session.sockets.size > 0;
  }
  // Every tool call spends one call; a match spends one call and `matches`.
  spend(code, matches = 0) {
    const session = this.get(code);
    if (!session)
      throw new Error(
        `Unknown or expired session "${String(code)}". Open llms-robot-arena, press "Connect an assistant" and use the code shown there.`,
      );
    const at = this.now();
    session.calls = session.calls.filter((t) => at - t < MINUTE);
    session.matches = session.matches.filter((t) => at - t < 10 * MINUTE);
    if (session.calls.length >= this.callsPerMinute)
      throw new Error(`Rate limit: ${this.callsPerMinute} calls per minute per session. Wait a moment.`);
    if (session.matches.length + matches > this.matchesPerTenMinutes)
      throw new Error(
        `Rate limit: ${this.matchesPerTenMinutes} matches per ten minutes per session (${session.matches.length} played). Try a shorter series later.`,
      );
    session.calls.push(at);
    for (let i = 0; i < matches; i++) session.matches.push(at);
    return session;
  }
  // A pushed controller waits for the visitor: the assistant learns the
  // decision, or that the visitor has not answered yet.
  propose(code, controller) {
    const session = this.get(code);
    if (!session) return Promise.reject(new Error("Unknown or expired session."));
    const id = session.nextPush++;
    const outcome = new Promise((resolve) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        resolve("pending");
      }, this.decisionSeconds * 1000);
      session.pending.set(id, { controller, resolve, timer });
    });
    this.emit(code, { type: "controller", id, ...controller });
    return outcome.then((decision) => ({ id, decision }));
  }
  decide(code, id, accepted) {
    const session = this.get(code);
    const pending = session?.pending.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    session.pending.delete(id);
    pending.resolve(accepted ? "accepted" : "rejected");
    return true;
  }
  close(code, reason = "closed") {
    const session = this.byCode.get(code);
    if (!session) return;
    this.byCode.delete(code);
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve("pending");
    }
    for (const socket of session.sockets) {
      try {
        socket.end?.(4000, reason);
      } catch {
        // The socket was already gone.
      }
    }
  }
  sweep() {
    for (const session of [...this.byCode.values()])
      if (this.now() - session.touched > this.idle) this.close(session.code, "expired");
  }
  get size() {
    return this.byCode.size;
  }
}
