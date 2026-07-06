# NetLog 真实样本 benchmark evidence

日期：2026-07-06

样本：`chrome-net-export-log_副本.json`

样本大小：326,930,225 bytes

## 结论

同一真实 NetLog 样本的 `dataset-import` 与 `upload-single-scan` browser benchmark 均已跑通，Dataset 事件数一致：

```text
datasetEventCount = 2,235,117
```

轻量事件 parse skip 在真实样本中命中明显：

```text
lightweightParseSkippedEvents = 2,179,162
lightweightParseSkippedBytes = 309,143,756
lightweightParseSkipRate = 0.975
```

Sockets lazy params probe 在真实样本中全部命中：

```text
socketLazyProbeAttemptedEvents = 7,699
socketLazyProbeSatisfiedEvents = 7,699
socketLazyFallbackParamEvents = 0
socketLazyProbeSatisfiedRate = 1
```

Phase 6 仍不建议默认开启 single scan，原因不是功能门禁失败，而是只跑了一个真实样本，且同环境内存估算显示 single-scan 高于 dataset-import baseline。

## Browser benchmark 对比

| 指标 | dataset-import | upload-single-scan |
|---|---:|---:|
| fileSize | 326,930,225 | 326,930,225 |
| datasetEventCount | 2,235,117 | 2,235,117 |
| datasetImportMs | 7,917 | 0 |
| datasetReadyMs | - | 7,782 |
| uploadToFirstDiagnosisMs | - | 7,782 |
| queryP95 | 11 | 12 |
| detailP95 | 1 | 0 |
| rawSearchWorstCaseMs | 156 | 155 |
| rawSearchFilteredMs | 15 | 16 |
| memoryPeakEstimateMb | 10 | 22 |
| mainThreadBlockedMs | 0 | 0 |
| rafMaxDelayMs | 1 | 16 |

## Raw evidence

Raw detail 读回和 byte range 校验通过：

```text
rawDetailReadbackOk = true
rawDetailRowsHaveByteRange = true
rawDetailCheckedEventIds = [0, 50, 2235116]
```

Raw search guard 命中预期：

```text
rawSearchWorstCaseHasMoreMatchesUnknown = true
rawSearchFilteredHasMoreMatchesUnknown = false
```

## DNS answer 差异

DNS answer endpoint 与 DNS State 口径基本一致，只剩 1 条 endpoint-only：

```text
dnsAnswerEndpointCount = 248
dnsAnswerStateCount = 247
dnsAnswerBothCount = 247
dnsAnswerEndpointOnlyCount = 1
dnsAnswerStateOnlyCount = 0
dnsAnswerStateMissingTraceCount = 0
```

这说明旧 summary `dnsAnswerCount = 41` 不是完整候选集合；Dataset/Endpoint/DNS State 现在能暴露更完整的 host/ip pair 证据。

## Socket source graph

Socket peer source graph 关联率：

```text
socketPeerTotal = 598
socketPeerSourceGraphAssociated = 328
socketPeerGlobalCandidate = 270
socketPeerAssociationRate = 0.5485
socketPeerUnresolvedRate = 0.4515
socketPeerHostTimeCandidate = 0
```

未解析原因：

```text
sourceGraphNoUrlRequest = 264
noSourceLink = 6
```

剩余 global candidate 主要来自：

```text
UDP_CONNECT = 132
SOCKET_CONNECT = 132
UDP_BYTES_RECEIVED = 6
```

这说明当前不会再用 host-time 近邻强行关联 socket peer，但仍有 UDP/socket source 无 URL_REQUEST 链路，需要作为候选事实保留。

## Phase 6 决策

基于 dataset-import baseline 与 upload-single-scan 的合并 evidence：

```text
recommendation = keep-disabled
```

主要 blockers：

```text
multiSampleEvidenceMissing
singleScanMemoryHigherThanBaseline
```

已经满足的关键 gates：

```text
datasetEventCountMatchesExpected
singleScanDatasetReady
noBackgroundDatasetImportExpected
singleCompleteEventScan
rawDetailReadbackAndByteRangeOk
rawSearchGuardVerified
dnsDiffReported
noHostTimeSocketPeerCandidate
diagnosisGuardHasNoForbiddenConfirmedMatches
lightweightParseSkipMeasured
socketLazyParamsStatsMeasured
```

仍需补充：

```text
Run the same evidence package on at least one more real NetLog sample.
Collect baseline and single-scan memoryPeakEstimateMb in the same run environment.
```

## 后续建议

1. 用第二个真实 NetLog 样本跑同一组 benchmark，满足 multi-sample evidence。
2. 复核 browser `memoryPeakEstimateMb` 在 headless Edge 下的稳定性；当前 single-scan 为 22MB，dataset-import 为 10MB，比例超过 1.2x 门槛。
3. 因 `socketLazyProbeSatisfiedRate = 1`，可以进入下一刀 `socket event 专用 early reducer path`，但仍应保持只针对 socket event 的小范围试点。
