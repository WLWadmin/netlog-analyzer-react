import type { TraceDetectedSource } from './types';

type Punctuation = '{' | '}' | '[' | ']' | ':' | ',';

type Token =
  | { type: 'string'; value: string }
  | { type: 'punctuation'; value: Punctuation }
  | { type: 'primitive' };

interface ObjectContext {
  type: 'object';
  path: string[];
  state: 'key-or-end' | 'colon' | 'value' | 'comma-or-end';
  key?: string;
}

interface ArrayContext {
  type: 'array';
  path: string[];
  state: 'value-or-end' | 'comma-or-end';
}

type Context = ObjectContext | ArrayContext;

export type SourceSniffResult =
  | { kind: 'pending' }
  | { kind: 'detected'; source: TraceDetectedSource }
  | { kind: 'error'; code: 'TRACE_TOP_LEVEL_ARRAY_UNSUPPORTED' | 'TRACE_SOURCE_AMBIGUOUS' };

export class TraceSourceSniffer {
  private mode: 'default' | 'string' | 'escape' | 'unicode' | 'primitive' = 'default';
  private stringValue = '';
  private unicodeValue = '';
  private captureString = false;
  private traceArraySkipDepth = 0;
  private skipMode: 'default' | 'string' | 'escape' | 'unicode' = 'default';
  private skipUnicodeDigits = 0;
  private fullyScannedCharacters = 0;
  private maxBufferedKeyCharacters = 0;
  private stack: Context[] = [];
  private rootStarted = false;
  private rootArray = false;
  private sources = new Set<TraceDetectedSource>();
  private evidenceCodes = new Set<string>();

  feed(chunk: string): SourceSniffResult {
    for (const character of chunk) {
      if (this.traceArraySkipDepth > 0) {
        this.consumeSkippedTraceCharacter(character);
        continue;
      }
      this.fullyScannedCharacters += 1;
      const token = this.consumeCharacter(character);
      if (token) this.consumeToken(token);
    }
    return this.result();
  }

  finish(): SourceSniffResult {
    if (this.mode === 'primitive') this.consumeToken({ type: 'primitive' });
    return this.result();
  }

  getMetrics(): {
    fullyScannedCharacters: number;
    maxBufferedKeyCharacters: number;
  } {
    return {
      fullyScannedCharacters: this.fullyScannedCharacters,
      maxBufferedKeyCharacters: this.maxBufferedKeyCharacters,
    };
  }

  getDetectedSources(): TraceDetectedSource[] {
    return [...this.sources].sort();
  }

  getEvidenceCodes(): string[] {
    return [...this.evidenceCodes].sort();
  }

  private result(): SourceSniffResult {
    if (this.rootArray) {
      return { kind: 'error', code: 'TRACE_TOP_LEVEL_ARRAY_UNSUPPORTED' };
    }
    if (this.sources.size > 1) {
      return { kind: 'error', code: 'TRACE_SOURCE_AMBIGUOUS' };
    }
    const source = [...this.sources][0];
    return source ? { kind: 'detected', source } : { kind: 'pending' };
  }

  private consumeCharacter(character: string): Token | undefined {
    if (this.mode === 'string') {
      if (character === '\\') {
        this.mode = 'escape';
      } else if (character === '"') {
        this.mode = 'default';
        const value = this.stringValue;
        this.stringValue = '';
        return { type: 'string', value };
      } else {
        if (this.captureString) {
          this.stringValue += character;
          this.maxBufferedKeyCharacters = Math.max(
            this.maxBufferedKeyCharacters,
            this.stringValue.length,
          );
        }
      }
      return undefined;
    }
    if (this.mode === 'escape') {
      if (character === 'u') {
        this.mode = 'unicode';
        this.unicodeValue = '';
      } else {
        const escaped: Record<string, string> = {
          '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
        };
        if (this.captureString) {
          this.stringValue += escaped[character] ?? character;
        }
        this.mode = 'string';
      }
      return undefined;
    }
    if (this.mode === 'unicode') {
      this.unicodeValue += character;
      if (this.unicodeValue.length === 4) {
        const codePoint = Number.parseInt(this.unicodeValue, 16);
        if (this.captureString) {
          this.stringValue += Number.isFinite(codePoint)
            ? String.fromCharCode(codePoint)
            : '';
        }
        this.mode = 'string';
      }
      return undefined;
    }
    if (this.mode === 'primitive') {
      if (!/[\s,\]}]/.test(character)) return undefined;
      this.mode = 'default';
      this.consumeToken({ type: 'primitive' });
      return /[,}\]]/.test(character)
        ? { type: 'punctuation', value: character as ',' | '}' | ']' }
        : undefined;
    }
    if (character === '\uFEFF' || /\s/.test(character)) return undefined;
    if (character === '"') {
      const context = this.stack[this.stack.length - 1];
      this.captureString = context?.type === 'object'
        && context.state === 'key-or-end';
      this.mode = 'string';
      return undefined;
    }
    if (/[{}[\]:,]/.test(character)) {
      return { type: 'punctuation', value: character as Punctuation };
    }
    this.mode = 'primitive';
    return undefined;
  }

  private consumeToken(token: Token): void {
    if (!this.rootStarted) {
      if (token.type !== 'punctuation') return;
      this.rootStarted = true;
      if (token.value === '[') {
        this.rootArray = true;
        return;
      }
      if (token.value === '{') {
        this.stack.push({ type: 'object', path: [], state: 'key-or-end' });
      }
      return;
    }

    const context = this.stack[this.stack.length - 1];
    if (!context) return;
    if (context.type === 'object') {
      this.consumeObjectToken(context, token);
    } else {
      this.consumeArrayToken(context, token);
    }
  }

  private consumeObjectToken(context: ObjectContext, token: Token): void {
    if (context.state === 'key-or-end') {
      if (token.type === 'string') {
        context.key = token.value;
        context.state = 'colon';
      } else if (token.type === 'punctuation' && token.value === '}') {
        this.completeContainer();
      }
      return;
    }
    if (context.state === 'colon') {
      if (token.type === 'punctuation' && token.value === ':') context.state = 'value';
      return;
    }
    if (context.state === 'value') {
      const key = context.key ?? '';
      this.recordSignature(context.path, key, token);
      context.state = 'comma-or-end';
      if (token.type === 'punctuation' && (token.value === '{' || token.value === '[')) {
        const path = [...context.path, key];
        this.stack.push(token.value === '{'
          ? { type: 'object', path, state: 'key-or-end' }
          : { type: 'array', path, state: 'value-or-end' });
        if (context.path.length === 0 && key === 'traceEvents' && token.value === '[') {
          this.traceArraySkipDepth = 1;
        }
      }
      return;
    }
    if (token.type === 'punctuation' && token.value === ',') {
      context.key = undefined;
      context.state = 'key-or-end';
    } else if (token.type === 'punctuation' && token.value === '}') {
      this.completeContainer();
    }
  }

  private consumeArrayToken(context: ArrayContext, token: Token): void {
    if (context.state === 'value-or-end') {
      if (token.type === 'punctuation' && token.value === ']') {
        this.completeContainer();
        return;
      }
      context.state = 'comma-or-end';
      if (token.type === 'punctuation' && (token.value === '{' || token.value === '[')) {
        this.stack.push(token.value === '{'
          ? { type: 'object', path: context.path, state: 'key-or-end' }
          : { type: 'array', path: context.path, state: 'value-or-end' });
      }
      return;
    }
    if (token.type === 'punctuation' && token.value === ',') {
      context.state = 'value-or-end';
    } else if (token.type === 'punctuation' && token.value === ']') {
      this.completeContainer();
    }
  }

  private completeContainer(): void {
    this.stack.pop();
  }

  private recordSignature(path: string[], key: string, token: Token): void {
    if (token.type !== 'punctuation') return;
    if (path.length === 0 && key === 'traceEvents' && token.value === '[') {
      this.sources.add('trace');
      this.evidenceCodes.add('TRACE_EVENTS_ARRAY');
    }
    if (path.length === 0 && key === 'events' && token.value === '[') {
      this.sources.add('netlog');
      this.evidenceCodes.add('NETLOG_EVENTS_ARRAY');
    }
    if (path.length === 0 && key === 'constants' && token.value === '{') {
      this.evidenceCodes.add('NETLOG_CONSTANTS_OBJECT');
    }
    if (path.length === 0 && key === 'log' && token.value === '{') {
      this.evidenceCodes.add('HAR_LOG_OBJECT');
    }
    if (path.length === 1 && path[0] === 'log' && key === 'entries' && token.value === '[') {
      this.sources.add('har');
      this.evidenceCodes.add('HAR_ENTRIES_ARRAY');
    }
  }

  private consumeSkippedTraceCharacter(character: string): void {
    if (this.skipMode === 'string') {
      if (character === '\\') this.skipMode = 'escape';
      else if (character === '"') this.skipMode = 'default';
      return;
    }
    if (this.skipMode === 'escape') {
      if (character === 'u') {
        this.skipMode = 'unicode';
        this.skipUnicodeDigits = 4;
      } else {
        this.skipMode = 'string';
      }
      return;
    }
    if (this.skipMode === 'unicode') {
      this.skipUnicodeDigits -= 1;
      if (this.skipUnicodeDigits === 0) this.skipMode = 'string';
      return;
    }
    if (character === '"') {
      this.skipMode = 'string';
      return;
    }
    if (character === '[' || character === '{') {
      this.traceArraySkipDepth += 1;
      return;
    }
    if (character === ']' || character === '}') {
      this.traceArraySkipDepth -= 1;
      if (this.traceArraySkipDepth === 0) this.completeContainer();
    }
  }
}
