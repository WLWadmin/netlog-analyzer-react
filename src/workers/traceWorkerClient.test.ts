import { createTraceWorkerTask, TraceWorkerError } from './traceWorkerTask';
import type { TraceWorkerResponse } from './traceWorkerProtocols';
import type { TraceContextResult } from '../parsers/trace/types';
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

function contextResult(jsonBytes = 0): TraceContextResult {
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
        type: 'trace-context-result',
        taskId: 'stale-task',
        result: contextResult(),
    }));
    expect(worker.terminate).not.toHaveBeenCalled();

    worker.emit('message', messageEvent({
        type: 'trace-progress',
        taskId: taskId(worker),
        progress: { phase: 'reading-file', processedBytes: 1 },
    }));
    worker.emit('message', messageEvent({
        type: 'trace-context-result',
        taskId: taskId(worker),
        result: contextResult(2),
    }));

    await expect(task.promise).resolves.toEqual({
      kind: 'trace',
      result: expect.objectContaining({
        intake: expect.objectContaining({ eventCount: 0 }),
      }),
    });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'reading-file' }));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
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
    expect(cancelWorker.terminate).toHaveBeenCalledTimes(1);

    const timeoutWorker = new FakeWorker();
    const timedOut = createTraceWorkerTask(
      new File(['{}'], 'sample.trace'),
      { hint: 'trace', timeoutMs: 10 },
      () => timeoutWorker as unknown as Worker,
    );
    jest.advanceTimersByTime(10);
    await expectError(timedOut.promise, 'TRACE_TIMEOUT');
    expect(timeoutWorker.terminate).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('ignores late progress, success and error after cancellation', async () => {
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
      type: 'trace-context-result',
      taskId: currentTaskId,
      result: contextResult(2),
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
    expect(onProgress).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
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
