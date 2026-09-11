import type { TournamentReport } from "./exhibition.js";
export interface IndexTerm {
  key: string;
  label: string;
  weight: number;
}
export const INDEX_TERMS: readonly IndexTerm[];
export function compositeIndex(report: TournamentReport): { id: string; index: number; terms: Record<string, number | null> }[] | null;
