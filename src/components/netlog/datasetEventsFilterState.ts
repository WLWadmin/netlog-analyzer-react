export interface DatasetEventsFilterState {
  errorOnly: boolean;
  sourceIdFilter: string;
  sourceChainIdFilter: string;
  typeIdFilter: string;
  typeNameFilter: string;
  sourceTypeNameFilter: string;
  phaseFilter: string;
  startTimeFilter: string;
  endTimeFilter: string;
  searchTextFilter: string;
  pageSize: number;
}

export const DEFAULT_DATASET_EVENTS_FILTER_STATE: DatasetEventsFilterState = {
  errorOnly: false,
  sourceIdFilter: '',
  sourceChainIdFilter: '',
  typeIdFilter: '',
  typeNameFilter: '',
  sourceTypeNameFilter: '',
  phaseFilter: '',
  startTimeFilter: '',
  endTimeFilter: '',
  searchTextFilter: '',
  pageSize: 100,
};

const STORAGE_PREFIX = 'netlog-dataset-events-filters:';

function storageKey(analysisId: string): string {
  return `${STORAGE_PREFIX}${analysisId}`;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function booleanValue(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function pageSizeValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(500, Math.max(1, Math.round(value))) : 100;
}

export function parseDatasetEventsFilterState(raw: string | null): DatasetEventsFilterState {
  if (!raw) return DEFAULT_DATASET_EVENTS_FILTER_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<DatasetEventsFilterState>;
    return {
      errorOnly: booleanValue(parsed.errorOnly),
      sourceIdFilter: stringValue(parsed.sourceIdFilter),
      sourceChainIdFilter: stringValue(parsed.sourceChainIdFilter),
      typeIdFilter: stringValue(parsed.typeIdFilter),
      typeNameFilter: stringValue(parsed.typeNameFilter),
      sourceTypeNameFilter: stringValue(parsed.sourceTypeNameFilter),
      phaseFilter: stringValue(parsed.phaseFilter),
      startTimeFilter: stringValue(parsed.startTimeFilter),
      endTimeFilter: stringValue(parsed.endTimeFilter),
      searchTextFilter: stringValue(parsed.searchTextFilter),
      pageSize: pageSizeValue(parsed.pageSize),
    };
  } catch {
    return DEFAULT_DATASET_EVENTS_FILTER_STATE;
  }
}

export function loadDatasetEventsFilterState(analysisId: string, storage: Storage | undefined = typeof window !== 'undefined' ? window.sessionStorage : undefined): DatasetEventsFilterState {
  if (!storage) return DEFAULT_DATASET_EVENTS_FILTER_STATE;
  return parseDatasetEventsFilterState(storage.getItem(storageKey(analysisId)));
}

export function saveDatasetEventsFilterState(analysisId: string, state: DatasetEventsFilterState, storage: Storage | undefined = typeof window !== 'undefined' ? window.sessionStorage : undefined): void {
  if (!storage) return;
  storage.setItem(storageKey(analysisId), JSON.stringify(state));
}

export function clearDatasetEventsFilterState(analysisId: string, storage: Storage | undefined = typeof window !== 'undefined' ? window.sessionStorage : undefined): void {
  storage?.removeItem(storageKey(analysisId));
}
