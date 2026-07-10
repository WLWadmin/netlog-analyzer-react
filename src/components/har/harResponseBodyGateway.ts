import type { HarRequestEntry } from '../../harParser';
import type { HarResponseBodyPayload } from '../../workers/protocols';

export interface HarResponseBodySource {
  rawData?: unknown;
  rawDataId?: string;
}

function bodyFromRawData(rawData: unknown, entryId: number): HarResponseBodyPayload {
  if (!Number.isInteger(entryId) || entryId < 0) throw new Error('HAR response body entryId 无效');
  const entries = (rawData as any)?.log?.entries;
  if (!Array.isArray(entries)) throw new Error('原始 HAR 已释放或不可用，无法读取响应体');
  if (entryId >= entries.length) throw new Error('HAR response body entryId 越界');
  const content = entries[entryId]?.response?.content;
  const text = content?.text;
  if (text === undefined || text === null) {
    return {
      state: 'absent',
      text: '',
      encoding: '',
      mimeType: content?.mimeType ? String(content.mimeType) : '',
      originalLength: 0,
    };
  }
  const bodyText = String(text);
  return {
    state: 'available',
    text: bodyText,
    encoding: content?.encoding ? String(content.encoding) : '',
    mimeType: content?.mimeType ? String(content.mimeType) : '',
    originalLength: bodyText.length,
  };
}

export async function loadHarResponseBody(
  source: HarResponseBodySource,
  entry: HarRequestEntry
): Promise<HarResponseBodyPayload> {
  if (entry.responseBodyDescriptor?.state === 'inline' || entry.responseBody) {
    return {
      state: 'available',
      text: entry.responseBody,
      encoding: entry.responseEncoding || entry.responseBodyDescriptor?.encoding || '',
      mimeType: entry.mimeType || entry.responseBodyDescriptor?.mimeType || '',
      originalLength: entry.responseBodyDescriptor?.originalLength || entry.responseBody.length,
    };
  }

  if (entry.responseBodyDescriptor?.state === 'absent') {
    return {
      state: 'absent',
      text: '',
      encoding: '',
      mimeType: entry.mimeType || '',
      originalLength: 0,
    };
  }

  if (source.rawDataId) {
    const { getHarResponseBodyInWorker } = await import('../../workers/workerClient');
    return getHarResponseBodyInWorker(source.rawDataId, entry.id, { timeout: 60_000 });
  }

  if (source.rawData) {
    return bodyFromRawData(source.rawData, entry.id);
  }

  throw new Error('原始 HAR 已释放，无法按需读取该响应体');
}
