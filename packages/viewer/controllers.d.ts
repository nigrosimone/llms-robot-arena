export function sortedBotOptions<T extends { id: string; model: string; thinking?: string | null }>(bots: readonly T[]): { bot: T; index: number }[];
export function groupedBotOptions<T extends { id: string; model: string; thinking?: string | null; provider?: string | null; provenance?: string | null }>(bots: readonly T[]): { label: string; options: { bot: T; index: number }[] }[];
export function controllerFilename(name: string): string;
