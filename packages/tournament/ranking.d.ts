import type { BotMetadata } from "../bot-catalog.js";
import type { Replay } from "../sim/replay.js";
import type { StyleSample } from "./style.js";

export interface MatchRecord {
  a: number;
  b: number;
  round?: number;
  seed: number;
  mirrored: boolean;
  score: number;
  reason: string;
  ticks: number;
  flips: number[];
  energy: number[];
  centerDistance: number[];
  decision: string | null;
  holeFalls: number[];
  violations: number[];
  ringOuts: number[];
  firstContact: number | null;
  style?: StyleSample[];
}
export interface RankingRow extends BotMetadata {
  score: number;
  ci: [number, number] | null;
  matches: number;
  wins: number;
  draws: number;
  winRate: number;
  flipDifferential: number;
  ringOutsInflicted: number;
  ringOutsTaken: number;
  meanEnergy: number;
  meanFirstContactTick: number | null;
  violationsPerMatch: number;
  style: StyleSample | null;
  timeouts: number;
}
export function matchRecord(replay: Replay, a: number, b: number): MatchRecord;
export function rankTournament(bots: BotMetadata[], records: MatchRecord[], replicates?: number): RankingRow[];
