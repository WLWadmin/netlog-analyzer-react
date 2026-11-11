(function () {
  'use strict';
  // Design-only fixed fixtures; no user file intake or production diagnosis.
  const workspace = document.getElementById('workspace');
  const root = document.getElementById('overlay-root');
  const state = { source: 'netlog', page: 'overview', quality: 'complete', intent: 'auto', query: '', status: 'all', sort: 'duration', selected: 101, detail: false, temporary: null, returnState: null, outcome: 'not-run', note: '', window: 'all', topic: 'Events' };
  let focusReturn = null;
  let lastTrigger = null;
  let toastTimer;
  const requests = [
    { id: 101, name: '获取项目列表', path: '/api/projects', duration: 1240, status: 'failed', code: 'ERR_CONNECTION_RESET', method: 'GET', event: 'demo-event-101-end' },
    { id: 102, name: '加载用户设置', path: '/api/preferences', duration: 3100, status: 'failed', code: 'ERR_CONNECTION_RESET', method: 'GET', event: 'demo-event-102-end' },
    { id: 103, name: '加载活动记录', path: '/api/activity', duration: 4800, status: 'success', code: '200', method: 'GET', event: 'demo-event-103-end' },
    { id: 104, name: '加载样式资源', path: '/assets/workspace.css', duration: 280, status: 'success', code: '200', method: 'GET', event: 'demo-event-104-end' }
  ];
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isHar = () => state.source === 'har';
  const sourceRequests = () => requests.map(r => {
    return isHar() && r.id === 102 ? { ...r, status:'success', code:'200' } : r;
  });
  const req = id => sourceRequests().find(r => r.id === Number(id));
  const badge = (text, cls = '') => `<span class="badge ${cls}">${text}</span>`;
  function heading(title, sub, action = '') {
    return `<div class="page-heading"><div><div class="eyebrow">历史合成演示 · ${esc(document.getElementById('source').selectedOptions[0].text)}</div><h1>${title}</h1><p class="muted">${sub}</p><p class="note">此页只展示布局与部分合成操作，不是完整生产功能清单。专家、比较、Go等页面未实现真实查询。<a href="../feature-matrix.html">以311项功能矩阵为实施保护基线</a>。</p></div>${action}</div>`;
  }
  function quality() {
    const label = state.quality === 'complete' ? '采集完成' : state.quality === 'truncated' ? '采集截断 · 仅部分可分析' : state.quality === 'corrupt' ? '结构损坏 · 暂不可分析' : '格式不支持';
    return `<div class="quality">${badge(label, state.quality === 'complete' ? 'good' : 'warn')}<span>示例数据 · 相对窗口 0–6 秒</span><span>原始文件不随报告导出</span><button data-page="import">查看采集质量</button></div>`;
  }
  function navigate(page) {
    closeOverlay(false);
    state.page = page;
    render();
  }
  function render() {
    document.querySelectorAll('#navigation button').forEach(b => {
      b.classList.toggle('active', b.dataset.page === state.page);
      b.setAttribute('aria-current', b.dataset.page === state.page ? 'page' : 'false');
    });
    if (state.page === 'import') workspace.innerHTML = importPage();
    else if (state.quality === 'corrupt' || state.quality === 'unsupported') workspace.innerHTML = overviewPage();
    else if (state.page === 'actions') workspace.innerHTML = actionPage();
    else if (state.source === 'trace') workspace.innerHTML = tracePage();
    else if (state.source === 'combined' || state.source === 'ab') workspace.innerHTML = comparePage();
    else if (state.source === 'go') workspace.innerHTML = goPage();
    else if (state.page === 'requests') workspace.innerHTML = requestPage();
    else if (state.page === 'evidence') workspace.innerHTML = evidencePage();
    else if (state.page === 'expert') workspace.innerHTML = expertPage();
    else workspace.innerHTML = overviewPage();
  }
  function importPage() {
    return `${heading('文件与准备', '直接导入，或先指定你想排查的问题。意图只影响诊断重点。')}<div class="wide"><section class="panel"><h2>你想排查什么？ <small>可选</small></h2><div class="radio-options">${[['auto','自动检查异常'],['failure','网页或接口失败'],['loading','页面加载慢'],['interaction','交互卡顿']].map(([v,t]) => `<button data-intent="${v}" class="${state.intent === v ? 'active' : ''}" aria-pressed="${state.intent === v}">${t}</button>`).join('')}</div><div class="import-zone"><h2>NetLog、HAR、Trace 或服务日志</h2><p class="muted">本原型使用合成文件，体验流程不需要上传真实日志。</p><button class="primary" data-demo="complete">载入完整演示文件</button><p class="muted" style="margin-top:14px">生产入口保留直接上传、格式检查和采集指引。</p></div></section><section class="panel"><h2>采集质量与异常状态</h2><div class="actions-row"><button data-demo="truncated">体验采集截断</button><button data-demo="corrupt">体验损坏文件</button><button data-demo="unsupported">体验不支持格式</button><button id="cancel-demo">取消演示准备</button></div><div class="note" id="intake-status">${state.quality === 'complete' ? '完整示例可分析请求、事件与原始字段。' : state.quality === 'truncated' ? '部分事实可分析；未闭合请求不能证明最终结果。' : state.quality === 'corrupt' ? '结构损坏，演示不会生成诊断。请重新导出原始格式。' : '当前格式不支持，不会切换到另一解析器冒充成功。'}</div></section></div>`;
  }
  function overviewPage() {
    if (state.quality === 'corrupt' || state.quality === 'unsupported') return `${heading('当前文件无法诊断','先处理文件结构或格式问题。')}<section class="panel">${badge('未产生诊断','warn')}<p class="divider">无法解析不代表网络正常，也不能输出故障原因。</p><button data-page="import">返回文件准备</button></section>`;
    const main = isHar() ? '一个请求没有完成，另一个等待响应较久' : '连接被重置，两个请求没有完成';
    return `${heading('诊断概览', '先了解问题与边界，再进入具体请求核对。', badge('事实已确认 · 原因待验证','warn'))}${quality()}
    <div class="grid-two"><div class="stack">
      <section class="panel"><div class="step-label">主要问题 · CLAIM-DEMO-01</div><h2 class="main-claim">${main}</h2>
        <p>${isHar() ? '浏览器记录到 ERR_CONNECTION_RESET；慢请求的 wait 为 3,900 ms。等待响应包含网络与服务端等因素。' : '这两个请求的自身终点记录到 ERR_CONNECTION_RESET。当前证据可以确认失败事实，但不能确定是哪一侧造成重置。'}</p>
        <dl class="fact-grid"><dt>可能影响</dt><dd>${isHar() ? '项目列表可能无法加载，活动记录响应较慢。' : '项目列表与设置可能无法加载。'}采集不证明整台电脑或所有网站受影响。</dd>
          <dt>支持依据</dt><dd>${isHar() ? '请求 101 的最终错误字段；请求 103 的浏览器 wait 为 3,900ms。' : '请求 101 的最终错误字段；请求 102 的同类错误记录。'}</dd>
          <dt>反证 / 限制</dt><dd>同窗口${isHar() ? '三个' : '两个'}请求完成。不支持“所有连接都中断”。</dd>
          <dt>仍然未知</dt><dd>服务器、代理或中间网络是否造成重置；需要同次复现的额外证据。</dd>
        </dl><div class="actions-row"><button class="primary" data-jump="101">查看请求证据</button><button data-page="actions">查看安全验证步骤</button></div>
      </section>
      <section class="panel"><h2>另一个值得查看的问题</h2><div class="evidence-line"><div><strong>活动记录加载用了 4.8 秒</strong><p class="muted">耗时现象已观察到；${isHar() ? 'Server-Timing 指标不能简单求和。' : '关联操作有重叠，不能拼成串行总耗时。'}</p></div><button data-jump="103">查看</button></div></section>
    </div><div class="stack">
      <section class="panel"><h2>受影响范围</h2><div class="number-line"><strong>${isHar() ? '1' : '2'}</strong><span class="muted">个失败请求 / 4 个示例请求</span></div><div class="divider"><p>失败集中在业务接口</p><small>同窗口存在成功请求。范围限定于这次采集，不推断整网故障。</small></div></section>
      <section class="panel"><div class="step-label">下一步 · 普通用户 / 一线支持</div><h2>记录同条件复现结果</h2><p>保持网络与代理设置不变，记录失败时间，再重新采集。先收集证据，不修改安全配置。</p><button data-page="actions">操作、观察与回退</button></section>
      <section class="panel"><h2>需要深入复核？</h2><p class="muted">完整事件、source 链和协议状态始终可从专家入口访问。</p><button data-page="expert">打开专家分析</button></section>
    </div></div>`;
  }
  function filteredRequests() {
    let list = sourceRequests().filter(r => {
      const matchText = `${r.id} ${r.name} ${r.path} ${r.code}`.toLowerCase().includes(state.query.toLowerCase());
      const matchStatus = state.status === 'all' || (state.status === 'slow' ? r.duration >= 3000 : r.status === state.status);
      return matchText && matchStatus && (state.window === 'all' || r.id === 101 || r.id === 104);
    });
    if (state.temporary && !list.some(r => r.id === state.temporary)) list.push(req(state.temporary));
    return list.sort((a,b) => state.sort === 'id' ? a.id-b.id : b.duration-a.duration);
  }
  function requestPage() {
    const list = filteredRequests();
    return `${heading('请求工作区', `${isHar() ? '浏览器 Timing 与失败字段' : '自身生命周期、最终结果与关联操作'} · 选择保留在当前会话中`)}${state.temporary ? `<div class="note warning">临时显示目标请求 ${state.temporary}；原筛选已保存。<button id="return-evidence">返回原工作状态</button></div>` : ''}<div class="toolbar"><input id="search" aria-label="搜索请求" placeholder="搜索名称、路径或错误码" value="${esc(state.query)}"><select id="status-filter" aria-label="状态筛选">${[['all','全部状态'],['failed','最终失败'],['success','完成'],['slow','耗时 ≥ 3 秒']].map(([v,t]) => `<option value="${v}" ${state.status===v?'selected':''}>${t}</option>`).join('')}</select><select id="sort" aria-label="请求排序"><option value="duration" ${state.sort==='duration'?'selected':''}>生命周期最长优先</option><option value="id" ${state.sort==='id'?'selected':''}>请求 ID 顺序</option></select><select id="window" aria-label="时间窗口"><option value="all">全部窗口</option><option value="early" ${state.window==='early'?'selected':''}>前 2 秒</option></select><button id="clear-filter">清除</button><span class="right">${list.length} / 4 个请求</span></div><div class="request-layout ${state.detail ? 'has-detail' : ''}"><section class="panel" style="padding:0"><div class="table-scroll"><table><thead><tr><th>请求 / 来源</th><th>最终结果</th><th>跨度</th><th>ID</th></tr></thead><tbody>${list.map(r => `<tr class="${state.selected === r.id ? 'selected' : ''}"><td><button class="row-link" data-select="${r.id}" aria-label="打开${r.name}">${r.name}<span class="request-url">https://demo.example${r.path}</span></button></td><td>${badge(r.status === 'failed' ? '失败' : '完成', r.status === 'failed' ? 'bad' : 'good')}<span class="mono" style="display:block;font-size:11px">${r.code}</span></td><td class="mono">${r.duration.toLocaleString()} ms</td><td class="mono">${r.id}</td></tr>`).join('')}</tbody></table>${list.length ? '' : '<div class="empty">当前筛选没有结果。可以清除筛选，原始数据仍保留。</div>'}</div></section>${state.detail ? detailPanel() : ''}</div>`;
  }
  function timing(label, start, end, total, cls='', origin=0) {
    const left = (start-origin)/total*100;
    const width = (end-start)/total*100;
    const value = cls === 'unknown' ? `${start}→${end} ms · 归因未知` : `${start}→${end} ms · ${end-start} ms`;
    return `<div class="timing-row" data-start="${start}" data-end="${end}" data-origin="${origin}" data-total="${total}"><span>${label}</span><div class="track"><div class="bar ${cls}" style="left:${left}%;width:${width}%" title="${esc(value)}"></div></div><span class="mono">${value}</span></div>`;
  }
  function requestTiming(r) {
    if (isHar() && r.id === 103) {
      return timing('获取连接',0,140,4800)+timing('发送',140,200,4800)+timing('等待响应',200,4100,4800,'warning')+timing('正文接收',4100,4800,4800);
    }
    const a = Math.round(r.duration*.1), b = Math.round(r.duration*.4);
    const c = Math.round(r.duration*.25), d = Math.round(r.duration*.85);
    return timing('连接尝试',a,b,r.duration)+timing('请求操作',c,d,r.duration,'warning')+timing('阶段未知',d,r.duration,r.duration,'unknown');
  }
  function missingTarget(id) {
    return `<section class="panel" role="alert"><h2>目标请求不存在</h2><p>当前合成来源没有请求 ${esc(id)}。未选择第一条请求，也未按URL猜测替代；原筛选、选区和来源保持。</p></section>`;
  }
  function detailPanel() {
    const r = req(state.selected);
    if (!r) return missingTarget(state.selected);
    return `<aside class="detail" aria-label="请求详情"><div class="detail-heading"><div><div class="eyebrow">REQUEST ${r.id} · ${isHar() ? 'HAR' : 'NETLOG'}</div><h2>${r.name}</h2></div><button id="close-detail" aria-label="关闭请求详情">×</button></div><p class="detail-url">https://demo.example${r.path}</p>${badge(r.code, r.status==='failed'?'bad':'good')}<div class="divider"><h3>${isHar()?'浏览器 Timing':'自身生命周期'}</h3><p class="mono">0 → ${r.duration} ms · ${r.duration} ms</p><p class="muted">${r.status==='failed'?'自身最终终点记录失败。':'请求最终完成；内部尝试不等于最终失败。'}</p></div><div class="timing"><h3>${isHar()?'已知阶段（合成示例）':'关联操作（合成重叠示例）'}</h3><p class="muted">共用0–${r.duration}ms横轴；条形位置表示开始时刻，斜纹区间表示阶段归因未知。</p>${requestTiming(r)}</div><div class="note">${isHar() ? 'connect 已包含 TLS；wait 不等于服务端 CPU。示例 Timing 用于设计，不推断真实网络原因。' : '操作重叠按原位置显示，不相加为总耗时。未知区间不填零，不推导执行耗时。自身终点与关联 Socket 终点分开。'}</div><div class="divider"><h3>可复核依据</h3><p class="mono">source.id = ${r.id}<br>eventId = ${r.event}</p><div class="actions-row"><button class="primary" data-raw="${r.id}">查看原始事件</button><button data-page="evidence">Source 链</button></div></div>${isHar() && r.id === 103 ? '<div class="divider"><h3>Server-Timing · 服务端自报</h3><p class="mono">app 1200ms · db 800ms · edge dur未知</p><small>可能存在父子/并行，不计算“总共2000ms”。</small></div>' : ''}</aside>`;
  }
  function evidencePage() {
    const r = req(state.selected);
    if (!r) return heading('证据复核','历史合成演示')+missingTarget(state.selected);
    return `${heading('证据复核', '请求、source 与 event 分别保留标识；原始字段可直接定位。')}${quality()}<div class="grid-two"><section class="panel"><h2>请求 ${r.id} · ${r.name}</h2><p class="mono">${r.code}</p><div class="divider"><h3>Source 关联示例</h3><figure style="margin:12px 0"><figcaption class="muted">关联关系不等于串行耗时</figcaption><div class="diagram-steps"><span>URL_REQUEST ${r.id}</span><b>→</b><span>HTTP_STREAM_JOB 201</span><b>→</b><span>SOCKET 301</span></div></figure><div class="note">关联 Socket 的结束不延长请求自身生命周期；内部尝试失败后仍可能成功。</div></div><table><thead><tr><th>事件</th><th>Source</th><th>事实</th></tr></thead><tbody><tr><td>REQUEST_ALIVE BEGIN</td><td>${r.id}</td><td>自身生命周期起点</td></tr><tr><td>REQUEST_ALIVE END</td><td>${r.id}</td><td>${r.status==='failed'?'net_error = -101':'net_error = 0'}</td></tr><tr><td>SOCKET_ALIVE END</td><td>301</td><td>仅关联 source 终点</td></tr></tbody></table><div class="actions-row"><button class="primary" data-raw="${r.id}">打开自身最终事件</button><button data-jump="${r.id}">定位请求列表</button></div></section><section class="panel"><h2>结论边界 · CLAIM-DEMO-01</h2><dl class="fact-grid"><dt>支持</dt><dd>请求自身最终错误</dd><dt>反证</dt><dd>同窗口存在成功请求</dd><dt>无法确定</dt><dd>重置责任主体</dd><dt>下一步</dt><dd>同条件复采、服务端或代理侧相关证据</dd></dl><p class="muted">精确定位依赖当前文件。脱敏报告只保留引用，不能凭报告恢复完整原始内容。</p></section></div>`;
  }
  function expertPage() {
    const topics = isHar() ? ['Timing','Headers 与缓存','失败字段','响应内容','原始证据','Server-Timing'] : ['Events','Source Chain','DNS / Host Resolver Cache','Proxy / PAC','Sockets / TLS','HTTP/2','QUIC','Cache / Alt-Svc','Data Loaded','Stream Pool','Reporting / Modules','Raw Evidence'];
    return `${heading('专家分析', '完整专业入口保留。每个结论仍使用概览中的相同事实与引用。')}<div class="expert-grid">${topics.map(t=>`<button data-topic="${esc(t)}"><strong>${t}</strong><small>打开该类证据与限制</small></button>`).join('')}</div><section class="panel" style="margin-top:20px"><h2>${esc(state.topic)} · 示例证据</h2><p class="muted">生产视图应使用完整 Dataset 查询；此处仅是设计示例，不代表数据覆盖上限。</p>${state.topic.includes('DNS') ? '<dl class="fact-grid"><dt>配置DNS</dt><dd>192.0.2.53（文档地址）</dd><dt>DNS答案</dt><dd>198.51.100.20（文档地址）</dd><dt>DoH候选</dt><dd>独立字段，不能当作DNS答案</dd><dt>Socket peer</dt><dd>203.0.113.10（文档地址），不是DNS server</dd></dl>' : '<p>全量事件、源关系和原始字段的访问不因概览简化而删除。</p>'}<button data-page="evidence">打开请求证据链</button></section>`;
  }
  function tracePage() {
    return `${heading('Trace · 加载与交互', 'Trace 使用独立时间模型。高级 Workbench 的开放仍由正式验收与功能开关决定。')}${badge('示例缺少 CPU profile','warn')}<div class="grid-two" style="margin-top:20px"><section class="panel"><h2>交互窗口内有一个长任务</h2><p>已观察事实：示例主线程任务持续 180ms。可能影响交互响应，但不等于已定位具体函数。</p><figure><figcaption>独立窗口 · 1200–1600ms（合成起止位置）</figcaption>${timing('事件处理',1200,1380,400,'warning',1200)}${timing('样式 / 布局',1320,1370,400,'',1200)}${timing('绘制',1380,1404,400,'',1200)}${timing('阶段未知',1404,1600,400,'unknown',1200)}</figure><div class="note">布局位于任务内部，按真实合成起止位置显示重叠；斜纹归因未知，不直接求和成关键路径。网络与CPU依赖不足时不确定“加载瓶颈”。</div><button id="trace-raw">查看任务原始字段</button></section><section class="panel"><h2>能力与缺失信息</h2><dl class="fact-grid"><dt>任务事实</dt><dd>可观察任务起终点</dd><dt>CPU profile</dt><dd>缺失 · 无法定位函数采样热点</dd><dt>交互事件</dt><dd>示例包含时间窗口，不能替代真实INP验收</dd><dt>帧事件</dt><dd>本例缺失，不能输出“0次掉帧”</dd></dl><div class="note warning">采样热点不是精确执行时间。缺失数据不显示虚构零值。</div><button data-page="actions">查看重新采集建议</button></section></div>`;
  }
  function comparePage() {
    const ab = state.source === 'ab';
    return `${heading(ab ? '正常 / 异常 A-B' : 'HAR + NetLog · 关联复核', ab ? '先检查可比性，再查看差异；差异本身不等于根因。' : '保留各来源事实，关联需要可验证的依据。')}${badge(ab ? '可比性不足 · 条件未对齐' : '弱关联 · 不提高根因等级','warn')}<div class="grid-equal" style="margin-top:20px"><section class="panel"><h2>${ab?'A · 正常示例':'HAR · 请求现象'}</h2><p class="mono">GET /api/projects</p><p>${ab?'请求完成 · 600ms':'status = 0 · ERR_CONNECTION_RESET'}</p><p class="muted">${ab?'网络条件：未记录代理状态':'同URL有两个请求，重定向顺序未充分确认'}</p></section><section class="panel"><h2>${ab?'B · 异常示例':'NetLog · 网络栈事实'}</h2><p class="mono">source.id = 101</p><p>${ab?'请求失败 · 1240ms':'REQUEST_ALIVE END · net_error = -101'}</p><p class="muted">${ab?'网络条件：不同复现时间，缺少同条件说明':'记录到最终重置；时间映射仍有不确定性'}</p></section></div><section class="panel" style="margin-top:18px"><h2>${ab?'差异与不能证明的部分':'候选匹配与冲突'}</h2><dl class="fact-grid"><dt>支持</dt><dd>${ab?'结果与耗时发生变化':'方法与路径相同'}</dd><dt>缺失</dt><dd>${ab?'相同操作、代理与缓存条件':'时间与重复URL的唯一匹配依据'}</dd><dt>未匹配</dt><dd>保留双方剩余请求，不伪造一一对应</dd><dt>结论</dt><dd>${ab?'仅描述差异，不能确认造成变化的原因':'独立事实均可复核；不确认为同一个请求'}</dd></dl><button data-jump="101">查看独立 NetLog 证据</button><button data-page="actions">记录采集条件</button></section>`;
  }
  function goPage() {
    return `${heading('Go 服务日志', '保留项目特定流程能力，适配共享工作区。')}<section class="panel"><h2>服务端流程示例</h2><p>服务日志支持服务侧结果与流程观察，不直接替代浏览器网络证据。</p><dl class="fact-grid"><dt>解析覆盖</dt><dd>示例：3/4行可识别；未识别行保留</dd><dt>流程结果</dt><dd>示例流程完成</dd><dt>不能证明</dt><dd>浏览器请求是否完成或网络责任方</dd></dl><div class="note">本轮不扩大到任意格式通用日志平台。</div></section>`;
  }
  function resultText() {
    return { 'not-run':'尚未执行。没有新的验证证据。', unchanged:'未观察到改善：该步骤没有支持恢复，不排除整个原因类别。下一步补充同条件证据。', worse:'情况变差：先停止本步骤并还原原条件，再联系 IT。结果不自动排除或确认任何原因。', improved:'问题改善：只支持继续验证该方向，不能自动确认根因。请在相同条件复采并对照。' }[state.outcome];
  }
  function actionPage() {
    const trace = state.source === 'trace';
    return `${heading('行动验证与交付', '先低风险观察，再用证据复核。用户反馈与机器事实分别记录。')}<div class="grid-two"><section class="panel"><div class="step-label">验证步骤 01 · ${trace?'前端工程师':'普通用户 / 一线支持'}</div><h2>${trace?'补采包含 profile 的同类交互':'保持设置不变，记录同条件复现'}</h2><dl class="fact-grid"><dt>验证命题</dt><dd>${trace?'是否存在重复函数采样热点':'相同条件下请求是否继续最终失败'}</dd><dt>前提</dt><dd>有权复现相同操作；遵守组织策略。不关闭防护，不清除认证数据。</dd><dt>改变条件</dt><dd>${trace?'只改变采集配置，不改变业务操作':'不改系统设置；重新执行同一个操作并记录复现时间'}</dd><dt>预期观察</dt><dd>是否改善、失败请求及错误是否相同，采集质量是否完整</dd><dt>能支持</dt><dd>重复现象或方向性线索</dd><dt>不能证明</dt><dd>重置责任主体或某设备是根因</dd><dt>回退</dt><dd>本步骤不改系统配置；出现变差立即停止复现，联系负责人。</dd></dl><div class="field"><label for="outcome">实际结果</label><select id="outcome">${[['not-run','尚未执行'],['unchanged','无变化'],['improved','有所改善'],['worse','情况变差']].map(([v,t])=>`<option value="${v}" ${state.outcome===v?'selected':''}>${t}</option>`).join('')}</select></div><div class="field"><label for="verification-note">观察备注（仅本次演示会话，不随示例导出）</label><textarea id="verification-note" placeholder="记录同类操作、时间与观察结果；不要填写令牌或个人信息。">${esc(state.note)}</textarea></div><div id="result-explanation" class="status-result">${resultText()}</div></section><div class="stack"><section class="panel"><h2>脱敏结果交付</h2><p>预览与演示下载使用相同允许字段。默认不包含 query、Headers、正文、原始日志和用户备注。</p><button class="primary" id="preview-export">预览脱敏报告</button></section><section class="panel"><h2>会话边界</h2><p class="muted">刷新会丢失演示验证记录。生产默认会话持久化方案待 D05 确认。</p><p class="muted">收到报告的人没有原文件时，只能阅读证据索引。</p></section></div></div>`;
  }
  function snapshot() {
    return { source:state.source,page:state.page,query:state.query,status:state.status,sort:state.sort,selected:state.selected,detail:state.detail,window:state.window,scroll:workspace.scrollTop };
  }
  function jump(id) {
    if (!requests.some(r => r.id === Number(id))) {
      openOverlay('目标请求不存在', missingTarget(id));
      return;
    }
    state.returnState = snapshot();
    state.temporary = Number(id);
    if (!['netlog','har'].includes(state.source)) state.source = 'netlog';
    document.getElementById('source').value = state.source;
    state.page = 'requests';state.selected=Number(id);state.detail=true;render();
  }
  function restore() {
    if (state.returnState) {
      const previous = state.returnState;
      Object.assign(state,previous);
      state.returnState=null;state.temporary=null;
      document.getElementById('source').value=state.source;
      render();workspace.scrollTop=previous.scroll;
    } else {state.temporary=null;state.detail=false;render();}
  }
  function openOverlay(title, content) {
    focusReturn = lastTrigger || document.activeElement;
    root.innerHTML = `<div class="overlay"><section class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1"><div class="detail-heading"><h2>${title}</h2><button id="close-overlay" aria-label="关闭面板">×</button></div>${content}</section></div>`;
    root.querySelector('#close-overlay').focus();
  }
  function closeOverlay(restoreFocus = true) {
    const wasOpen = Boolean(root.firstChild);
    root.innerHTML='';
    if (wasOpen && restoreFocus && focusReturn && focusReturn.isConnected) focusReturn.focus();
  }
  function raw(id) {
    const r = req(id);
    if (!r) { openOverlay('目标请求不存在', missingTarget(id)); return; }
    const data = { eventId:r.event,source:{id:r.id,type:'URL_REQUEST'},type:'REQUEST_ALIVE',phase:'END',timeMs:r.duration,params:{net_error:r.status==='failed'?-101:0} };
    openOverlay('原始事件 · 合成示例', `<p class="muted">事件ID / source.id 分开；生产位置使用原始字节偏移。</p><pre>${esc(JSON.stringify(data,null,2))}</pre><div class="note">本例为独立合成事件，无真实文件byteRange。不能用字符串位置伪装原始偏移。</div><h3>该事件支持什么</h3><p>支持请求自身最终结果。不确认服务器、代理或中间网络责任。</p><button data-jump="${r.id}">定位请求 ${r.id}</button>`);
  }
  function exportDTO() {
    const trace = state.source === 'trace';
    const compare = state.source === 'combined' || state.source === 'ab';
    const go = state.source === 'go';
    return { schema:'design-demo-1',dataKind:'synthetic',claimId:trace?'TRACE-DEMO-01':compare?'COMPARE-DEMO-01':go?'GO-DEMO-01':'CLAIM-DEMO-01',observation:trace?'示例主线程任务持续180ms':compare?'来源关联或采集可比性不足':go?'示例服务流程完成':'请求最终记录连接重置',scope:'本次合成示例',limitations:[trace?'CPU profile与帧事件缺失':compare?'不能据此确认同一请求或变化根因':go?'不能证明浏览器请求结果':'责任方未知','无原文件无法恢复原始内容'],evidence:trace?[{source:'trace-demo',taskId:'demo-task-01'}]:compare?[]:go?[{source:'go-demo',flowId:'demo-flow-01'}]:[{source:isHar()?'har-demo':'netlog-demo',requestId:101,eventId:isHar()?undefined:'demo-event-101-end'}],verification:{outcome:state.outcome,meaning:resultText()} };
  }
  function showExport() {
    openOverlay('脱敏交付预览 · 演示', `<p>以下是实际演示下载的全部允许字段。用户输入备注不进入该示例文件。</p><pre id="export-preview">${esc(JSON.stringify(exportDTO(),null,2))}</pre><div class="note">不含原始文件、完整URL、查询参数、Headers、正文、系统路径或个人标识。</div><button class="primary" id="download-demo">下载演示报告</button>`);
  }
  function toast(message) {
    const el = document.getElementById('toast');el.textContent=message;el.classList.add('visible');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),2500);
  }
  document.addEventListener('click', event => {
    const b = event.target.closest('button');if (!b) return;
    lastTrigger = b;
    if (b.dataset.page) navigate(b.dataset.page);
    else if (b.dataset.jump) { closeOverlay(false);jump(b.dataset.jump); }
    else if (b.dataset.select) {if (!req(b.dataset.select)) {openOverlay('目标请求不存在',missingTarget(b.dataset.select));return;}state.selected=Number(b.dataset.select);state.detail=true;render();document.getElementById('close-detail')?.focus();}
    else if (b.dataset.raw) raw(b.dataset.raw);
    else if (b.dataset.intent) {state.intent=b.dataset.intent;render();}
    else if (b.dataset.demo) {state.quality=b.dataset.demo;state.page=['corrupt','unsupported'].includes(state.quality)?'import':'overview';render();}
    else if (b.dataset.topic) {state.topic=b.dataset.topic;render();}
    else if (b.id === 'theme-toggle') {const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';b.textContent=dark?'深色主题':'浅色主题';}
    else if (b.id === 'close-detail') {state.detail=false;render();document.querySelector(`[data-select="${state.selected}"]`)?.focus();}
    else if (b.id === 'return-evidence') restore();
    else if (b.id === 'clear-filter') {state.query='';state.status='all';state.window='all';render();}
    else if (b.id === 'close-overlay') closeOverlay();
    else if (b.id === 'open-export' || b.id === 'preview-export') showExport();
    else if (b.id === 'cancel-demo') {state.quality='complete';toast('演示准备已取消，没有读取文件或产生新诊断。');}
    else if (b.id === 'trace-raw') openOverlay('Trace 任务原始字段 · 示例','<pre>taskId: demo-task-01\nstart: 1200ms\nend: 1380ms\nprofile: missing\nframeEvents: missing</pre><p>缺失字段为未知，不是零值。</p>');
    else if (b.id === 'download-demo') {
      const blob=new Blob([JSON.stringify(exportDTO(),null,2)],{type:'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='diagnosis-synthetic-demo.json';a.click();URL.revokeObjectURL(url);toast('已下载合成演示报告。');
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id==='search') {
      const cursor=event.target.selectionStart;state.query=event.target.value;render();
      const input=document.getElementById('search');input.focus();input.setSelectionRange(cursor,cursor);
    } else if (event.target.id==='verification-note') state.note=event.target.value;
  });
  document.addEventListener('change', event => {
    const {id,value}=event.target;
    if (id==='source') {
      Object.assign(state,{source:value,page:'overview',query:'',status:'all',sort:'duration',detail:false,temporary:null,returnState:null,window:'all'});
      closeOverlay(false);render();
    } else if (id==='status-filter') {state.status=value;render();}
    else if (id==='sort') {state.sort=value;render();}
    else if (id==='window') {state.window=value;render();}
    else if (id==='outcome') {state.outcome=value;document.getElementById('result-explanation').textContent=resultText();}
  });
  document.addEventListener('keydown', event => {
    if (event.key==='Escape') {
      if (root.firstChild) closeOverlay();
      else if (state.detail) {state.detail=false;render();document.querySelector(`[data-select="${state.selected}"]`)?.focus();}
    }
    if (event.key==='Tab' && root.firstChild) {
      const items=[...root.querySelectorAll('button,a[href],input,select,textarea')];
      if (event.shiftKey && document.activeElement===items[0]) {event.preventDefault();items.at(-1)?.focus();}
      else if (!event.shiftKey && document.activeElement===items.at(-1)) {event.preventDefault();items[0]?.focus();}
    }
  });
  render();
})();
