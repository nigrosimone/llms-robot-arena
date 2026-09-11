import type { Replay } from "../sim/replay.js";
export interface Challenge {
  engineVersion: string;
  seed: number;
  mirrored: boolean;
  player: number;
  botId: string;
  sha: string;
  inputs: [number, number][];
}
export const CHALLENGE_PARAM: string;
export const SHA_PREFIX: number;
export function challengeFromReplay(replay: Replay): Challenge;
export function encodeChallenge(challenge: Challenge): Promise<string>;
export function decodeChallenge(text: string): Promise<Challenge>;
export function readChallenge(hash: string | null | undefined): string | null;
export function challengeFragment(encoded: string): string;
