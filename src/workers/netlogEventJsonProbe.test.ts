import { extractSourceId, extractSourceTypeId, extractTopLevelNumberLikeField, extractTopLevelNumericField } from './netlogEventJsonProbe';

describe('netlogEventJsonProbe', () => {
  it('只提取顶层 event.type，不误读 source.type', () => {
    const json = '{"source":{"id":1,"type":20},"type":100,"params":{"type":300}}';

    expect(extractTopLevelNumericField(json, 'type')).toBe(100);
    expect(extractSourceId(json)).toBe(1);
    expect(extractSourceTypeId(json)).toBe(20);
  });

  it('支持顶层 type 出现在 source 前面', () => {
    const json = '{"type":101,"source":{"id":1,"type":21},"params":{}}';

    expect(extractTopLevelNumericField(json, 'type')).toBe(101);
    expect(extractSourceTypeId(json)).toBe(21);
  });

  it('忽略字符串里的 type 文本', () => {
    const json = '{"params":{"message":"\\"type\\":999"},"source":{"type":22},"type":102}';

    expect(extractTopLevelNumericField(json, 'type')).toBe(102);
  });

  it('支持提取顶层字符串数字 time', () => {
    const json = '{"time":"123.5","source":{"id":1,"type":20},"type":100,"params":{"time":"999"}}';

    expect(extractTopLevelNumberLikeField(json, 'time')).toBe(123.5);
    expect(extractTopLevelNumericField(json, 'time')).toBeUndefined();
  });
});
