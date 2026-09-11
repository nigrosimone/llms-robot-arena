// A music file under the match, filtered by how hectic the fight is: muffled
// and quiet while the robots circle each other, wide open and louder when they
// start hitting. It runs through the same graph as the cues, so it is part of
// the recorded video.
//
// The file is local and is not part of the repository. Without it the viewer
// stays silent, and only the sound effects play.
// The music sits next to the bundle, whatever page loaded it: the renderer
// has no notion of the site, only of where its own code came from.
export const TRACK_URL = new URL("music/bed.mp3", import.meta.url).href;
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

export class Soundtrack {
  constructor(ctx, destination, url = TRACK_URL) {
    this.ctx = ctx;
    this.url = url;
    this.buffer = null;
    this.source = null;
    this.intensity = 0;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    // A light touch: the track keeps its own mix, the filter only leans on it.
    this.bass = ctx.createBiquadFilter();
    this.bass.type = "lowshelf";
    this.bass.frequency.value = 120;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = 3500;
    this.tone.Q.value = 0.6;
    this.bass.connect(this.tone).connect(this.gain).connect(destination);
    this.load();
  }
  async load() {
    try {
      const response = await fetch(this.url);
      if (!response.ok) return;
      this.buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
    } catch {
      // No file, an unsupported format or an offline page: play no music.
    }
  }
  get ready() {
    return Boolean(this.buffer);
  }
  // Called once per rendered frame with the state of the match.
  update({ on = false, intensity = 0, level = 0.5 } = {}) {
    const now = this.ctx.currentTime;
    this.intensity += (clamp01(intensity) - this.intensity) * 0.03;
    if (on && !this.source) this.start();
    this.gain.gain.setTargetAtTime(on ? level * (0.82 + 0.18 * this.intensity) : 0, now, on ? 0.5 : 0.7);
    if (!this.source) return;
    // Exponential sweep: the ear hears the filter opening evenly this way.
    this.tone.frequency.setTargetAtTime(3500 * Math.pow(5.7, this.intensity), now, 0.4);
    this.bass.gain.setTargetAtTime(2.5 * this.intensity, now, 0.4);
  }
  start(offset = 0) {
    if (!this.buffer || this.source) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.connect(this.bass);
    source.start(this.ctx.currentTime, offset % this.buffer.duration);
    this.source = source;
  }
  // A new take: the clip should open on the same bar every time.
  restart(offset = 0) {
    if (!this.source) return this.start(offset);
    this.source.stop();
    this.source.disconnect();
    this.source = null;
    this.start(offset);
  }
}
