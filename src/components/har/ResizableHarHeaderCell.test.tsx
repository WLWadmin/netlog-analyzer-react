import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import ResizableHarHeaderCell from './ResizableHarHeaderCell';

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
function flushFrame() {
  act(() => {
    const callbacks = Array.from(frames.values());
    frames.clear();
    callbacks.forEach(callback => callback(0));
  });
}

beforeAll(() => {
  // JSDOM has no pointer capture; emulate only the event fields used by the control.
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: TestPointerEvent });
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.hasPointerCapture = jest.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = jest.fn();
});

beforeEach(() => {
  frames.clear();
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
});

function header(maximumWidth?: number) {
  const onResize = jest.fn();
  const onSort = jest.fn();
  const { unmount } = render(
    <table><thead><tr>
      <ResizableHarHeaderCell columnLabel="Domain" columnWidth={200} minimumWidth={110}
        maximumWidth={maximumWidth}
        onColumnResize={onResize} onClick={onSort}>
        Domain
      </ResizableHarHeaderCell>
    </tr></thead></table>,
  );
  return { handle: screen.getByRole('separator'), onResize, onSort, unmount };
}

it('coalesces pointer samples and resizes before release without sorting', () => {
  const { handle, onResize, onSort } = header();
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 420 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 430 });
  expect(onResize).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  flushFrame();
  expect(onResize).toHaveBeenCalledWith(430);
  expect(handle).toHaveClass('is-resizing');
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 430 });
  fireEvent.click(handle);
  expect(onResize).toHaveBeenCalledTimes(1);
  expect(onSort).not.toHaveBeenCalled();
  // The remaining header still sorts normally.
  fireEvent.click(screen.getByRole('columnheader'));
  expect(onSort).toHaveBeenCalledTimes(1);
});

it('enforces minimum width and cancels a lost drag without committing', () => {
  const { handle, onResize } = header();
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: -500 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: -500 });
  expect(onResize).toHaveBeenLastCalledWith(110);
  onResize.mockClear();
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });
  fireEvent.pointerCancel(handle, { pointerId: 1 });
  expect(onResize).not.toHaveBeenCalled();
  expect(handle).not.toHaveClass('is-resizing');
});

it('allows keyboard resizing without triggering the sortable header', () => {
  const { handle, onResize, onSort } = header();
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(onResize).toHaveBeenCalledWith(216);
  fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  expect(onResize).toHaveBeenLastCalledWith(184);
  fireEvent.keyDown(handle, { key: 'Enter' });
  expect(onResize).toHaveBeenCalledTimes(2);
  expect(onSort).not.toHaveBeenCalled();
});

it('clamps pointer and keyboard growth at the neighbour budget', () => {
  const { handle, onResize } = header(210);
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(onResize).toHaveBeenLastCalledWith(210);
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 });
  flushFrame();
  expect(onResize).toHaveBeenLastCalledWith(210);
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(onResize).toHaveBeenLastCalledWith(210);
});

it('continues across live parent rerenders and restores the original width on cancellation', () => {
  function LiveHeader() {
    const [width, setWidth] = useState(200);
    return <table><thead><tr><ResizableHarHeaderCell columnLabel="Domain" columnWidth={width}
      minimumWidth={110} maximumWidth={500} onColumnResize={setWidth}>Domain</ResizableHarHeaderCell></tr></thead></table>;
  }
  render(<LiveHeader />);
  const handle = screen.getByRole('separator');
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 });
  flushFrame();
  expect(handle).toHaveAttribute('aria-valuenow', '300');
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 350 });
  flushFrame();
  expect(handle).toHaveAttribute('aria-valuenow', '350');
  fireEvent.pointerCancel(handle, { pointerId: 1 });
  expect(handle).toHaveAttribute('aria-valuenow', '200');
  expect(handle).not.toHaveClass('is-resizing');
});

it('discards pending frames on unmount and rolls back on lost capture', () => {
  const { handle, onResize, unmount } = header();
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 350 });
  flushFrame();
  fireEvent.lostPointerCapture(handle, { pointerId: 1 });
  expect(onResize).toHaveBeenLastCalledWith(200);
  onResize.mockClear();
  fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 200 });
  fireEvent.pointerMove(handle, { pointerId: 2, clientX: 350 });
  unmount();
  flushFrame();
  expect(onResize).not.toHaveBeenCalled();
});
