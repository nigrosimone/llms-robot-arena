import type { BotMetadata } from "../bot-catalog.js";
import type { MatchRecord, RankingRow } from "./ranking.js";

export type TournamentFormat = "quick" | "round-robin";
export interface Schedule {
  format: TournamentFormat;
  rounds: number;
  matches: { a: number; b: number; seed: number; mirrored: boolean; round: number }[];
}
export interface CodeMetrics {
  language: string;
  lines: number;
  codeLines: number;
  commentLines: number;
  functions: number;
  statements: number;
  complexity: number;
  maxDepth: number;
  bytes: number;
}
export interface GateCheck {
  name: string;
  pass: boolean;
  required?: boolean;
  detail?: string;
}
export interface GateVerdict {
  pass: boolean;
  eligible?: boolean;
  checks: GateCheck[];
  p99?: number | null;
}
export interface Highlight {
  a: string;
  b: string;
  seed: number;
  mirrored: boolean;
  flips: number;
  engagements: number;
  index: number;
  reason: string;
  ticks: number;
  winner: string | null;
}
export interface TournamentReport {
  specVersion: string;
  engineVersion: string;
  mode: string;
  budgetMode: string;
  format: TournamentFormat;
  status: string;
  rounds: number;
  totalMatches: number;
  replicates: number;
  bots: (BotMetadata & { file?: string | null; code?: CodeMetrics | null })[];
  gates: ({ id: string } & GateVerdict)[];
  records: MatchRecord[];
  ranking: RankingRow[];
  highlights?: Highlight[];
  published?: boolean;
  generatedAt?: string;
}
export function exhibitionSchedule(count: number, format?: TournamentFormat): Schedule;
export function recordKey(shaA: string, shaB: string, seed: number, mirrored: boolean): string;
