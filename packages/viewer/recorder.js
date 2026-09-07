// Clips for social media. The WebGL canvas carries no names, clock or result:
// those live in DOM overlays, so recording composites every rendered frame with
// its own overlay on a second canvas, plus the intro card and the final verdict.
import { botName, botProvider } from "../bot-catalog.js";
import { robotColor } from "./palette.js";
export const INTRO_SECONDS = 4;
export const OUTRO_SECONDS = 3;
const WIDTH = 1280,
  HEIGHT = 720,
  FPS = 30;
const SANS = '"DM Sans", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", monospace';
const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
// MP4 first: it is the format social platforms accept without conversion. Each
// entry also names the codec pair to ask for when the clip carries sound.
const TYPES = [
  { mime: "video/mp4;codecs=avc1.4d002a", sound: "video/mp4;codecs=avc1.4d002a,mp4a.40.2", extension: "mp4" },
  { mime: "video/mp4", sound: "video/mp4;codecs=avc1,mp4a.40.2", extension: "mp4" },
  { mime: "video/webm;codecs=vp9", sound: "video/webm;codecs=vp9,opus", extension: "webm" },
  { mime: "video/webm;codecs=vp8", sound: "video/webm;codecs=vp8,opus", extension: "webm" },
  { mime: "video/webm", sound: "video/webm", extension: "webm" },
];
export function pickRecordingType(supported, withSound = false) {
  const type = TYPES.map((entry) => ({
    mime: withSound ? entry.sound : entry.mime,
    extension: entry.extension,
  })).find((entry) => supported(entry.mime));
  return type ?? (withSound ? pickRecordingType(supported) : null);
}
export function recordingSupported() {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    Boolean(pickRecordingType((type) => MediaRecorder.isTypeSupported(type)))
  );
}
const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28) || "robot";
export function recordingFilename(replay, extension) {
  const names = (replay?.bots ?? []).map((bot) => slug(botName(bot)));
  const label = !names.length
    ? "match"
    : names.length > 2
      ? `rumble-${names.length}`
      : names.join("-vs-");
  return `llms-robot-arena-${label}-seed-${replay?.seed ?? 0}.${extension}`;
}
// One roster description for the on-screen intro and the recorded intro card.
export function introCard(replay) {
  const bots = replay?.bots ?? [];
  return {
    title: bots.length > 2 ? "Royal rumble" : "The arena decides",
    seed: `SEED ${String(replay?.seed ?? 0).padStart(2, "0")}${replay?.mirrored ? " · MIRRORED" : ""}`,
    robots: bots.map((bot, i) => ({
      label: `ROBOT ${String.fromCharCode(65 + i)}`,
      name: botName(bot),
      provider: botProvider(bot),
      color: robotColor(i).css,
    })),
  };
}
export function matchOutcome(replay) {
  const result = replay?.result;
  if (!result) return { title: "", reason: "" };
  const winner = result.winner === null ? null : replay.bots[result.winner];
  return {
    title:
      winner === null
        ? "Draw."
        : winner.id === "human"
          ? "You win."
          : botName(winner) + " wins.",
    reason:
      {
        ["ring-out"]: "Ring-out",
        hole: "Fell through a hole",
        flips: "Two flips",
        disqualification: "Disqualification",
        timeout:
          result.decision === "center"
            ? "Timeout · closest to center"
            : "Timeout decision",
      }[result.reason] ?? "Match complete",
  };
}
const clock = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const ease = (t) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
function text(ctx, value, x, y, font, color, align = "center", spacing = "0px") {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.letterSpacing = spacing;
  ctx.fillText(value, x, y);
  ctx.letterSpacing = "0px";
}
function fit(ctx, value, width) {
  if (ctx.measureText(value).width <= width) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > width)
    cut = cut.slice(0, -1);
  return cut + "…";
}
function bar(ctx, x, y, width, height, ratio, color) {
  ctx.fillStyle = "rgba(55,65,68,.85)";
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, Math.min(1, ratio)) * width, height, height / 2);
  ctx.fill();
}
const STATUS = ["ACTIVE", "FLIPPED", "RECOVERING", "OUT"];
function drawRobotPanel(ctx, x, y, width, robot, state, energyMax) {
  const height = 78;
  ctx.fillStyle = "rgba(18,23,27,.76)";
  ctx.strokeStyle = "rgba(72,84,90,.65)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = robot.color;
  ctx.beginPath();
  ctx.roundRect(x + 8, y + 12, 3, height - 24, 2);
  ctx.fill();
  const left = x + 20,
    right = x + width - 16;
  text(ctx, robot.label, left, y + 25, `500 12px ${MONO}`, "#8e999f", "left", "1px");
  ctx.font = `600 21px ${SANS}`;
  text(ctx, fit(ctx, robot.name, width - 130), left, y + 50, `600 21px ${SANS}`, "#edf0ed", "left");
  if (!state) return;
  const low = state.energy < energyMax * 0.2;
  const status = state.hole
    ? "FELL THROUGH"
    : state.ringOut
      ? "RING-OUT"
      : STATUS[state.status] ?? "ACTIVE";
  text(
    ctx,
    status,
    right,
    y + 25,
    `500 12px ${MONO}`,
    status === "ACTIVE" ? "#8e999f" : "#ee956b",
    "right",
    "1px",
  );
  text(ctx, `${state.flips} / 2 FLIPS`, right, y + 50, `500 12px ${MONO}`, "#8e999f", "right");
  bar(ctx, left, y + height - 20, width - 36, 5, state.energy / energyMax, low ? "#ee956b" : robot.color);
}
function drawOverlay(ctx, { replay, frame, duration }) {
  const card = introCard(replay);
  const gradient = ctx.createLinearGradient(0, 0, 0, 150);
  gradient.addColorStop(0, "rgba(11,15,18,.72)");
  gradient.addColorStop(1, "rgba(11,15,18,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, 150);
  text(ctx, clock(frame?.time ?? 0), WIDTH / 2, 48, `600 30px ${MONO}`, "#edf0ed");
  text(ctx, `${card.seed} · ${clock(duration)}`, WIDTH / 2, 70, `500 12px ${MONO}`, "#8e999f", "center", "1px");
  const energyMax = replay?.energyMax ?? 100;
  const states = frame?.states ?? [];
  if (card.robots.length <= 2) {
    const width = 320;
    card.robots.forEach((robot, i) =>
      drawRobotPanel(ctx, i ? WIDTH - width - 28 : 28, 26, width, robot, states[i], energyMax),
    );
  } else {
    // A rumble: one compact row per robot down the left side.
    card.robots.forEach((robot, i) => {
      const y = 26 + i * 30,
        state = states[i];
      ctx.fillStyle = robot.color;
      ctx.beginPath();
      ctx.roundRect(28, y + 6, 3, 14, 2);
      ctx.fill();
      ctx.font = `600 16px ${SANS}`;
      text(ctx, fit(ctx, robot.name, 180), 42, y + 19, `600 16px ${SANS}`, state?.out ? "#71797d" : "#edf0ed", "left");
      if (state)
        bar(ctx, 236, y + 11, 90, 5, state.energy / energyMax, state.energy < energyMax * 0.2 ? "#ee956b" : robot.color);
    });
  }
  text(ctx, "llms-robot-arena", 28, HEIGHT - 26, `500 15px ${MONO}`, "rgba(195,241,121,.75)", "left", "1px");
  if (!frame?.ended) return;
  const outcome = matchOutcome(replay);
  ctx.fillStyle = "rgba(11,15,18,.68)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  text(ctx, "MATCH COMPLETE", WIDTH / 2, HEIGHT / 2 - 70, `500 14px ${MONO}`, "#8e999f", "center", "6px");
  text(ctx, outcome.title.toUpperCase(), WIDTH / 2, HEIGHT / 2 + 20, `700 82px ${DISPLAY}`, "#c3f179", "center", "2px");
  text(ctx, `${outcome.reason} · ${clock(duration)}`, WIDTH / 2, HEIGHT / 2 + 60, `500 15px ${MONO}`, "#b0bbb9");
}
function drawIntro(ctx, { replay }, progress) {
  const card = introCard(replay);
  const alpha = Math.min(1, progress / 0.12, (1 - progress) / 0.15);
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.fillStyle = "rgba(11,15,18,.93)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  text(ctx, "AUTONOMOUS COMBAT LAB", WIDTH / 2, 128, `500 14px ${MONO}`, "#8e999f", "center", "7px");
  text(ctx, card.title.toUpperCase(), WIDTH / 2, 184, `700 44px ${DISPLAY}`, "#edf0ed", "center", "3px");
  const slide = (1 - ease(progress / 0.3)) * 240;
  if (card.robots.length <= 2) {
    card.robots.forEach((robot, i) => {
      const y = 304 + i * 192,
        x = WIDTH / 2 + (i ? slide : -slide);
      text(ctx, robot.label, x, y - 46, `500 13px ${MONO}`, "#8e999f", "center", "5px");
      text(ctx, robot.name.toUpperCase(), x, y + 12, `700 66px ${DISPLAY}`, robot.color, "center", "1px");
      text(ctx, robot.provider, x, y + 42, `500 14px ${MONO}`, "#8e999f");
    });
    text(ctx, "VS", WIDTH / 2, 398, `700 36px ${DISPLAY}`, "#6f7c82", "center", "8px");
  } else {
    const columns = card.robots.length > 6 ? 2 : 1;
    card.robots.forEach((robot, i) => {
      const column = Math.floor(i / Math.ceil(card.robots.length / columns));
      const row = i % Math.ceil(card.robots.length / columns);
      const x = columns === 1 ? WIDTH / 2 : WIDTH / 2 + (column ? 260 : -260);
      text(ctx, robot.name.toUpperCase(), x, 268 + row * 54, `700 38px ${DISPLAY}`, robot.color, "center", "1px");
    });
  }
  text(ctx, card.seed, WIDTH / 2, HEIGHT - 74, `500 14px ${MONO}`, "#7d8a90", "center", "4px");
  ctx.restore();
}
export class MatchRecorder {
  // source() returns the rendered WebGL canvas, state() the replay and the
  // frame the viewer is showing, so recording never drives the simulation.
  constructor({ source, state, sound = null, width = WIDTH, height = HEIGHT, fps = FPS }) {
    this.source = source;
    this.state = state;
    // The synthesized match sound, as a live MediaStream, or null for a silent clip.
    this.sound = sound;
    this.fps = fps;
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d");
    this.media = null;
  }
  get recording() {
    return Boolean(this.media);
  }
  start() {
    const track = this.sound?.getAudioTracks?.()[0] ?? null;
    const type = pickRecordingType(
      (mime) => MediaRecorder.isTypeSupported(mime),
      Boolean(track),
    );
    if (!type) throw Error("This browser cannot record video.");
    this.type = type;
    this.chunks = [];
    const stream = this.canvas.captureStream(this.fps);
    if (track) stream.addTrack(track);
    this.media = new MediaRecorder(stream, {
      mimeType: type.mime,
      videoBitsPerSecond: 8_000_000,
    });
    this.media.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.finished = new Promise((resolve) => {
      this.media.onstop = () => resolve(new Blob(this.chunks, { type: type.mime }));
    });
    this.capture();
    this.media.start(1000);
  }
  // Called from the viewer render loop: the WebGL drawing buffer is only
  // readable inside the frame that produced it.
  capture() {
    if (!this.media) return;
    const { ctx } = this,
      { width, height } = this.canvas;
    ctx.fillStyle = "#101316";
    ctx.fillRect(0, 0, width, height);
    const source = this.source?.();
    if (source?.width && source?.height) {
      const scale = Math.max(width / source.width, height / source.height);
      const w = source.width * scale,
        h = source.height * scale;
      ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
    }
    const state = this.state?.();
    if (!state?.replay) return;
    if (state.intro == null) drawOverlay(ctx, state);
    else drawIntro(ctx, state, state.intro);
  }
  async stop() {
    const media = this.media;
    if (!media) return null;
    this.media = null;
    media.stop();
    const blob = await this.finished;
    return { blob, extension: this.type.extension };
  }
}
