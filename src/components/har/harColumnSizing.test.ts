import { fitHarColumnWidths } from './harColumnSizing';

const columns = [
  { key: 'name', minimum: 140, preferred: 320 },
  { key: 'domain', minimum: 140, preferred: 200 },
  { key: 'time', minimum: 80, preferred: 90 },
];

it('fits the exact available budget while preserving readable minima', () => {
  for (const width of [360, 480, 1200, 1501]) {
    const fitted = fitHarColumnWidths(columns, width);
    expect(fitted.reduce((sum, value) => sum + value, 0)).toBe(width);
    fitted.forEach((value, index) => expect(value).toBeGreaterThanOrEqual(columns[index].minimum));
  }
});

it('retains minima instead of crushing columns when optional columns cannot fit', () => {
  expect(fitHarColumnWidths(columns, 200)).toEqual([140, 140, 80]);
});

const networkColumns = [
  { key: 'name', minimum: 140, preferred: 320, flexible: true },
  ...['status', 'issue', 'protocol', 'category', 'size', 'time'].map(key => ({ key, minimum: 112, preferred: 112 })),
  { key: 'domain', minimum: 140, preferred: 200, flexible: true },
  { key: 'waterfall', minimum: 140, preferred: 300 },
];

it('keeps compact columns equal and waterfall unchanged, splitting the surplus equally', () => {
  const fitted = fitHarColumnWidths(networkColumns, 1440);
  expect(fitted.slice(1, 7)).toEqual(Array(6).fill(112));
  expect(fitted[0]).toBe(234);
  expect(fitted[7]).toBe(234);
  expect(fitted[8]).toBe(300);
  const odd = fitHarColumnWidths(networkColumns, 1441);
  expect(Math.abs(odd[0] - odd[7])).toBe(1);
  expect(odd.reduce((sum, width) => sum + width, 0)).toBe(1441);
});

it('prioritizes minima when a narrow container cannot fit preferred widths', () => {
  const fitted = fitHarColumnWidths(networkColumns, 1200);
  expect(fitted[0]).toBe(140);
  expect(fitted[7]).toBe(140);
  expect(fitted[8]).toBe(248);
  expect(fitted.reduce((sum, width) => sum + width, 0)).toBe(1200);
});
