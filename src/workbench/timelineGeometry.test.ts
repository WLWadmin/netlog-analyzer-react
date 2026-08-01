import {
  hitTestTimelineEvent,
  panTimelineRange,
  timeToX,
  xToTime,
  zoomTimelineRange,
} from './timelineGeometry';

describe('timeline geometry', () => {
  const range = { startUs: 1_000, endUs: 2_000 };

  it('converts between time and canvas coordinates', () => {
    expect(timeToX(1_250, range, 400)).toBe(100);
    expect(xToTime(300, range, 400)).toBe(1_750);
  });

  it('zooms around an anchor and pans without changing duration', () => {
    expect(zoomTimelineRange(range, 1_500, 0.5)).toEqual({
      startUs: 1_250,
      endUs: 1_750,
    });
    expect(panTimelineRange(range, 250)).toEqual({
      startUs: 1_250,
      endUs: 2_250,
    });
  });

  it('hits the narrowest visible event at the pointer position', () => {
    const events = [
      { id: 'long', startUs: 1_100, durationUs: 500, trackId: 'main' },
      { id: 'short', startUs: 1_200, durationUs: 20, trackId: 'main' },
      { id: 'network', startUs: 1_200, durationUs: 20, trackId: 'network' },
    ];

    expect(hitTestTimelineEvent(events, {
      timeUs: 1_210,
      trackId: 'main',
    })?.id).toBe('short');
    expect(hitTestTimelineEvent(events, {
      timeUs: 1_210,
      trackId: 'frames',
    })).toBeUndefined();
  });
});
