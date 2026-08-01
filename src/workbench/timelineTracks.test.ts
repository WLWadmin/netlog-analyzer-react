import {
  classifyTimelineTrack,
  TIMELINE_TRACKS,
} from './timelineTracks';

describe('timeline tracks', () => {
  it.each([
    ['navigationStart', 'other', 'milestones'],
    ['ResourceSendRequest', 'network', 'network'],
    ['RunTask', 'other', 'main'],
    ['Layout', 'rendering', 'rendering'],
    ['EventTiming', 'interaction', 'interactions'],
    ['AnimationFrame', 'rendering', 'frames'],
    ['Screenshot', 'screenshot', undefined],
  ] as const)('classifies %s into a stable semantic track', (name, category, expected) => {
    expect(classifyTimelineTrack(name, category)).toBe(expected);
  });

  it('registers the six Timeline MVP tracks in stable order', () => {
    expect(TIMELINE_TRACKS.map(track => track.id)).toEqual([
      'milestones',
      'network',
      'main',
      'rendering',
      'interactions',
      'frames',
    ]);
    expect(TIMELINE_TRACKS.every(track => track.label && track.capability)).toBe(true);
  });
});
