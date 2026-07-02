export type {
  IpScope,
  IpEvidenceRole,
  IpEvidenceSource,
  RequestImpact,
  IpEvidenceItem,
  CipSipEvidenceRow,
  DnsServerEvidence,
  DnsAnswerEvidence,
  DohCandidateEvidence,
  DnsIpEvidenceSummary,
} from './ipEvidenceTypes';

export { normalizeIp, classifyIpScope } from './ipNormalize';
export { classifyDnsServer } from './classifyDnsServer';
export {
  extractDnsIpEvidenceFromHar,
  extractDnsIpEvidenceFromNetlog,
} from './extractDnsIpEvidence';
export {
  buildIpListText,
  buildCipSipRowsText,
  buildDnsIpEvidenceCopyText,
} from './buildCopyText';
export type {
  IpLookupStatus,
  IpLookupResult,
  IpLookupState,
  LookupIpContext,
  IpRoutingConclusion,
  IpLookupBatchSummary,
} from './ipLookupTypes';
export {
  DEFAULT_IP_LOOKUP_PROXY_URL,
  lookupIpViaProxy,
  lookupCurrentClientIp,
  lookupIpsWithLimit,
  shouldLookupIp,
  resetIpLookupBudgetForTest,
} from './ipLookupClient';
export {
  buildIpLookupConclusions,
  compareCipSipCarriersInRow,
  collectRowLookupIps,
  formatIpLocation,
  getCarrierDisplayName,
  getCarrierGroup,
} from './ipLookupDiagnosis';
export { parseManualIps } from './manualIpInput';
