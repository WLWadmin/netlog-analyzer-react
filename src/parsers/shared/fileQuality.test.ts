import { parseHar } from '../../harParser';
import { parseLog } from '../netlog/parser';
import { createNetlogStreamingAnalyzer } from '../netlog/streamingAnalyzer';
import { parseHarInput } from '../../utils/parseHarInput';
import { createFileQualityCollector, checkHarEntry, checkNetlogEvent, FileQualityError, parseNetlogJson } from './fileQuality';

const harEntry = {
  startedDateTime: '2026-10-28T00:00:00Z', time: 10,
  request: { method: 'GET', url: 'https://example.test/', headers: [], cookies: [] },
  response: { status: 200, headers: [], cookies: [], content: { size: 0 } },
  timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: 10, receive: 0 },
};
const event = { time: '12.25', type: 1, source: { id: 7, type: 1 }, phase: 0, params: {} };
const reportFor = (entry: unknown) => parseHar({ log: { entries: [entry] } }).qualityReport!;

describe('file quality checks', () => {
  it.each(['method', 'url'])('rejects unsafe request %s before UI consumers receive it', key => {
    try {
      parseHar({ log: { entries: [harEntry, { ...harEntry, request: { ...harEntry.request, [key]: 42 } }] } });
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(FileQualityError);
      if (error instanceof FileQualityError) {
        expect(error.qualityReport).toMatchObject({ status: 'fatal', scope: 'partial', checkedRecords: 2 });
        expect(error.qualityReport.issues.flatMap(issue => issue.samples)).toContainEqual({
          jsonPath: `$.log.entries[1].request.${key}`, requestId: 1,
        });
      }
    }
  });

  it('reports unsafe content types and does not turn numeric timestamps into timeline positions', () => {
    expect(() => parseHar({ log: { entries: [{ ...harEntry, response: {
      ...harEntry.response, content: { mimeType: 42 },
    } }] } })).toThrow(FileQualityError);
    const result = parseHar({ log: { entries: [{ ...harEntry, startedDateTime: 42 }] } });
    expect(result.entries[0].startMs).toBeNaN();
    expect(result.qualityReport?.issues.some(issue => issue.code === 'timestamp')).toBe(true);
  });

  it('accepts zero timings/status and optional -1 stages without inventing errors', () => {
    expect(reportFor(harEntry)).toMatchObject({ status: 'checked', checkedRecords: 1, scope: 'records', issues: [] });
    expect(reportFor({ ...harEntry, response: { ...harEntry.response, status: 0 } }).issues).toEqual([]);
  });

  it.each([{}, { send: -1, wait: 10, receive: 0 }, { send: 0, wait: 'NaN', receive: 0 }])(
    'retains incomplete/invalid timing positions and preserves the request', timings => {
      const result = parseHar({ log: { entries: [{ ...harEntry, timings }] } });
      expect(result.entries[0].id).toBe(0);
      expect(result.entries[0].isFailed).toBe(false);
      expect(result.qualityReport?.status).toBe('issues');
      expect(result.qualityReport?.issues.flatMap(issue => issue.samples).some(sample =>
        sample.requestId === 0 && sample.jsonPath.startsWith('$.log.entries[0].timings.'))).toBe(true);
    });

  it('detects numeric strings without exposing the raw value', () => {
    const report = reportFor({ ...harEntry, time: 'SECRET_VALUE', response: { ...harEntry.response, status: '200' } });
    expect(report.issues.find(issue => issue.code === 'number')?.count).toBe(2);
    expect(JSON.stringify(report)).not.toContain('SECRET_VALUE');
  });

  it('flags timing contradictions, excluding ssl from the sum and allowing rounding', () => {
    expect(reportFor({ ...harEntry, time: 20, timings: { ...harEntry.timings, connect: 10, ssl: 10 } }).issues).toEqual([]);
    expect(reportFor({ ...harEntry, time: 9 }).issues).toEqual([]);
    expect(reportFor({ ...harEntry, time: 1 }).issues.some(issue => issue.code === 'timing')).toBe(true);
    expect(reportFor({ ...harEntry, timings: { ...harEntry.timings, connect: 2, ssl: 10 } }).issues.some(issue => issue.code === 'timing')).toBe(true);
  });

  it('bounds locator storage while retaining exact counts for large inputs', () => {
    const collector = createFileQualityCollector('har');
    for (let id = 0; id < 25000; id++) checkHarEntry(collector, { ...harEntry, time: 'invalid' }, id);
    const report = collector.finish();
    expect(report.checkedRecords).toBe(25000);
    expect(report.issues[0]).toMatchObject({ count: 25000, samples: expect.any(Array) });
    expect(report.issues[0].samples).toHaveLength(8);
  });

  it('propagates structural fatal errors with the actual request position', () => {
    try {
      parseHar({ log: { entries: [harEntry, { request: {} }] } });
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(FileQualityError);
      if (error instanceof FileQualityError) {
        expect(error.qualityReport.status).toBe('fatal');
        expect(error.qualityReport.issues[0].samples[0].requestId).toBe(1);
      }
    }
  });

  it('always retains the fatal locator after the warning sample limit is reached', () => {
    const collector = createFileQualityCollector('netlog');
    for (let eventId = 0; eventId < 20; eventId++) checkNetlogEvent(collector, { ...event, params: [] }, eventId);
    expect(checkNetlogEvent(collector, null, 20)).toBe(false);
    const report = collector.finish('partial');
    expect(report.issues[0]).toMatchObject({ severity: 'fatal', count: 21 });
    expect(report.issues[0].samples).toHaveLength(8);
    expect(report.issues[0].samples[7]).toEqual({ jsonPath: '$.events[20]', eventId: 20 });
  });

  it('labels repaired capture coverage separately from checked retained requests', () => {
    const info = { repaired: true, recoveredEntries: 1, totalEntries: 1, droppedEntries: 0, recoveryRate: 100, reason: '', warnings: [] };
    const result = parseHarInput({ log: { entries: [harEntry] } }, info).result;
    expect(result.qualityReport).toMatchObject({ scope: 'partial', status: 'issues', checkedRecords: 1 });
    expect(result.qualityReport?.issues.some(issue => issue.code === 'recovery')).toBe(true);
  });

  it('accepts Chromium numeric time strings in normal and streaming paths', () => {
    expect(parseLog({ events: [event] }).events[0].time).toBe(12.25);
    const analyzer = createNetlogStreamingAnalyzer();
    analyzer.accept(event);
    expect(analyzer.finish().result.qualityReport).toMatchObject({ checkedRecords: 1, status: 'checked', scope: 'partial' });
  });

  it.each(['', '12junk', 'NaN', null, -1, Infinity])('stops invalid NetLog clocks before they become zero: %s', time => {
    expect(() => parseLog({ events: [{ ...event, time }] })).toThrow(FileQualityError);
    const analyzer = createNetlogStreamingAnalyzer();
    expect(() => analyzer.accept({ ...event, time }, 42)).toThrow(FileQualityError);
  });

  it('retains original logEvents positions and source IDs', () => {
    try {
      parseLog({ logEvents: [event, { ...event, time: 'bad' }] });
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(FileQualityError);
      if (error instanceof FileQualityError) expect(error.qualityReport.issues[0].samples[0]).toEqual({
        jsonPath: '$.logEvents[1].time', eventId: 1, sourceId: 7,
      });
    }
  });

  it('sanitizes JSON syntax exceptions and malformed HAR input', () => {
    expect(() => parseNetlogJson('{"SECRET":broken}')).toThrow(FileQualityError);
    expect(() => parseHarInput('SECRET not json')).toThrow(FileQualityError);
    try { parseNetlogJson('{"SECRET":broken}'); }
    catch (error) {
      expect(JSON.stringify(error)).not.toContain('SECRET');
      expect(String(error)).not.toContain('SECRET');
    }
  });
});
