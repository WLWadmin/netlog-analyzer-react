import {
  readBoolean,
  readEventData,
  readFiniteNumber,
  readFrameId,
  readIsOutermostFrame,
  readNavigationId,
  readParentFrameId,
  readProcessId,
  readRecord,
  readString,
  readThreadId,
} from './eventAccessors';

describe('trace event accessors', () => {
  it('reads only values with the expected primitive types', () => {
    expect(readRecord({ value: 1 })).toEqual({ value: 1 });
    expect(readRecord([])).toBeUndefined();
    expect(readString('frame-a')).toBe('frame-a');
    expect(readString(1)).toBeUndefined();
    expect(readFiniteNumber(7)).toBe(7);
    expect(readFiniteNumber('7')).toBeUndefined();
    expect(readFiniteNumber(Number.NaN)).toBeUndefined();
    expect(readFiniteNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(readBoolean(false)).toBe(false);
    expect(readBoolean('false')).toBeUndefined();
  });

  it('reads only explicit event and args.data paths', () => {
    const event = {
      pid: 10,
      tid: 20,
      args: {
        data: {
          frame: 'frame-a',
          parent: 'frame-parent',
          navigationId: 'nav-a',
          processId: 30,
          isOutermostMainFrame: true,
        },
      },
    };

    expect(readEventData(event)).toEqual(event.args.data);
    expect(readFrameId(event)).toBe('frame-a');
    expect(readParentFrameId(event)).toBe('frame-parent');
    expect(readNavigationId(event)).toBe('nav-a');
    expect(readProcessId(event)).toBe(30);
    expect(readThreadId(event)).toBe(20);
    expect(readIsOutermostFrame(event)).toBe(true);
    expect(readFrameId({
      args: {
        frame: 'frame-from-args',
        data: { navigationId: 'nav-from-data' },
      },
    })).toBe('frame-from-args');
  });

  it('does not recurse into nested same-name or sensitive fields', () => {
    const event = {
      pid: '10',
      args: {
        data: {
          nested: {
            frame: 'private-frame',
            navigationId: 'private-navigation',
            processId: 99,
          },
          url: 'https://private.invalid/?token=secret',
          headers: { Authorization: 'secret' },
          frame: 'https://private.invalid/?token=secret',
          navigationId: 'nav?token=secret',
        },
      },
    };

    expect(readFrameId(event)).toBeUndefined();
    expect(readNavigationId(event)).toBeUndefined();
    expect(readProcessId(event)).toBeUndefined();
    expect(readThreadId(event)).toBeUndefined();
    expect(JSON.stringify({
      frameId: readFrameId(event),
      navigationId: readNavigationId(event),
      processId: readProcessId(event),
    })).not.toContain('private.invalid');
  });
});
