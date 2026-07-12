import { parseLog, type AnalysisResult } from '../../parsers/netlog/parser';

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(String(event.target?.result || ''));
    reader.onerror = () => reject(reader.error || new Error('NetLog 文件读取失败'));
    reader.readAsText(file);
  });
}

export async function parseBaselineNetlogFile(file: File): Promise<AnalysisResult> {
  const text = await readFileAsText(file);
  if (typeof Worker !== 'undefined') {
    try {
      const { parseNetlogInWorker } = await import('../../workers/workerClient');
      return (await parseNetlogInWorker(text)).result;
    } catch {
      // Keep a deterministic parser error below if the worker is unavailable.
    }
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('NetLog 文件不是有效 JSON');
  }
  try {
    return parseLog(data).result;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'NetLog 解析失败');
  }
}
