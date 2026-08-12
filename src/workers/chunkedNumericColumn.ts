export type NumericTypedArray =
  | Float64Array
  | Uint32Array
  | Uint8Array;

interface NumericTypedArrayConstructor<TArray extends NumericTypedArray> {
  new(length: number): TArray;
}

export type NumericColumn = readonly number[] | ChunkedNumericColumn;

const DEFAULT_CHUNK_SIZE = 65_536;

export class ChunkedNumericColumn<
  TArray extends NumericTypedArray = NumericTypedArray,
> implements Iterable<number> {
  private readonly chunks: TArray[] = [];
  private itemCount = 0;

  constructor(
    private readonly ArrayType: NumericTypedArrayConstructor<TArray>,
    private readonly chunkSize = DEFAULT_CHUNK_SIZE,
  ) {
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
      throw new Error('chunkSize must be a positive integer');
    }
  }

  get length(): number {
    return this.itemCount;
  }

  get chunkCount(): number {
    return this.chunks.length;
  }

  getChunks(): readonly TArray[] {
    return this.chunks;
  }

  push(value: number): void {
    const offset = this.itemCount % this.chunkSize;
    if (offset === 0) {
      this.chunks.push(new this.ArrayType(this.chunkSize));
    }
    this.chunks[this.chunks.length - 1][offset] = value;
    this.itemCount += 1;
  }

  at(index: number): number | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= this.itemCount) {
      return undefined;
    }
    const chunkIndex = Math.floor(index / this.chunkSize);
    return this.chunks[chunkIndex][index % this.chunkSize];
  }

  set(index: number, value: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.itemCount) {
      throw new Error(`numeric column index out of range: ${index}`);
    }
    const chunkIndex = Math.floor(index / this.chunkSize);
    this.chunks[chunkIndex][index % this.chunkSize] = value;
  }

  find(predicate: (value: number, index: number) => boolean): number | undefined {
    for (let index = 0; index < this.itemCount; index += 1) {
      const value = this.at(index)!;
      if (predicate(value, index)) return value;
    }
    return undefined;
  }

  *[Symbol.iterator](): IterableIterator<number> {
    for (let index = 0; index < this.itemCount; index += 1) {
      yield this.at(index)!;
    }
  }
}

export function numericColumnAt(
  column: NumericColumn | undefined,
  index: number,
): number | undefined {
  if (!column) return undefined;
  return column instanceof ChunkedNumericColumn
    ? column.at(index)
    : column[index];
}

export function numericColumnFind(
  column: NumericColumn | undefined,
  predicate: (value: number, index: number) => boolean,
): number | undefined {
  if (!column) return undefined;
  return column instanceof ChunkedNumericColumn
    ? column.find(predicate)
    : column.find(predicate);
}

export function numericColumnIndexOf(
  column: NumericColumn | undefined,
  expected: number,
): number {
  if (!column) return -1;
  let index = 0;
  for (const value of column) {
    if (value === expected) return index;
    index += 1;
  }
  return -1;
}

export function numericColumnValues(
  column: NumericColumn,
): Iterable<number> {
  return column;
}
