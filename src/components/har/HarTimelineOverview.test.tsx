import '@testing-library/jest-dom';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { parseHar } from '../../harParser';
import { buildHarWaterfallRange } from '../../diagnosis/shared/harWaterfall';
import HarTimelineOverview from './HarTimelineOverview';

beforeAll(() => {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  }
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: TestPointerEvent });
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.hasPointerCapture = jest.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = jest.fn();
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

const entries = parseHar({ log: { entries: [{
  request: { url: 'https://example.test/', headers: [] }, response: { status: 200, headers: [], content: {} },
  startedDateTime: '2026-10-28T00:00:00Z', time: 10000, timings: { send: 0, wait: 9000, receive: 1000 },
}] } }).entries;
const fullRange = buildHarWaterfallRange(entries);

it('previews locally, commits a drag interval, cancels and resets without changing global ticks', () => {
  const onChange = jest.fn();
  const { container, rerender } = render(<HarTimelineOverview entries={entries} fullRange={fullRange} selection={null} markers={[]} width={500} onChange={onChange} />);
  const track = container.querySelector('.har-timeline-track') as HTMLElement;
  jest.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 500 } as DOMRect);
  fireEvent.pointerDown(track, { button: 0, pointerId: 1, clientX: 100 });
  fireEvent.pointerMove(track, { pointerId: 1, clientX: 300 });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerUp(track, { pointerId: 1 });
  expect(onChange).toHaveBeenLastCalledWith({ minStart: fullRange.minStart + 2000, maxEnd: fullRange.minStart + 6000, span: 4000, available: true });
  const selected = onChange.mock.calls[0][0];
  rerender(<HarTimelineOverview entries={entries} fullRange={fullRange} selection={selected} markers={[]} width={500} onChange={onChange} />);
  expect(screen.getByText('8000 ms')).toBeInTheDocument();
  const group = screen.getByRole('group');
  fireEvent.keyDown(group, { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ minStart: selected.minStart + 200, maxEnd: selected.maxEnd + 200 }));
  const beforeCancel = onChange.mock.calls.length;
  fireEvent.pointerDown(group, { button: 0, pointerId: 2, clientX: 150 });
  fireEvent.pointerMove(group, { pointerId: 2, clientX: 250 });
  fireEvent.pointerCancel(group, { pointerId: 2 });
  expect(onChange).toHaveBeenCalledTimes(beforeCancel);
  fireEvent.click(screen.getByRole('button', { name: '重置时间范围' }));
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it('adjusts both selection bounds with keyboard', () => {
  const onChange = jest.fn();
  const selection = { ...fullRange, minStart: fullRange.minStart + 2000, maxEnd: fullRange.minStart + 6000, span: 4000 };
  render(<HarTimelineOverview entries={entries} fullRange={fullRange} selection={selection} markers={[]} width={500} onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole('slider', { name: '时间范围起点' }), { key: 'ArrowLeft' });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ minStart: fullRange.minStart + 1800, maxEnd: selection.maxEnd }));
  fireEvent.keyDown(screen.getByRole('slider', { name: '时间范围终点' }), { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ minStart: selection.minStart, maxEnd: fullRange.minStart + 6200 }));
});

it('clamps pointer panning and resizing, and discards a preview on a new capture', () => {
  const onChange = jest.fn();
  const selection = { ...fullRange, minStart: fullRange.minStart + 2000, maxEnd: fullRange.minStart + 6000, span: 4000 };
  const { container, rerender } = render(<HarTimelineOverview entries={entries} fullRange={fullRange} selection={selection} markers={[]} width={500} onChange={onChange} />);
  const track = container.querySelector('.har-timeline-track') as HTMLElement;
  jest.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 500 } as DOMRect);
  const group = screen.getByRole('group');
  fireEvent.pointerDown(group, { button: 0, pointerId: 1, clientX: 150 });
  fireEvent.pointerMove(group, { pointerId: 1, clientX: -300 });
  fireEvent.pointerUp(group, { pointerId: 1 });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ minStart: fullRange.minStart, maxEnd: fullRange.minStart + 4000 }));
  const right = screen.getByRole('slider', { name: '时间范围终点' });
  fireEvent.pointerDown(right, { button: 0, pointerId: 2, clientX: 300 });
  fireEvent.pointerMove(right, { pointerId: 2, clientX: 800 });
  fireEvent.pointerUp(right, { pointerId: 2 });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ minStart: selection.minStart, maxEnd: fullRange.maxEnd }));
  const left = screen.getByRole('slider', { name: '时间范围起点' });
  fireEvent.pointerDown(left, { button: 0, pointerId: 3, clientX: 100 });
  fireEvent.pointerMove(left, { pointerId: 3, clientX: 50 });
  const callCount = onChange.mock.calls.length;
  rerender(<HarTimelineOverview entries={entries} fullRange={{ ...fullRange, minStart: fullRange.minStart + 10000, maxEnd: fullRange.maxEnd + 10000 }} selection={null} markers={[]} width={500} onChange={onChange} />);
  fireEvent.pointerUp(track, { pointerId: 3 });
  expect(onChange).toHaveBeenCalledTimes(callCount);
  expect(screen.getByRole('group')).toHaveStyle({ left: '0%', width: '100%' });
});

it('zooms around the centre on wheel and restores the full capture without scrolling the page', () => {
  const onChange = jest.fn();
  const { container } = render(<HarTimelineOverview entries={entries} fullRange={fullRange} selection={null} markers={[]} width={500} onChange={onChange} />);
  const track = container.querySelector('.har-timeline-track') as HTMLElement;
  const zoomIn = createEvent.wheel(track, { deltaY: -100, clientX: 10, bubbles: true, cancelable: true });
  fireEvent(track, zoomIn);
  const zoomed = onChange.mock.calls[0][0];
  expect(zoomed.span).toBeLessThan(fullRange.span);
  expect((zoomed.minStart + zoomed.maxEnd) / 2).toBe((fullRange.minStart + fullRange.maxEnd) / 2);
  expect(zoomIn.defaultPrevented).toBe(true);
  fireEvent.wheel(track, { deltaY: 200, bubbles: true, cancelable: true });
  expect(onChange).toHaveBeenLastCalledWith(null);
  expect(screen.getByText('8000 ms')).toBeInTheDocument();
});

it('bounds repeated zoom, normalizes wheel units and removes the native listener on unmount', () => {
  const onChange = jest.fn();
  const { container, unmount } = render(<HarTimelineOverview entries={entries} fullRange={fullRange} selection={null} markers={[]} width={500} onChange={onChange} />);
  const track = container.querySelector('.har-timeline-track') as HTMLElement;
  fireEvent.wheel(track, { deltaY: -1, deltaMode: 1, bubbles: true, cancelable: true });
  expect(onChange.mock.calls[0][0].span).toBeCloseTo(fullRange.span * Math.exp(-0.032));
  for (let i = 0; i < 30; i++) fireEvent.wheel(track, { deltaY: -1000, bubbles: true, cancelable: true });
  const narrow = onChange.mock.calls[onChange.mock.calls.length - 1][0];
  expect(narrow.span).toBe(fullRange.span * 0.001);
  expect(narrow.minStart).toBeGreaterThanOrEqual(fullRange.minStart);
  expect(narrow.maxEnd).toBeLessThanOrEqual(fullRange.maxEnd);
  const count = onChange.mock.calls.length;
  const toolbarWheel = createEvent.wheel(screen.getByRole('button', { name: '重置时间范围' }), { deltaY: -100, bubbles: true, cancelable: true });
  fireEvent(screen.getByRole('button', { name: '重置时间范围' }), toolbarWheel);
  expect(toolbarWheel.defaultPrevented).toBe(false);
  expect(onChange).toHaveBeenCalledTimes(count);
  unmount();
  fireEvent.wheel(track, { deltaY: -100, bubbles: true, cancelable: true });
  expect(onChange).toHaveBeenCalledTimes(count);
});
