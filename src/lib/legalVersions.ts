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

// El string de versión es "1.0-YYYY-MM-DD" — no un Date parseable directo
// (`new Date("1.0-2026-06-29")` da Invalid Date). Esta función extrae la
// fecha real para mostrar "última modificación".
export function getLegalVersionDate(docType: LegalDocumentType): Date {
  const match = LEGAL_VERSIONS[docType].match(/(\d{4}-\d{2}-\d{2})$/);
  return match ? new Date(match[1]) : new Date(NaN);
}
