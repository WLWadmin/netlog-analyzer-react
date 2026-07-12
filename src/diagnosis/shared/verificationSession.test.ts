import type { FinalAction } from './finalSummaryTypes';
import { evaluateVerificationSession } from './verificationSession';

function action(id: string, title: string): FinalAction {
  return {
    id,
    title,
    detail: '执行验证',
    expectedResult: '应看到是否改善',
    nextIfFailed: '继续下一步',
    priority: 1,
    effort: 'low',
    risk: 'safe',
  };
}

describe('verificationSession', () => {
  it('asks user to run a low-risk action when no record exists', () => {
    const result = evaluateVerificationSession([action('a1', '切换网络')], []);

    expect(result.status).toBe('no-action-recorded');
    expect(result.mustAvoidConfirmedRootCause).toBe(true);
  });

  it('returns direction-supported but does not create confirmed root cause', () => {
    const result = evaluateVerificationSession([action('a1', '切换网络')], [{ actionId: 'a1', outcome: 'improved' }]);

    expect(result.status).toBe('direction-supported');
    expect(result.message).toContain('不是新的确定根因');
    expect(result.mustAvoidConfirmedRootCause).toBe(true);
  });

  it('selects next untried action when unchanged', () => {
    const result = evaluateVerificationSession([
      action('a1', '切换网络'),
      action('a2', 'nslookup'),
    ], [{ actionId: 'a1', outcome: 'unchanged' }]);

    expect(result.status).toBe('needs-next-action');
    expect(result.nextAction?.id).toBe('a2');
  });

  it('asks for more evidence after all actions are tried without improvement', () => {
    const result = evaluateVerificationSession([
      action('a1', '切换网络'),
    ], [{ actionId: 'a1', outcome: 'unchanged' }]);

    expect(result.status).toBe('collect-more-evidence');
    expect(result.message).toContain('重新同时采集 HAR 与 NetLog');
  });
});
