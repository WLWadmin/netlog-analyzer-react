import { TextDecoder, TextEncoder } from 'util';
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { buildNetlogCompactEventIndex, type NetlogIndexableFile } from './netlogDatasetIndexer';
import { FileQualityError } from '../parsers/shared/fileQuality';
import { scanNetlogEventJson } from './netlogStreamScanner';

Object.assign(global, { TextDecoder });
function fileFor(text: string): NetlogIndexableFile {
  const bytes = new TextEncoder().encode(text);
  return {
    size: bytes.length,
    stream: () => new NodeReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.slice(offset, offset + 3));
        controller.close();
      },
    }) as unknown as ReadableStream<Uint8Array>,
    slice: () => new Blob(),
  };
}

describe('NetLog stream file quality', () => {
  const rootDamage = [
    '{"events":[]"constants":{}}', '{"events":[],}', '{"events":[],"other":0]',
    '{,"events":[]}', '{"events":[],,"other":0}', '{"events":[]junk}',
    '{"other":,"events":[]}', '{"other":[},"events":[]}',
    '{"other":"text""events":[]}',
    '{"events":[],"other":0 "constants":{}}', '{"events":[],"other":broken}',
    '{"events":[],"other":01}', '{"events":[],"other":1e}',
  ];
  it.each(rootDamage)('rejects invalid root delimiters in both stream paths: %s', async text => {
    await expect(buildNetlogCompactEventIndex(fileFor(text))).rejects.toBeInstanceOf(FileQualityError);
    const meta = { bytesRead: 0, parsedEvents: 0, skippedEvents: 0, reachedEventsEnd: false };
    const collect = async () => {
      for await (const event of scanNetlogEventJson(fileFor(text).stream(), meta)) JSON.parse(event);
    };
    await expect(collect()).rejects.toBeInstanceOf(FileQualityError);
  });

  it.each(['{"other":0,"events":[]}', '{"events":[],"other":"text"}', '{"other":[{}],"events":[],"tail":true}', '{"events":[],"other":-1.25e+3 }', '{"events":[],"other":null}'])(
    'accepts valid root separators and metadata values: %s', async text => {
      await expect(buildNetlogCompactEventIndex(fileFor(text))).resolves.toMatchObject({ index: { count: 0 } });
      const meta = { bytesRead: 0, parsedEvents: 0, skippedEvents: 0, reachedEventsEnd: false };
      for await (const event of scanNetlogEventJson(fileFor(text).stream(), meta)) JSON.parse(event);
      expect(meta.reachedEventsEnd).toBe(true);
    });

  it.each([
    '{"events":[', '{"events":[]', '{"events":[null]}', '{"events":[{"time":broken}]}',
    '{"events":[]}SECRET', '{"constants":broken,"events":[]}',
    '{"events":[{},]}', '{"events":[{}{}]}', '{"events":[,{}]}',
  ])('rejects detected syntax/structure damage across chunks: %s', async text => {
    await expect(buildNetlogCompactEventIndex(fileFor(text))).rejects.toBeInstanceOf(FileQualityError);
  });
  it('scans metadata after the events array and accepts root arrays', async () => {
    const fields: string[] = [];
    await expect(buildNetlogCompactEventIndex(fileFor('{"events":[],"constants":{"timeTickOffset":10}}'), {
      onTopLevelField: key => fields.push(key),
    })).resolves.toMatchObject({ index: { count: 0 } });
    expect(fields).toEqual(['constants']);
    await expect(buildNetlogCompactEventIndex(fileFor('[]'))).resolves.toMatchObject({ index: { count: 0 } });
  });

  it.each(['{"events":[]', '{"events":[null]}', '{"events":[{},]}', '{"events":[{}{}]}'])(
    'summary fallback also refuses detected damage: %s', async text => {
      const meta = { bytesRead: 0, parsedEvents: 0, skippedEvents: 0, reachedEventsEnd: false };
      const collect = async () => {
        for await (const event of scanNetlogEventJson(fileFor(text).stream(), meta)) JSON.parse(event);
      };
      await expect(collect()).rejects.toBeInstanceOf(FileQualityError);
    });
});
