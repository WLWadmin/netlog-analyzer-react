import {
  runStage2ProductBenchmark,
  type Stage2ProductBenchmarkState,
} from './stage2ProductBenchmark';

declare global {
  interface Window {
    __STAGE3_PRODUCT_BENCHMARK__?: Stage2ProductBenchmarkState;
  }
}

export async function runStage3ProductBenchmark(): Promise<void> {
  await runStage2ProductBenchmark();
  window.__STAGE3_PRODUCT_BENCHMARK__ = window.__STAGE2_PRODUCT_BENCHMARK__;
}
