import { TestBed } from '@angular/core/testing';
import { storeProviders } from '../../testing/fakes';
import { BotsStore } from './bots.store';

describe('BotsStore', () => {
  let store: BotsStore;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: storeProviders });
    store = TestBed.inject(BotsStore);
  });

  it('starts with the registered controllers, sources included', () => {
    const bots = store.bots();
    expect(bots.length).toBeGreaterThanOrEqual(2);
    expect(bots).toEqual(store.builtins);
    expect(bots.every((bot) => bot.source.includes('function'))).toBe(true);
    expect(store.options()).toHaveLength(bots.length);
    expect(store.isRegistered(bots.length - 1)).toBe(true);
    expect(store.isRegistered(bots.length)).toBe(false);
  });

  it('keeps custom controllers after the registered ones with free ids', () => {
    const count = store.builtins.length;
    expect(store.customId()).toBe('custom-1');
    const index = store.add({ id: 'custom-1', model: 'Mine', source: 'export function tick() {}' });
    expect(index).toBe(count);
    expect(store.bots()).toHaveLength(count + 1);
    expect(store.isRegistered(index)).toBe(false);
    expect(store.customId()).toBe('custom-2');
    store.replace(index, { id: 'custom-1', model: 'Mine v2', source: '// v2' });
    expect(store.bots()[index]?.model).toBe('Mine v2');
    expect(store.builtins).toHaveLength(count);
  });
});
