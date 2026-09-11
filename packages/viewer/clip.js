// Offline clips: the replay is rendered one frame per tick at the clip size
// and encoded with exact timestamps, so the file is smooth whatever the
// machine manages on screen. Sound, when the browser can encode it, comes from
// a second pass that plays the replay in real time and taps the mix.
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { INTRO_SECONDS, OUTRO_SECONDS, WIDTH, HEIGHT, drawIntro, drawOverlay } from "./recorder.js";

export const clipSupported = () =>
  typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";

// Frame counts and timestamps of a clip: the intro card, the match, the verdict.
export function clipTimeline(playbackDuration, fps = 60) {
  const intro = Math.round(INTRO_SECONDS * fps),
    match = Math.floor(playbackDuration * fps) + 1,
    outro = Math.round(OUTRO_SECONDS * fps);
  return { intro, match, outro, total: intro + match + outro, step: 1e6 / fps };
}

// H.264 High first, then Main; hardware first, then whatever the browser has.
export const videoConfigs = ({ width, height, fps }) =>
  ["avc1.640028", "avc1.4d002a"].flatMap((codec) =>
    ["prefer-hardware", "no-preference"].map((hardwareAcceleration) => ({
      codec, width, height, bitrate: 16_000_000, framerate: fps, hardwareAcceleration,
      latencyMode: "quality", avc: { format: "avc" },
    })),
  );
export const audioConfigs = (sampleRate) => [
  { codec: "opus", sampleRate, numberOfChannels: 2, bitrate: 128_000 },
  { codec: "mp4a.40.2", sampleRate, numberOfChannels: 2, bitrate: 160_000 },
];

async function supportedConfig(Encoder, configs) {
  for (const config of configs) {
    const { supported } = await Encoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (supported) return config;
  }
  return null;
}
const yieldToUI = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function renderClip({
  viewer, replay, frame, audio = null, playAudio = null,
  onProgress = () => {}, signal = null, width = 1920, height = 1080, fps = 60,
}) {
  const videoConfig = await supportedConfig(VideoEncoder, videoConfigs({ width, height, fps }));
  if (!videoConfig) throw Error("This browser cannot encode H.264 video.");
  // Muted, or blocked by the browser: the clip stays silent rather than carrying an empty track.
  const sampleRate = audio?.audible ? audio.ctx.sampleRate : null;
  const audioConfig = sampleRate && typeof AudioEncoder !== "undefined" && playAudio
    ? await supportedConfig(AudioEncoder, audioConfigs(sampleRate))
    : null;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height, frameRate: fps },
    ...(audioConfig ? { audio: { codec: audioConfig.codec === "opus" ? "opus" : "aac", sampleRate, numberOfChannels: 2 } } : {}),
    fastStart: "in-memory",
    firstTimestampBehavior: "permissive",
  });
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => (failure = error),
  });
  encoder.configure(videoConfig);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(width / WIDTH, 0, 0, height / HEIGHT, 0, 0);
  const timeline = clipTimeline(viewer.playbackDuration, fps);
  const state = () => ({ replay, frame: frame(), duration: viewer.duration });
  let index = 0;
  const submit = async (draw) => {
    if (signal?.aborted) throw Error("Clip cancelled.");
    if (failure) throw failure;
    draw();
    const videoFrame = new VideoFrame(canvas, { timestamp: index * timeline.step, duration: timeline.step });
    encoder.encode(videoFrame, { keyFrame: index % (fps * 2) === 0 });
    videoFrame.close();
    index++;
    onProgress({ phase: "video", done: index, total: timeline.total });
    // The encoder queue is the pace: the page stays responsive between frames.
    while (encoder.encodeQueueSize > 8) await yieldToUI();
    if (index % 4 === 0) await yieldToUI();
  };
  const composite = (source) => {
    ctx.fillStyle = "#101316";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(source, 0, 0, WIDTH, HEIGHT);
  };
  try {
    viewer.beginOffline(width, height);
    const opening = viewer.renderAt(0, 0);
    for (let i = 0; i < timeline.intro; i++)
      await submit(() => {
        composite(opening);
        drawIntro(ctx, state(), i / timeline.intro);
      });
    for (let i = 0; i < timeline.match; i++)
      await submit(() => {
        composite(viewer.renderAt(Math.min(i / fps, viewer.playbackDuration), i ? 1 / fps : 0));
        drawOverlay(ctx, state());
      });
    for (let i = 0; i < timeline.outro; i++) await submit(() => {});
    await encoder.flush();
  } finally {
    encoder.close();
    viewer.endOffline();
  }
  if (audioConfig) await recordSound({ audio, playAudio, muxer, config: audioConfig, signal, onProgress, seconds: timeline.total / fps });
  muxer.finalize();
  return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), extension: "mp4", sound: Boolean(audioConfig) };
}

// The real-time pass: the replay plays as usual while the mix is tapped and
// encoded with timestamps on the clip's own clock.
async function recordSound({ audio, playAudio, muxer, config, signal, onProgress, seconds }) {
  let failure = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => (failure = error),
  });
  encoder.configure(config);
  const started = audio.startCapture((channels, at, sampleRate) => {
    if (failure || at > seconds) return;
    const frames = channels[0].length, data = new Float32Array(frames * channels.length);
    channels.forEach((channel, i) => data.set(channel, i * frames));
    encoder.encode(new AudioData({
      format: "f32-planar", sampleRate, numberOfFrames: frames, numberOfChannels: channels.length,
      timestamp: Math.round(at * 1e6), data,
    }));
    onProgress({ phase: "sound", done: Math.min(at, seconds), total: seconds });
  });
  try {
    if (started) await playAudio({ signal });
    if (signal?.aborted) throw Error("Clip cancelled.");
    if (failure) throw failure;
    await encoder.flush();
  } finally {
    audio.stopCapture();
    encoder.close();
  }
}
