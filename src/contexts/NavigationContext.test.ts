import type { NavigationIntent } from './NavigationContext';

describe('NavigationIntent', () => {
  it('承载 Trace 证据定位字段', () => {
    const intent: NavigationIntent = {
      tab: 'evidence',
      fileType: 'trace',
      evidenceSource: 'trace',
      filters: { navigationKey: 'nav-1' },
      highlight: {
        factIds: ['task-1'],
        evidenceIds: ['trace:event:7'],
      },
    };

    expect(intent).toEqual(expect.objectContaining({
      fileType: 'trace',
      evidenceSource: 'trace',
    }));
  });

  it.each([
    ['fact', 'task-1'],
    ['evidence', 'trace:event:7'],
    ['navigation', 'nav-1'],
  ] as const)('支持滚动定位 Trace %s', (type, id) => {
    const intent: NavigationIntent = {
      tab: 'evidence',
      fileType: 'trace',
      scrollTo: { type, id },
    };

    expect(intent.scrollTo).toEqual({ type, id });
  });
});
