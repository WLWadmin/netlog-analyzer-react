import { ChunkedNumericColumn } from '../../workers/chunkedNumericColumn';
import type {
  NetlogDiagnosticContextEvent,
  NetlogDiagnosticContextIndex,
  NetlogEventCategory,
} from './parser';

const DEFAULT_CHUNK_SIZE = 65_536;

const categoryCodes: Record<NetlogEventCategory, number> = {
  networkChange: 1,
  proxy: 2,
  cache: 3,
  ssl: 4,
  quic: 5,
  http2: 6,
  dns: 7,
  connect: 8,
};

const categoriesByCode: Record<number, NetlogEventCategory> = {
  1: 'networkChange',
  2: 'proxy',
  3: 'cache',
  4: 'ssl',
  5: 'quic',
  6: 'http2',
  7: 'dns',
  8: 'connect',
};

class TypeNameInterner {
  private readonly ids = new Map<string, number>();
  private readonly values = [''];

  add(value: string): number {
    const existing = this.ids.get(value);
    if (existing !== undefined) return existing;
    const id = this.values.length;
    this.values.push(value);
    this.ids.set(value, id);
    return id;
  }

  all(): readonly string[] {
    return this.values;
  }
}

export function createDiagnosticContextIndexBuilder(
  chunkSize = DEFAULT_CHUNK_SIZE,
) {
  const category = new ChunkedNumericColumn(Uint8Array, chunkSize);
  const time = new ChunkedNumericColumn(Float64Array, chunkSize);
  const typeName = new ChunkedNumericColumn(Uint32Array, chunkSize);
  const sourceId = new ChunkedNumericColumn(Uint32Array, chunkSize);
  const typeNames = new TypeNameInterner();
  let lastTime = Number.NEGATIVE_INFINITY;
  let lastCategoryCode = 0;
  let isTimeOrdered = true;

  const accept = (
    eventCategory: NetlogEventCategory,
    eventTime: number,
    eventTypeName: string,
    eventSourceId: number,
  ): void => {
    const categoryCode = categoryCodes[eventCategory];
    category.push(categoryCode);
    time.push(eventTime);
    typeName.push(typeNames.add(eventTypeName));
    sourceId.push(eventSourceId);
    if (
      eventTime < lastTime
      || (eventTime === lastTime && categoryCode < lastCategoryCode)
    ) {
      isTimeOrdered = false;
    }
    lastTime = eventTime;
    lastCategoryCode = categoryCode;
  };

  const finish = (): NetlogDiagnosticContextIndex => {
    let sortedOrder: Uint32Array | undefined;
    if (!isTimeOrdered && time.length > 1) {
      sortedOrder = new Uint32Array(time.length);
      for (let index = 0; index < sortedOrder.length; index += 1) {
        sortedOrder[index] = index;
      }
      sortedOrder.sort((left, right) => (
        (time.at(left) || 0) - (time.at(right) || 0)
        || (category.at(left) || 0) - (category.at(right) || 0)
        || left - right
      ));
    }
    return {
      count: time.length,
      chunkSize,
      categoryChunks: category.getChunks(),
      timeChunks: time.getChunks(),
      typeNameChunks: typeName.getChunks(),
      sourceIdChunks: sourceId.getChunks(),
      typeNames: typeNames.all(),
      ...(sortedOrder ? { sortedOrder } : {}),
    };
  };

  return { accept, finish };
}

function chunkedValueAt(
  chunks: readonly (
    | Float64Array
    | Uint32Array
    | Uint8Array
  )[],
  chunkSize: number,
  index: number,
): number | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined;
  return chunks[Math.floor(index / chunkSize)]?.[index % chunkSize];
}

export function diagnosticContextEventAt(
  index: NetlogDiagnosticContextIndex,
  logicalIndex: number,
): NetlogDiagnosticContextEvent | undefined {
  if (logicalIndex < 0 || logicalIndex >= index.count) return undefined;
  const physicalIndex = index.sortedOrder?.[logicalIndex] ?? logicalIndex;
  const categoryCode = chunkedValueAt(
    index.categoryChunks,
    index.chunkSize,
    physicalIndex,
  );
  const typeNameId = chunkedValueAt(
    index.typeNameChunks,
    index.chunkSize,
    physicalIndex,
  );
  const eventCategory = categoryCode === undefined
    ? undefined
    : categoriesByCode[categoryCode];
  if (!eventCategory) return undefined;
  return {
    category: eventCategory,
    time: chunkedValueAt(index.timeChunks, index.chunkSize, physicalIndex) || 0,
    typeName: index.typeNames[typeNameId || 0] || '',
    sourceId: chunkedValueAt(
      index.sourceIdChunks,
      index.chunkSize,
      physicalIndex,
    ) || 0,
  };
}
