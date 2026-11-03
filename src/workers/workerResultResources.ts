import type { WorkerSuccessResponse } from './protocols';

/** Only newly produced resources belong to a task; query results never own the Dataset they read. */
export function workerResultResources(response: WorkerSuccessResponse) {
  const payload = response.payload;
  const analysisId = response.datasetMeta?.analysisId
    ?? (response.resultType === 'netlog-dataset'
      && payload !== null && typeof payload === 'object'
      && 'analysisId' in payload && typeof payload.analysisId === 'string'
      ? payload.analysisId : undefined);
  return { analysisId, rawDataId: response.rawDataId };
}
