import { fireEvent, render, screen } from '@testing-library/react';
import { TimelineInteractionStore } from '../../../workbench/timelineInteractionStore';
import FlameChartCanvas from './FlameChartCanvas';

describe('FlameChartCanvas', () => {
  beforeEach(() => {
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect: jest.fn(),
      strokeRect: jest.fn(),
      fillText: jest.fn(),
      setTransform: jest.fn(),
      set fillStyle(_value: string | CanvasGradient | CanvasPattern) {},
      set strokeStyle(_value: string | CanvasGradient | CanvasPattern) {},
      set lineWidth(_value: number) {},
      set font(_value: string) {},
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes only a bounded current and neighboring frame list', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 100 });
    const frames = Array.from({ length: 20 }, (_, index) => ({
      id: `frame-${index}`,
      nodeId: index,
      entityId: `cpu:node:profile:${index}`,
      functionName: `function-${index}`,
      startUs: index,
      durationUs: 10,
      depth: index % 3,
      sampleHits: 1,
      evidenceIds: [`trace:event:${index}`],
    }));
    render(<FlameChartCanvas frames={frames} store={store} />);

    expect(screen.getAllByRole('button', { name: /function-/ })).toHaveLength(5);
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('application'), { key: 'Enter' });
    expect(store.getSnapshot()).toMatchObject({
      highlightedEntityId: 'cpu:node:profile:0',
      cursorUs: 0,
      selection: { startUs: 0, endUs: 10 },
    });
  });

  it('returns through the shared history on Escape', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 100 });
    const onEscape = jest.fn();
    render(<FlameChartCanvas
      frames={[{
        id: 'frame',
        nodeId: 1,
        entityId: 'cpu:node:profile:1',
        functionName: 'work',
        startUs: 10,
        durationUs: 10,
        depth: 0,
        sampleHits: 1,
        evidenceIds: ['trace:event:1'],
      }]}
      store={store}
      onEscape={onEscape}
    />);

    fireEvent.keyDown(screen.getByRole('application'), { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('uses the vertical row when hit testing overlapping stack frames', () => {
    const store = new TimelineInteractionStore({ startUs: 0, endUs: 100 });
    render(<FlameChartCanvas
      frames={[
        {
          id: 'root-frame',
          nodeId: 1,
          entityId: 'cpu:node:profile:1',
          functionName: 'root',
          startUs: 10,
          durationUs: 50,
          depth: 0,
          sampleHits: 1,
          evidenceIds: ['trace:event:1'],
        },
        {
          id: 'leaf-frame',
          nodeId: 2,
          entityId: 'cpu:node:profile:2',
          parentId: 'root-frame',
          functionName: 'leaf',
          startUs: 10,
          durationUs: 50,
          depth: 1,
          sampleHits: 1,
          evidenceIds: ['trace:event:1'],
        },
      ]}
      store={store}
    />);
    const canvas = screen.getByRole('application');
    jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 88,
      right: 100,
      bottom: 88,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.click(canvas, { clientX: 20, clientY: 30 });

    expect(store.getSnapshot().highlightedEntityId).toBe('cpu:node:profile:2');
  });
});
