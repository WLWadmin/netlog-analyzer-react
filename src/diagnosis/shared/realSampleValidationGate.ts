export type RealSampleValidationArea =
  | 'har'
  | 'netlog'
  | 'trace'
  | 'combined'
  | 'large-file'
  | 'acceptance';

export interface RealSampleValidationAreaStatus {
  area: RealSampleValidationArea;
  configured: boolean;
  executed: boolean;
  passed: boolean;
  missingEnvironmentVariables: string[];
}

export interface RealSampleValidationGateReport {
  passed: boolean;
  configuredAreaCount: number;
  executedAreaCount: number;
  passedAreaCount: number;
  requiredAreaCount: number;
  areas: RealSampleValidationAreaStatus[];
}

export interface RealSampleValidationExecutionResult {
  executed: boolean;
  passed: boolean;
}

type Environment = Readonly<Record<string, string | undefined>>;
type ExecutionResults = Partial<
  Record<RealSampleValidationArea, RealSampleValidationExecutionResult>
>;

const REQUIREMENTS: ReadonlyArray<{
  area: RealSampleValidationArea;
  environmentVariables: readonly string[];
}> = [
  {
    area: 'har',
    environmentVariables: ['RUN_HAR_REAL_SAMPLES', 'HAR_REAL_SAMPLE_DIR'],
  },
  {
    area: 'netlog',
    environmentVariables: ['NETLOG_PARITY_SAMPLE_DIR'],
  },
  {
    area: 'trace',
    environmentVariables: [
      'TRACE_SAMPLE_MANIFEST_PATH',
      'TRACE_PLAIN_SAMPLE_PATH',
      'TRACE_GZIP_SAMPLE_PATH',
    ],
  },
  {
    area: 'combined',
    environmentVariables: ['DIAGNOSIS_COMBINED_SAMPLE_MANIFEST_PATH'],
  },
  {
    area: 'large-file',
    environmentVariables: ['DIAGNOSIS_LARGE_FILE_SAMPLE_MANIFEST_PATH'],
  },
  {
    area: 'acceptance',
    environmentVariables: ['DIAGNOSIS_ACCEPTANCE_RECORD_PATH'],
  },
];

const REQUIRED_AREAS = REQUIREMENTS.map(requirement => requirement.area);

export function isCompleteRealSampleValidationGateReport(
  report: RealSampleValidationGateReport,
): boolean {
  if (report.requiredAreaCount !== REQUIRED_AREAS.length) return false;
  if (report.areas.length !== REQUIRED_AREAS.length) return false;
  const areas = new Map(report.areas.map(area => [area.area, area]));
  if (areas.size !== REQUIRED_AREAS.length) return false;
  if (!REQUIRED_AREAS.every(area => {
    const status = areas.get(area);
    return status?.configured === true
      && status.executed === true
      && status.passed === true
      && status.missingEnvironmentVariables.length === 0;
  })) return false;
  return report.configuredAreaCount === REQUIRED_AREAS.length
    && report.executedAreaCount === REQUIRED_AREAS.length
    && report.passedAreaCount === REQUIRED_AREAS.length
    && report.passed === true;
}

function isConfigured(environment: Environment, name: string): boolean {
  const value = environment[name];
  if (name === 'RUN_HAR_REAL_SAMPLES') return value === '1';
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildRealSampleValidationGateReport(
  environment: Environment,
  executionResults: ExecutionResults = {},
): RealSampleValidationGateReport {
  const areas = REQUIREMENTS.map<RealSampleValidationAreaStatus>(requirement => {
    const missingEnvironmentVariables = requirement.environmentVariables.filter(
      name => !isConfigured(environment, name),
    );
    const configured = missingEnvironmentVariables.length === 0;
    const result = executionResults[requirement.area];
    const executed = configured && result?.executed === true;
    return {
      area: requirement.area,
      configured,
      executed,
      passed: executed && result?.passed === true,
      missingEnvironmentVariables,
    };
  });
  const configuredAreaCount = areas.filter(area => area.configured).length;
  const executedAreaCount = areas.filter(area => area.executed).length;
  const passedAreaCount = areas.filter(area => area.passed).length;

  return {
    passed: passedAreaCount === areas.length,
    configuredAreaCount,
    executedAreaCount,
    passedAreaCount,
    requiredAreaCount: areas.length,
    areas,
  };
}
