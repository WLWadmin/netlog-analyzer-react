import {
  useEffect,
  useRef,
  useState,
} from 'react';
import type { TraceWorkbenchClient } from '../../../workbench/client';
import type {
  CustomQueryResultResponse,
  WorkbenchCustomQuery,
  WorkbenchCustomQueryClause,
} from '../../../workbench/protocol';

interface CustomQueryPanelProps {
  client: TraceWorkbenchClient;
  range: { startUs: number; endUs: number };
  onFocusRange(range: { startUs: number; endUs: number }): void;
  onOpenEvent(eventId: string): void;
}

type QueryField = WorkbenchCustomQueryClause['field'];

interface EditableClause {
  id: number;
  field: QueryField;
  operator: string;
  value: string;
}

const FIELD_LABELS: Record<QueryField, string> = {
  name: '名称',
  category: '分类',
  trackId: '轨道',
  status: '状态',
  durationUs: '持续时间',
};
const QUERY_FIELDS: QueryField[] = [
  'name',
  'category',
  'trackId',
  'status',
  'durationUs',
];

const STATUS_VALUES = [
  'normal',
  'warning',
  'error',
  'incomplete',
  'candidate',
] as const;

function defaultClause(id: number): EditableClause {
  return {
    id,
    field: 'name',
    operator: 'contains',
    value: 'Task',
  };
}

function operators(field: QueryField): string[] {
  if (field === 'durationUs') return ['equals', 'gte', 'lte'];
  if (field === 'status') return ['equals'];
  return ['equals', 'contains'];
}

function queryField(value: string): QueryField | undefined {
  return QUERY_FIELDS.find(field => field === value);
}

function toQuery(clauses: EditableClause[]): WorkbenchCustomQuery | undefined {
  const result: WorkbenchCustomQueryClause[] = [];
  for (const clause of clauses) {
    if (clause.field === 'durationUs') {
      const value = Number(clause.value);
      if (!Number.isFinite(value) || value < 0) return undefined;
      const operator = clause.operator === 'gte' || clause.operator === 'lte'
        ? clause.operator
        : 'equals';
      result.push({ field: 'durationUs', operator, value });
    } else if (clause.field === 'status') {
      const value = STATUS_VALUES.find(status => status === clause.value);
      if (!value) return undefined;
      result.push({ field: 'status', operator: 'equals', value });
    } else {
      if (!clause.value || clause.value.length > 128) return undefined;
      result.push({
        field: clause.field,
        operator: clause.operator === 'equals' ? 'equals' : 'contains',
        value: clause.value,
      });
    }
  }
  return { clauses: result };
}

const CustomQueryPanel: React.FC<CustomQueryPanelProps> = ({
  client,
  range,
  onFocusRange,
  onOpenEvent,
}) => {
  const [clauses, setClauses] = useState<EditableClause[]>([defaultClause(1)]);
  const [nextId, setNextId] = useState(2);
  const [response, setResponse] = useState<CustomQueryResultResponse>();
  const [state, setState] = useState<
    'idle' | 'loading' | 'invalid' | 'unavailable' | 'failed'
  >('idle');
  const requestSequence = useRef(0);

  useEffect(() => {
    requestSequence.current += 1;
    setResponse(undefined);
    setState('idle');
  }, [range.endUs, range.startUs]);

  useEffect(() => {
    requestSequence.current += 1;
    setResponse(undefined);
    setState('idle');
  }, [clauses]);

  const updateClause = (
    id: number,
    update: Partial<Omit<EditableClause, 'id'>>,
  ) => {
    setClauses(current => current.map(clause => {
      if (clause.id !== id) return clause;
      const next = { ...clause, ...update };
      if (update.field) {
        next.operator = operators(update.field)[0];
        next.value = update.field === 'status'
          ? 'normal'
          : update.field === 'durationUs' ? '0' : '';
      }
      return next;
    }));
  };

  const run = async () => {
    const query = toQuery(clauses);
    if (!query) {
      setState('invalid');
      setResponse(undefined);
      return;
    }
    const sequence = ++requestSequence.current;
    setState('loading');
    setResponse(undefined);
    try {
      const result = await client.queryCustomEvents(range, query, 2_000);
      if (sequence !== requestSequence.current) return;
      if (result?.type === 'custom-query-result') {
        setResponse(result);
        setState('idle');
      } else if (
        result?.type === 'structured-error'
        && result.error.code === 'unsupported-capability'
      ) {
        setState('unavailable');
      } else {
        setState('failed');
      }
    } catch {
      if (sequence === requestSequence.current) setState('failed');
    }
  };

  return (
    <section className="trace-advanced-panel" aria-labelledby="trace-custom-query-heading">
      <h3 id="trace-custom-query-heading">声明式自定义查询</h3>
      <p>条件使用 AND 语义，仅查询当前选区或视口的白名单事件字段。</p>
      <div className="trace-custom-query-clauses">
        {clauses.map(clause => (
          <div key={clause.id}>
            <label>
              查询字段
              <select
                aria-label="查询字段"
                value={clause.field}
                onChange={event => {
                  const field = queryField(event.target.value);
                  if (field) updateClause(clause.id, { field });
                }}
              >
                {QUERY_FIELDS.map(value => (
                  <option key={value} value={value}>{FIELD_LABELS[value]}</option>
                ))}
              </select>
            </label>
            <label>
              查询操作符
              <select
                aria-label="查询操作符"
                value={clause.operator}
                onChange={event => updateClause(
                  clause.id,
                  { operator: event.target.value },
                )}
              >
                {operators(clause.field).map(operator => (
                  <option key={operator} value={operator}>{operator}</option>
                ))}
              </select>
            </label>
            <label>
              查询值
              {clause.field === 'status' ? (
                <select
                  aria-label="查询值"
                  value={clause.value}
                  onChange={event => updateClause(
                    clause.id,
                    { value: event.target.value },
                  )}
                >
                  {STATUS_VALUES.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label="查询值"
                  type={clause.field === 'durationUs' ? 'number' : 'text'}
                  min={clause.field === 'durationUs' ? 0 : undefined}
                  maxLength={clause.field === 'durationUs' ? undefined : 128}
                  value={clause.value}
                  onChange={event => updateClause(
                    clause.id,
                    { value: event.target.value },
                  )}
                />
              )}
            </label>
            <button
              type="button"
              aria-label="删除查询条件"
              disabled={clauses.length === 1}
              onClick={() => setClauses(current => (
                current.filter(item => item.id !== clause.id)
              ))}
            >
              删除
            </button>
          </div>
        ))}
      </div>
      <div className="trace-advanced-actions">
        <button
          type="button"
          aria-label="添加查询条件"
          disabled={clauses.length >= 8}
          onClick={() => {
            setClauses(current => [...current, defaultClause(nextId)]);
            setNextId(value => value + 1);
          }}
        >
          添加条件
        </button>
        <button type="button" aria-label="运行自定义查询" onClick={run}>
          运行查询
        </button>
      </div>
      <div aria-live="polite">
        {state === 'loading' && <p>正在查询当前范围…</p>}
        {state === 'invalid' && <p role="alert">查询条件无效，请检查值和长度。</p>}
        {state === 'unavailable' && <p>能力不可用：Stage 6 声明式查询未启用。</p>}
        {state === 'failed' && <p role="alert">自定义查询失败，当前时间轴仍可使用。</p>}
        {response && response.events.length === 0 && (
          <p>当前查询没有匹配事件。</p>
        )}
        {response?.truncation.truncated && (
          <p>
            结果已截断，共匹配 {response.truncation.totalMatched} 个事件；
            请缩小范围继续检查。
          </p>
        )}
        {response && response.limitations.length > 0 && (
          <p>{response.limitations.join(' ')}</p>
        )}
      </div>
      {response && response.events.length > 0 && (
        <ol>
          {response.events.map(event => (
            <li key={event.id}>
              <span>{event.name} · {event.durationUs} μs</span>
              <button
                type="button"
                aria-label={`定位 ${event.name}`}
                onClick={() => onFocusRange({
                  startUs: event.startUs,
                  endUs: event.startUs + event.durationUs,
                })}
              >
                定位
              </button>
              <button
                type="button"
                aria-label={`打开 ${event.name} 详情`}
                onClick={() => onOpenEvent(event.id)}
              >
                打开详情
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

export default CustomQueryPanel;
