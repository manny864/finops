/**
 * Contratos TypeScript — Aprobaciones de Remediación.
 *
 * El flujo implementa el principio de cuatro ojos: quien solicita el cambio
 * (un motor automático o un operador) no es quien lo aprueba, y la aprobación
 * es lo que dispara la llamada a ARM. Hasta esta versión aprobar sólo cambiaba
 * el estado en MySQL y no ejecutaba nada en Azure.
 */

export type ApprovalActionType =
  | "DELETE_RESOURCE"
  | "RIGHTSIZE_VM"
  | "CHANGE_TIER"
  | "POWER_OFF"
  | "PURGE_BACKUP";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "FAILED";

export type ArmExecutionStatus = "Succeeded" | "Failed" | "Running";

export const ACTION_LABELS_ES: Record<ApprovalActionType, string> = {
  DELETE_RESOURCE: "Eliminar recurso",
  RIGHTSIZE_VM: "Redimensionar VM",
  CHANGE_TIER: "Cambiar tier de almacenamiento",
  POWER_OFF: "Apagar recurso",
  PURGE_BACKUP: "Purgar backup",
};

export const STATUS_LABELS_ES: Record<ApprovalStatus, string> = {
  PENDING: "Pendiente",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  FAILED: "Fallido",
};

/** Acciones irreversibles: exigen confirmación explícita y ofrecen snapshot. */
export const DESTRUCTIVE_ACTIONS: ApprovalActionType[] = ["DELETE_RESOURCE", "PURGE_BACKUP"];

/** Acciones que interrumpen el servicio mientras se aplican. */
export const REBOOT_ACTIONS: ApprovalActionType[] = ["RIGHTSIZE_VM", "POWER_OFF"];

/** Sólo estas admiten un snapshot previo que permita revertir. */
export const SNAPSHOTTABLE_ACTIONS: ApprovalActionType[] = ["DELETE_RESOURCE"];

export interface PendingApprovalItem {
  id: string;
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceTypeDisplay: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  actionType: ApprovalActionType;
  actionDisplayName: string;
  requestedBy: string;
  requestedAt: string;
  monthlySavingsUSD: number;
  requiresReboot: boolean;
  isDestructive: boolean;
  canSnapshot: boolean;
  /** Configuración destino, p. ej. "Standard_D4s_v5" o "Cool". */
  targetConfiguration?: string;
  description?: string;
}

export interface ApprovalHistoryItem {
  id: string;
  resourceName: string;
  resourceType: string;
  resourceTypeDisplay: string;
  actionType: ApprovalActionType;
  monthlySavingsUSD: number;
  status: ApprovalStatus;
  resolvedBy: string;
  resolvedAt: string;
  rejectionReason?: string;
  armExecutionStatus?: ArmExecutionStatus;
  armExecutionDetail?: string;
  backupSnapshotId?: string;
}

export interface ApprovalsSummaryMetrics {
  pendingApprovalsCount: number;
  approvedCount: number;
  rejectedCount: number;
  failedCount: number;
  /** Ahorro de las aprobaciones que ARM confirmó, no de todas las aprobadas. */
  liberatedSavingsMonthlyUSD: number;
  pendingSavingsMonthlyUSD: number;
  pendingRequests: PendingApprovalItem[];
  history: ApprovalHistoryItem[];
}

export interface ApprovalsPayload {
  summary: ApprovalsSummaryMetrics;
  source: "live" | "mock";
  lastUpdated: string;
}

export interface ResolveApprovalPayload {
  approvalId: string;
  decision: "APPROVE" | "REJECT";
  rejectionReason?: string;
  createBackupSnapshot?: boolean;
}

export interface TableColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  minWidth: number;
}

export const HISTORY_COLUMNS: TableColumnConfig[] = [
  { id: "resource", label: "Recurso", visible: true, minWidth: 200 },
  { id: "action", label: "Acción Ejecutada", visible: true, minWidth: 180 },
  { id: "savings", label: "Ahorro Mensual", visible: true, minWidth: 140 },
  { id: "status", label: "Estado de la Decisión", visible: true, minWidth: 160 },
  { id: "resolvedBy", label: "Resuelto Por", visible: true, minWidth: 200 },
  { id: "resolvedAt", label: "Fecha y Hora", visible: true, minWidth: 160 },
  { id: "arm", label: "Resultado ARM", visible: true, minWidth: 150 },
  { id: "actions", label: "Acciones", visible: true, minWidth: 100 },
];
