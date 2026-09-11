// A challenge link carries a whole manual match in the URL fragment: engine,
// seed, spawn, opponent and the human input log. Whoever opens it rebuilds the
// same replay, then plays the same seed against the same controller. No server.
export const CHALLENGE_PARAM = "m";
const FORMAT = 1;
const SEED_MAX = 4294967295;
const MAX_TICKS = 7200;
const MAX_ENCODED = 64 * 1024;

// The controller is looked up by id; the digest prefix only tells a reader
// that the source changed since the match was played.
export const SHA_PREFIX = 16;

const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const base64ToBytes = (text) => {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw Error("The challenge link is damaged.");
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};
const pipe = async (bytes, stream) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export function challengeFromReplay(replay) {
  const player = replay.bots.findIndex((b) => b.id === "human");
  const opponent = replay.bots[1 - player];
  if (replay.mode !== "manual" || player < 0 || !replay.inputs?.[player] || replay.bots.length !== 2)
    throw Error("Only manual duels with a logged input can become a challenge.");
  return {
    engineVersion: replay.engineVersion,
    seed: replay.seed,
    mirrored: Boolean(replay.mirrored),
    player,
    botId: opponent.id,
    sha: opponent.codeSha256.slice(0, SHA_PREFIX),
    inputs: replay.inputs[player],
  };
}

export async function encodeChallenge(challenge) {
  const { engineVersion, seed, mirrored, player, botId, sha, inputs } = challenge;
  // Ticks travel as deltas: small numbers compress well.
  let previous = 0;
  const log = inputs.flatMap(([tick, code]) => {
    const delta = tick - previous;
    previous = tick;
    return [delta, code];
  });
  const payload = JSON.stringify([FORMAT, engineVersion, seed, mirrored ? 1 : 0, player, botId, sha, log]);
  const bytes = await pipe(new TextEncoder().encode(payload), new CompressionStream("deflate-raw"));
  return bytesToBase64(bytes);
}

export async function decodeChallenge(text) {
  if (typeof text !== "string" || !text || text.length > MAX_ENCODED)
    throw Error("The challenge link is damaged.");
  let payload;
  try {
    const bytes = await pipe(base64ToBytes(text), new DecompressionStream("deflate-raw"));
    if (bytes.length > MAX_ENCODED) throw Error();
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw Error("The challenge link is damaged.");
  }
  if (!Array.isArray(payload) || payload.length !== 8 || payload[0] !== FORMAT)
    throw Error("The challenge link is damaged.");
  const [, engineVersion, seed, mirrored, player, botId, sha, log] = payload;
  if (
    typeof engineVersion !== "string" || engineVersion.length > 32 ||
    !Number.isInteger(seed) || seed < 0 || seed > SEED_MAX ||
    ![0, 1].includes(mirrored) || ![0, 1].includes(player) ||
    typeof botId !== "string" || !botId || botId.length > 64 ||
    typeof sha !== "string" || !new RegExp(`^[a-f0-9]{${SHA_PREFIX}}$`).test(sha) ||
    !Array.isArray(log) || log.length % 2 || log.length > MAX_TICKS * 2 ||
    !log.every((n) => Number.isInteger(n) && n >= 0)
  )
    throw Error("The challenge link is damaged.");
  const inputs = [];
  let tick = 0;
  for (let i = 0; i < log.length; i += 2) {
    tick += log[i];
    if (log[i + 1] > 8 || (i && log[i] === 0) || tick >= MAX_TICKS)
      throw Error("The challenge link is damaged.");
    inputs.push([tick, log[i + 1]]);
  }
  return { engineVersion, seed, mirrored: mirrored === 1, player, botId, sha, inputs };
}

// The fragment `#m=<challenge>`; `null` when the URL carries no challenge.
export function readChallenge(hash) {
  const match = /^#(?:.*&)?m=([A-Za-z0-9_-]+)/.exec(hash ?? "");
  return match ? match[1] : null;
}
export const challengeFragment = (encoded) => `#${CHALLENGE_PARAM}=${encoded}`;
