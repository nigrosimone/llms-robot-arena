// The catalog contract for typed callers; the implementation is bot-catalog.js.
export interface BotDefinition {
  id: string;
  model: string;
  provider?: string | null;
  thinking?: string | null;
  harness?: string | null;
  provenance?: string | null;
  file?: string;
}
export interface BotMetadata extends BotDefinition {
  codeSha256?: string;
}
export const botCatalog: readonly BotDefinition[];
export function validateBotDefinitions<T extends BotDefinition>(entries: T[], options?: { catalog?: boolean }): T[];
export function botName(bot: Partial<BotDefinition> | { model?: string }): string;
export function botProvider(bot: Partial<BotDefinition>): string;
export function botMetadata(bot: BotDefinition): BotMetadata;
export function botDetails(bot: Partial<BotDefinition>): string;
