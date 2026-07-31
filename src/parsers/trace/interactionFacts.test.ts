import { calculateEventTiming } from './interactionFacts';

describe('calculateEventTiming', () => {
  it('derives all phases from the four EventTiming timestamps', () => {
    expect(calculateEventTiming({
      eventStart: 100,
      processingStart: 130,
      processingEnd: 190,
      interactionEnd: 250,
    })).toEqual({ inputDelay: 30, processingDuration: 60, presentationDelay: 60, totalLatency: 150 });
  });

  it('rejects non-finite or non-monotonic timestamps', () => {
    expect(calculateEventTiming({
      eventStart: 100,
      processingStart: 90,
      processingEnd: 190,
      interactionEnd: 250,
    })).toBeUndefined();
    expect(calculateEventTiming({
      eventStart: 100,
      processingStart: 130,
      processingEnd: Number.NaN,
      interactionEnd: 250,
    })).toBeUndefined();
  });
});
