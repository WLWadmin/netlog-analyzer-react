import { createRawDataStore, RawDataKind } from './rawDataStore';

function createDeterministicIds() {
  let index = 0;
  return (kind: RawDataKind) => `${kind}-${++index}`;
}

describe('rawDataStore', () => {
  it('超过 maxItems 后淘汰最旧项', () => {
    const store = createRawDataStore({ maxItems: 2, createId: createDeterministicIds() });

    const first = store.keep('netlog', { value: 1 });
    const second = store.keep('har', { value: 2 });
    const third = store.keep('netlog', { value: 3 });

    expect(store.size()).toBe(2);
    expect(() => store.get(first)).toThrow('Raw data not found or released');
    expect(store.get(second)).toEqual({ value: 2 });
    expect(store.get(third)).toEqual({ value: 3 });
  });

  it('get 会 touch 数据，避免刚访问项被淘汰', () => {
    const store = createRawDataStore({ maxItems: 2, createId: createDeterministicIds() });

    const first = store.keep('netlog', { value: 1 });
    const second = store.keep('har', { value: 2 });
    expect(store.get(first)).toEqual({ value: 1 });
    const third = store.keep('netlog', { value: 3 });

    expect(store.get(first)).toEqual({ value: 1 });
    expect(() => store.get(second)).toThrow('Raw data not found or released');
    expect(store.get(third)).toEqual({ value: 3 });
  });

  it('支持 release 单项和 releaseAll', () => {
    const store = createRawDataStore({ maxItems: 3, createId: createDeterministicIds() });

    const first = store.keep('netlog', {});
    store.keep('har', {});

    expect(store.release(first)).toBe(true);
    expect(store.release(first)).toBe(false);
    expect(store.size()).toBe(1);
    expect(store.releaseAll()).toBe(true);
    expect(store.releaseAll()).toBe(false);
    expect(store.size()).toBe(0);
  });
});
