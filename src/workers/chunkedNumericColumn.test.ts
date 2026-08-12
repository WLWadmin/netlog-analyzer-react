import {
  ChunkedNumericColumn,
  numericColumnAt,
  numericColumnFind,
  numericColumnIndexOf,
  numericColumnValues,
} from './chunkedNumericColumn';

describe('ChunkedNumericColumn', () => {
  it('跨 chunk 保留顺序、随机访问和查找语义', () => {
    const column = new ChunkedNumericColumn(Uint32Array, 2);

    column.push(10);
    column.push(20);
    column.push(30);

    expect(column.length).toBe(3);
    expect(column.chunkCount).toBe(2);
    expect(column.at(0)).toBe(10);
    expect(column.at(2)).toBe(30);
    expect(column.at(3)).toBeUndefined();
    column.set(1, 25);
    expect(column.at(1)).toBe(25);
    expect(column.find(value => value > 15)).toBe(25);
    expect(Array.from(column)).toEqual([10, 25, 30]);
  });

  it('helpers 同时兼容 typed column 和 legacy array fixture', () => {
    const column = new ChunkedNumericColumn(Float64Array, 2);
    column.push(1.5);
    column.push(2.5);
    const fixture = [3.5, 4.5];

    expect(numericColumnAt(column, 1)).toBe(2.5);
    expect(numericColumnAt(fixture, 1)).toBe(4.5);
    expect(numericColumnFind(column, value => value > 2)).toBe(2.5);
    expect(numericColumnFind(fixture, value => value > 4)).toBe(4.5);
    expect(numericColumnIndexOf(column, 2.5)).toBe(1);
    expect(numericColumnIndexOf(fixture, 4.5)).toBe(1);
    expect(Array.from(numericColumnValues(column))).toEqual([1.5, 2.5]);
    expect(Array.from(numericColumnValues(fixture))).toEqual([3.5, 4.5]);
  });
});
