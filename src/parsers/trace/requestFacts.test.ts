import { buildDispatchWaitFact, classifyRequest } from './requestFacts';

describe('classifyRequest', () => {
  it('applies the request result precedence from the Trace contract', () => {
    expect(classifyRequest({ statusCode: 500, failed: true, cancelledSignal: 'explicit', hasFinish: false, traceEnded: true }))
      .toEqual({ result: 'http-error', confidence: 'high' });
    expect(classifyRequest({ failed: true, cancelledSignal: 'explicit', hasFinish: false, traceEnded: true }))
      .toEqual({ result: 'cancelled', confidence: 'high' });
    expect(classifyRequest({ failed: true, cancelledSignal: 'navigation-overlap', hasFinish: false, traceEnded: true }))
      .toEqual({ result: 'cancelled', confidence: 'medium' });
    expect(classifyRequest({ failed: true, cancelledSignal: 'none', hasFinish: false, traceEnded: true }))
      .toEqual({ result: 'transport-failed', confidence: 'medium' });
    expect(classifyRequest({ cancelledSignal: 'none', hasFinish: false, traceEnded: true }))
      .toEqual({ result: 'incomplete-at-trace-end', confidence: 'observation' });
    expect(classifyRequest({ statusCode: 204, cancelledSignal: 'none', hasFinish: true, traceEnded: true }))
      .toEqual({ result: 'success', confidence: 'high' });
    expect(classifyRequest({ cancelledSignal: 'none', hasFinish: true, traceEnded: true }))
      .toEqual({ result: 'unknown-failure', confidence: 'observation' });
  });

  it('does not classify navigation overlap without failure as cancellation', () => {
    expect(classifyRequest({ cancelledSignal: 'navigation-overlap', hasFinish: true, traceEnded: false }))
      .toEqual({ result: 'unknown-failure', confidence: 'observation' });
  });
});

describe('buildDispatchWaitFact', () => {
  const busyIntervals = [{ start: 120, end: 140 }, { start: 135, end: 180 }];

  it('returns dispatch wait only for the same calibrated domain with busy overlap', () => {
    expect(buildDispatchWaitFact({
      calibratedNetworkResponseMs: 100,
      rendererResponseEventMs: 200,
      networkTimeDomain: 'renderer-1',
      rendererTimeDomain: 'renderer-1',
      traceTimeDomain: 'renderer-1',
      mainThreadBusyIntervals: busyIntervals,
    })).toEqual({ dispatchWaitMs: 100, mainThreadOverlapMs: 60 });
  });

  it('rejects different or missing domains and waits without busy overlap', () => {
    expect(buildDispatchWaitFact({
      calibratedNetworkResponseMs: 100,
      rendererResponseEventMs: 200,
      networkTimeDomain: 'network',
      rendererTimeDomain: 'renderer',
      mainThreadBusyIntervals: busyIntervals,
    })).toBeUndefined();
    expect(buildDispatchWaitFact({
      calibratedNetworkResponseMs: 100,
      rendererResponseEventMs: 200,
      mainThreadBusyIntervals: busyIntervals,
    })).toBeUndefined();
    expect(buildDispatchWaitFact({
      calibratedNetworkResponseMs: 100,
      rendererResponseEventMs: 110,
      networkTimeDomain: 'renderer-1',
      rendererTimeDomain: 'renderer-1',
      traceTimeDomain: 'renderer-1',
      mainThreadBusyIntervals: busyIntervals,
    })).toBeUndefined();
  });
});
