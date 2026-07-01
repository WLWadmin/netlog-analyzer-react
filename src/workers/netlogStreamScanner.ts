export interface NetlogStreamScanMeta {
  bytesRead: number;
  parsedEvents: number;
  skippedEvents: number;
  reachedEventsEnd: boolean;
}

export interface NetlogStreamScanOptions {
  fileSize?: number;
  onProgress?: (bytesRead: number, parsedEvents: number) => void;
  onDebug?: (event: string, details?: Record<string, unknown>) => void;
  onTopLevelField?: (key: string, valueJson: string) => void;
}

type TextChunkSource = AsyncIterable<string | Uint8Array> | ReadableStream<Uint8Array | string>;
const NETLOG_EVENT_ARRAY_KEYS = new Set(['events', 'logEvents']);
const NETLOG_TOP_LEVEL_META_KEYS = new Set(['constants', 'polledData', 'systemInfo', 'clientInfo', 'netLogInfo']);

function describeChunk(chunk: string | Uint8Array) {
  return {
    kind: typeof chunk,
    constructorName: typeof chunk === 'string' ? 'String' : chunk.constructor?.name,
    rawLength: chunk.length,
  };
}

function describeTextPrefix(text: string) {
  const prefix = text.slice(0, 16);
  return {
    prefix,
    charCodes: Array.from(prefix).map(ch => ch.charCodeAt(0)),
  };
}

async function* streamToTextChunks(source: TextChunkSource, options: NetlogStreamScanOptions): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let loggedFirstChunk = false;

  if (Symbol.asyncIterator in source) {
    for await (const chunk of source as AsyncIterable<string | Uint8Array>) {
      if (typeof chunk === 'string') {
        if (!loggedFirstChunk) {
          loggedFirstChunk = true;
          options.onDebug?.('scanner:first-chunk', {
            sourceKind: 'async-iterable',
            ...describeChunk(chunk),
            decodedLength: chunk.length,
            ...describeTextPrefix(chunk),
          });
        }
        yield chunk;
      } else {
        const decoded = decoder.decode(chunk, { stream: true });
        if (!loggedFirstChunk) {
          loggedFirstChunk = true;
          options.onDebug?.('scanner:first-chunk', {
            sourceKind: 'async-iterable',
            ...describeChunk(chunk),
            decodedLength: decoded.length,
            ...describeTextPrefix(decoded),
          });
        }
        yield decoded;
      }
    }
    const tail = decoder.decode();
    if (tail) yield tail;
    return;
  }

  const reader = (source as ReadableStream<Uint8Array | string>).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (typeof value === 'string') {
        if (!loggedFirstChunk) {
          loggedFirstChunk = true;
          options.onDebug?.('scanner:first-chunk', {
            sourceKind: 'readable-stream-reader',
            ...describeChunk(value),
            decodedLength: value.length,
            ...describeTextPrefix(value),
          });
        }
        yield value;
      } else {
        const decoded = decoder.decode(value, { stream: true });
        if (!loggedFirstChunk) {
          loggedFirstChunk = true;
          options.onDebug?.('scanner:first-chunk', {
            sourceKind: 'readable-stream-reader',
            ...describeChunk(value),
            decodedLength: decoded.length,
            ...describeTextPrefix(decoded),
          });
        }
        yield decoded;
      }
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
}

export async function* scanNetlogEventJson(
  source: TextChunkSource,
  meta: NetlogStreamScanMeta,
  options: NetlogStreamScanOptions = {}
): AsyncGenerator<string> {
  let mode: 'before-root' | 'find-key' | 'after-key' | 'after-colon' | 'skip-value' | 'in-events-array' | 'done' = 'before-root';
  let escape = false;
  let readingKey = false;
  let keyBuffer = '';
  let currentKey = '';
  let pendingTargetKey = false;
  let captureTopLevelValue = false;
  let capturedKey = '';
  let capturedValueBuffer = '';
  let skipPrimitive = false;
  let skipValueComplete = false;
  let skipDepth = 0;
  let skipStarted = false;
  let skipInString = false;
  let skipEscape = false;
  let objectBuffer = '';
  let objectDepth = 0;
  let objectInString = false;
  let objectEscape = false;

  const emitCapturedValue = () => {
    if (!captureTopLevelValue || !capturedKey || !capturedValueBuffer) return;
    options.onTopLevelField?.(capturedKey, capturedValueBuffer);
    options.onDebug?.('scanner:top-level-field-captured', {
      key: capturedKey,
      valueLength: capturedValueBuffer.length,
      bytesRead: meta.bytesRead,
    });
    captureTopLevelValue = false;
    capturedKey = '';
    capturedValueBuffer = '';
  };

  for await (const chunk of streamToTextChunks(source, options)) {
    meta.bytesRead += chunk.length;
    options.onProgress?.(meta.bytesRead, meta.parsedEvents);

    for (const ch of chunk) {
      if (mode === 'done') continue;

      if (mode === 'before-root') {
        if (isWhitespace(ch)) continue;
        if (ch === '{') {
          options.onDebug?.('scanner:root-object-detected', { bytesRead: meta.bytesRead });
          mode = 'find-key';
          continue;
        }
        if (ch === '[') {
          options.onDebug?.('scanner:root-array-detected', { bytesRead: meta.bytesRead });
          mode = 'in-events-array';
          continue;
        }
        options.onDebug?.('scanner:invalid-root-token', {
          token: String(ch),
          charCode: typeof ch === 'string' ? ch.charCodeAt(0) : undefined,
          bytesRead: meta.bytesRead,
        });
        throw new Error('NetLog JSON 格式异常：根节点不是对象或数组');
      }

      if (mode === 'find-key') {
        if (readingKey) {
          if (escape) {
            keyBuffer += ch;
            escape = false;
          } else if (ch === '\\') {
            escape = true;
          } else if (ch === '"') {
            readingKey = false;
            currentKey = keyBuffer;
            pendingTargetKey = NETLOG_EVENT_ARRAY_KEYS.has(keyBuffer);
            if (pendingTargetKey) {
              options.onDebug?.('scanner:event-array-key-detected', { key: keyBuffer, bytesRead: meta.bytesRead });
            }
            mode = 'after-key';
            keyBuffer = '';
          } else {
            keyBuffer += ch;
          }
          continue;
        }

        if (isWhitespace(ch) || ch === ',') continue;
        if (ch === '}') {
          mode = 'done';
          continue;
        }
        if (ch === '"') {
          readingKey = true;
          keyBuffer = '';
        }
        continue;
      }

      if (mode === 'after-key') {
        if (isWhitespace(ch)) continue;
        if (ch !== ':') throw new Error('NetLog events/logEvents 字段格式异常：缺少冒号');
        if (pendingTargetKey) {
          mode = 'after-colon';
        } else {
          mode = 'skip-value';
          capturedKey = currentKey;
          captureTopLevelValue = NETLOG_TOP_LEVEL_META_KEYS.has(currentKey);
          capturedValueBuffer = '';
          skipPrimitive = false;
          skipValueComplete = false;
          skipDepth = 0;
          skipStarted = false;
          skipInString = false;
          skipEscape = false;
        }
        continue;
      }

      if (mode === 'after-colon') {
        if (isWhitespace(ch)) continue;
        if (ch !== '[') throw new Error('NetLog events/logEvents 字段格式异常：不是数组');
        options.onDebug?.('scanner:event-array-started', { bytesRead: meta.bytesRead });
        mode = 'in-events-array';
        continue;
      }

      if (mode === 'skip-value') {
        if (skipValueComplete) {
          if (isWhitespace(ch)) continue;
          if (ch === ',') {
            mode = 'find-key';
            continue;
          }
          if (ch === '}') {
            mode = 'done';
            continue;
          }
          continue;
        }

        if (!skipStarted) {
          if (isWhitespace(ch)) continue;
          skipStarted = true;
          if (captureTopLevelValue) capturedValueBuffer += ch;
          if (ch === '"') {
            skipInString = true;
            continue;
          }
          if (ch === '{' || ch === '[') {
            skipDepth = 1;
            continue;
          }
          if (ch === ',') {
            mode = 'find-key';
            continue;
          }
          if (ch === '}') {
            mode = 'done';
            continue;
          }
          skipPrimitive = true;
          continue;
        }

        if (skipPrimitive) {
          if (ch === ',' || ch === '}') {
            emitCapturedValue();
            skipPrimitive = false;
            if (ch === ',') {
              mode = 'find-key';
            } else {
              mode = 'done';
            }
            continue;
          }
          if (captureTopLevelValue) capturedValueBuffer += ch;
          continue;
        }

        if (captureTopLevelValue) capturedValueBuffer += ch;

        if (skipInString) {
          if (skipEscape) skipEscape = false;
          else if (ch === '\\') skipEscape = true;
          else if (ch === '"') {
            skipInString = false;
            if (skipDepth === 0) {
              emitCapturedValue();
              skipValueComplete = true;
            }
          }
          continue;
        }

        if (ch === '"') {
          skipInString = true;
          continue;
        }
        if (ch === '{' || ch === '[') {
          skipDepth++;
          continue;
        }
        if (ch === '}' || ch === ']') {
          if (skipDepth > 0) {
            skipDepth--;
            if (skipDepth === 0) {
              emitCapturedValue();
              skipValueComplete = true;
            }
            continue;
          }
          mode = 'done';
          continue;
        }
        if (skipDepth === 0 && ch === ',') {
          mode = 'find-key';
        }
        continue;
      }

      if (mode === 'in-events-array') {
        if (objectDepth === 0) {
          if (isWhitespace(ch) || ch === ',') continue;
          if (ch === ']') {
            meta.reachedEventsEnd = true;
            mode = 'done';
            options.onDebug?.('scanner:event-array-ended', {
              bytesRead: meta.bytesRead,
              parsedEvents: meta.parsedEvents,
              skippedEvents: meta.skippedEvents,
            });
            continue;
          }
          if (ch === '{') {
            objectBuffer = '{';
            objectDepth = 1;
            objectInString = false;
            objectEscape = false;
            continue;
          }
          continue;
        }

        objectBuffer += ch;
        if (objectInString) {
          if (objectEscape) objectEscape = false;
          else if (ch === '\\') objectEscape = true;
          else if (ch === '"') objectInString = false;
          continue;
        }

        if (ch === '"') objectInString = true;
        else if (ch === '{') objectDepth++;
        else if (ch === '}') {
          objectDepth--;
          if (objectDepth === 0) {
            meta.parsedEvents++;
            yield objectBuffer;
            objectBuffer = '';
          }
        }
      }
    }
  }

  if (!meta.reachedEventsEnd) {
    if (mode === 'before-root' || mode === 'find-key' || mode === 'skip-value' || mode === 'done') {
      throw new Error('未找到 NetLog events/logEvents 数组，请确认文件是否为标准 Chrome/Edge NetLog');
    }
    throw new Error('NetLog events/logEvents 数组未完整结束，文件可能被截断');
  }
}
