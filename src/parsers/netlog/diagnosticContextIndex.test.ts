import {
  createDiagnosticContextIndexBuilder,
  diagnosticContextEventAt,
} from './diagnosticContextIndex';

describe('diagnosticContextIndex', () => {
  it('单调时间保持 chunked columns 且不创建排序副本', () => {
    const builder = createDiagnosticContextIndexBuilder(2);

    builder.accept('networkChange', 1, 'NETWORK_CHANGE', 10);
    builder.accept('ssl', 2, 'SSL_CONNECT', 20);
    builder.accept('http2', 3, 'HTTP2_SESSION', 30);
    const index = builder.finish();

    expect(index.count).toBe(3);
    expect(index.timeChunks).toHaveLength(2);
    expect(index.sortedOrder).toBeUndefined();
    expect(diagnosticContextEventAt(index, 2)).toEqual({
      category: 'http2',
      time: 3,
      typeName: 'HTTP2_SESSION',
      sourceId: 30,
    });
  });

  it('乱序时间只增加 typed 排序索引并保持稳定 tie-break', () => {
    const builder = createDiagnosticContextIndexBuilder(2);

    builder.accept('http2', 3, 'HTTP2_LATE', 30);
    builder.accept('ssl', 1, 'SSL_FIRST', 10);
    builder.accept('networkChange', 1, 'NETWORK_FIRST', 20);
    const index = builder.finish();

    expect(index.sortedOrder).toBeInstanceOf(Uint32Array);
    expect([
      diagnosticContextEventAt(index, 0),
      diagnosticContextEventAt(index, 1),
      diagnosticContextEventAt(index, 2),
    ]).toEqual([
      expect.objectContaining({ category: 'networkChange', time: 1 }),
      expect.objectContaining({ category: 'ssl', time: 1 }),
      expect.objectContaining({ category: 'http2', time: 3 }),
    ]);
  });

  it('相同时间的类别逆序也使用 legacy 类别顺序', () => {
    const builder = createDiagnosticContextIndexBuilder(2);

    builder.accept('http2', 1, 'HTTP2_FIRST_IN_FILE', 30);
    builder.accept('proxy', 1, 'PROXY_SECOND_IN_FILE', 10);
    const index = builder.finish();

    expect(index.sortedOrder).toBeInstanceOf(Uint32Array);
    expect(diagnosticContextEventAt(index, 0)).toEqual(
      expect.objectContaining({ category: 'proxy' }),
    );
    expect(diagnosticContextEventAt(index, 1)).toEqual(
      expect.objectContaining({ category: 'http2' }),
    );
  });
});
