import { useState } from 'react';
import { NETLOG_STATE_PAGE_SIZE, type NetlogStatePageQuery, type NetlogStatePaging } from '../workers/netlogStatePaging';

export function useNetlogStatePaging(view?: NetlogStatePaging) {
  const [statePage, setStatePage] = useState<NetlogStatePageQuery>({ pages: {} });
  const pagination = (field: string) => ({
    current: view?.paging?.pages[field] ?? 1,
    total: view?.paging?.totals[field] ?? 0,
    pageSize: NETLOG_STATE_PAGE_SIZE,
    showSizeChanger: false,
    hideOnSinglePage: true,
    showTotal: (total: number) => `共 ${total} 条`,
    onChange: (page: number) => setStatePage(previous => ({ pages: { ...previous.pages, [field]: page } })),
  });
  return { statePage, pagination };
}
