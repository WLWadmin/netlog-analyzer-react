import { TimelineInteractionStore } from './timelineInteractionStore';

describe('TimelineInteractionStore', () => {
  it('owns viewport, selection, hover, selected event and collapsed tracks', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 1_000 });
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    store.setSelection({ startUs: 100, endUs: 300 });
    store.setHoveredEvent('event-hover');
    store.selectEvent('event-selected');
    store.toggleTrack('network');

    expect(store.getSnapshot()).toMatchObject({
      viewport: { startUs: 0, endUs: 1_000 },
      selection: { startUs: 100, endUs: 300 },
      hoveredEventId: 'event-hover',
      selectedEventId: 'event-selected',
      collapsedTrackIds: ['network'],
    });
    expect(store.getSnapshot().selection).toEqual({ startUs: 100, endUs: 300 });
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it('restores viewport, selection and selected event after diagnostic navigation', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 1_000 });
    store.setSelection({ startUs: 200, endUs: 400 });
    store.selectEvent('event-before');

    store.navigateTo({
      viewport: { startUs: 500, endUs: 700 },
      selectedEventId: 'event-target',
    });
    expect(store.getSnapshot()).toMatchObject({
      viewport: { startUs: 500, endUs: 700 },
      selectedEventId: 'event-target',
    });

    expect(store.restorePrevious()).toMatchObject({
      drawerOpen: false,
      scrollTop: 0,
    });
    expect(store.getSnapshot()).toMatchObject({
      viewport: { startUs: 0, endUs: 1_000 },
      selection: { startUs: 200, endUs: 400 },
      selectedEventId: 'event-before',
    });
    expect(store.restorePrevious()).toBeUndefined();
  });

  it('normalizes ranges and ignores invalid viewport updates', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 1_000 });
    store.setSelection({ startUs: 400, endUs: 100 });
    store.setViewport({ startUs: Number.NaN, endUs: 10 });

    expect(store.getSnapshot().selection).toEqual({ startUs: 100, endUs: 400 });
    expect(store.getSnapshot().viewport).toEqual({ startUs: 0, endUs: 1_000 });
  });

  it('clamps viewport, selection and cursor to the capture range', () => {
    const store = new TimelineInteractionStore({ startUs: 100, endUs: 1_100 });
    store.setViewport({ startUs: -500, endUs: 0 });
    store.setSelection({ startUs: 900, endUs: 1_500 });
    store.setCursor(2_000);

    expect(store.getSnapshot()).toMatchObject({
      viewport: { startUs: 100, endUs: 600 },
      selection: { startUs: 500, endUs: 1_100 },
      cursorUs: 1_100,
    });
  });
});
