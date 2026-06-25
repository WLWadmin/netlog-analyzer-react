import { getValueByPath, searchJsonPaths } from './rawJsonPath';

describe('rawJsonPath', () => {
  test('getValueByPath should read nested value', () => {
    const data = { arr: [{ x: 'foo' }], a: { b: 1 } };
    expect(getValueByPath(data, 'arr[0].x')).toBe('foo');
    expect(getValueByPath(data, 'a.b')).toBe(1);
  });

  test('searchJsonPaths should find by key or value', () => {
    const data = { arr: [{ x: 'foo' }], a: { b: 1 }, name: 'hello' };
    const byKey = searchJsonPaths(data, 'x', 50, 8);
    expect(byKey.some(r => r.path.includes('arr[0].x'))).toBe(true);

    const byValue = searchJsonPaths(data, 'hello', 50, 8);
    expect(byValue.some(r => r.path === 'name')).toBe(true);
  });

  test('searchJsonPaths should respect maxDepth', () => {
    const data = { a: { b: { c: 1 } } };
    const shallow = searchJsonPaths(data, 'c', 50, 1);
    expect(shallow.length).toBe(0);
    const deep = searchJsonPaths(data, 'c', 50, 3);
    expect(deep.some(r => r.path.endsWith('.c'))).toBe(true);
  });
});

