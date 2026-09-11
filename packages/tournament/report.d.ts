import type { RankingRow } from "./ranking.js";
import type { TournamentReport } from "./exhibition.js";
export function renderCSV(ranking: RankingRow[]): string;
export function renderReport(report: TournamentReport): string;
