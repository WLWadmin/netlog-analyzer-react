import { normalizeNetlogErrorValue } from './netlogErrorValue';

describe('normalizeNetlogErrorValue', () => {
  it.each([0, '0', 'OK', 'NO_ERROR', 'NET_OK', '', '  ok  '])('filters successful value %p', value => {
    expect(normalizeNetlogErrorValue(value)).toBeUndefined();
  });

  it.each([-105, 'PROTOCOL_ERROR', 'CANCEL'])('retains failure value %p', value => {
    expect(normalizeNetlogErrorValue(value)).toBe(value);
  });
});
