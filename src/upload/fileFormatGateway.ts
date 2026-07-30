import {
  FileFormatRegistry,
  probeRegisteredFormat,
  probeRegisteredFormats,
} from './fileFormatRegistry';
import { resolveFileFormat } from './resolveFileFormat';
import type {
  FileFormatAdapter,
  FileParserId,
  FormatResolution,
  ParseContext,
  ParseInput,
} from './fileFormatTypes';

export type PreparedFileFormat =
  | {
      kind: 'awaiting-confirmation';
      input: ParseInput;
      resolution: FormatResolution;
    }
  | {
      kind: 'expert-ready';
      input: ParseInput;
      parserId: FileParserId;
    }
  | {
      kind: 'auto-ready';
      input: ParseInput;
      parserId: FileParserId;
    }
  | {
      kind: 'parser-mismatch';
      input: ParseInput;
      requestedParserId: FileParserId;
      resolution: FormatResolution;
    };

export class ParserMismatchError extends Error {
  readonly code = 'PARSER_MISMATCH';
  readonly evidenceCodes: string[];

  constructor(evidenceCodes: string[]) {
    super('文件结构与所选打开方式不匹配');
    this.name = 'ParserMismatchError';
    this.evidenceCodes = evidenceCodes;
  }
}

function getAdapter(
  registry: FileFormatRegistry,
  parserId: FileParserId,
): FileFormatAdapter {
  const adapter = registry.get(parserId);
  if (!adapter || !('validate' in adapter) || !('parse' in adapter)) {
    throw new Error(`File parser is not executable: ${parserId}`);
  }
  return adapter as FileFormatAdapter;
}

export async function prepareFileFormat(
  input: ParseInput,
  registry: FileFormatRegistry,
  requestedParserId?: FileParserId,
): Promise<PreparedFileFormat> {
  if (!requestedParserId) {
    const resolution = resolveFileFormat(
      await probeRegisteredFormats(registry, input),
    );
    if (resolution.kind === 'recommended') {
      return {
        kind: 'auto-ready',
        input,
        parserId: resolution.candidate.parserId,
      };
    }
    return {
      kind: 'awaiting-confirmation',
      input,
      resolution,
    };
  }

  const requestedAdapter = registry.get(requestedParserId);
  if (!requestedAdapter) {
    throw new Error(`Unknown file parser: ${requestedParserId}`);
  }
  const requestedVerdict = await probeRegisteredFormat(requestedAdapter, input);
  if (requestedVerdict.kind === 'definite-match') {
    return {
      kind: 'expert-ready',
      input,
      parserId: requestedParserId,
    };
  }
  return {
    kind: 'parser-mismatch',
    input,
    requestedParserId,
    resolution: resolveFileFormat(await probeRegisteredFormats(registry, input)),
  };
}

export async function confirmFileParser<Result>(
  input: ParseInput,
  parserId: FileParserId,
  registry: FileFormatRegistry,
  context: ParseContext,
  onValidated?: () => void,
): Promise<Result> {
  const adapter = getAdapter(registry, parserId);
  const validation = await adapter.validate(input);
  if (!validation.ok) {
    throw new ParserMismatchError(validation.evidenceCodes);
  }
  onValidated?.();
  return adapter.parse(input, context) as Promise<Result>;
}
