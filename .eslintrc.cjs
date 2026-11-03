const restrictedBrowserGlobals = require('confusing-browser-globals');

module.exports = {
  root: true,
  extends: ['react-app'],
  // CRA enables every runtime in its base config; narrow each execution context.
  env: { browser: false, commonjs: false, jest: false, node: false, es6: true },
  overrides: [
    {
      files: ['src/**/*.{js,ts,tsx}', 'scripts/trace-spike/probes/**/*.{ts,tsx}'],
      env: { browser: true },
      // CRA replaces process.env at build time; this does not enable Node APIs.
      globals: { process: 'readonly' },
    },
    {
      files: ['scripts/**/*.{js,cjs}', '.eslintrc.cjs'],
      env: { node: true, commonjs: true },
      parserOptions: { sourceType: 'script' },
    },
    {
      files: [
        'scripts/trace-spike/run-spike.js',
        'scripts/trace-spike/self-test.js',
        'scripts/trace-spike/spike-core.js',
      ],
      // CommonJS is not implicitly strict; these scripts explicitly opt in.
      rules: { strict: ['warn', 'global'] },
    },
    {
      files: ['src/**/*.{test,spec}.{js,ts,tsx}', 'src/setupTests.ts'],
      extends: ['react-app/jest'],
      env: { browser: true, node: true, commonjs: true, jest: true },
    },
    {
      files: ['src/harParser.standard.test.ts', 'src/diagnosis/shared/harTimingCompleteness.test.ts'],
      // Only imported Testing Library tools are async utilities; HAR timings.wait
      // is a recorded value in these data tests. DOM tests retain full detection.
      settings: { 'testing-library/utils-module': 'off' },
    },
    {
      files: [
        'src/workers/analysisWorker.ts',
        'src/workers/traceAnalysisWorker.ts',
        'src/workers/fileFormatProbeWorker.ts',
        'scripts/trace-spike/probes/trace-worker.probe.ts',
      ],
      env: { browser: false, worker: true },
      rules: {
        // self is the Worker global scope. All other confusing globals stay banned.
        'no-restricted-globals': ['error', ...restrictedBrowserGlobals.filter(name => name !== 'self')],
      },
    },
  ],
};
