import type { Replay } from "../sim/replay.js";
import type { RankingRow } from "./ranking.js";

export type StyleSample = Record<string, number>;
export interface StyleAxis {
  key: string;
  label: string;
  short?: string;
  metric: string;
  percent?: boolean;
  unit?: string;
  digits?: number;
}
export const STYLE_AXES: readonly StyleAxis[];
export function formatStyleValue(axis: StyleAxis, style: StyleSample | null | undefined): string;
export function matchStyle(replay: Replay): StyleSample[];
export function meanStyle(samples: (StyleSample | undefined)[]): StyleSample | null;
export function styleProfiles(ranking: RankingRow[]): Record<string, number>[] | null;
export function styleLabel(profile: Record<string, number>): string;
