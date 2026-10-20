import { parseHarInput } from '../../utils/parseHarInput';
import type { HarAnalysisResult } from '../../harParser';

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(String(event.target?.result || ''));
    reader.onerror = () => reject(reader.error || new Error('HAR 文件读取失败'));
    reader.readAsText(file);
  });
}

export async function parseBaselineHarFile(file: File): Promise<HarAnalysisResult> {
  const text = await readFileAsText(file);
  return parseHarInput(text).result;
}
