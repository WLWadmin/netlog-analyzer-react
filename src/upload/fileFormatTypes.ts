export type FileParserId =
  | 'har@1'
  | 'chromium-netlog@1'
  | 'chromium-performance-trace@1'
  | 'go-service-log@1';

export type SourceKind = 'har' | 'netlog' | 'trace' | 'log';

export type ParserFamily = 'network' | 'performance' | 'server';

export interface ProbeInput {
  taskId: string;
  fileName: string;
  container: 'plain' | 'gzip';
  value: unknown;
  probeVerdicts?: ProbeVerdict[];
}

export type ProbeVerdict =
  | {
      kind: 'definite-match';
      parserId: FileParserId;
      evidenceCodes: string[];
    }
  | {
      kind: 'possible-match';
      parserId: FileParserId;
      evidenceCodes: string[];
    }
  | {
      kind: 'no-match';
      parserId: FileParserId;
      evidenceCodes: string[];
    }
  | {
      kind: 'unsupported-version';
      parserId: FileParserId;
      evidenceCodes: string[];
    };

export interface FileFormatProbeAdapter {
  readonly parserId: FileParserId;
  readonly sourceKind: SourceKind;
  readonly family: ParserFamily;
  readonly extensions: readonly string[];
  probe(input: ProbeInput): Promise<ProbeVerdict>;
}

export interface ParseInput extends ProbeInput {
  payload: unknown;
}

export interface ValidationResult {
  ok: boolean;
  evidenceCodes: string[];
}

export interface ParseContext {
  taskId: string;
  isCancelled(): boolean;
  onProgress?(progress: import('./analysisProgress').AnalysisProgress): void;
}

export interface FileFormatAdapter<Result = unknown> extends FileFormatProbeAdapter {
  validate(input: ParseInput): Promise<ValidationResult>;
  parse(input: ParseInput, context: ParseContext): Promise<Result>;
}

export type FormatCandidate = Extract<
  ProbeVerdict,
  { kind: 'definite-match' | 'possible-match' }
>;

export type FormatResolution =
  | {
      kind: 'recommended';
      candidate: Extract<ProbeVerdict, { kind: 'definite-match' }>;
    }
  | {
      kind: 'needs-choice';
      candidates: FormatCandidate[];
    }
  | {
      kind: 'unsupported';
      evidenceCodes: string[];
    };
