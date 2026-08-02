import { fireEvent, render, screen } from '@testing-library/react';
import type { WorkbenchTimelineEventDto } from '../../../workbench/protocol';
import { TimelineInteractionStore } from '../../../workbench/timelineInteractionStore';
import TimelineCanvas from './TimelineCanvas';

const events: WorkbenchTimelineEventDto[] = [
  {
    id: 'event-1',
    trackId: 'main',
    startUs: 100,
    durationUs: 100,
    depth: 0,
    category: 'main',
    name: 'RunTask',
  },
  {
    id: 'event-2',
    trackId: 'main',
    startUs: 300,
    durationUs: 50,
    depth: 0,
    category: 'main',
    name: 'FunctionCall',
  },
];

describe('TimelineCanvas', () => {
  beforeEach(() => {
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      strokeRect: jest.fn(),
      fillText: jest.fn(),
      setTransform: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect: jest.fn(),
      fill: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      set fillStyle(_value: string | CanvasGradient | CanvasPattern) {},
      set strokeStyle(_value: string | CanvasGradient | CanvasPattern) {},
      set lineWidth(_value: number) {},
      set font(_value: string) {},
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('provides equivalent DOM text and keyboard event navigation', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 1_000 });
    const openDetail = jest.fn();
    render(
      <TimelineCanvas
        events={events}
        onOpenDetail={openDetail}
        onEscape={jest.fn()}
        store={store}
      />,
    );

    const canvas = screen.getByRole('application', { name: /Timeline 画布/ });
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(screen.getByText(/已选择 RunTask/)).not.toBeNull();
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(openDetail).toHaveBeenCalledWith('event-1');
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(screen.getByText(/已选择 FunctionCall/)).not.toBeNull();
    expect(screen.getByRole('list', { name: '当前事件及邻近事件' })).not.toBeNull();
  });

  it('exposes track collapse and explicit zoom/pan controls', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 1_000 });
    render(
      <TimelineCanvas
        events={events}
        onEscape={jest.fn()}
        onOpenDetail={jest.fn()}
        store={store}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '折叠 Main' }));
    expect(store.getSnapshot().collapsedTrackIds).toContain('main');
    fireEvent.click(screen.getByRole('button', { name: '放大时间轴' }));
    expect(store.getSnapshot().viewport.endUs - store.getSnapshot().viewport.startUs)
      .toBeLessThan(1_000);
    fireEvent.click(screen.getByRole('button', { name: '向右平移' }));
    expect(store.getSnapshot().viewport.startUs).toBeGreaterThan(0);
  });

  it('limits keyboard navigation and equivalent text to visible tracks', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 1_000 });
    store.toggleTrack('main');
    render(
      <TimelineCanvas
        events={[
          ...events,
          {
            id: 'event-network',
            trackId: 'network',
            startUs: 400,
            durationUs: 10,
            depth: 0,
            category: 'network',
            name: 'Request',
          },
        ]}
        onEscape={jest.fn()}
        onOpenDetail={jest.fn()}
        store={store}
      />,
    );

    const canvas = screen.getByRole('application', { name: /Timeline 画布/ });
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    expect(screen.getByText(/已选择 Request/)).not.toBeNull();
    expect(screen.queryByText(/RunTask，开始/)).toBeNull();
    expect(screen.queryByText(/FunctionCall，开始/)).toBeNull();
  });

  it('opens event detail when a Canvas event is clicked', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 1_000 });
    const openDetail = jest.fn();
    render(
      <TimelineCanvas
        events={events}
        onEscape={jest.fn()}
        onOpenDetail={openDetail}
        store={store}
      />,
    );
    const canvas = screen.getByRole('application', { name: /Timeline 画布/ });
    jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 900,
      height: 324,
      right: 900,
      bottom: 324,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(canvas, { clientX: 191, clientY: 150 });
    fireEvent.mouseUp(canvas, { clientX: 191, clientY: 150 });

    expect(openDetail).toHaveBeenCalledWith('event-1');
    expect(store.getSnapshot().selectedEventId).toBeUndefined();
  });

  it('treats a drag across dense events as a brush instead of a click', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 1_000 });
    const openDetail = jest.fn();
    render(
      <TimelineCanvas
        events={events}
        onEscape={jest.fn()}
        onOpenDetail={openDetail}
        store={store}
      />,
    );
    const canvas = screen.getByRole('application', { name: /Timeline 画布/ });
    jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 900,
      height: 324,
      right: 900,
      bottom: 324,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(canvas, { clientX: 191, clientY: 150 });
    fireEvent.mouseUp(canvas, { clientX: 230, clientY: 150 });

    expect(openDetail).not.toHaveBeenCalled();
    expect(store.getSnapshot().selection).toMatchObject({
      startUs: expect.any(Number),
      endUs: expect.any(Number),
    });
  });

  it('opens the event drawn in the clicked overlap lane', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 1_000 });
    const openDetail = jest.fn();
    render(
      <TimelineCanvas
        events={[
          events[0],
          { ...events[0], id: 'event-overlap', durationUs: 200, name: 'Overlap' },
        ]}
        onEscape={jest.fn()}
        onOpenDetail={openDetail}
        store={store}
      />,
    );
    const canvas = screen.getByRole('application', { name: /Timeline 画布/ });
    jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 900,
      height: 324,
      right: 900,
      bottom: 324,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(canvas, { clientX: 191, clientY: 162 });
    fireEvent.mouseUp(canvas, { clientX: 191, clientY: 162 });

    expect(openDetail).toHaveBeenCalledWith('event-overlap');
  });

  it('draws each active track label once even when a track has multiple events', () => {
    const fillText = jest.fn();
    const fillRect = jest.fn();
    const rect = jest.fn();
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: jest.fn(),
      fillRect,
      strokeRect: jest.fn(),
      fillText,
      setTransform: jest.fn(),
      beginPath: jest.fn(),
      rect,
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      set fillStyle(_value: string | CanvasGradient | CanvasPattern) {},
      set strokeStyle(_value: string | CanvasGradient | CanvasPattern) {},
      set lineWidth(_value: number) {},
      set font(_value: string) {},
    } as unknown as CanvasRenderingContext2D);
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 1_000 });
    render(
      <TimelineCanvas
        events={events}
        onEscape={jest.fn()}
        onOpenDetail={jest.fn()}
        store={store}
      />,
    );

    expect(fillText.mock.calls.filter(([label]) => label === 'Main')).toHaveLength(1);
    expect(fillRect.mock.calls.length).toBeGreaterThan(2);
    expect(rect).not.toHaveBeenCalled();
  });
});
