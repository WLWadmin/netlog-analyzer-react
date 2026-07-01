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
  };
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

export async function readNetlogEventDetail(file: NetlogIndexableFile, index: CompactEventIndex, eventId: number): Promise<unknown> {
  const start = index.byteStart[eventId];
  const end = index.byteEnd[eventId];
  if (start === undefined || end === undefined) {
    throw new Error(`NetLog eventId 不存在：${eventId}`);
  }
  const text = await file.slice(start, end).text();
  return JSON.parse(text);
}

export async function buildNetlogCompactEventIndex(file: NetlogIndexableFile): Promise<CompactEventIndex> {
  const index = emptyIndex();
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
  };

  const finishObject = async (byteEnd: number) => {
    const eventJson = decoder.decode(new Uint8Array(objectBytes));
    pushEvent(index, JSON.parse(eventJson), objectStart, byteEnd);
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
          if (byte === QUOTE) {
            skipInString = true;
            continue;
          }
          if (byte === LEFT_BRACE || byte === LEFT_BRACKET) {
            skipDepth = 1;
            continue;
          }
          if (byte === COMMA) {
            mode = 'find-key';
            continue;
          }
          if (byte === RIGHT_BRACE) {
            mode = 'done';
            continue;
          }
          continue;
        }
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
            continue;
          }
          mode = 'done';
          continue;
        }
        if (skipDepth === 0 && byte === COMMA) {
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

  return index;
}
