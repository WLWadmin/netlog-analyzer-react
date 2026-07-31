import {
  buildProjectFacts,
  detectEventFamilies,
  parseTraceEvents,
} from './trace-engine-api.probe';

describe('Trace Engine contract probe', () => {
  it('loads the candidate package and parses a minimal trace', async () => {
    const result = await parseTraceEvents([
      {
        name: 'thread_name',
        cat: '__metadata',
        ph: 'M',
        pid: 1,
        tid: 1,
        ts: 0,
        args: { name: 'CrRendererMain' },
      },
      {
        name: 'RunTask',
        cat: 'devtools.timeline',
        ph: 'X',
        pid: 1,
        tid: 1,
        ts: 1000,
        dur: 60000,
        args: {},
      },
    ]);

    expect(result.exportNames.length).toBeGreaterThan(0);
    expect(result.hasTraceProcessor).toBe(true);
    expect(result.parsed).toBe(true);
    expect(result.inputEventCount).toBe(2);
    expect(result.handlerNames.length).toBeGreaterThan(0);
    expect(result.projectFacts).toEqual(expect.objectContaining({
      navigations: expect.any(Array),
      requests: expect.any(Array),
      milestones: expect.any(Array),
      mainThreadTasks: expect.any(Array),
      interactions: expect.any(Array),
      frames: expect.any(Array),
    }));
  });

  it('does not misclassify a single outermost navigation as multiple or iframe', () => {
    const families = detectEventFamilies([{
      name: 'navigationStart',
      ph: 'R',
      pid: 1,
      tid: 1,
      ts: 1,
      args: {
        frame: 'FRAME-A',
        data: {
          navigationId: 'NAV-A',
          isOutermostMainFrame: true,
        },
      },
    }]);

    expect(families).toContain('navigation');
    expect(families).not.toContain('multiple-navigation');
    expect(families).not.toContain('iframe');
  });

  it('does not treat resource loader IDs as navigation IDs', () => {
    const families = detectEventFamilies([
      {
        name: 'ResourceSendRequest',
        args: { data: { loaderId: 'LOADER-A', requestId: 'REQUEST-A' } },
      },
      {
        name: 'ResourceReceiveResponse',
        args: { data: { loaderId: 'LOADER-B', requestId: 'REQUEST-B' } },
      },
    ]);

    expect(families).toContain('network');
    expect(families).not.toContain('navigation');
    expect(families).not.toContain('multiple-navigation');
  });

  it('requires distinct navigation IDs and real frame relationships', () => {
    const families = detectEventFamilies([
      {
        name: 'navigationStart',
        pid: 1,
        args: { frame: 'FRAME-A', data: { navigationId: 'NAV-A' } },
      },
      {
        name: 'navigationStart',
        pid: 2,
        args: {
          frame: 'FRAME-B',
          data: {
            navigationId: 'NAV-B',
            parentFrame: 'FRAME-A',
            isOutermostMainFrame: false,
          },
        },
      },
    ]);

    expect(families).toContain('multiple-navigation');
    expect(families).toContain('iframe');
    expect(families).toContain('oopif');
  });

  it('builds related project DTOs instead of global key evidence', () => {
    const facts = buildProjectFacts({
      Meta: {
        contexts: [
          { frameId: 'FRAME-A', pid: 10, tid: 11 },
          {
            navigationId: 'NAV-A',
            frameId: 'FRAME-A',
            startTime: 1000,
            endTime: 100000,
          },
        ],
      },
      NetworkRequests: {
        requests: [{
          requestId: 'REQ-A',
          navigationId: 'NAV-A',
          statusCode: 500,
          startTime: 2000,
          finishTime: 3000,
          url: 'https://contract.invalid/resource',
        }],
      },
      Initiators: {
        links: [{
          requestId: 'REQ-A',
          initiatorRequestId: 'REQ-PARENT',
        }],
      },
      PageLoadMetrics: {
        metrics: [{
          navigationId: 'NAV-A',
          name: 'FCP',
          timestamp: 4000,
        }],
      },
      Renderer: {
        tasks: [{
          name: 'RunTask',
          pid: 10,
          tid: 11,
          ts: 5000,
          dur: 60000,
          selfTime: 40,
        }],
      },
      UserInteractions: {
        interactions: [{
          interactionId: 'INTERACTION-A',
          navigationId: 'NAV-A',
          startTime: 6000,
          processingStart: 7000,
          processingEnd: 9000,
          interactionEnd: 12000,
        }],
      },
      Frames: {
        frames: [{
          navigationId: 'NAV-A',
          startTime: 13000,
          duration: 18000,
        }],
      },
    });

    expect(facts.navigations).toEqual([expect.objectContaining({
      key: 'NAV-A',
      frameKey: 'FRAME-A',
      processId: 10,
      threadId: 11,
    })]);
    expect(facts.requests).toEqual([expect.objectContaining({
      requestKey: 'REQ-A',
      navigationKey: 'NAV-A',
      result: 'http-error',
      initiatorKey: 'REQ-PARENT',
    })]);
    expect(facts.milestones).toEqual([expect.objectContaining({
      navigationKey: 'NAV-A',
      relativeUs: 3000,
    })]);
    expect(facts.mainThreadTasks).toEqual([expect.objectContaining({
      navigationKey: 'NAV-A',
      processId: 10,
      threadId: 11,
      durationMs: 60,
    })]);
    expect(facts.interactions).toEqual([expect.objectContaining({
      inputDelayMs: 1,
      processingMs: 2,
      presentationMs: 3,
    })]);
    expect(facts.frames).toEqual([expect.objectContaining({
      navigationKey: 'NAV-A',
      durationMs: 18,
    })]);
  });

  it('closes an implicit navigation span at the next navigation', () => {
    const facts = buildProjectFacts({
      Meta: {
        contexts: [
          { frameId: 'FRAME-A', pid: 10, tid: 11 },
          { navigationId: 'NAV-A', frameId: 'FRAME-A', startTime: 1000 },
          { navigationId: 'NAV-B', frameId: 'FRAME-A', startTime: 5000 },
        ],
      },
      Renderer: {
        tasks: [
          { name: 'RunTask', pid: 10, tid: 11, ts: 2000, dur: 1000 },
          { name: 'RunTask', pid: 10, tid: 11, ts: 6000, dur: 1000 },
        ],
      },
    });

    expect(facts.navigations).toEqual([
      expect.objectContaining({ key: 'NAV-A', endUs: 5000 }),
      expect.objectContaining({ key: 'NAV-B' }),
    ]);
    expect(facts.mainThreadTasks.map(task => task.navigationKey)).toEqual(['NAV-A', 'NAV-B']);
  });
});
