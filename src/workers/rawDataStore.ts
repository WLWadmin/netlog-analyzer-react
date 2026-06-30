export type RawDataKind = 'har' | 'netlog';

interface RawDataStoreOptions {
  maxItems: number;
  createId?: (kind: RawDataKind) => string;
}

export function createRawDataStore({ maxItems, createId = defaultCreateId }: RawDataStoreOptions) {
  const store = new Map<string, unknown>();

  function touch(id: string) {
    if (!store.has(id)) return;
    const value = store.get(id);
    store.delete(id);
    store.set(id, value);
  }

  function enforceLimit() {
    while (store.size > maxItems) {
      const oldestId = store.keys().next().value;
      if (!oldestId) break;
      store.delete(oldestId);
    }
  }

  return {
    keep(kind: RawDataKind, rawData: unknown): string {
      const id = createId(kind);
      store.set(id, rawData);
      enforceLimit();
      return id;
    },

    get(id: string): unknown {
      if (!store.has(id)) {
        throw new Error('Raw data not found or released');
      }
      touch(id);
      return store.get(id);
    },

    release(id: string): boolean {
      return store.delete(id);
    },

    releaseAll(): boolean {
      const hadData = store.size > 0;
      store.clear();
      return hadData;
    },

    size(): number {
      return store.size;
    },
  };
}

function defaultCreateId(kind: RawDataKind): string {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
