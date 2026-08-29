/**
 * Tipos y contratos TypeScript para el Registro de Auditoría de Seguridad y Trazabilidad FinOps.
 */

export type AuditActionType =
    | "ROTATE_APP_SECRET"
    | "START_VM"
    | "STOP_VM"
    | "DELETE_ZOMBIE"
    | "APPLY_RIGHTSIZING"
    | "UPDATE_TAGS"
    | "WHAT_IF_SIMULATION"
    | "AKS_CHARGEBACK_REPORT"
    | "EXPORT_FOCUS"
    | "UNLINK_SUBSCRIPTION"
    | "RELINK_SUBSCRIPTION";

export type AuditStatusType = "SUCCESS" | "FAILED" | "PENDING";

export interface AuditTrailLogItem {
    id: string;
    tenantId: string;
    userEmail: string;
    userName?: string;
    ipAddress?: string;
    userAgent?: string;
    actionType: AuditActionType;
    resourceTargetId?: string;
    resourceTargetName: string;
    status: AuditStatusType;
    errorMessage?: string;
    metadataJson?: Record<string, unknown>;
    createdAtIso: string;
    formattedCreatedAt: string;
}

export interface AuditTrailFilterParams {
    tenantId: string;
    userEmail?: string;
    actionType?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    page: number;
    pageSize: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
}

export interface AuditTrailPaginatedResponse {
    items: AuditTrailLogItem[];
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
}
