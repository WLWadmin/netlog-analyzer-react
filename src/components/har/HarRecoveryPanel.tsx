import { Alert, Table } from 'antd';
import type { HarRepairInfo, HarExcludedEntry } from '../../utils/harRepair';

export default function HarRecoveryPanel({ info }: { info: HarRepairInfo }) {
  if (!info.repaired) return null;
  return (
    <Alert
      type="warning"
      showIcon
      message={info.reason}
      description={
        <div className="har-repair-detail">
          {info.totalEntriesExact === true ? (
            <div>完整请求保留比例：{info.recoveryRate}% · {info.recoveredEntries}/{info.totalEntries} 条</div>
          ) : <div>至少恢复 {info.recoveredEntries} 条完整请求；原始总数无法确认。</div>}
          {info.warnings.map((warning, index) => <div key={index}>{warning}</div>)}
          {info.heuristicResynchronization ? <div>存在启发式重新同步；未知片段之后不推测原始请求序号。</div> : null}
          {info.excludedEntries?.length ? (
            <details>
              <summary>未参与分析的请求 / 未恢复片段（{info.excludedEntries.length} 项）</summary>
              <Table<HarExcludedEntry>
                tableLayout="fixed"
                scroll={{ x: 1000 }}
                size="small"
                rowKey={item => String(item.charStart)}
                dataSource={info.excludedEntries}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                columns={[
                  {
                    title: '原始请求序号', key: 'ordinal', width: 135,
                    render: (_, item) => item.originalEntryIndex === undefined
                      ? '未恢复片段 / 序号未知' : `第 ${item.originalEntryIndex + 1} 条`,
                  },
                  {
                    title: '请求地址', key: 'url',
                    render: (_, item) => <div style={{ overflowWrap: 'anywhere' }}>
                      {item.safeUrl || '请求地址无法可靠恢复'}
                      {item.urlBasis ? <div>依据：独立解析的 request.url（已隐藏查询参数等）</div> : null}
                    </div>,
                  },
                  { title: '异常类型', dataIndex: 'reason', key: 'reason' },
                  {
                    title: '原始位置', key: 'position',
                    render: (_, item) => `第 ${item.line} 行，第 ${item.column} 列`,
                  },
                  {
                    title: '处理结果 / 详情', key: 'detail',
                    render: (_, item) => <details>
                      <summary>已隔离，未参与诊断 · 查看本地异常区域</summary>
                      <div>字符偏移 {item.charStart}–{item.charEnd}（UTF-16，末端不含；非字节偏移）</div>
                      <div>原始区域前 600 字符的结构预览；字段名和值均已脱敏。</div>
                      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 200, overflow: 'auto' }}>
                        {item.structuralPreview}
                      </pre>
                    </details>,
                  },
                ]}
              />
            </details>
          ) : null}
        </div>
      }
    />
  );
}
