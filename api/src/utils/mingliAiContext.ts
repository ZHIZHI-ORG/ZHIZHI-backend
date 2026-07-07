import type { BaziBasicInfoResult } from './baziBasicInfo';
import type { ZipingAiBriefResult } from './zipingStructureFacts';

export interface MingliAiContextResult {
  method_version: 'mingli_ai_context_v1';
  bazi_basic_info: BaziBasicInfoResult;
  ziping_structure: ZipingAiBriefResult | null;
}

interface MingliAiContextInput {
  baziBasicInfo: BaziBasicInfoResult;
  zipingStructure: ZipingAiBriefResult | null;
}

export function buildMingliAiContext({
  baziBasicInfo,
  zipingStructure,
}: MingliAiContextInput): MingliAiContextResult {
  return {
    method_version: 'mingli_ai_context_v1',
    bazi_basic_info: baziBasicInfo,
    ziping_structure: zipingStructure,
  };
}
