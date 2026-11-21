import { Service, computed } from '@angular/core';
import { NgSimpleStateBaseSignalStore, type NgSimpleStateStoreConfig } from 'ng-simple-state';
import { type BotDefinition } from '../../../../../packages/bot-catalog.js';
import { groupedBotOptions, sortedBotOptions } from '../../../../../packages/viewer/controllers.js';
import { BOTS } from '../../generated/bots';

export interface Bot extends BotDefinition {
  source: string;
}
export interface BotsState {
  bots: Bot[];
}
let BUILTINS: readonly Bot[] | null = null;

/**
 * Loads the catalog sources, kept in their own chunk so the main bundle does
 * not grow with the catalog. The app initializer awaits it before any page.
 */
export async function loadBotSources(): Promise<void> {
  if (BUILTINS) return;
  const { SOURCES } = await import('../../generated/bot-sources');
  BUILTINS = BOTS.map((bot) => ({ ...bot, source: SOURCES[bot.id] ?? '' }));
}
/** The catalog controllers with their sources, once loaded. */
function builtins(): readonly Bot[] {
  if (!BUILTINS) throw new Error('The bot sources are not loaded yet.');
  return BUILTINS;
}

/**
 * The registered controllers plus the ones written in the Bot Lab, which live
 * in this tab only. Indexes are stable: the registered ones come first.
 */
@Service()
export class BotsStore extends NgSimpleStateBaseSignalStore<BotsState> {
  readonly builtins = builtins();
  readonly bots = this.selectState((s) => s.bots);
  readonly options = computed(() => sortedBotOptions(this.bots()));
  /** The same options grouped by provider, for the selectors. */
  readonly groups = computed(() => groupedBotOptions(this.bots()));
  /** Store name for the devtools. */
  storeConfig(): NgSimpleStateStoreConfig<BotsState> {
    return { storeName: 'bots' };
  }
  /** Called by the base constructor, before the fields of this class exist. */
  initialState(): BotsState {
    return { bots: [...builtins()] };
  }
  /** True for a controller from the catalog, false for a Bot Lab one. */
  isRegistered(index: number): boolean {
    return index < BOTS.length;
  }
  /** The next free `custom-N` id. */
  customId(): string {
    const bots = this.bots();
    let number = bots.length - BOTS.length + 1;
    while (bots.some((bot) => bot.id === 'custom-' + String(number))) number++;
    return 'custom-' + String(number);
  }
  /** Appends a controller and returns its index. */
  add(bot: Bot): number {
    this.setState((s) => ({ bots: [...s.bots, bot] }));
    return this.bots().length - 1;
  }
  /** Replaces the controller at `index`. */
  replace(index: number, bot: Bot): void {
    this.setState((s) => ({ bots: s.bots.map((b, i) => (i === index ? bot : b)) }));
  }
}
