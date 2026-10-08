/**
 * Por qué un CSV que no es FOCUS no se pudo mapear con IA: los motivos del gate
 * (`aiFeatureGate.ts`) más un mapeo que no pasó la validación. La página de
 * upload muestra `IntelligenceUpload.mappingError_<motivo>`.
 */
export const CSV_MAPPING_ERROR_REASONS = [
    "global_disabled",
    "tenant_disabled",
    "tier",
    "quota",
    "rate_limited",
    "invalid_mapping",
] as const;

export type CsvMappingErrorReason = (typeof CSV_MAPPING_ERROR_REASONS)[number];
