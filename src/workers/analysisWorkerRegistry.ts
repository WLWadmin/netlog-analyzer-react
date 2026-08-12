let terminateActiveWorker: (() => void) | undefined;

export function registerAnalysisWorkerTerminator(terminator: () => void): void {
  terminateActiveWorker = terminator;
}

export function cancelActiveAnalysisWorkerTasks(): void {
  terminateActiveWorker?.();
}
