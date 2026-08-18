const BASE_ACCEPT = '.json,.har,.log';
const TRACE_ACCEPT = '.trace,.json2,.json.gz,.trace.gz,.json2.gz';
const BASE_UPLOAD_EXTENSIONS = ['.json', '.har', '.log'];
const TRACE_UPLOAD_EXTENSIONS = [
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

export function isSupportedUploadName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const extensions = isTraceAnalysisEnabled()
    ? [...BASE_UPLOAD_EXTENSIONS, ...TRACE_UPLOAD_EXTENSIONS]
    : BASE_UPLOAD_EXTENSIONS;
  return extensions.some(extension => lower.endsWith(extension));
}
