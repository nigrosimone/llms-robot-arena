export interface MatchSettings {
  a: number | null;
  b: number | null;
  seed: number | null;
  spawn: "normal" | "mirror" | null;
}
export function readMatchSettings(search: string, bots: readonly { id: string }[]): MatchSettings | null;
export function matchSettingsSearch(settings: { a: string; b: string; seed: number; mirrored: boolean }): string;
