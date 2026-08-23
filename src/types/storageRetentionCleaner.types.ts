/**
 * Tipos TypeScript para el motor de purga y retención de almacenamiento por tier.
 */

export interface PurgedReportDetail {
  reportId: string;
  tenantId: string;
  planTier: string;
  ageInDays: number;
  pdfBlob: string;
  jsonBlob: string;
}

export interface StorageCleanupResult {
  success: boolean;
  totalCandidatesFound: number;
  totalPurgedCount: number;
  totalFreedBytes: number;
  formattedFreedMb: string;
  durationMs: number;
  errorsCount: number;
  executedAtIso: string;
  purgedReports?: PurgedReportDetail[];
}
