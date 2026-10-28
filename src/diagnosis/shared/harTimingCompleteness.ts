import type { HarRequestEntry, HarNumericField } from '../../harParser';
import { harTimingContradictions } from '../../parsers/shared/harTimingValidity';

export function getHarTimingCompleteness(entry: HarRequestEntry) {
  const fields: Array<{ key: string; path: string; field: HarNumericField }> = [
    { key: 'time', path: 'time', field: entry.standard.time },
    ...(['send', 'wait', 'receive'] as const).map(key => ({
      key, path: `timings.${key}`, field: entry.standard.timings[key],
    })),
  ];
  const unavailable = fields.filter(({ field }) => field.state !== 'value').map(({ key, path, field }) => ({
    key,
    sourcePath: `${entry.standard.jsonPath}.${path}`,
    state: field.state,
    label: field.state === 'missing' ? '缺失' : field.state === 'invalid' ? '非法值' : '不可用（-1）',
  }));
  const time = entry.standard.time;
  const timings = Object.fromEntries(Object.entries(entry.standard.timings).map(([key, field]) => (
    [key, typeof field === 'object' && field.state === 'value' ? field.value : undefined]
  )));
  const contradictions = harTimingContradictions(time.state === 'value' ? time.value : undefined, timings)
    .map(path => `${entry.standard.jsonPath}.${path}`);
  return { complete: unavailable.length === 0 && contradictions.length === 0, totalAvailable: time.state === 'value', unavailable, contradictions };
}

export const HAR_TIMING_LIMITATION = '已记录的状态码、请求和响应信息仍可复核；缺失阶段不代表 0ms 或请求失败，也无法确认链路正常或定位耗时原因。请重新采集同次 HAR，必要时配对 NetLog 和服务端日志。';
export const HAR_TIMING_CONTRADICTION = 'HAR 阶段耗时与总耗时或 connect/ssl 存在矛盾；保留原始数值供复核，无法据此定位慢阶段或推算时间轴位置。请重新导出同次 HAR，并核验采集工具。';
