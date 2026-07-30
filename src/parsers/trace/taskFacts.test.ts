import { calculateSelfTime, mergeIntervals, unionDuration } from './taskFacts';

describe('task interval facts', () => {
  it('merges overlapping, nested, and adjacent half-open intervals', () => {
    expect(mergeIntervals([
      { start: 30, end: 40 },
      { start: 10, end: 20 },
      { start: 15, end: 35 },
      { start: 40, end: 45 },
      { start: 50, end: 50 },
    ])).toEqual([{ start: 10, end: 45 }]);
    expect(unionDuration([
      { start: 10, end: 20 },
      { start: 15, end: 30 },
      { start: 40, end: 45 },
    ])).toBe(25);
  });

  it('clips direct children to the parent before calculating self time', () => {
    expect(calculateSelfTime(
      { start: 100, end: 200 },
      [
        { start: 80, end: 120 },
        { start: 110, end: 150 },
        { start: 140, end: 170 },
        { start: 220, end: 230 },
      ],
    )).toBe(30);
  });
});
