import { TextDecoder, TextEncoder } from 'util';
import { ReadableStream as NodeReadableStream } from 'stream/web';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseLog } from './parser';
import { createNetlogStreamingAnalyzer } from './streamingAnalyzer';
import { FileQualityError } from '../shared/fileQuality';
import { buildNetlogCompactEventIndex, readNetlogEventDetail, type NetlogIndexableFile } from '../../workers/netlogDatasetIndexer';
import { queryNetlogEvents } from '../../workers/netlogDatasetQuery';
import { queryNetlogRawEvidenceEvents } from '../../workers/netlogRawEvidenceView';
import { buildNetlogSourceChainDetailView } from '../../workers/netlogSourceChainView';

Object.assign(global, { TextDecoder });

function fileFor(events: unknown[], constants = {}): NetlogIndexableFile {
  const bytes = new TextEncoder().encode(JSON.stringify({ constants, events }));
  return {
    size: bytes.length,
    stream: () => new NodeReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 3) {
          controller.enqueue(bytes.slice(offset, offset + 3));
        }
        controller.close();
      },
    }) as unknown as ReadableStream<Uint8Array>,
    slice: (start, end) => ({
      text: async () => new TextDecoder().decode(bytes.slice(start, end)),
    } as Blob),
  };
}

function rawEvent(phase?: unknown) {
  return {
    time: '10', type: 2, source: { id: 7, type: 1 },
    ...(phase === undefined ? {} : { phase }),
    params: { note: '跨块中文证据' },
  };
}

// Expectations are independent of PHASE: Chromium NetLogEventPhase declares
// NONE=0, BEGIN=1, END=2. The two public naming contracts remain distinct.
describe('Chromium phase contract', () => {
  it.each([[0, 'NONE'], [1, 'BEGIN'], [2, 'END'], [undefined, 'NONE']])(
    'ordinary parser maps %s to %s', (phase, name) => {
      expect(parseLog({ events: [rawEvent(phase)] }).events[0]).toMatchObject({
        phase: phase ?? 0, phaseName: name,
      });
    });

  it.each([[0, 'NONE'], [1, 'BEGIN'], [2, 'END'], [undefined, 'NONE']])(
    'streaming parser maps %s to %s', (phase, name) => {
      const analyzer = createNetlogStreamingAnalyzer();
      analyzer.accept(rawEvent(phase));
      expect(analyzer.finish().eventsPreview[0]).toMatchObject({
        phase: phase ?? 0, phaseName: name,
      });
    });

  it.each([[0, 'PHASE_NONE'], [1, 'PHASE_BEGIN'], [2, 'PHASE_END'], [undefined, 'PHASE_NONE']])(
    'Dataset maps %s to %s while preserving raw detail', async (phase, name) => {
      const event = rawEvent(phase);
      const file = fileFor([event]);
      const { index } = await buildNetlogCompactEventIndex(file);
      expect(queryNetlogEvents(index, { analysisId: 'phase', phase: phase ?? 0 }).rows[0]).toMatchObject({
        phase: phase ?? 0, phaseName: name,
      });
      await expect(readNetlogEventDetail(file, index, 0)).resolves.toEqual(event);
    });

  it.each([-1, 3, 1.5, '1', null, false])(
    'all three intake paths reject illegal phase %j as file quality damage', async phase => {
      expect(() => parseLog({ events: [rawEvent(phase)] })).toThrow(FileQualityError);
      expect(() => createNetlogStreamingAnalyzer().accept(rawEvent(phase))).toThrow(FileQualityError);
      // Match analysisWorker's Dataset intake: the analyzer owns field quality
      // checks; the standalone byte indexer does not validate event semantics.
      const analyzer = createNetlogStreamingAnalyzer();
      await expect(buildNetlogCompactEventIndex(fileFor([rawEvent(phase)]), {
        onEvent: (event, trace) => analyzer.accept(event, trace.eventId, trace.eventRoot),
      })).rejects.toBeInstanceOf(FileQualityError);
    });
});

describe('official phase lifecycle evidence', () => {
  const constants = {
    logEventTypes: {
      URL_REQUEST_START_JOB: 9001, REQUEST_ALIVE: 9002,
      HOST_RESOLVER_MANAGER_JOB: 9003, TCP_CONNECT: 9004, SSL_CONNECT: 9005,
      HTTP_TRANSACTION_SEND_REQUEST: 9006, HTTP_TRANSACTION_READ_RESPONSE_HEADERS: 9007,
      HTTP_TRANSACTION_READ_BODY: 9008,
    },
    logSourceType: { URL_REQUEST: 8001, HOST_RESOLVER_IMPL_JOB: 8002, SOCKET: 8003, SSL_CONNECT_JOB: 8004 },
  };
  function event(time: number, type: number, phase: number, sourceId = 7, sourceType = 8001, params: Record<string, unknown> = {}) {
    return { time: String(time), type, phase, source: { id: sourceId, type: sourceType }, params };
  }
  const start = () => event(10, 9001, 1, 7, 8001, { url: 'https://phase.example.invalid/路径' });

  async function threeResults(events: ReturnType<typeof event>[]) {
    const full = parseLog({ constants, events }).result;
    const stream = createNetlogStreamingAnalyzer({ constants });
    events.forEach(value => stream.accept(value));
    const dataset = createNetlogStreamingAnalyzer();
    await buildNetlogCompactEventIndex(fileFor(events, constants), {
      onTopLevelField: (key, value) => dataset.applyMetadata({ [key]: value }),
      onEvent: (value, trace) => dataset.accept(value, trace.eventId, trace.eventRoot),
    });
    return [full, stream.finish().result, dataset.finish().result];
  }

  it.each([[0, 'succeeded'], [-106, 'failed'], [-3, 'cancelled'], [undefined, 'unknown']])(
    'REQUEST_ALIVE END produces %s / %s on all intake paths', async (code, state) => {
      for (const result of await threeResults([start(), event(210, 9002, 2, 7, 8001, { net_error: code })])) {
        expect(result.urlRequests[0]).toMatchObject({
          duration: 200, endTime: 210, outcome: { state, terminalEventId: 1, terminalTime: 210 },
        });
      }
    });

  it('NONE, header END and linked socket END cannot establish the request outcome', async () => {
    const events = [
      start(), event(20, 9002, 0, 7, 8001, { net_error: 0 }),
      event(30, 9007, 2, 7, 8001, { status_code: 200 }),
      event(40, 9002, 2, 8, 8003, { source_dependency: { id: 7 }, net_error: 0 }),
    ];
    for (const result of await threeResults(events)) {
      expect(result.urlRequests[0].outcome).toMatchObject({ state: 'incomplete' });
      expect(result.urlRequests[0].outcome?.terminalEventId).toBeUndefined();
    }
  });

  it('preserves DNS/TCP/TLS/send/header/body boundaries on all intake paths', async () => {
    const events = [
      start(),
      event(20, 9003, 1, 8, 8002, { source_dependency: { id: 7 } }),
      event(40, 9003, 2, 8, 8002),
      event(50, 9004, 1, 9, 8003, { source_dependency: { id: 7 } }),
      event(80, 9004, 2, 9, 8003),
      event(90, 9005, 1, 10, 8004, { source_dependency: { id: 7 } }),
      event(130, 9005, 2, 10, 8004),
      event(140, 9006, 1), event(160, 9006, 2),
      event(170, 9007, 1), event(210, 9007, 2, 7, 8001, { status_code: 200 }),
      event(220, 9008, 1), event(310, 9008, 2),
      event(330, 9008, 0), event(350, 9002, 2, 7, 8001, { net_error: 0 }),
    ];
    for (const result of await threeResults(events)) {
      expect(result.urlRequests[0]).toMatchObject({
        duration: 340,
        timeline: {
          dns: { start: 20, end: 40, duration: 20 },
          connect: { start: 50, end: 80, duration: 30 },
          ssl: { start: 90, end: 130, duration: 40 },
          send: { start: 140, end: 160, duration: 20 },
          wait: { start: 160, end: 210, duration: 50 },
          download: { start: 210, end: 310, duration: 100 },
        },
      });
    }
  });

  it('NONE never opens a source and END removes it before a later request starts', async () => {
    const events = [
      start(), event(20, 9001, 1, 11, 8001, { url: 'https://second.example.invalid/' }),
      event(25, 9002, 0, 12), event(30, 9002, 2), event(35, 9002, 2, 11),
      event(40, 9001, 1, 13, 8001, { url: 'https://third.example.invalid/' }),
      event(50, 9002, 2, 13),
    ];
    for (const result of await threeResults(events)) expect(result.peakConcurrency).toBe(2);
  });

  it('keeps numeric filters, Source Chain, Raw Evidence and multibyte detail consistent', async () => {
    const events = [start(), event(20, 9003, 0, 8, 8002, { source_dependency: { id: 7 } }), event(30, 9002, 2)];
    const file = fileFor(events, constants);
    const { index } = await buildNetlogCompactEventIndex(file);
    const rows = queryNetlogEvents(index, { analysisId: 'phase' }).rows;
    expect(rows.map(row => [row.phase, row.phaseName])).toEqual([
      [1, 'PHASE_BEGIN'], [0, 'PHASE_NONE'], [2, 'PHASE_END'],
    ]);
    for (const phase of [0, 1, 2]) {
      expect(queryNetlogEvents(index, { analysisId: 'phase', phase }).rows).toEqual(rows.filter(row => row.phase === phase));
    }
    expect(queryNetlogRawEvidenceEvents('phase', index).rows).toEqual(rows);
    expect(buildNetlogSourceChainDetailView('phase', index, 7).events.rows).toEqual(rows);
    for (const row of rows) {
      expect(row.byteEnd - row.byteStart).toBe(new TextEncoder().encode(JSON.stringify(events[row.eventId])).length);
      await expect(readNetlogEventDetail(file, index, row.eventId)).resolves.toEqual(events[row.eventId]);
    }
  });
});

it('regenerates a synthetic capture with official lifecycle pairs and instant observations', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'netlog-phase-'));
  try {
    const path = join(directory, 'synthetic.json');
    execFileSync(process.execPath, [join(process.cwd(), 'scripts/generate-synthetic-netlog.js'), path, '192']);
    const raw: { constants: Record<string, unknown>; events: Array<ReturnType<typeof rawEvent>> } = JSON.parse(readFileSync(path, 'utf8'));
    const full = parseLog(raw);
    expect(full.events.slice(0, 14).map(event => [event.typeName, event.phaseName])).toEqual([
      ['REQUEST_ALIVE', 'BEGIN'], ['URL_REQUEST_START_JOB', 'BEGIN'],
      ['PROXY_RESOLUTION_SERVICE_RESOLVED_PROXY_LIST', 'NONE'],
      ['HOST_RESOLVER_MANAGER_JOB', 'BEGIN'], ['HOST_RESOLVER_DNS_TASK', 'BEGIN'],
      ['HOST_RESOLVER_DNS_TASK', 'END'], ['HOST_RESOLVER_MANAGER_JOB', 'END'],
      ['SOCKET_CONNECT', 'BEGIN'], ['SOCKET_CONNECT', 'END'],
      ['SSL_CONNECT', 'BEGIN'], ['SSL_CONNECT', 'END'], ['QUIC_SESSION', 'BEGIN'],
      ['HTTP_TRANSACTION_READ_RESPONSE_HEADERS', 'BEGIN'], ['HTTP_TRANSACTION_READ_RESPONSE_HEADERS', 'END'],
    ]);
    expect(full.events[14].phaseName).toBe('NONE');
    expect(full.events[95]).toMatchObject({ typeName: 'REQUEST_ALIVE', phase: 2, phaseName: 'END' });
    expect(full.events[107]).toMatchObject({ typeName: 'HTTP2_SESSION_INITIALIZED', phase: 0, phaseName: 'NONE' });
    expect(full.result.urlRequests.map(request => request.duration)).toEqual([23.5, 23.5]);
    expect(full.result.urlRequests.map(request => request.outcome?.state)).toEqual(['failed', 'unknown']);
    const analyzer = createNetlogStreamingAnalyzer({ constants: raw.constants });
    raw.events.forEach((event: unknown) => analyzer.accept(event));
    expect(analyzer.finish().result.urlRequests.map(request => request.duration)).toEqual([23.5, 23.5]);
    const file = fileFor(raw.events, raw.constants);
    const { index } = await buildNetlogCompactEventIndex(file);
    for (const eventId of [0, 14, 95, 107, 191]) {
      await expect(readNetlogEventDetail(file, index, eventId)).resolves.toEqual(raw.events[eventId]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
