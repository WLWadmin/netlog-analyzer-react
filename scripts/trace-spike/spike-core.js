'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SAMPLE_IDS = [
  'TRACE-SAMPLE-01',
  'TRACE-SAMPLE-02',
  'TRACE-SAMPLE-03',
  'TRACE-SAMPLE-04',
  'TRACE-SAMPLE-05',
];

const SAMPLE_CAPABILITIES = [
  'navigation-context',
  'page-milestones',
  'network-lifecycle',
  'network-initiators',
  'renderer-tasks',
  'multi-process-attribution',
  'interactions',
  'rendering-frames',
];

const REQUIRED_CAPABILITIES = [
  ...SAMPLE_CAPABILITIES,
  'project-fact-isolation',
  'worker-runtime',
  'cra-jest-compatibility',
  'deterministic-output',
  'privacy-boundary',
];

const OPTIONAL_CAPABILITIES = [
  'cpu-profile-samples',
  'forced-reflow-warning',
  'layout-shift-insight',
  'selective-handlers',
  'raw-array-input',
  'advanced-insights',
  'source-location-detail',
];

const CAPACITY_ROLES = ['functional', 'near-limit', 'stress-observation'];
const CAPABILITY_STATUSES = [
  'available',
  'sample-missing',
  'adapter-risk',
  'engine-missing',
  'environment-incompatible',
  'unavailable-optional',
];
const DEPENDENCY_TREE_WARNING_CODES = [
  'UNRELATED_PROJECT_DEPENDENCY_PROBLEMS',
];

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertAllowedKeys(value, allowedKeys, label) {
  const unknown = Object.keys(value).filter(key => !allowedKeys.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unknown.join(', ')}`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`${label} must be a non-empty string array`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
}

function validateManifest(manifest) {
  assertPlainObject(manifest, 'manifest');
  assertAllowedKeys(manifest, ['schemaVersion', 'samples'], 'manifest');
  if (manifest.schemaVersion !== 1) {
    throw new Error('manifest.schemaVersion must be 1');
  }
  if (!Array.isArray(manifest.samples) || manifest.samples.length !== SAMPLE_IDS.length) {
    throw new Error(`manifest.samples must contain exactly ${SAMPLE_IDS.length} samples`);
  }

  const seenIds = new Set();
  const coveredCapabilities = new Set();
  const samples = manifest.samples.map((sample, index) => {
    const label = `manifest.samples[${index}]`;
    assertPlainObject(sample, label);
    assertAllowedKeys(
      sample,
      ['id', 'inputRef', 'expectedEventFamilies', 'positiveCapabilities', 'capacityRole'],
      label,
    );
    if (!SAMPLE_IDS.includes(sample.id)) {
      throw new Error(`${label}.id must be a declared TRACE-SAMPLE alias`);
    }
    if (seenIds.has(sample.id)) {
      throw new Error(`${label}.id must be unique`);
    }
    seenIds.add(sample.id);
    if (typeof sample.inputRef !== 'string' || sample.inputRef.length === 0) {
      throw new Error(`${label}.inputRef must be a non-empty runtime reference`);
    }
    assertStringArray(sample.expectedEventFamilies, `${label}.expectedEventFamilies`);
    assertStringArray(sample.positiveCapabilities, `${label}.positiveCapabilities`);
    for (const capability of sample.positiveCapabilities) {
      if (!SAMPLE_CAPABILITIES.includes(capability)) {
        throw new Error(`${label}.positiveCapabilities contains unknown capability: ${capability}`);
      }
      coveredCapabilities.add(capability);
    }
    if (!CAPACITY_ROLES.includes(sample.capacityRole)) {
      throw new Error(`${label}.capacityRole is invalid`);
    }
    return {
      id: sample.id,
      inputRef: sample.inputRef,
      expectedEventFamilies: [...sample.expectedEventFamilies],
      positiveCapabilities: [...sample.positiveCapabilities],
      capacityRole: sample.capacityRole,
    };
  });

  const missingCoverage = SAMPLE_CAPABILITIES.filter(capability => !coveredCapabilities.has(capability));
  if (missingCoverage.length > 0) {
    throw new Error(`manifest lacks positive samples for: ${missingCoverage.join(', ')}`);
  }
  for (const sampleId of SAMPLE_IDS) {
    if (!seenIds.has(sampleId)) {
      throw new Error(`manifest is missing sample alias: ${sampleId}`);
    }
  }
  return { schemaVersion: 1, samples };
}

function buildPseudonymMap(factSets) {
  const hosts = new Set();
  const paths = new Set();
  for (const facts of factSets) {
    for (const request of Array.isArray(facts.requests) ? facts.requests : []) {
      const parsed = parseUrl(request.url);
      if (!parsed) continue;
      hosts.add(parsed.host);
      paths.add(parsed.pathname);
    }
  }
  return {
    hosts: new Map([...hosts].sort().map((value, index) => [value, `host-${String(index + 1).padStart(3, '0')}`])),
    paths: new Map([...paths].sort().map((value, index) => [value, `path-${String(index + 1).padStart(3, '0')}`])),
  };
}

function parseUrl(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = new URL(value);
    return {
      scheme: parsed.protocol.replace(/:$/, ''),
      host: parsed.host,
      pathname: parsed.pathname || '/',
    };
  } catch (_error) {
    return undefined;
  }
}

function pseudonymizeUrl(value, aliases) {
  const parsed = parseUrl(value);
  if (!parsed) return undefined;
  return {
    scheme: parsed.scheme,
    hostLabel: aliases.hosts.get(parsed.host),
    pathLabel: aliases.paths.get(parsed.pathname),
  };
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : undefined;
}

function cleanObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function stableSort(items, keyBuilder) {
  return [...items].sort((left, right) => keyBuilder(left).localeCompare(keyBuilder(right)));
}

function normalizeFacts(facts, aliases) {
  assertPlainObject(facts, 'facts');
  const navigations = stableSort(
    (Array.isArray(facts.navigations) ? facts.navigations : []).map(item => cleanObject({
      key: String(item.key || ''),
      frameKey: String(item.frameKey || ''),
      processId: finiteNumber(item.processId),
      threadId: finiteNumber(item.threadId),
      startUs: finiteNumber(item.startUs),
      endUs: finiteNumber(item.endUs),
      processCount: finiteNumber(item.processCount),
    })),
    item => `${item.key}\u0000${item.frameKey}\u0000${item.startUs}`,
  );

  const requests = stableSort(
    (Array.isArray(facts.requests) ? facts.requests : []).map(item => {
      const url = pseudonymizeUrl(item.url, aliases);
      const stableSeed = canonicalStringify({
        navigationKey: String(item.navigationKey || ''),
        redirectIndex: finiteNumber(item.redirectIndex) || 0,
        startUs: finiteNumber(item.startUs),
        url,
      });
      return cleanObject({
        evidenceId: `request-${sha256(stableSeed).slice(0, 16)}`,
        requestKey: String(item.requestKey || ''),
        navigationKey: String(item.navigationKey || ''),
        redirectIndex: finiteNumber(item.redirectIndex) || 0,
        result: String(item.result || 'unknown'),
        statusCode: finiteNumber(item.statusCode),
        startUs: finiteNumber(item.startUs),
        endUs: finiteNumber(item.endUs),
        url,
        initiatorKey: typeof item.initiatorKey === 'string' ? item.initiatorKey : undefined,
      });
    }),
    item => `${item.navigationKey}\u0000${item.startUs}\u0000${item.redirectIndex}\u0000${item.evidenceId}`,
  );

  const milestones = stableSort(
    (Array.isArray(facts.milestones) ? facts.milestones : []).map(item => cleanObject({
      navigationKey: String(item.navigationKey || ''),
      name: String(item.name || ''),
      relativeUs: finiteNumber(item.relativeUs),
      candidate: item.candidate === true,
    })),
    item => `${item.navigationKey}\u0000${item.name}\u0000${item.relativeUs}`,
  );

  const mainThreadTasks = stableSort(
    (Array.isArray(facts.mainThreadTasks) ? facts.mainThreadTasks : []).map(item => cleanObject({
      navigationKey: String(item.navigationKey || ''),
      processId: finiteNumber(item.processId),
      threadId: finiteNumber(item.threadId),
      startUs: finiteNumber(item.startUs),
      durationMs: finiteNumber(item.durationMs),
      selfTimeMs: finiteNumber(item.selfTimeMs),
    })),
    item => `${item.navigationKey}\u0000${item.processId}\u0000${item.threadId}\u0000${item.startUs}`,
  );

  const interactions = stableSort(
    (Array.isArray(facts.interactions) ? facts.interactions : []).map(item => cleanObject({
      interactionKey: String(item.interactionKey || ''),
      navigationKey: String(item.navigationKey || ''),
      startUs: finiteNumber(item.startUs),
      inputDelayMs: finiteNumber(item.inputDelayMs),
      processingMs: finiteNumber(item.processingMs),
      presentationMs: finiteNumber(item.presentationMs),
    })),
    item => `${item.navigationKey}\u0000${item.startUs}\u0000${item.interactionKey}`,
  );

  const frames = stableSort(
    (Array.isArray(facts.frames) ? facts.frames : []).map(item => cleanObject({
      navigationKey: String(item.navigationKey || ''),
      startUs: finiteNumber(item.startUs),
      durationMs: finiteNumber(item.durationMs),
      dropped: item.dropped === true,
    })),
    item => `${item.navigationKey}\u0000${item.startUs}\u0000${item.durationMs}`,
  );

  const capabilityAvailability = {};
  const rawAvailability = facts.capabilityAvailability || {};
  for (const capability of [...REQUIRED_CAPABILITIES, ...OPTIONAL_CAPABILITIES].sort()) {
    if (typeof rawAvailability[capability] === 'string') {
      capabilityAvailability[capability] = rawAvailability[capability];
    }
  }

  return {
    navigations,
    requests,
    milestones,
    mainThreadTasks,
    interactions,
    frames,
    capabilityAvailability,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
  );
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function summarizeFacts(facts) {
  const requestResults = {};
  for (const request of facts.requests) {
    requestResults[request.result] = (requestResults[request.result] || 0) + 1;
  }
  return {
    navigationKeys: facts.navigations.map(item => item.key),
    requestCount: facts.requests.length,
    requestResults,
    milestones: facts.milestones.map(item => `${item.navigationKey}:${item.name}:${item.relativeUs}`),
    taskCount: facts.mainThreadTasks.length,
    interactionCount: facts.interactions.length,
  };
}

function compareStability(rawRuns) {
  if (!Array.isArray(rawRuns) || rawRuns.length !== 3) {
    throw new Error('stability comparison requires exactly three runs');
  }
  const aliases = buildPseudonymMap(rawRuns);
  const normalizedRuns = rawRuns.map(facts => normalizeFacts(facts, aliases));
  const hashes = normalizedRuns.map(facts => sha256(canonicalStringify(facts)));
  const summaries = normalizedRuns.map(summarizeFacts);
  const stable = hashes.every(hash => hash === hashes[0])
    && summaries.every(summary => canonicalStringify(summary) === canonicalStringify(summaries[0]));
  return { stable, hashes, summaries, normalizedRuns };
}

function validateCapabilityResults(capabilities) {
  assertPlainObject(capabilities, 'capabilities');
  const allowedCapabilities = [...REQUIRED_CAPABILITIES, ...OPTIONAL_CAPABILITIES];
  for (const [capability, result] of Object.entries(capabilities)) {
    if (!allowedCapabilities.includes(capability)) {
      throw new Error(`unknown capability result: ${capability}`);
    }
    assertPlainObject(result, `capabilities.${capability}`);
    assertAllowedKeys(result, ['status', 'positiveSamples', 'reasonCode'], `capabilities.${capability}`);
    if (!CAPABILITY_STATUSES.includes(result.status)) {
      throw new Error(`capabilities.${capability}.status is invalid`);
    }
    if (result.positiveSamples !== undefined) {
      if (!Array.isArray(result.positiveSamples) || result.positiveSamples.some(id => !SAMPLE_IDS.includes(id))) {
        throw new Error(`capabilities.${capability}.positiveSamples is invalid`);
      }
    }
  }
}

function decideSpike(input) {
  assertPlainObject(input, 'decision input');
  const capabilities = input.capabilities || {};
  validateCapabilityResults(capabilities);

  const missingSamples = [...(input.missingSamples || [])];
  const unresolvedLicenses = [...(input.unresolvedLicenses || [])];
  const unverifiedCapacity = [...(input.unverifiedCapacity || [])];
  const privacyScanFailures = [...(input.privacyScanFailures || [])];
  const environmentFailures = [...(input.environmentFailures || [])];
  if (!Number.isFinite(input.validatedMaxJsonBytes) || input.validatedMaxJsonBytes <= 0) {
    unverifiedCapacity.push('validatedMaxJsonBytes must be a positive finite number');
  }
  const blockingCapabilityGaps = REQUIRED_CAPABILITIES.filter(capability => {
    const status = capabilities[capability]?.status;
    return status === 'engine-missing' || status === 'environment-incompatible';
  });

  if (
    missingSamples.length > 0
    || unresolvedLicenses.length > 0
    || unverifiedCapacity.length > 0
    || privacyScanFailures.length > 0
  ) {
    return {
      result: 'BLOCKED_NEEDS_EVIDENCE',
      missingSamples,
      unresolvedLicenses,
      unverifiedCapacity,
      privacyScanFailures,
    };
  }

  if (environmentFailures.length > 0 || blockingCapabilityGaps.length > 0) {
    return {
      result: 'FAIL_USE_MINIMAL_AGGREGATOR',
      blockingCapabilityGaps,
      environmentFailures,
    };
  }

  const incompleteRequired = REQUIRED_CAPABILITIES.filter(capability => {
    const status = capabilities[capability]?.status;
    return status !== 'available' && status !== 'adapter-risk';
  });
  if (incompleteRequired.length > 0) {
    return {
      result: 'BLOCKED_NEEDS_EVIDENCE',
      missingSamples: [],
      unresolvedLicenses: [],
      unverifiedCapacity: [`required capability results incomplete: ${incompleteRequired.join(', ')}`],
      privacyScanFailures: [],
    };
  }

  return {
    result: 'PASS_RECOMMEND_ENGINE',
    validatedMaxJsonBytes: input.validatedMaxJsonBytes,
    acceptedAdapterRisks: REQUIRED_CAPABILITIES.filter(
      capability => capabilities[capability]?.status === 'adapter-risk',
    ),
    unavailableOptionalCapabilities: OPTIONAL_CAPABILITIES.filter(
      capability => capabilities[capability]?.status === 'unavailable-optional',
    ),
  };
}

function optionalString(value) {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value) {
  return Number.isFinite(value) ? value : undefined;
}

function stringList(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

function projectCapabilityMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const projected = {};
  for (const capability of [...REQUIRED_CAPABILITIES, ...OPTIONAL_CAPABILITIES]) {
    const item = value[capability];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    projected[capability] = cleanObject({
      status: optionalString(item.status),
      positiveSamples: stringList(item.positiveSamples).filter(id => SAMPLE_IDS.includes(id)),
      reasonCode: optionalString(item.reasonCode),
    });
  }
  return projected;
}

function projectDecision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return cleanObject({
    result: optionalString(value.result),
    validatedMaxJsonBytes: optionalNumber(value.validatedMaxJsonBytes),
    acceptedAdapterRisks: stringList(value.acceptedAdapterRisks),
    unavailableOptionalCapabilities: stringList(value.unavailableOptionalCapabilities),
    blockingCapabilityGaps: stringList(value.blockingCapabilityGaps),
    environmentFailures: stringList(value.environmentFailures),
    missingSamples: stringList(value.missingSamples),
    unresolvedLicenses: stringList(value.unresolvedLicenses),
    unverifiedCapacity: stringList(value.unverifiedCapacity),
    privacyScanFailures: stringList(value.privacyScanFailures),
  });
}

function projectReport(input) {
  assertPlainObject(input, 'report');
  const prd = input.prd || {};
  const candidate = input.candidate || {};
  const environment = input.environment || {};
  const methods = input.methods || {};
  const capacity = input.capacity || {};
  const privacy = input.privacy || {};
  const cleanup = input.cleanup || {};
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const stability = Array.isArray(input.stability) ? input.stability : [];

  return cleanObject({
    schemaVersion: optionalNumber(input.schemaVersion),
    prd: cleanObject({
      documentId: optionalString(prd.documentId),
      date: optionalString(prd.date),
      sha256: optionalString(prd.sha256),
    }),
    branch: optionalString(input.branch),
    baselineCommitSha: optionalString(input.baselineCommitSha),
    toolCommitSha: optionalString(input.toolCommitSha),
    candidate: cleanObject({
      packageName: optionalString(candidate.packageName),
      version: optionalString(candidate.version),
      license: optionalString(candidate.license),
      transitiveDependencies: stringList(candidate.transitiveDependencies),
      licenseInventory: stringList(candidate.licenseInventory),
      polyfills: stringList(candidate.polyfills),
      dependencyTreeWarnings: stringList(candidate.dependencyTreeWarnings)
        .filter(code => DEPENDENCY_TREE_WARNING_CODES.includes(code)),
    }),
    environment: cleanObject({
      nodeVersion: optionalString(environment.nodeVersion),
      npmVersion: optionalString(environment.npmVersion),
      osPlatform: optionalString(environment.osPlatform),
      osReleaseMajor: optionalString(environment.osReleaseMajor),
      chromiumVersion: optionalString(environment.chromiumVersion),
    }),
    methods: cleanObject({
      memoryMeasurement: optionalString(methods.memoryMeasurement),
      heartbeatMeasurement: optionalString(methods.heartbeatMeasurement),
      workerIsolation: optionalString(methods.workerIsolation),
    }),
    samples: samples.map(sample => cleanObject({
      id: SAMPLE_IDS.includes(sample?.id) ? sample.id : undefined,
      expectedEventFamilies: stringList(sample?.expectedEventFamilies),
      positiveCapabilities: stringList(sample?.positiveCapabilities),
      capacityRole: CAPACITY_ROLES.includes(sample?.capacityRole) ? sample.capacityRole : undefined,
      compressedBytes: optionalNumber(sample?.compressedBytes),
      jsonBytes: optionalNumber(sample?.jsonBytes),
      eventCount: optionalNumber(sample?.eventCount),
      resultBytes: optionalNumber(sample?.resultBytes),
      parseDurationsMs: Array.isArray(sample?.parseDurationsMs)
        ? sample.parseDurationsMs.filter(Number.isFinite)
        : [],
      peakMemoryBytes: Array.isArray(sample?.peakMemoryBytes)
        ? sample.peakMemoryBytes.filter(Number.isFinite)
        : [],
      heartbeatMaxDelayMs: optionalNumber(sample?.heartbeatMaxDelayMs),
      status: optionalString(sample?.status),
      runFailures: (Array.isArray(sample?.runFailures) ? sample.runFailures : []).map(failure =>
        cleanObject({
          runIndex: optionalNumber(failure?.runIndex),
          stage: optionalString(failure?.stage),
          category: optionalString(failure?.category),
          code: optionalString(failure?.code),
        })),
    })),
    capabilities: projectCapabilityMap(input.capabilities),
    stability: stability.map(item => cleanObject({
      sampleId: SAMPLE_IDS.includes(item?.sampleId) ? item.sampleId : undefined,
      stable: typeof item?.stable === 'boolean' ? item.stable : undefined,
      hashes: stringList(item?.hashes),
      navigationCount: optionalNumber(item?.navigationCount),
      requestCount: optionalNumber(item?.requestCount),
      milestoneCount: optionalNumber(item?.milestoneCount),
      taskCount: optionalNumber(item?.taskCount),
      interactionCount: optionalNumber(item?.interactionCount),
    })),
    capacity: cleanObject({
      validatedMaxJsonBytes: optionalNumber(capacity.validatedMaxJsonBytes),
      memoryTrend: optionalString(capacity.memoryTrend),
      timeoutCount: optionalNumber(capacity.timeoutCount),
      crashCount: optionalNumber(capacity.crashCount),
      engineErrorCount: optionalNumber(capacity.engineErrorCount),
      workerErrorCount: optionalNumber(capacity.workerErrorCount),
    }),
    privacy: cleanObject({
      allowlistProjectionPassed: privacy.allowlistProjectionPassed === true,
      generatedOutputScanPassed: privacy.generatedOutputScanPassed === true,
      toolStaticCheckPassed: privacy.toolStaticCheckPassed === true,
      failureCodes: stringList(privacy.failureCodes),
    }),
    cleanup: cleanObject({
      status: optionalString(cleanup.status),
      warningCode: optionalString(cleanup.warningCode),
    }),
    decision: projectDecision(input.decision),
  });
}

function scanGeneratedOutput(value) {
  const text = typeof value === 'string' ? value : canonicalStringify(value);
  const checks = [
    ['absolute-user-path', /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/i],
    ['url', /\bhttps?:\/\//i],
    ['sensitive-header', /\b(?:authorization|proxy-authorization|cookie|set-cookie)\b/i],
    ['raw-trace-events', /["']?traceEvents["']?\s*:/i],
    ['source-code', /\b(?:sourceMap|scriptSource|function\s+[A-Za-z_$][\w$]*\s*\()/i],
    ['sample-file', /\b(?!TRACE-SAMPLE-\d{2}\b)[^\s"']+\.(?:json2?|trace)(?:\.gz)?\b/i],
    ['real-domain', /\b(?:[a-z0-9-]+\.)+(?:com|net|org|cn|io|dev|internal)\b/i],
  ];
  return checks.filter(([, pattern]) => pattern.test(text)).map(([code]) => code);
}

function scanToolSource(value) {
  const text = String(value);
  const checks = [
    ['hard-coded-user-path', /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/],
    ['hard-coded-secret', /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*["'][^"'*\s]{8,}["']/i],
  ];
  const failures = checks.filter(([, pattern]) => pattern.test(text)).map(([code]) => code);
  const quotedFilePattern = /["']([^"'\/\\\s]+\.(?:json2?|trace)(?:\.gz)?)["']/gi;
  for (const match of text.matchAll(quotedFilePattern)) {
    const fileName = match[1].toLowerCase();
    const allowedToolAsset = ['example', 'minimal', 'synthetic', 'spike', 'report', 'package']
      .some(marker => fileName.includes(marker));
    if (!allowedToolAsset) {
      failures.push('real-sample-filename');
      break;
    }
  }
  return failures;
}

function validateCleanupTarget(targetPath, options = {}) {
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('cleanup target is required');
  }
  const approvedRoot = fs.realpathSync(options.approvedRoot || '/private/tmp');
  const resolvedTarget = fs.realpathSync(targetPath);
  const relative = path.relative(approvedRoot, resolvedTarget);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('cleanup target must be a child of /private/tmp');
  }
  if (!path.basename(resolvedTarget).startsWith('netlog-trace-spike.')) {
    throw new Error('cleanup target does not use the fixed Spike prefix');
  }
  const forbidden = [
    fs.realpathSync(os.homedir()),
    ...(options.repositoryRoots || []).filter(fs.existsSync).map(root => fs.realpathSync(root)),
  ];
  if (forbidden.includes(resolvedTarget)) {
    throw new Error('cleanup target is a protected directory');
  }
  return resolvedTarget;
}

function removeValidatedTempDirectory(targetPath, options = {}) {
  const resolvedTarget = validateCleanupTarget(targetPath, options);
  fs.rmSync(resolvedTarget, { recursive: true, force: false });
}

module.exports = {
  CAPACITY_ROLES,
  OPTIONAL_CAPABILITIES,
  REQUIRED_CAPABILITIES,
  SAMPLE_CAPABILITIES,
  SAMPLE_IDS,
  buildPseudonymMap,
  canonicalStringify,
  compareStability,
  decideSpike,
  normalizeFacts,
  projectReport,
  removeValidatedTempDirectory,
  scanGeneratedOutput,
  scanToolSource,
  sha256,
  validateCapabilityResults,
  validateCleanupTarget,
  validateManifest,
};
