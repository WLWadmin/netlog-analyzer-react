import type { ChromiumTraceEvent } from '../parsers/trace/types';
import { CpuProfileStore } from './cpuProfileStore';

function profileEvents(): ChromiumTraceEvent[] {
  return [
    {
      name: 'Profile',
      ts: 100,
      pid: 1,
      tid: 10,
      id: 'p',
      args: { data: { startTime: 100 } },
    },
    {
      name: 'ProfileChunk',
      ts: 110,
      pid: 1,
      tid: 99,
      id: 'p',
      args: {
        data: {
          cpuProfile: {
            nodes: [
              { id: 1, callFrame: { functionName: '(root)' }, children: [2, 3] },
              { id: 2, callFrame: { functionName: 'work' }, children: [4] },
              { id: 3, callFrame: { functionName: 'shared' }, children: [4] },
              { id: 4, callFrame: { functionName: 'leaf' }, children: [2] },
            ],
            samples: [2, 4],
          },
          timeDeltas: [10, 20],
        },
      },
    },
    {
      name: 'ProfileChunk',
      ts: 140,
      pid: 1,
      tid: 99,
      id: 'p',
      args: {
        data: {
          cpuProfile: { samples: [3, 4] },
          timeDeltas: [10, 20],
        },
      },
    },
  ];
}

describe('CpuProfileStore', () => {
  it('computes deterministic self/total time and sample hits for a clipped range', async () => {
    const store = CpuProfileStore.build(profileEvents());
    const result = await store.queryCallTree({
      range: { startUs: 115, endUs: 150 },
      sort: 'total-time',
      limit: 20,
    });

    expect(result.capability).toBe('available');
    expect(result.nodes.find(node => node.functionName === 'leaf')).toMatchObject({
      selfTimeUs: 25,
      sampleHits: 2,
    });
    expect(result.nodes.find(node => node.functionName === 'work')).toMatchObject({
      totalTimeUs: 25,
      sampleHits: 0,
    });
    expect(result.nodes.every(node => node.callCount === undefined)).toBe(true);
  });

  it('returns bounded flame frames and bottom-up rows without exposing raw stacks', async () => {
    const store = CpuProfileStore.build(profileEvents());
    const flame = await store.queryFlameChart({
      range: { startUs: 100, endUs: 200 },
      sort: 'start-time',
      limit: 3,
    });
    const bottomUp = await store.queryBottomUp({
      range: { startUs: 100, endUs: 200 },
      sort: 'self-time',
      limit: 20,
    });

    expect(flame.frames).toHaveLength(3);
    expect(flame.truncation).toMatchObject({ truncated: true, returnedCount: 3 });
    expect(JSON.stringify(flame)).not.toMatch(/args|children|timeDeltas/);
    expect(bottomUp.nodes[0].selfTimeUs).toBeGreaterThanOrEqual(
      bottomUp.nodes[1].selfTimeUs,
    );
  });

  it('preserves call-tree and reversed bottom-up parent relationships', async () => {
    const store = CpuProfileStore.build(profileEvents());
    const callTree = await store.queryCallTree({
      range: { startUs: 100, endUs: 200 },
      sort: 'total-time',
      limit: 20,
    });
    const bottomUp = await store.queryBottomUp({
      range: { startUs: 100, endUs: 200 },
      sort: 'total-time',
      limit: 20,
    });
    const callLeaf = callTree.nodes.find(node => node.functionName === 'leaf');
    const bottomLeaf = bottomUp.nodes.find(node => (
      node.functionName === 'leaf' && node.depth === 0
    ));
    const bottomCaller = bottomUp.nodes.find(node => (
      node.functionName === 'work' && node.depth === 1
    ));

    expect(callLeaf?.parentId).toBeDefined();
    expect(callTree.nodes.some(node => node.id === callLeaf?.parentId)).toBe(true);
    expect(bottomLeaf).toMatchObject({
      selfTimeUs: 40,
      sampleHits: 2,
    });
    expect(bottomLeaf?.parentId).toBeUndefined();
    expect(bottomCaller?.parentId).toBe(bottomLeaf?.id);
    expect(callLeaf?.entityId).toBe(bottomLeaf?.entityId);
  });

  it('isolates equal numeric node IDs from different profiles', async () => {
    const secondProfile = profileEvents().map(event => ({
      ...event,
      pid: 2,
      args: event.args,
    }));
    const store = CpuProfileStore.build([...profileEvents(), ...secondProfile]);
    const result = await store.queryCallTree({
      range: { startUs: 100, endUs: 200 },
      sort: 'total-time',
      limit: 50,
    });

    expect(result.nodes.filter(node => (
      node.nodeId === 4 && node.functionName === 'leaf'
    ))).toHaveLength(2);
    expect(new Set(result.nodes.map(node => node.entityId)).size).toBe(
      result.nodes.length,
    );
  });

  it('links a child node that arrives after its parent chunk', async () => {
    const events = profileEvents();
    const firstChunk = events[1];
    const firstData = (firstChunk.args as {
      data: { cpuProfile: { nodes: unknown[]; samples: number[] }; timeDeltas: number[] };
    }).data;
    firstData.cpuProfile.nodes = firstData.cpuProfile.nodes.slice(0, 2);
    const secondChunk = events[2];
    const secondData = (secondChunk.args as {
      data: { cpuProfile: { nodes?: unknown[]; samples: number[] }; timeDeltas: number[] };
    }).data;
    secondData.cpuProfile.nodes = [
      { id: 4, callFrame: { functionName: 'lateLeaf' } },
    ];
    secondData.cpuProfile.samples = [4];
    secondData.timeDeltas = [10];
    const store = CpuProfileStore.build(events);
    const result = await store.queryCallTree({
      range: { startUs: 100, endUs: 200 },
      sort: 'total-time',
      limit: 20,
    });
    const leaf = result.nodes.find(node => node.functionName === 'lateLeaf');

    expect(leaf?.depth).toBe(2);
    expect(leaf?.parentId).toBeDefined();
  });

  it('degrades explicitly for orphan chunks and negative time deltas', () => {
    const store = CpuProfileStore.build([
      profileEvents()[1],
      profileEvents()[0],
      {
        ...profileEvents()[2],
        args: {
          data: {
            cpuProfile: { samples: [3, 4] },
            timeDeltas: [10, -1],
          },
        },
      },
    ]);

    expect(store.getStatus()).toEqual({
      capability: 'partial',
      limitations: expect.arrayContaining([
        'orphan-profile-chunk',
        'negative-profile-time-delta',
      ]),
    });
  });

  it('reports a missing capability instead of inventing stacks', async () => {
    const store = CpuProfileStore.build([{ name: 'RunTask', ts: 1, dur: 50 }]);
    expect(store.getStatus()).toEqual({
      capability: 'missing',
      limitations: ['cpu-profile-not-recorded'],
    });
    await expect(store.queryCallTree({
      range: { startUs: 0, endUs: 100 },
      sort: 'self-time',
      limit: 10,
    })).resolves.toMatchObject({ capability: 'missing', nodes: [] });
  });
});
