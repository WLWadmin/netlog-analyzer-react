import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationProvider, useNavigation } from '../../contexts/NavigationContext';
import { useTraceTargetNavigation } from './useTraceTargetNavigation';

const Probe = () => {
  const { navigateTo, intent } = useNavigation();
  const state = useTraceTargetNavigation('overview');
  return <div>
    <button onClick={() => navigateTo({ fileType: 'trace', tab: 'overview', scrollTo: { type: 'fact', id: 'quality' } })}>定位质量</button>
    <span data-testid="intent">{intent ? 'pending' : 'consumed'}</span>
    <span data-testid="highlight">{state.highlightedDomId ?? ''}</span>
    <div id="trace-fact-quality" tabIndex={-1}>质量锚点</div>
  </div>;
};

describe('useTraceTargetNavigation', () => {
  it('消费重复意图、重复滚动并在计时后清除高亮', async () => {
    jest.useFakeTimers();
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<NavigationProvider><Probe /></NavigationProvider>);

    await userEvent.click(screen.getByText('定位质量'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('intent').textContent).toBe('consumed');
    expect(screen.getByTestId('highlight').textContent).toBe('trace-fact-quality');
    expect(screen.getByText('质量锚点', { selector: ':focus' })).not.toBeNull();

    await userEvent.click(screen.getByText('定位质量'));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    act(() => { jest.advanceTimersByTime(2000); });
    expect(screen.getByTestId('highlight').textContent).toBe('');
    jest.useRealTimers();
  });

  it('减少动态效果时使用即时滚动', async () => {
    jest.useFakeTimers();
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    const view = render(<NavigationProvider><Probe /></NavigationProvider>);

    await userEvent.click(screen.getByText('定位质量'));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });

    view.unmount();
    jest.useRealTimers();
  });

});
