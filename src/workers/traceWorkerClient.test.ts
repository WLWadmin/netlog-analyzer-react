import { createTraceWorkerTask, TraceWorkerError } from './traceWorkerTask';
import type { TraceWorkerResponse } from './traceWorkerProtocols';
import type { TraceAnalysisResult } from '../diagnosis/trace';
import {
  cancelActiveTraceWorkerTask,
  replaceActiveTraceWorkerTask,
} from './traceWorkerRegistry';

class FakeWorker {
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly postMessage = jest.fn();
  readonly terminate = jest.fn();

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, payload: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(payload as Event);
    }
  }
}

function messageEvent(data: TraceWorkerResponse): MessageEvent<TraceWorkerResponse> {
  return { data } as unknown as MessageEvent<TraceWorkerResponse>;
}

function taskId(worker: FakeWorker): string {
  return worker.postMessage.mock.calls[0][0].taskId;
}

function analysisResult(jsonBytes = 0): TraceAnalysisResult {
  return {
    intake: {
      format: 'chromium-trace-object',
      encoding: 'plain-json',
      jsonBytes,
      eventCount: 0,
      availableFamilies: [],
      warnings: [],
    },
    context: {
      processes: [],
      threads: [],
      frames: [],
      navigations: [],
      evidence: [],
      evidenceTotalCount: 0,
      evidenceReturnedCount: 0,
      quality: {
        level: 'insufficient',
        captureWindow: 'missing',
        navigationContext: 'missing',
        processThreadMetadata: 'missing',
        frameHierarchy: 'missing',
        rendererMainThread: 'missing',
        skippedEventCount: 0,
        warnings: [],
        disabledCapabilities: [
          'navigation-context',
          'renderer-main-thread-mapping',
        ],
      },
      warnings: [],
    },
    diagnosis: { diagnoses: [], evaluations: [] },
  };
}

async function expectError(
  promise: Promise<unknown>,
  code: string,
) {
  try {
    await promise;
    throw new Error('expected task to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(TraceWorkerError);
    expect((error as TraceWorkerError).detail.code).toBe(code);
  }
}

describe('traceWorkerClient', () => {
  afterEach(() => {
    cancelActiveTraceWorkerTask();
  });

  it('settles a matching task once and ignores stale task messages', async () => {
    const worker = new FakeWorker();
    const onProgress = jest.fn();
    const task = createTraceWorkerTask(
      new File(['{}'], 'sample.trace'),
      { hint: 'trace', onProgress },
      () => worker as unknown as Worker,
    );

    worker.emit('message', messageEvent({
        type: 'trace-analysis-result',
        taskId: 'stale-task',
        result: analysisResult(),
    }));
    expect(worker.terminate).not.toHaveBeenCalled();

    worker.emit('message', messageEvent({
        type: 'trace-progress',
        taskId: taskId(worker),
        progress: { phase: 'reading-file', processedBytes: 1 },
    }));
    worker.emit('message', messageEvent({
        type: 'trace-analysis-result',
        taskId: taskId(worker),
        result: analysisResult(2),
    }));

    await expect(task.promise).resolves.toEqual({
      kind: 'trace',
      result: expect.objectContaining({
        intake: expect.objectContaining({ eventCount: 0 }),
        diagnosis: { diagnoses: [], evaluations: [] },
      }),
    });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'reading-file' }));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('keeps the parsed Worker alive for an explicit Workbench session and closes it on release', async () => {
    const worker = new FakeWorker();
    const task = createTraceWorkerTask(
      new File(['{}'], 'sample.trace'),
      { hint: 'trace', enableWorkbench: true },
      () => worker as unknown as Worker,
    );
    const currentTaskId = taskId(worker);
    worker.emit('message', messageEvent({
      type: 'trace-analysis-result',
      taskId: currentTaskId,
      result: analysisResult(10),
      workbenchSource: {
        sourceId: `trace-source:${currentTaskId}`,
        parserId: 'trace',
        fingerprint: 'trace:10:0',
      },
    }));
    const outcome = await task.promise;
    expect(outcome.kind).toBe('trace');
    if (outcome.kind !== 'trace' || !outcome.workbench) return;
    expect(worker.terminate).not.toHaveBeenCalled();

    const createPromise = outcome.workbench.createSession();
    const createEnvelope = worker.postMessage.mock.calls.at(-1)?.[0];
    expect(createEnvelope).toMatchObject({
      type: 'workbench-request',
      taskId: currentTaskId,
      request: { type: 'create-session' },
    });
    const createRequestId = createEnvelope.request.requestId;
    worker.emit('message', messageEvent({
      type: 'workbench-response',
      taskId: currentTaskId,
      response: {
        type: 'session-created',
        schemaVersion: 1,
        requestId: createRequestId,
        sessionId: 'session-1',
        sessionRevision: 1,
        session: {
          sessionId: 'session-1',
          sessionRevision: 1,
          state: 'ready',
          source: createEnvelope.request.source,
          capabilities: ['timeline-events'],
          missingCapabilities: [],
          range: { startUs: 0, endUs: 1 },
          eventCount: 1,
          trackEventCounts: { main: 1 },
          screenshotCount: 0,
        },
      },
    }));
    await expect(createPromise).resolves.toMatchObject({ sessionId: 'session-1' });

    const closePromise = outcome.workbench.close();
    const releaseEnvelope = worker.postMessage.mock.calls.at(-1)?.[0];
    expect(releaseEnvelope.request.type).toBe('release-session');
    worker.emit('message', messageEvent({
      type: 'workbench-response',
      taskId: currentTaskId,
      response: {
        type: 'session-released',
        schemaVersion: 1,
        requestId: releaseEnvelope.request.requestId,
        sessionId: 'session-1',
        sessionRevision: 1,
        releasedRequestCount: 0,
        revokedBlobUrlCount: 0,
        releasedBufferCount: 0,
      },
    }));
    await closePromise;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(task.done).resolves.toBeUndefined();
  });

  it('fails closed and terminates the session when a source operation times out', async () => {
    jest.useFakeTimers();
    const worker = new FakeWorker();
    const task = createTraceWorkerTask(
      new File(['{}'], 'sample.trace'),
      {
        hint: 'trace',
        enableWorkbench: true,
        workbenchSourceTimeoutMs: 10,
      },
      () => worker as unknown as Worker,
    );
    const currentTaskId = taskId(worker);
    worker.emit('message', messageEvent({
      type: 'trace-analysis-result',
      taskId: currentTaskId,
      result: analysisResult(10),
      workbenchSource: {
        sourceId: `trace-source:${currentTaskId}`,
        parserId: 'trace',
        fingerprint: 'trace:10:0',
      },
    }));
    const outcome = await task.promise;
    if (outcome.kind !== 'trace' || !outcome.workbench) {
      throw new Error('Workbench unavailable');
    }
    const createPromise = outcome.workbench.createSession();
    const createEnvelope = worker.postMessage.mock.calls.at(-1)?.[0];
    worker.emit('message', messageEvent({
      type: 'workbench-response',
      taskId: currentTaskId,
      response: {
        type: 'session-created',
        schemaVersion: 1,
        requestId: createEnvelope.request.requestId,
        sessionId: 'session-1',
        sessionRevision: 1,
        session: {
          sessionId: 'session-1',
          sessionRevision: 1,
          state: 'ready',
          source: createEnvelope.request.source,
          capabilities: ['timeline-events'],
          missingCapabilities: [],
          range: { startUs: 0, endUs: 1 },
          eventCount: 1,
          trackEventCounts: { main: 1 },
          screenshotCount: 0,
        },
      },
    }));
    await createPromise;

    const sourcePromise = outcome.workbench.addSource(
      new File(['{}'], 'slow.har'),
      'har',
    );
    const sourceEnvelope = worker.postMessage.mock.calls.at(-1)?.[0];
    jest.advanceTimersByTime(10);

    await expect(sourcePromise).rejects.toThrow('会话已关闭');
    expect(outcome.workbench.getSnapshot().status).toBe('failed');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect([...worker.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);

    worker.emit('message', messageEvent({
      type: 'workbench-response',
      taskId: currentTaskId,
      response: {
        type: 'source-change-result',
        schemaVersion: 1,
        requestId: sourceEnvelope.request.requestId,
        sessionId: 'session-1',
        sessionRevision: 2,
        sourceRevision: 1,
        operation: 'added',
        sources: [],
        revokedEdgeCount: 0,
        revokedFindingCount: 0,
      },
    }));
    expect(outcome.workbench.getSnapshot().sources).toBeUndefined();
    await expect(task.done).resolves.toBeUndefined();
    jest.useRealTimers();
  });

  it('terminates on cancel and timeout', async () => {
    jest.useFakeTimers();
    const cancelWorker = new FakeWorker();
    const cancelled = createTraceWorkerTask(
      new File(['{}'], 'sample.trace'),
      { hint: 'trace' },
      () => cancelWorker as unknown as Worker,
    );
    cancelled.cancel();
    await expectError(cancelled.promise, 'TRACE_CANCELLED');
    jest.advanceTimersByTime(50);
    expect(cancelWorker.terminate).toHaveBeenCalledTimes(1);

    const timeoutWorker = new FakeWorker();
    const timedOut = createTraceWorkerTask(
      new File(['{}'], 'sample.trace'),
      { hint: 'trace', timeoutMs: 10 },
      () => timeoutWorker as unknown as Worker,
    );
    jest.advanceTimersByTime(10);
    await expectError(timedOut.promise, 'TRACE_TIMEOUT');
    jest.advanceTimersByTime(50);
    expect(timeoutWorker.terminate).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('ignores late progress, success and error after cancellation', async () => {
    jest.useFakeTimers();
    const worker = new FakeWorker();
    const onProgress = jest.fn();
    const task = createTraceWorkerTask(
      new File(['{}'], 'sample.trace'),
      { hint: 'trace', onProgress },
      () => worker as unknown as Worker,
    );
    const currentTaskId = taskId(worker);

    task.cancel();
    worker.emit('message', messageEvent({
      type: 'trace-progress',
      taskId: currentTaskId,
      progress: { phase: 'reading-file', processedBytes: 1 },
    }));
    worker.emit('message', messageEvent({
      type: 'trace-analysis-result',
      taskId: currentTaskId,
      result: analysisResult(2),
    }));
    worker.emit('message', messageEvent({
      type: 'trace-error',
      taskId: currentTaskId,
      error: {
        code: 'TRACE_WORKER_FAILED',
        stage: 'reading-file',
        message: 'late error',
        recoverable: true,
      },
    }));

    await expectError(task.promise, 'TRACE_CANCELLED');
    jest.advanceTimersByTime(50);
    expect(onProgress).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it.each(['error', 'messageerror'])('terminates on Worker %s', async type => {
    const worker = new FakeWorker();
    const task = createTraceWorkerTask(
      new File(['{}'], 'sample.trace'),
      { hint: 'json-auto' },
      () => worker as unknown as Worker,
    );
    worker.emit(type, new Event(type));

    await expectError(task.promise, 'TRACE_WORKER_FAILED');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect([...worker.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
  });

  it('returns HAR and NetLog routing outcomes without errors', async () => {
    const worker = new FakeWorker();
    const task = createTraceWorkerTask(
      new File(['{}'], 'sample.json'),
      { hint: 'json-auto' },
      () => worker as unknown as Worker,
    );
    worker.emit('message', messageEvent({
        type: 'detected-source',
        taskId: taskId(worker),
        source: 'netlog',
        encoding: 'plain-json',
    }));

    await expect(task.promise).resolves.toEqual({
      kind: 'detected-source',
      source: 'netlog',
      encoding: 'plain-json',
    });
  });

  it('replaces and cancels the previous active task exactly once', async () => {
    const first = {
      promise: new Promise<never>(() => undefined),
      cancel: jest.fn(),
    };
    const second = {
      promise: new Promise<never>(() => undefined),
      cancel: jest.fn(),
    };

    replaceActiveTraceWorkerTask(first);
    replaceActiveTraceWorkerTask(second);
    cancelActiveTraceWorkerTask();

    expect(first.cancel).toHaveBeenCalledTimes(1);
    expect(second.cancel).toHaveBeenCalledTimes(1);
  });

  it('maps Worker creation failure to TRACE_WORKER_FAILED', async () => {
    const task = createTraceWorkerTask(
      new File(['{}'], 'sample.trace'),
      { hint: 'trace' },
      () => {
        throw new Error('sensitive creation failure');
      },
    );

    await expectError(task.promise, 'TRACE_WORKER_FAILED');
  });

  it('cleans up and terminates when postMessage throws', async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      throw new Error('sensitive clone failure');
    });
    const task = createTraceWorkerTask(
      new File(['{}'], 'sample.trace'),
      { hint: 'trace' },
      () => worker as unknown as Worker,
    );

    await expectError(task.promise, 'TRACE_WORKER_FAILED');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect([...worker.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
  });

  it('rejects malformed matching responses with a public Worker error', async () => {
    const worker = new FakeWorker();
    const task = createTraceWorkerTask(
      new File(['{}'], 'sample.trace'),
      { hint: 'trace' },
      () => worker as unknown as Worker,
    );
    worker.emit('message', {
      data: { taskId: taskId(worker), type: 'unexpected', stack: 'sensitive' },
    });

    await expectError(task.promise, 'TRACE_WORKER_FAILED');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
