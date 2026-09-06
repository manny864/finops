/**
 * Contratos TypeScript — Reporting de Gobernanza.
 *
 * El Score de Seguridad Financiera pondera cuatro pilares. Cada uno se calcula
 * sólo si hay datos para medirlo: un pilar sin datos no puntúa 100 (haría subir
 * el score por no tener información) ni 0 (castigaría al tenant por una falta
 * de permisos del Service Principal). Se excluye del promedio y su peso se
 * redistribuye entre los pilares medibles, con el detalle visible en la UI.
 */

export type GovernancePillar = "PolicyCompliance" | "TagHygiene" | "RbacHygiene" | "ZombieControl";

export const PILLAR_WEIGHTS: Record<GovernancePillar, number> = {
  PolicyCompliance: 40,
  TagHygiene: 30,
  RbacHygiene: 20,
  ZombieControl: 10,
};

export type RbacPrincipalType = "User" | "ServicePrincipal" | "Group";

export interface ResourceTypeDistribution {
  typeKey: string;
  typeDisplayName: string;
  count: number;
  percentage: number;
}

export interface RegionDistribution {
  regionKey: string;
  regionDisplayName: string;
  count: number;
  percentage: number;
}

export interface RbacPrincipalDistribution {
  principalType: RbacPrincipalType;
  count: number;
  privilegedRolesCount: number;
  orphanedSidsCount: number;
}

export interface PillarScoreDetail {
  pillar: GovernancePillar;
  /** 0-100 dentro del pilar. `null` cuando no hay datos para medirlo. */
  rawScore: number | null;
  /** Peso nominal del pilar. */
  weight: number;
  /** Peso efectivo tras redistribuir el de los pilares no medibles. */
  effectiveWeight: number;
  /** Puntos que aporta al score final. */
  contribution: number;
  measurable: boolean;
  /**
   * Clave i18n del detalle, no la frase: el payload se cachea 30 min y es
   * compartido por los tres idiomas, asi que no puede llevar prosa.
   */
  detailKey: string;
  detailArgs?: Record<string, number>;
}

export interface GovernanceReportingSummary {
  financialSecurityScorePercentage: number;
  auditedResourcesCount: number;
  activePolicyAssignmentsCount: number;
  nonCompliantResourcesCount: number;
  nonCompliantPoliciesCount: number;
  subscriptionsCount: number;
  totalRbacAssignmentsCount: number;
  orphanedSidsCount: number;
  privilegedRolesCount: number;
  resourceTypeBreakdown: ResourceTypeDistribution[];
  regionBreakdown: RegionDistribution[];
  rbacBreakdown: RbacPrincipalDistribution[];
  pillars: PillarScoreDetail[];
}

export interface NonCompliantResourceDetail {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  subscriptionName: string;
  violatedPolicyName: string;
  policyEffect: string;
}

export interface OrphanedAssignmentDetail {
  assignmentId: string;
  principalId: string;
  principalType: string;
  roleName: string;
  scopeDisplayName: string;
  /** `true` cuando el rol es Owner/Contributor/User Access Administrator. */
  isPrivileged: boolean;
  /** `true` cuando el principal ya no existe en el directorio. */
  isOrphaned: boolean;
}

export interface GovernanceReportingPayload {
  summary: GovernanceReportingSummary;
  nonCompliantResources: NonCompliantResourceDetail[];
  orphanedAssignments: OrphanedAssignmentDetail[];
  source: "live" | "mock";
  lastUpdated: string;
}

export interface TableColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  minWidth: number;
}

export const NON_COMPLIANT_COLUMNS: TableColumnConfig[] = [
  { id: "resource", label: "Recurso", visible: true, minWidth: 200 },
  { id: "type", label: "Tipo", visible: true, minWidth: 180 },
  { id: "subscription", label: "Suscripción", visible: true, minWidth: 160 },
  { id: "policy", label: "Política Incumplida", visible: true, minWidth: 220 },
  { id: "effect", label: "Efecto", visible: true, minWidth: 120 },
  { id: "actions", label: "Acciones", visible: true, minWidth: 140 },
];

export const RBAC_COLUMNS: TableColumnConfig[] = [
  { id: "principal", label: "Principal", visible: true, minWidth: 220 },
  { id: "type", label: "Tipo", visible: true, minWidth: 140 },
  { id: "role", label: "Rol Asignado", visible: true, minWidth: 200 },
  { id: "scope", label: "Alcance", visible: true, minWidth: 200 },
  { id: "status", label: "Estado", visible: true, minWidth: 170 },
];

/** Roles con capacidad de escalar privilegios o alterar la facturación. */
export const PRIVILEGED_ROLES = ["Owner", "Contributor", "User Access Administrator", "Billing Reader"];

/** Paleta del módulo, en escala de azules. */
export const REPORTING_COLORS = {
  compute: "#0078D4",
  storage: "#2563EB",
  network: "#0284C7",
  region: "#38BDF8",
  rbac: "#0078D4",
  neutral: "#94A3B8",
} as const;
