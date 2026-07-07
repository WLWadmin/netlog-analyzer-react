import { createNetlogModulesStateReducer } from './netlogModulesStateReducer';

describe('createNetlogModulesStateReducer', () => {
  it('聚合 module/component/service 事件', () => {
    const reducer = createNetlogModulesStateReducer();

    reducer.accept({
      eventId: 0,
      byteStart: 10,
      byteEnd: 40,
      time: 1,
      typeName: 'NETWORK_SERVICE_MODULE_INITIALIZED',
      sourceId: 100,
      sourceTypeName: 'NETWORK_SERVICE',
      params: { module_name: 'network-service' },
    });
    reducer.accept({
      eventId: 1,
      byteStart: 41,
      byteEnd: 70,
      time: 2,
      typeName: 'COMPONENT_UPDATE_FAILED',
      sourceId: 101,
      sourceTypeName: 'COMPONENT',
      params: { component: 'crl-set', error: -2 },
    });

    const view = reducer.finish();

    expect(view.eventCount).toBe(2);
    expect(view.errorCount).toBe(1);
    expect(view.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'network-service', category: 'module' }),
      expect.objectContaining({ name: 'crl-set', category: 'component', errorCount: 1 }),
    ]));
    expect(view.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'failed', error: -2 }),
    ]));
  });
});
