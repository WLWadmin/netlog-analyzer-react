import type { UploadFileTypeHint } from './parseUploadedInput';

const BASE_ACCEPT = '.json,.har,.log';
const TRACE_ACCEPT = '.trace,.json2,.json.gz,.trace.gz,.json2.gz';
const SUPPORTED_UPLOAD_EXTENSIONS = [
  '.json',
  '.har',
  '.log',
  '.trace',
  '.json2',
  '.json.gz',
  '.trace.gz',
  '.json2.gz',
];

export function isTraceAnalysisEnabled(): boolean {
  return process.env.REACT_APP_ENABLE_TRACE_ANALYSIS === '1';
}

export function uploadAccept(): string {
  return isTraceAnalysisEnabled()
    ? `${BASE_ACCEPT},${TRACE_ACCEPT}`
    : BASE_ACCEPT;
}

export function uploadHintForFileName(fileName: string): UploadFileTypeHint | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.log')) return 'log';
  if (lower.endsWith('.har')) return 'har';
  if (lower.endsWith('.json') || lower.endsWith('.json.gz')) return 'json-auto';
  if (
    lower.endsWith('.trace')
    || lower.endsWith('.json2')
    || lower.endsWith('.trace.gz')
    || lower.endsWith('.json2.gz')
  ) {
    return 'trace';
  }
  return undefined;
}

export function isSupportedUploadName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SUPPORTED_UPLOAD_EXTENSIONS.some(extension => lower.endsWith(extension));
}
