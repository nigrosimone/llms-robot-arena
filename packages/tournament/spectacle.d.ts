import type { MatchRecord } from "./ranking.js";
import type { Highlight, TournamentReport } from "./exhibition.js";
export function matchSpectacle(record: Pick<MatchRecord, "flips" | "ticks" | "style">): { flips: number; engagements: number; index: number };
export function highlights(report: Partial<TournamentReport>, count?: number): Highlight[];
export function highlightLabel(report: Pick<TournamentReport, "bots">, highlight: Highlight): { match: string; result: string; search: string };
