负责人已撤销此前默认匿名分享决定：恢复原出口支持的真实诊断数据和旧 JSON 结构，保留 CSV 编码、公式保护及完整导出预览修复。本 PR 继续 Draft，仅处理 P0-A。

## Why

- Forced aliases and hidden fields reduced the usefulness of a local diagnostic tool.
- The owner explicitly superseded the earlier safe-sharing v1 / metadata product decisions. Preserve historical review records without treating them as the current export contract.

## Changes

- Restore the pre-P0-A NetLog and Go JSON contracts by default, real request/proxy/error values, original Go IDs, Headers/Body/BodyRaw and raw TXT lines.
- Remove the sharing sanitizer, address aliases, redactions projection, sharing schema and sharing/expert mode UI/cache.
- Restore existing NetLog reports, evidence packages, HAR summaries, Trace and IT handoff paths without the added anonymization layer. Keep their pre-existing content policies and bounded DTOs.
- Retain CSV BOM, quoting/newline and formula defenses; zero/negative errors, recorded times and optional values; complete copy/download; bounded DOM preview; cancellation/reset/stale-snapshot guards; Trace whitelist and identity/reference integrity.
- Do not change parsers, Worker/Dataset behavior, diagnostic rules, dependencies or Feature Flags.

## Validation

- Five restoration regressions failed before implementation; final targeted run: 12 suites / 157 tests passed.
- Full Jest: 211 suites / 1758 tests passed; 4 existing suites / 12 tests remain skipped.
- `npm run lint`, `npm run typecheck`, Trace-enabled production build passed.
- Legacy synthetic fixture/consumer verification passed; independent CSV reader: 45 checks passed.
- 50,000 synthetic requests: full JSON 16,483,933 characters, DOM preview 32,768; Node/JSDOM JSON generation 38.39ms, opening 6.68ms. These are observations, not browser or real-file performance acceptance.

## Compatibility / limitations

- Default JSON returns to the original root and field types. The withdrawn anonymized v1 data/redactions layout is intentionally no longer supported by product exports.
- Pre-existing HAR query/hash/body omissions, Trace whitelist and report-specific handling remain; no new full raw-event/body reads.
- Local checks used Node 24.13.0; GitHub CI uses the repository's Node 20 workflow. Current-head CI must be checked separately.
- Real samples, actual downstream consumers and 500/800MB acceptance have not run. Safe Edge / Excel acceptance remains blocked; no private profile or keychain access.
- Details and test-by-test migration: [restoration record](https://github.com/WLWadmin/netlog-analyzer-react/blob/fix/export-sharing-safety/reviews/p0-a/diagnostic-export-restoration.md).
- Historical reviews remain available. This is not independent approval of the new implementation. Keep Draft; do not mark Ready, merge or deploy.
