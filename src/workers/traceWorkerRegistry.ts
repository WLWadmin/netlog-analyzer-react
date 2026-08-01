import type { TraceWorkerTask } from './traceWorkerTask';

let activeTask: TraceWorkerTask | undefined;

export function cancelActiveTraceWorkerTask(): void {
  const task = activeTask;
  activeTask = undefined;
  task?.cancel();
}

export function replaceActiveTraceWorkerTask(
  task: TraceWorkerTask,
): TraceWorkerTask {
  cancelActiveTraceWorkerTask();
  activeTask = task;
  void (task.done ?? task.promise).finally(() => {
    if (activeTask === task) activeTask = undefined;
  }).catch(() => {
    // The caller owns task.promise; this chain only clears the registry.
  });
  return task;
}
