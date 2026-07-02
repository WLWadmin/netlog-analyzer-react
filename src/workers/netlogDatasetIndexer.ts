import type { DnsIpEvidenceSummary } from '../diagnosis/ipEvidence';
import { createNetlogEndpointEvidenceReducer } from './netlogEndpointEvidenceReducer';

export interface CompactEventIndex {
  count: number;
  time: number[];
  typeId: number[];
  sourceTypeId: number[];
  sourceId: number[];
  phase: number[];
  flags: number[];
  byteStart: number[];
  byteEnd: number[];
  eventTypeNames?: Record<number, string>;
  sourceTypeNames?: Record<number, string>;
}

export interface NetlogDatasetIndexResult {
  index: CompactEventIndex;
  endpointEvidence: DnsIpEvidenceSummary;
}

export interface NetlogIndexableFile {
  name?: string;
  size: number;
  stream(): ReadableStream<Uint8Array>;
  slice(start?: number, end?: number): Blob;
}

const QUOTE = 34;
const BACKSLASH = 92;
const LEFT_BRACE = 123;
const RIGHT_BRACE = 125;
const LEFT_BRACKET = 91;
const RIGHT_BRACKET = 93;
const COLON = 58;
const COMMA = 44;

function isWhitespaceByte(byte: number): boolean {
  return byte === 32 || byte === 10 || byte === 13 || byte === 9;
}

function decodeAscii(bytes: number[]): string {
  return String.fromCharCode(...bytes);
}

function emptyIndex(): CompactEventIndex {
  return {
    count: 0,
    time: [],
    typeId: [],
    sourceTypeId: [],
    sourceId: [],
    phase: [],
    flags: [],
    byteStart: [],
    byteEnd: [],
    eventTypeNames: {},
    sourceTypeNames: {},
  };
}

function buildReverseNameMap(raw: unknown): Record<number, string> {
  const result: Record<number, string> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number') {
      result[value] = name;
    } else if (/^\d+$/.test(name) && typeof value === 'string') {
      result[Number(name)] = value;
    }
  }
  return result;
}

function applyConstants(index: CompactEventIndex, constants: unknown) {
  if (!constants || typeof constants !== 'object') return;
  const value = constants as Record<string, unknown>;
  index.eventTypeNames = buildReverseNameMap(value.logEventTypes || value.eventTypes);
  index.sourceTypeNames = buildReverseNameMap(value.logSourceType || value.sourceTypes || value.logSourceTypes);
}

function pushEvent(index: CompactEventIndex, event: any, byteStart: number, byteEnd: number) {
  index.count += 1;
  index.time.push(Number(event?.time) || 0);
  index.typeId.push(Number(event?.type) || 0);
  index.sourceTypeId.push(Number(event?.source?.type ?? event?.source_type) || 0);
  index.sourceId.push(Number(event?.source?.id ?? event?.source_id) || 0);
  index.phase.push(Number(event?.phase) || 0);
  index.flags.push(event?.params?.net_error || event?.params?.error_code ? 1 : 0);
  index.byteStart.push(byteStart);
  index.byteEnd.push(byteEnd);
}

function eventName(index: CompactEventIndex, typeId: number): string {
  return index.eventTypeNames?.[typeId] || `UNKNOWN_${typeId}`;
}

function sourceTypeName(index: CompactEventIndex, sourceTypeId: number): string {
  return index.sourceTypeNames?.[sourceTypeId] || (sourceTypeId ? `UNKNOWN_SRC_${sourceTypeId}` : 'UNKNOWN_SRC');
}

export async function readNetlogEventDetail(file: NetlogIndexableFile, index: CompactEventIndex, eventId: number): Promise<unknown> {
  const start = index.byteStart[eventId];
  const end = index.byteEnd[eventId];
  if (start === undefined || end === undefined) {
    throw new Error(`NetLog eventId 不存在：${eventId}`);
  }
  const text = await file.slice(start, end).text();
  return JSON.parse(text);
}

export async function buildNetlogCompactEventIndex(file: NetlogIndexableFile): Promise<NetlogDatasetIndexResult> {
  const index = emptyIndex();
  const endpointReducer = createNetlogEndpointEvidenceReducer();
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();

  let absoluteByteOffset = 0;
  let mode: 'before-root' | 'find-key' | 'after-key' | 'after-colon' | 'skip-value' | 'in-events-array' | 'done' = 'before-root';
  let readingKey = false;
  let keyEscape = false;
  let keyBytes: number[] = [];
  let pendingKey = '';
  let pendingTargetKey = false;
  let skipStarted = false;
  let skipDepth = 0;
  let skipInString = false;
  let skipEscape = false;
  let skipValueBytes: number[] | null = null;
  let objectDepth = 0;
  let objectInString = false;
  let objectEscape = false;
  let objectStart = -1;
  let objectBytes: number[] = [];

  const resetSkip = () => {
    skipStarted = false;
    skipDepth = 0;
    skipInString = false;
    skipEscape = false;
    skipValueBytes = pendingKey === 'constants' ? [] : null;
  };

  const finishSkippedValue = () => {
    if (!skipValueBytes) return;
    try {
      const value = JSON.parse(decoder.decode(new Uint8Array(skipValueBytes)));
      if (pendingKey === 'constants') applyConstants(index, value);
    } catch {
      // constants 解析失败不影响事件索引
    } finally {
      skipValueBytes = null;
    }
  };

  const appendSkipByte = (byte: number) => {
    if (skipValueBytes !== null) {
      skipValueBytes.push(byte);
    }
  };

  const removeLastSkipByte = () => {
    if (skipValueBytes !== null) {
      skipValueBytes.pop();
    }
  };

  const finishObject = async (byteEnd: number) => {
    const eventJson = decoder.decode(new Uint8Array(objectBytes));
    const event = JSON.parse(eventJson);
    const eventId = index.count;
    pushEvent(index, event, objectStart, byteEnd);
    const typeId = Number(event?.type) || 0;
    const sourceTypeId = Number(event?.source?.type ?? event?.source_type) || 0;
    endpointReducer.accept({
      eventId,
      byteStart: objectStart,
      byteEnd,
      time: Number(event?.time) || 0,
      typeName: eventName(index, typeId),
      sourceId: Number(event?.source?.id ?? event?.source_id) || 0,
      sourceTypeName: sourceTypeName(index, sourceTypeId),
      phase: Number(event?.phase) || 0,
      params: event?.params,
    });
    objectBytes = [];
    objectStart = -1;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = value || new Uint8Array();
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      const byteOffset = absoluteByteOffset + i;

      if (mode === 'done') continue;

      if (mode === 'before-root') {
        if (isWhitespaceByte(byte)) continue;
        if (byte === LEFT_BRACE) {
          mode = 'find-key';
          continue;
        }
        if (byte === LEFT_BRACKET) {
          mode = 'in-events-array';
          continue;
        }
        throw new Error('NetLog JSON 格式异常：根节点不是对象或数组');
      }

      if (mode === 'find-key') {
        if (readingKey) {
          if (keyEscape) {
            keyBytes.push(byte);
            keyEscape = false;
          } else if (byte === BACKSLASH) {
            keyEscape = true;
          } else if (byte === QUOTE) {
            readingKey = false;
            pendingKey = decodeAscii(keyBytes);
            pendingTargetKey = pendingKey === 'events' || pendingKey === 'logEvents';
            keyBytes = [];
            mode = 'after-key';
          } else {
            keyBytes.push(byte);
          }
          continue;
        }
        if (isWhitespaceByte(byte) || byte === COMMA) continue;
        if (byte === RIGHT_BRACE) {
          mode = 'done';
          continue;
        }
        if (byte === QUOTE) {
          readingKey = true;
          keyBytes = [];
        }
        continue;
      }

      if (mode === 'after-key') {
        if (isWhitespaceByte(byte)) continue;
        if (byte !== COLON) throw new Error(`NetLog 顶层字段 ${pendingKey} 缺少冒号`);
        if (pendingTargetKey) {
          mode = 'after-colon';
        } else {
          mode = 'skip-value';
          resetSkip();
        }
        continue;
      }

      if (mode === 'after-colon') {
        if (isWhitespaceByte(byte)) continue;
        if (byte !== LEFT_BRACKET) throw new Error('NetLog events/logEvents 字段格式异常：不是数组');
        mode = 'in-events-array';
        continue;
      }

      if (mode === 'skip-value') {
        if (!skipStarted) {
          if (isWhitespaceByte(byte)) continue;
          skipStarted = true;
          appendSkipByte(byte);
          if (byte === QUOTE) {
            skipInString = true;
            continue;
          }
          if (byte === LEFT_BRACE || byte === LEFT_BRACKET) {
            skipDepth = 1;
            continue;
          }
          if (byte === COMMA) {
            finishSkippedValue();
            mode = 'find-key';
            continue;
          }
          if (byte === RIGHT_BRACE) {
            finishSkippedValue();
            mode = 'done';
            continue;
          }
          continue;
        }
        appendSkipByte(byte);
        if (skipInString) {
          if (skipEscape) skipEscape = false;
          else if (byte === BACKSLASH) skipEscape = true;
          else if (byte === QUOTE) skipInString = false;
          continue;
        }
        if (byte === QUOTE) {
          skipInString = true;
          continue;
        }
        if (byte === LEFT_BRACE || byte === LEFT_BRACKET) {
          skipDepth++;
          continue;
        }
        if (byte === RIGHT_BRACE || byte === RIGHT_BRACKET) {
          if (skipDepth > 0) {
            skipDepth--;
            if (skipDepth === 0) finishSkippedValue();
            continue;
          }
          finishSkippedValue();
          mode = 'done';
          continue;
        }
        if (skipDepth === 0 && byte === COMMA) {
          removeLastSkipByte();
          finishSkippedValue();
          mode = 'find-key';
        }
        continue;
      }

      if (mode === 'in-events-array') {
        if (objectDepth === 0) {
          if (isWhitespaceByte(byte) || byte === COMMA) continue;
          if (byte === RIGHT_BRACKET) {
            mode = 'done';
            continue;
          }
          if (byte !== LEFT_BRACE) continue;
          objectStart = byteOffset;
          objectDepth = 1;
          objectInString = false;
          objectEscape = false;
          objectBytes = [byte];
          continue;
        }

        objectBytes.push(byte);
        if (objectInString) {
          if (objectEscape) objectEscape = false;
          else if (byte === BACKSLASH) objectEscape = true;
          else if (byte === QUOTE) objectInString = false;
          continue;
        }
        if (byte === QUOTE) {
          objectInString = true;
          continue;
        }
        if (byte === LEFT_BRACE) objectDepth++;
        else if (byte === RIGHT_BRACE) {
          objectDepth--;
          if (objectDepth === 0) {
            await finishObject(byteOffset + 1);
          }
        }
      }
    }
    absoluteByteOffset += chunk.length;
  }

  return {
    index,
    endpointEvidence: endpointReducer.finish(),
  };
}
