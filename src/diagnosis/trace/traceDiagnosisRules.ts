import { interactionRules } from './rules/interactionRules';
import { loadingRules } from './rules/loadingRules';
import { mainThreadRules } from './rules/mainThreadRules';
import { networkDispatchRules } from './rules/networkDispatchRules';
import { qualityRules } from './rules/qualityRules';
import { renderingRules } from './rules/renderingRules';

export const TRACE_DIAGNOSIS_RULES = [
  ...qualityRules,
  ...loadingRules,
  ...networkDispatchRules,
  ...mainThreadRules,
  ...renderingRules,
  ...interactionRules,
] as const;
