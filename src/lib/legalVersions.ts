/**
 * Legal document versions for FinOps SaaS platform
 * Update these when legal docs change to force re-acceptance
 */
export const LEGAL_VERSIONS = {
  privacy: "1.0-2026-06-29",
  terms: "1.0-2026-06-29",
  dpa: "1.0-2026-06-29",
} as const;

export type LegalDocumentType = keyof typeof LEGAL_VERSIONS;

export function getCurrentVersion(docType: LegalDocumentType): string {
  return LEGAL_VERSIONS[docType];
}
