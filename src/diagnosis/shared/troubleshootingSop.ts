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
  actionSteps: string[];
  prerequisite: string;
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
    stepIndex: number;
    category: DiagnosticCategory;
    outcome: TroubleshootingOutcome;
    rollbackConfirmed?: boolean;
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
    problemDetail: '当前证据指向名称解析现象，但还不能区分域名、解析器、策略或网络路径。',
    temporaryWorkaround: '可暂时使用能够正常访问的网络。',
    permanentFix: '若热点多次正常、工区网络多次失败，由 IT 优先检查工区 DNS、出口、VPN DNS、DoH 和域名解析策略。',
    permanentOwners: ['it'],
    rollback: '请切回原来的网络，并恢复测试前记录的原 DNS 设置，再继续下一步。',
  },
  proxy: {
    problemTitle: '代理或 VPN 可能影响了这次访问',
    problemDetail: '当前设备正在使用代理或 VPN。只有代理错误或受控对比与请求对齐时，才能提高关联置信度。',
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
    permanentFix: '若热点多次正常、工区网络多次失败，由 IT 优先检查工区接入、网关、防火墙、白名单、代理和安全设备日志；必要时由后端确认服务端监听。',
    permanentOwners: ['it', 'backend'],
    rollback: '请切回原来的网络，再继续下一步。',
  },
  protocol: {
    problemTitle: '当前连接记录到协议层异常',
    problemDetail: '需要结合具体错误码、方向、连接/stream 和回退结果判断，不能默认归因代理或网关。',
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

function actionRollback(action: FinalAction, category: DiagnosticCategory): string | undefined {
  const text = `${action.title} ${action.detail}`;
  if (/临时对照.*DNS|修改.*DNS|切换.*DNS 解析器/i.test(text)) {
    return '请恢复测试前记录的原 DNS 设置；如果也切换了网络，请切回原网络并确认。';
  }
  if (/关闭代理|停用代理|关闭 VPN|关闭VPN/i.test(text)) return '请重新开启公司要求的代理或 VPN，恢复原设置并确认。';
  if (/切换网络|手机热点|另一条网络/i.test(text)) return '请切回原来的网络，确认原页面状态后再继续。';
  if (/无痕窗口/i.test(text)) return '请关闭无痕窗口，回到原窗口确认状态。';
  return category === 'proxy' && action.risk === 'needs-approval' ? CATEGORY_COPY.proxy.rollback : undefined;
}

function actionSteps(action: FinalAction, category: DiagnosticCategory): string[] {
  const collecting = category === 'quality' || /采集|导出 HAR|导出 NetLog/i.test(`${action.title} ${action.detail}`);
  return [
    collecting ? '记录复现步骤、时间和当前网络环境，确认采集从复现前开始。' : '记录当前页面、失败时间和原设置，不同时改变其他条件。',
    action.detail,
    collecting ? '停止采集后检查文件是否覆盖完整复现窗口。' : '观察同一目标的结果，记录恢复、无变化或变差及对应时间。',
  ];
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
      actionSteps: actionSteps(action, category),
      prerequisite: actionSafetyNotice(action, category) || '仅在该操作符合当前环境和组织要求时执行；不可安全重复的提交不要重试。',
      safetyNotice: actionSafetyNotice(action, category),
      rollback: actionRollback(action, category),
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

  const history = [...session.history, { stepId: step.id, stepIndex: session.currentStepIndex, category: step.category, outcome }];
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
  const history = session.state === 'ROLLBACK_REQUIRED'
    ? session.history.map((record, index) => index === session.history.length - 1 ? { ...record, rollbackConfirmed: true } : record)
    : session.history;
  if (session.pendingStepIndex === undefined) {
    return { ...session, state: 'HANDOFF_READY', history };
  }
  return {
    ...session,
    state: 'ACTION_PENDING',
    currentStepIndex: session.pendingStepIndex,
    pendingStepIndex: undefined,
    history,
  };
}

/** Only the latest answer can be corrected: prior answers may have already selected the current action. */
export function correctLastTroubleshootingOutcome(session: TroubleshootingSession): TroubleshootingSession {
  const last = session.history[session.history.length - 1];
  if (!last) return session;
  const history = session.history.slice(0, -1);
  return {
    ...session,
    state: 'ACTION_PENDING',
    currentStepIndex: last.stepIndex,
    pendingStepIndex: undefined,
    history,
    supportedDirections: uniq(history.filter(item => item.outcome === 'improved').map(item => item.category)),
    unsupportedDirections: uniq(history.filter(item => item.outcome !== 'improved').map(item => item.category)),
  };
}

export function getRelevantRoleTasks(
  plan: TroubleshootingPlan,
  session: TroubleshootingSession
): TroubleshootingRoleTask[] {
  if (plan.steps.length === 0) return plan.roleTasks.slice(0, 6);
  const supportedCategory = session.supportedDirections[0];
  const category = supportedCategory || plan.steps[session.currentStepIndex]?.category || plan.fallbackCategory;
  const matching = plan.roleTasks.filter(task => task.category === category);
  return matching.slice(0, 6);
}
