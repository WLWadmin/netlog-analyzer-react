import type {
  ActionGroup,
  FinalAction,
  FinalDiagnosisSummary,
} from './finalSummaryTypes';
import type { DiagnosticCategory, DiagnosticRole } from './types';

export type TroubleshootingOutcome = 'improved' | 'unchanged' | 'worse';
export type TroubleshootingState =
  | 'ACTION_PENDING'
  | 'ROLLBACK_REQUIRED'
  | 'NEXT_ACTION'
  | 'DIRECTION_SUPPORTED'
  | 'HANDOFF_READY';

export interface TroubleshootingStep {
  id: string;
  category: DiagnosticCategory;
  problemTitle: string;
  problemDetail: string;
  actionTitle: string;
  actionDetail: string;
  safetyNotice?: string;
  rollback?: string;
  expectedObservation: string;
  temporaryWorkaround: string;
  permanentFix: string;
  permanentOwners: DiagnosticRole[];
  sourceAction: FinalAction;
}

export interface TroubleshootingRoleTask {
  role: DiagnosticRole;
  roleTitle: string;
  category: DiagnosticCategory;
  action: FinalAction;
}

export interface TroubleshootingPlan {
  steps: TroubleshootingStep[];
  roleTasks: TroubleshootingRoleTask[];
  fallbackCategory: DiagnosticCategory;
  fallbackProblemTitle: string;
  fallbackProblemDetail: string;
}

export interface TroubleshootingSession {
  state: TroubleshootingState;
  currentStepIndex: number;
  pendingStepIndex?: number;
  history: Array<{
    stepId: string;
    category: DiagnosticCategory;
    outcome: TroubleshootingOutcome;
  }>;
  supportedDirections: DiagnosticCategory[];
  unsupportedDirections: DiagnosticCategory[];
}

interface CategoryCopy {
  problemTitle: string;
  problemDetail: string;
  temporaryWorkaround: string;
  permanentFix: string;
  permanentOwners: DiagnosticRole[];
  rollback?: string;
}

const CATEGORY_COPY: Record<DiagnosticCategory, CategoryCopy> = {
  dns: {
    problemTitle: '设备可能没有正确找到网站服务器',
    problemDetail: '这通常和当前网络的域名解析有关，可以先换一个网络验证。',
    temporaryWorkaround: '可暂时使用能够正常访问的网络。',
    permanentFix: '由 IT 检查企业 DNS、VPN DNS、DoH 和域名解析策略。',
    permanentOwners: ['it'],
    rollback: '请切回原来的网络，再继续下一步。',
  },
  proxy: {
    problemTitle: '代理或 VPN 可能影响了这次访问',
    problemDetail: '当前设备正在使用代理或 VPN。做一次关闭或换网络对比，可以判断它是否影响访问。',
    temporaryWorkaround: '在公司策略允许时，可暂时使用不经过该代理的可用网络。',
    permanentFix: '由 IT 检查 PAC、代理认证、域名白名单、CONNECT 隧道和代理服务器状态。',
    permanentOwners: ['it'],
    rollback: '请重新开启公司要求的代理或 VPN，恢复原设置。',
  },
  tls: {
    problemTitle: '安全证书检查可能拦住了连接',
    problemDetail: '系统时间、网站证书或公司安全网关都可能影响 HTTPS 连接。',
    temporaryWorkaround: '不要绕过证书警告；可先使用证书正常的网络环境。',
    permanentFix: '由 IT 检查企业根证书和 HTTPS inspection，后端检查网站证书链。',
    permanentOwners: ['it', 'backend'],
  },
  connect: {
    problemTitle: '设备与网站服务器的连接没有正常完成',
    problemDetail: '当前网络、代理、防火墙或目标端口都可能影响连接。',
    temporaryWorkaround: '可暂时使用能够正常访问的网络。',
    permanentFix: '由 IT 检查防火墙、网关、端口和安全设备日志；必要时由后端确认服务端监听。',
    permanentOwners: ['it', 'backend'],
    rollback: '请切回原来的网络，再继续下一步。',
  },
  protocol: {
    problemTitle: '当前连接方式可能与代理或网关不兼容',
    problemDetail: '这只是一条待验证线索，不需要用户理解或修改网络协议。',
    temporaryWorkaround: '先保持当前可用的网络或访问方式。',
    permanentFix: '由 IT 检查 HTTP/2、QUIC、WebSocket、ALPN 以及中间设备兼容性。',
    permanentOwners: ['it'],
  },
  server: {
    problemTitle: '请求已经发出，但服务端返回错误或响应太慢',
    problemDetail: '这通常不是用户能够通过修改网络设置解决的问题。',
    temporaryWorkaround: '可以稍后重试；如果业务允许，可暂时使用备用入口。',
    permanentFix: '由后端根据请求时间、logid 和 Server-Timing 检查网关、应用和下游依赖。',
    permanentOwners: ['backend'],
  },
  client: {
    problemTitle: '当前登录状态、权限或请求方式可能不符合要求',
    problemDetail: '可以先重新登录；仍失败时需要前端或后端确认。',
    temporaryWorkaround: '重新登录恢复后可继续使用。',
    permanentFix: '由前后端核对鉴权、权限和接口调用约定。',
    permanentOwners: ['frontend', 'backend'],
  },
  performance: {
    problemTitle: '页面主要慢在等待响应或下载内容',
    problemDetail: '做一次网络对比后，就能判断更偏网络还是服务处理方向。',
    temporaryWorkaround: '可暂时使用更稳定的网络或稍后重试。',
    permanentFix: '由后端检查服务耗时，由前端检查资源大小、缓存和加载顺序。',
    permanentOwners: ['backend', 'frontend'],
    rollback: '请切回原来的网络，再继续下一步。',
  },
  cache: {
    problemTitle: '浏览器缓存可能让页面反复加载旧内容',
    problemDetail: '先用无痕窗口重新打开，最快确认缓存是否影响使用。',
    temporaryWorkaround: '可以暂时使用无痕窗口或清理该站点缓存。',
    permanentFix: '由前端检查 Cache-Control、ETag、Service Worker 和资源版本。',
    permanentOwners: ['frontend'],
  },
  compression: {
    problemTitle: '页面资源可能过大，导致下载时间过长',
    problemDetail: '这通常需要研发优化资源和压缩策略。',
    temporaryWorkaround: '可暂时使用更稳定的网络。',
    permanentFix: '由前后端开启 gzip/br、拆分大资源并检查 CDN 缓存。',
    permanentOwners: ['frontend', 'backend'],
  },
  security: {
    problemTitle: '浏览器插件或公司安全策略可能阻止了访问',
    problemDetail: '可以先用无痕窗口验证；企业策略需要 IT 协助。',
    temporaryWorkaround: '个人插件导致时可停用对应插件；不要长期关闭企业安全策略。',
    permanentFix: '由 IT 检查 URL block list、防火墙和终端管控，前端检查浏览器安全策略。',
    permanentOwners: ['it', 'frontend'],
  },
  cors: {
    problemTitle: '浏览器拒绝了页面的跨域请求',
    problemDetail: '这不是用户网络设置问题，需要前端和后端处理。',
    temporaryWorkaround: '重新登录可能临时恢复；不要修改系统网络配置。',
    permanentFix: '由前后端核对 OPTIONS、Access-Control-Allow-*、Cookie SameSite 和鉴权配置。',
    permanentOwners: ['frontend', 'backend'],
  },
  redirect: {
    problemTitle: '页面跳转次数过多或跳转规则异常',
    problemDetail: '重新登录后仍出现时，需要研发检查跳转规则。',
    temporaryWorkaround: '重新登录恢复后可继续使用。',
    permanentFix: '由前后端检查登录态、地域跳转、协议跳转和重定向循环。',
    permanentOwners: ['frontend', 'backend'],
  },
  'network-change': {
    problemTitle: '问题发生时网络连接可能发生了切换',
    problemDetail: 'Wi-Fi、VPN、休眠唤醒或弱网重连都可能让请求中断。',
    temporaryWorkaround: '保持稳定网络后可继续使用。',
    permanentFix: '由 IT 检查 Wi-Fi、VPN 和休眠唤醒后的重连策略。',
    permanentOwners: ['it'],
  },
  'browser-queue': {
    problemTitle: '浏览器同时处理的请求可能过多',
    problemDetail: '页面短时间发起了大量请求，部分请求还没连接到服务器就已经排队很久。',
    temporaryWorkaround: '减少一次打开、预览或下载的内容数量。',
    permanentFix: '由前端限制同域请求并发，检查懒加载、重复请求、统一超时和取消逻辑。',
    permanentOwners: ['frontend'],
  },
  quality: {
    problemTitle: '当前文件没有完整记录问题发生过程',
    problemDetail: '请先重新采集，不要根据不完整记录修改网络设置。',
    temporaryWorkaround: '重新采集后再继续判断。',
    permanentFix: '由客服或一线支持指导完整采集。',
    permanentOwners: ['user'],
  },
  unknown: {
    problemTitle: '已经看到网络异常，但当前信息还不能说明具体方向',
    problemDetail: '按低风险步骤逐项验证，产品会根据结果继续引导。',
    temporaryWorkaround: '保持当前能够使用的临时方案。',
    permanentFix: '把操作记录交给 IT 或研发继续确认。',
    permanentOwners: ['it'],
  },
};

const ROLE_TITLES: Record<DiagnosticRole, string> = {
  user: '用户',
  it: 'IT / 网络管理员',
  frontend: '前端',
  backend: '后端',
};

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function actionCategory(finalSummary: FinalDiagnosisSummary, action: FinalAction): DiagnosticCategory {
  if (action.sourceCardId) {
    const card = finalSummary.expertCards.find(item => item.id === action.sourceCardId);
    if (card) return card.category;
  }
  return finalSummary.headline[0]?.category || 'unknown';
}

function actionSafetyNotice(action: FinalAction, category: DiagnosticCategory): string | undefined {
  if (category === 'tls') return '不要绕过浏览器证书警告，也不要删除企业证书。';
  if (category === 'proxy') return '只有在公司安全策略允许时才临时关闭；公司强制代理不能长期停用。';
  if (action.risk === 'needs-approval') return '该操作可能改变当前网络状态，请确认符合公司安全要求。';
  if (action.risk === 'sensitive') return '该操作可能涉及敏感信息，请不要复制 Cookie、Authorization 或请求体。';
  return undefined;
}

function buildRoleTasks(finalSummary: FinalDiagnosisSummary, groups: ActionGroup[]): TroubleshootingRoleTask[] {
  return groups
    .filter(group => group.role !== 'user' && group.role !== 'collect')
    .flatMap(group => group.actions.map(action => ({
      role: group.role as DiagnosticRole,
      roleTitle: ROLE_TITLES[group.role as DiagnosticRole],
      category: actionCategory(finalSummary, action),
      action,
    })));
}

export function buildTroubleshootingPlan(finalSummary: FinalDiagnosisSummary): TroubleshootingPlan {
  const fallbackCategory = finalSummary.headline[0]?.category || 'unknown';
  const userActions = finalSummary.actionPlan
    .find(group => group.role === 'user')
    ?.actions.filter(action => action.risk !== 'sensitive')
    .slice(0, 3) || [];
  const steps = userActions.map(action => {
    const category = actionCategory(finalSummary, action);
    const copy = CATEGORY_COPY[category];
    return {
      id: action.id,
      category,
      problemTitle: copy.problemTitle,
      problemDetail: copy.problemDetail,
      actionTitle: action.title,
      actionDetail: action.detail,
      safetyNotice: actionSafetyNotice(action, category),
      rollback: copy.rollback,
      expectedObservation: action.expectedResult || '完成后重新打开刚才失败或很慢的页面，观察是否恢复。',
      temporaryWorkaround: copy.temporaryWorkaround,
      permanentFix: copy.permanentFix,
      permanentOwners: copy.permanentOwners,
      sourceAction: action,
    };
  });

  return {
    steps,
    roleTasks: buildRoleTasks(finalSummary, finalSummary.actionPlan),
    fallbackCategory,
    fallbackProblemTitle: CATEGORY_COPY[fallbackCategory].problemTitle,
    fallbackProblemDetail: CATEGORY_COPY[fallbackCategory].problemDetail,
  };
}

export function createTroubleshootingSession(plan: TroubleshootingPlan): TroubleshootingSession {
  return {
    state: plan.steps.length > 0 ? 'ACTION_PENDING' : 'HANDOFF_READY',
    currentStepIndex: 0,
    history: [],
    supportedDirections: [],
    unsupportedDirections: [],
  };
}

export function currentTroubleshootingStep(
  plan: TroubleshootingPlan,
  session: TroubleshootingSession
): TroubleshootingStep | undefined {
  return plan.steps[session.currentStepIndex];
}

export function recordTroubleshootingOutcome(
  plan: TroubleshootingPlan,
  session: TroubleshootingSession,
  outcome: TroubleshootingOutcome
): TroubleshootingSession {
  const step = currentTroubleshootingStep(plan, session);
  if (!step || session.state !== 'ACTION_PENDING') return session;

  const history = [...session.history, { stepId: step.id, category: step.category, outcome }];
  if (outcome === 'improved') {
    return {
      ...session,
      state: 'DIRECTION_SUPPORTED',
      history,
      supportedDirections: uniq([...session.supportedDirections, step.category]),
    };
  }

  const pendingStepIndex = session.currentStepIndex + 1 < plan.steps.length
    ? session.currentStepIndex + 1
    : undefined;

  if (outcome === 'worse') {
    return {
      ...session,
      state: step.rollback ? 'ROLLBACK_REQUIRED' : 'HANDOFF_READY',
      pendingStepIndex: undefined,
      history,
      unsupportedDirections: uniq([...session.unsupportedDirections, step.category]),
    };
  }

  return {
    ...session,
    state: step.rollback ? 'ROLLBACK_REQUIRED' : pendingStepIndex !== undefined ? 'NEXT_ACTION' : 'HANDOFF_READY',
    pendingStepIndex,
    history,
    unsupportedDirections: uniq([...session.unsupportedDirections, step.category]),
  };
}

export function continueTroubleshootingSession(session: TroubleshootingSession): TroubleshootingSession {
  if (session.state !== 'ROLLBACK_REQUIRED' && session.state !== 'NEXT_ACTION') return session;
  if (session.pendingStepIndex === undefined) {
    return { ...session, state: 'HANDOFF_READY' };
  }
  return {
    ...session,
    state: 'ACTION_PENDING',
    currentStepIndex: session.pendingStepIndex,
    pendingStepIndex: undefined,
  };
}

export function getRelevantRoleTasks(
  plan: TroubleshootingPlan,
  session: TroubleshootingSession
): TroubleshootingRoleTask[] {
  const supportedCategory = session.supportedDirections[0];
  if (!supportedCategory) return plan.roleTasks.slice(0, 6);
  const matching = plan.roleTasks.filter(task => task.category === supportedCategory);
  return matching.slice(0, 6);
}
