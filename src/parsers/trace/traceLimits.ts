const MiB = 1024 * 1024;

export const TRACE_LIMITS = {
  maxCompressedBytes: 64 * MiB,
  maxJsonBytes: 128 * MiB,
  maxEvents: 1_000_000,
  sourceSniffBytes: 1024 * 1024,
} as const;
