import { Injectable, computed } from '@angular/core';
import { NgSimpleStateBaseSignalStore, NgSimpleStateStoreConfig } from 'ng-simple-state';
import { sortedBotOptions } from '../../../../../packages/viewer/controllers.js';
import { BOTS } from '../../generated/bots';

export interface Bot {
  id: string;
  model: string;
  provider?: string | null;
  thinking?: string | null;
  harness?: string | null;
  provenance?: string | null;
  source: string;
}
export interface BotsState {
  bots: Bot[];
}

// The registered controllers plus the ones written in the Bot Lab, which live
// in this tab only. Indexes are stable: the registered ones come first.
@Injectable({ providedIn: 'root' })
export class BotsStore extends NgSimpleStateBaseSignalStore<BotsState> {
  readonly builtins = BOTS as unknown as readonly Bot[];
  readonly bots = this.selectState((s) => s.bots);
  readonly options = computed(() => sortedBotOptions(this.bots()) as { bot: Bot; index: number }[]);
  storeConfig(): NgSimpleStateStoreConfig<BotsState> {
    return { storeName: 'bots' };
  }
  // Called by the base constructor, before the fields of this class exist.
  initialState(): BotsState {
    return { bots: [...(BOTS as unknown as readonly Bot[])] };
  }
  isRegistered(index: number) {
    return index < this.builtins.length;
  }
  customId() {
    const bots = this.bots();
    let number = bots.length - this.builtins.length + 1;
    while (bots.some((bot) => bot.id === 'custom-' + number)) number++;
    return 'custom-' + number;
  }
  add(bot: Bot) {
    this.setState((s) => ({ bots: [...s.bots, bot] }));
    return this.bots().length - 1;
  }
  replace(index: number, bot: Bot) {
    this.setState((s) => ({ bots: s.bots.map((b, i) => (i === index ? bot : b)) }));
  }
}
