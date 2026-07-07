import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

// ============================================================
// 导航意图类型定义
// ============================================================

export interface NavigationFilters {
  /** 搜索关键词 */
  keyword?: string;
  /** 域名 / host */
  host?: string;
  /** 错误码 */
  errorCode?: string;
  /** 仅显示错误 */
  errorOnly?: boolean;
  /** source id */
  sourceId?: string;
  /** source chain root id */
  sourceChainId?: string;
  /** 来源类型 */
  sourceType?: string;
  /** 事件类型 */
  eventType?: string;
  /** 参数字段 */
  paramField?: string;
  /** 阶段 */
  phase?: string;
  /** 状态 */
  status?: string;
  /** 协议 */
  protocol?: string;
  /** 路径 */
  path?: string;
  /** URL 路径 */
  url?: string;
  /** 方法 */
  method?: string;
  /** worker */
  worker?: string;
  /** 级别 */
  level?: string;
  /** 最小耗时 */
  durationMin?: number;
  /** 最大耗时 */
  durationMax?: number;
  /** 请求 ID */
  requestId?: number;
}

export interface NavigationHighlight {
  requestIds?: number[];
  sourceIds?: number[];
  hosts?: string[];
  urls?: string[];
}

export interface NavigationScrollTo {
  type: 'request' | 'event' | 'log' | 'group' | 'host';
  id: string | number;
}

export interface NavigationIntent {
  /** 目标 tab key */
  tab: string;
  /** 目标文件类型（用于 HAR / NetLog 间避免跳错） */
  fileType?: 'har' | 'netlog' | 'log';
  /** 证据来源（联合诊断时用于区分证据来自 HAR 还是 NetLog） */
  evidenceSource?: 'har' | 'netlog';
  /** 跳转来源描述 */
  source?: string;
  /** 跳转原因描述 */
  reason?: string;
  /** 搜索 / 过滤条件 */
  filters?: NavigationFilters;
  /** 高亮目标 */
  highlight?: NavigationHighlight;
  /** 滚动到指定条目 */
  scrollTo?: NavigationScrollTo;
}

interface ResolvedNavigationIntent extends NavigationIntent {
  /** 递增 ID，确保多次跳转同一目标也能触发 effect */
  id: number;
}

interface NavigationContextType {
  /** 当前导航意图（消费前有效） */
  intent: ResolvedNavigationIntent | null;
  /** 发起一次导航 */
  navigateTo: (intent: NavigationIntent) => void;
  /** 消费导航意图（各 tab 用完后调用） */
  consumeIntent: () => void;
}

const NavigationContext = createContext<NavigationContextType>({
  intent: null,
  navigateTo: () => {},
  consumeIntent: () => {},
});

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [intent, setIntent] = useState<ResolvedNavigationIntent | null>(null);
  const idRef = useRef(0);

  const navigateTo = useCallback((newIntent: NavigationIntent) => {
    idRef.current += 1;
    setIntent({ ...newIntent, id: idRef.current });
  }, []);

  const consumeIntent = useCallback(() => {
    setIntent(null);
  }, []);

  return (
    <NavigationContext.Provider value={{ intent, navigateTo, consumeIntent }}>
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = () => useContext(NavigationContext);

export default NavigationContext;
