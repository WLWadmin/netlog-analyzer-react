export interface EventTimingTimestamps {
  eventStart: number;
  processingStart: number;
  processingEnd: number;
  interactionEnd: number;
}

export interface EventTimingFacts {
  inputDelay: number;
  processingDuration: number;
  presentationDelay: number;
  totalLatency: number;
}

export function calculateEventTiming(
  input: EventTimingTimestamps,
): EventTimingFacts | undefined {
  const timestamps = [
    input.eventStart,
    input.processingStart,
    input.processingEnd,
    input.interactionEnd,
  ];
  if (!timestamps.every(Number.isFinite)
    || timestamps.some((value, index) => index > 0 && value < timestamps[index - 1])) {
    return undefined;
  }
  return {
    inputDelay: input.processingStart - input.eventStart,
    processingDuration: input.processingEnd - input.processingStart,
    presentationDelay: input.interactionEnd - input.processingEnd,
    totalLatency: input.interactionEnd - input.eventStart,
  };
}
