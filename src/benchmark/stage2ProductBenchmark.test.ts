import { findForbiddenStage6Keys } from './stage6Privacy';

describe('Stage 6 benchmark privacy scanner', () => {
  it('detects forbidden keys without depending on key casing', () => {
    expect(findForbiddenStage6Keys({
      Authorization: 'masked',
      nested: {
        rawEvent: {},
        queryToken: 'masked',
        screenshotBytes: 10,
      },
    })).toEqual([
      'Authorization',
      'queryToken',
      'rawEvent',
      'screenshotBytes',
    ]);
  });

  it('does not reject safe projected source identifiers', () => {
    expect(findForbiddenStage6Keys({
      sourceEventId: 'projected:1',
      evidenceIds: ['trace:event:1'],
      trackId: 'plugin:temporary',
    })).toEqual([]);
  });
});
