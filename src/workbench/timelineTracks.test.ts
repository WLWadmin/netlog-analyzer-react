import {
  classifyCoreTimelineTrack,
  classifyTimelineTrack,
  TimelineTrackRegistry,
  TIMELINE_TRACKS,
} from './timelineTracks';

describe('timeline tracks', () => {
  it.each([
    ['navigationStart', 'other', 'milestones'],
    ['ResourceSendRequest', 'network', 'network'],
    ['RunTask', 'other', 'main'],
    ['CompositorAnimation', 'animation', 'animations'],
    ['NonCompositorAnimation', 'animation', undefined],
    ['Layout', 'rendering', 'rendering'],
    ['EventTiming', 'interaction', 'interactions'],
    ['AnimationFrame', 'rendering', 'frames'],
    ['Screenshot', 'screenshot', undefined],
  ] as const)('classifies %s into a stable semantic track', (name, category, expected) => {
    expect(classifyTimelineTrack(name, category)).toBe(expected);
  });

  it('registers core and advanced tracks in stable order', () => {
    expect(TIMELINE_TRACKS.map(track => track.id)).toEqual([
      'milestones',
      'network',
      'main',
      'rendering',
      'interactions',
      'frames',
      'layout-shifts',
      'animations',
    ]);
    expect(TIMELINE_TRACKS.every(track => track.label && track.capability)).toBe(true);
  });

  it('extends the registry without changing the Canvas renderer', () => {
    const registry = new TimelineTrackRegistry([]);
    registry.register({
      id: 'layout-shifts',
      label: 'Layout Shifts',
      capability: 'rendering',
      description: '明确的 LayoutShift 事件',
      matches: name => name === 'LayoutShift',
    });

    expect(registry.classify('LayoutShift', 'loading')).toBe('layout-shifts');
    expect(registry.list().map(track => track.id)).toEqual(['layout-shifts']);
    expect(() => registry.register(registry.list()[0])).toThrow(/already registered/);
  });

  it('preserves core classification when advanced tracks are disabled', () => {
    expect(classifyCoreTimelineTrack('Animation', 'rendering')).toBe('rendering');
    expect(classifyCoreTimelineTrack('LayoutShift', 'loading')).toBe('rendering');
  });
});
