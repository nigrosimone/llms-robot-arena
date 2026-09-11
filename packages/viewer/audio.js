// Match sound. Every cue is synthesized with Web Audio: nothing to download,
// and the same graph feeds the recorder, so the cues land in the saved video.
// The music under them is a file, filtered live by the state of the match.
import { Soundtrack } from "./soundtrack.js";

// One cue per replay event, plus the intensity of the sound it plays with.
export function eventCue(event) {
  if (event.type === "impact")
    return { cue: "impact", strength: Math.min(1, (event.closingSpeed ?? 1) / 5) };
  return {
    flip: { cue: "flip" },
    recovery: { cue: "recovery" },
    recharge: { cue: "recharge" },
    "ring-out": { cue: "fall" },
    hole: { cue: "fall" },
    "collapse-warning": { cue: "warning" },
    collapse: { cue: "collapse" },
    eliminated: { cue: "eliminated" },
  }[event.type] ?? null;
}

export class MatchAudio {
  constructor(volume = 0.8) {
    this.volume = volume;
    this.enabled = true;
    this.ctx = null;
    this.ended = false;
    // The intro card runs over the music too, before the match starts.
    this.intro = false;
    // Told whenever the sound becomes audible or stops being so.
    this.onchange = null;
  }
  // Muting is a choice, a blocked context is not: the button reads this.
  get audible() {
    return this.enabled && this.ctx?.state === "running";
  }
  // Browsers only allow a context to run after a gesture, so this is called
  // from the first interaction with the page and from the sound button.
  resume() {
    if (!this.enabled) return null;
    if (this.ctx) {
      if (this.ctx.state !== "running") this.ctx.resume();
      return this.ctx;
    }
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = (this.ctx = new Ctx());
    ctx.onstatechange = () => this.onchange?.();
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // A rumble can fire a dozen cues at once: the compressor keeps the mix
    // loud enough for a social clip without clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 12;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);
    this.limiter = limiter;
    this.tap = ctx.createMediaStreamDestination();
    limiter.connect(this.tap);
    // The flame is one looping noise source; only its gain follows the match.
    this.flame = ctx.createGain();
    this.flame.gain.value = 0;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 620;
    band.Q.value = 0.7;
    const source = ctx.createBufferSource();
    source.buffer = this.noise();
    source.loop = true;
    source.connect(band).connect(this.flame).connect(this.master);
    source.start();
    this.track = new Soundtrack(ctx, this.master);
    // A context built inside a gesture is already running and sends no event.
    if (ctx.state !== "running") ctx.resume();
    this.onchange?.();
    return ctx;
  }
  setEnabled(on) {
    this.enabled = on;
    if (on) this.resume();
    if (this.ctx) this.master.gain.value = on ? this.volume : 0;
    this.onchange?.();
  }
  // The audio track the recorder mixes into the clip.
  get stream() {
    return this.tap?.stream ?? null;
  }
  // PCM from the mix for the clip encoder, with times from the tap's start: a
  // ScriptProcessor, which every browser still runs. Returns the sample rate.
  startCapture(onData) {
    const ctx = this.resume();
    if (!ctx) return null;
    this.stopCapture();
    const node = ctx.createScriptProcessor(4096, 2, 2), mute = ctx.createGain();
    mute.gain.value = 0;
    const start = ctx.currentTime;
    node.onaudioprocess = (e) => {
      const at = e.playbackTime - start;
      if (at < 0) return;
      const channels = [0, 1].map((c) => e.inputBuffer.getChannelData(Math.min(c, e.inputBuffer.numberOfChannels - 1)));
      onData(channels, at, ctx.sampleRate);
    };
    this.limiter.connect(node);
    node.connect(mute).connect(ctx.destination);
    this.capture = { node, mute };
    return ctx.sampleRate;
  }
  stopCapture() {
    if (!this.capture) return;
    const { node, mute } = this.capture;
    node.onaudioprocess = null;
    this.limiter.disconnect(node);
    node.disconnect();
    mute.disconnect();
    this.capture = null;
  }
  noise() {
    if (!this.buffer) {
      const ctx = this.ctx;
      this.buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = this.buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.buffer;
  }
  burst({ from, to, duration, gain = 0.4, q = 1, type = "bandpass", delay = 0 }) {
    const ctx = this.ctx,
      start = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noise();
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), start + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(gain, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(start, Math.random() * 1.5);
    source.stop(start + duration + 0.05);
  }
  tone({ from, to = from, duration, gain = 0.3, type = "sine", delay = 0 }) {
    const ctx = this.ctx,
      start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(gain, start + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(envelope).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }
  play(name, strength = 1) {
    if (!this.audible) return;
    if (name === "impact") {
      this.burst({ from: 2400 + 1800 * strength, to: 480, duration: 0.16 + 0.12 * strength, gain: 0.16 + 0.3 * strength, q: 1.1 });
      this.tone({ from: 130 + 70 * strength, to: 42, duration: 0.22, gain: 0.3 + 0.25 * strength });
    } else if (name === "flip") {
      this.burst({ from: 700, to: 3400, duration: 0.22, gain: 0.22, q: 0.8 });
      this.tone({ from: 220, to: 700, duration: 0.3, gain: 0.2, type: "triangle" });
      this.burst({ from: 3200, to: 900, duration: 0.3, gain: 0.28, q: 4, delay: 0.2 });
    } else if (name === "fall") {
      this.tone({ from: 420, to: 60, duration: 0.9, gain: 0.26, type: "sawtooth" });
      this.burst({ from: 900, to: 90, duration: 0.5, gain: 0.4, type: "lowpass", delay: 0.85 });
    } else if (name === "recharge") {
      this.tone({ from: 620, duration: 0.12, gain: 0.16, type: "square" });
      this.tone({ from: 930, duration: 0.16, gain: 0.14, type: "square", delay: 0.1 });
    } else if (name === "recovery") {
      this.tone({ from: 260, to: 620, duration: 0.24, gain: 0.16, type: "triangle" });
    } else if (name === "warning") {
      this.tone({ from: 880, duration: 0.1, gain: 0.13, type: "square" });
      this.tone({ from: 880, duration: 0.1, gain: 0.13, type: "square", delay: 0.16 });
    } else if (name === "collapse") {
      this.burst({ from: 500, to: 55, duration: 0.9, gain: 0.5, type: "lowpass" });
      this.tone({ from: 95, to: 28, duration: 0.8, gain: 0.3 });
    } else if (name === "eliminated") {
      this.tone({ from: 300, to: 110, duration: 0.5, gain: 0.18, type: "sawtooth" });
    } else if (name === "finish") {
      [262, 330, 392].forEach((note, i) =>
        this.tone({ from: note, duration: 1.6, gain: 0.13, type: "triangle", delay: i * 0.06 }),
      );
      this.burst({ from: 5200, to: 1200, duration: 0.6, gain: 0.14, q: 0.6 });
    }
  }
  // Called once per rendered frame with the events the playhead just crossed.
  // The music bed: it plays under the intro card and while the replay runs, and
  // the filter opens with the fight.
  bed({ playing = false, intensity = 0 } = {}) {
    if (!this.audible) return;
    this.track.update({ on: playing || this.intro, intensity, level: 0.42 });
  }
  // A new take restarts the track, so every clip opens the same way. The
  // offset picks where in the file that is.
  restartTrack(offset = 0) {
    this.resume();
    this.track?.restart(offset);
  }
  frame(events, { burning = 0, ended = false, playing = false, intensity = 0 } = {}) {
    this.bed({ playing, intensity });
    // The end of the match is tracked even in silence: turning the sound on
    // later must not replay the closing cue.
    const wasEnded = this.ended;
    this.ended = ended;
    if (!this.audible) return;
    for (const event of events) {
      const cue = eventCue(event);
      if (cue) this.play(cue.cue, cue.strength ?? 1);
    }
    this.flame.gain.setTargetAtTime(Math.min(0.3, burning * 0.22), this.ctx.currentTime, 0.08);
    if (ended && !wasEnded) this.play("finish");
  }
  // A new match, a seek or a stop: no cue should trail into the next frame.
  reset() {
    this.ended = false;
    if (this.ctx) this.flame.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
  }
}
