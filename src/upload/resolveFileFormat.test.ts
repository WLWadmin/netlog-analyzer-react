import {
  BUILT_IN_FORMAT_PROBES,
  FileFormatRegistry,
  probeRegisteredFormats,
} from './fileFormatRegistry';
import { resolveFileFormat } from './resolveFileFormat';
import type {
  FileFormatProbeAdapter,
  FileParserId,
  ProbeInput,
} from './fileFormatTypes';

function input(value: unknown): ProbeInput {
  return {
    taskId: 'task-1',
    fileName: 'sample.json',
    container: 'plain',
    value,
  };
}

describe('file format registry and resolver', () => {
  const registry = new FileFormatRegistry(BUILT_IN_FORMAT_PROBES);

  it.each([
    [
      'HAR',
      {
        log: {
          entries: [{
            request: { method: 'GET', url: 'https://example.invalid/' },
            response: { status: 200 },
          }],
        },
      },
      'har@1',
    ],
    [
      'NetLog',
      {
        constants: { logEventTypes: { REQUEST_ALIVE: 1 } },
        events: [{ source: { id: 1, type: 1 }, type: 1, time: '1' }],
      },
      'chromium-netlog@1',
    ],
    [
      'Trace',
      {
        traceEvents: [{ name: 'RunTask', ph: 'X', ts: 1, pid: 1, tid: 1 }],
      },
      'chromium-performance-trace@1',
    ],
    [
      'Go Log',
      '[worker-1] Info GET:https://example.invalid/ +10ms',
      'go-service-log@1',
    ],
  ] as Array<[string, unknown, FileParserId]>)(
    '%s has exactly one definite match',
    async (_label, value, parserId) => {
      const verdicts = await probeRegisteredFormats(registry, input(value));
      const definite = verdicts.filter(verdict => verdict.kind === 'definite-match');

      expect(definite).toEqual([
        expect.objectContaining({ parserId }),
      ]);
      expect(resolveFileFormat(verdicts)).toEqual({
        kind: 'recommended',
        candidate: expect.objectContaining({ parserId }),
      });
    },
  );

  it('treats a generic events array as possible NetLog, never definite', async () => {
    const verdicts = await probeRegisteredFormats(registry, input({
      events: [{ type: 'custom-event' }],
    }));

    expect(verdicts).toContainEqual(expect.objectContaining({
      kind: 'possible-match',
      parserId: 'chromium-netlog@1',
    }));
    expect(resolveFileFormat(verdicts).kind).toBe('needs-choice');
  });

  it('returns needs-choice for conflicting format signatures without priority', async () => {
    const verdicts = await probeRegisteredFormats(registry, input({
      log: {
        entries: [{
          request: { method: 'GET' },
          response: { status: 200 },
        }],
      },
      traceEvents: [{ name: 'RunTask', ph: 'X', ts: 1, pid: 1, tid: 1 }],
    }));

    const resolution = resolveFileFormat(verdicts);
    expect(resolution.kind).toBe('needs-choice');
    if (resolution.kind !== 'needs-choice') throw new Error('expected needs-choice');
    expect(resolution.candidates.map(candidate => candidate.parserId)).toEqual([
      'har@1',
      'chromium-performance-trace@1',
    ]);
  });

  it('returns unsupported when every adapter reports no-match', async () => {
    const verdicts = await probeRegisteredFormats(registry, input({ custom: true }));

    expect(resolveFileFormat(verdicts)).toEqual({
      kind: 'unsupported',
      evidenceCodes: expect.arrayContaining(['HAR_LOG_MISSING', 'TRACE_EVENTS_MISSING']),
    });
  });

  it('supports a newly registered adapter without changing resolver code', async () => {
    const parserId = 'synthetic@1' as FileParserId;
    const synthetic: FileFormatProbeAdapter = {
      parserId,
      sourceKind: 'trace',
      family: 'performance',
      extensions: ['.synthetic'],
      probe: async () => ({
        kind: 'definite-match',
        parserId,
        evidenceCodes: ['SYNTHETIC_SIGNATURE'],
      }),
    };
    const extensibleRegistry = new FileFormatRegistry([
      ...BUILT_IN_FORMAT_PROBES,
      synthetic,
    ]);

    const resolution = resolveFileFormat(
      await probeRegisteredFormats(extensibleRegistry, input({ custom: true })),
    );

    expect(resolution).toEqual({
      kind: 'recommended',
      candidate: expect.objectContaining({ parserId }),
    });
  });
});
