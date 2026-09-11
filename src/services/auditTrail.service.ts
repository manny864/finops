/**
 * Servicio para consulta paginada, filtrado granular y exportación en streaming
 * de registros de auditoría de seguridad y trazabilidad FinOps.
 */

import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import {
    AuditActionType,
    AuditStatusType,
    AuditTrailLogItem,
    AuditTrailFilterParams,
    AuditTrailPaginatedResponse,
} from "@/types/auditTrail.types";

/**
 * Genera el dataset sintético completo de auditoría para tenants de demostración.
 */
function getMockAuditLogs(tenantId: string): AuditTrailLogItem[] {
    const now = new Date();

    const mockItems: Array<{
        id: string;
        minsAgo: number;
        userEmail: string;
        userName: string;
        ipAddress: string;
        userAgent: string;
        actionType: AuditActionType;
        resourceTargetId: string;
        resourceTargetName: string;
        status: AuditStatusType;
        errorMessage?: string;
        metadataJson: Record<string, unknown>;
    }> = [
        {
            id: "audit-evt-001",
            minsAgo: 12,
            userEmail: "admin@cscloudsolutions.com",
            userName: "Juan Manuel Chavez",
            ipAddress: "190.114.208.45",
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            actionType: "ROTATE_APP_SECRET",
            resourceTargetId: "/subscriptions/sub-prod-01/resourceGroups/rg-security-core/providers/Microsoft.KeyVault/vaults/kv-finops-prod",
            resourceTargetName: "kv-finops-prod (Key Vault Service Principal)",
            status: "SUCCESS",
            metadataJson: {
                keyVault: "kv-finops-prod",
                secretName: "sp-finops-collector-secret",
                keyVersion: "9d8e7f6a5b4c3d2e",
                expiresInDays: 365,
                previousState: "EXPIRED_WARNING",
                newState: "ACTIVE_VALID",
            },
        },
        {
            id: "audit-evt-002",
            minsAgo: 45,
            userEmail: "devops.bot@cscloudsolutions.com",
            userName: "Azure Automation Worker",
            ipAddress: "52.179.18.22",
            userAgent: "AzureAutomation/3.0 (Scheduler Pipeline)",
            actionType: "START_VM",
            resourceTargetId: "/subscriptions/sub-prod-01/resourceGroups/rg-compute-prod/providers/Microsoft.Compute/virtualMachines/vm-batch-worker-01",
            resourceTargetName: "vm-batch-worker-01 (Standard_D8s_v5)",
            status: "SUCCESS",
            metadataJson: {
                vmSize: "Standard_D8s_v5",
                osType: "Linux Ubuntu 22.04",
                powerState: "VM running",
                costPerHourUsd: 0.384,
                scheduleJobId: "sched-batch-morning-0800",
            },
        },
        {
            id: "audit-evt-003",
            minsAgo: 110,
            userEmail: "finops.lead@cscloudsolutions.com",
            userName: "Carlos Rodriguez",
            ipAddress: "181.44.120.12",
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0",
            actionType: "DELETE_ZOMBIE",
            resourceTargetId: "/subscriptions/sub-dev-02/resourceGroups/rg-storage-dev/providers/Microsoft.Compute/disks/disk-temp-backup-orphaned",
            resourceTargetName: "disk-temp-backup-orphaned (Unattached Managed Disk)",
            status: "SUCCESS",
            metadataJson: {
                diskTier: "Premium SSD (P30)",
                diskSizeGb: 1024,
                daysUnattached: 47,
                monthlySavingsUsd: 135.20,
                snapshotBackupCreated: true,
            },
        },
        {
            id: "audit-evt-004",
            minsAgo: 195,
            userEmail: "cfo@cscloudsolutions.com",
            userName: "Mariana Lopez",
            ipAddress: "201.218.44.90",
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/605.1.15",
            actionType: "WHAT_IF_SIMULATION",
            resourceTargetId: "/subscriptions/sub-prod-01",
            resourceTargetName: "Subscription Enterprise Production",
            status: "SUCCESS",
            metadataJson: {
                simulationType: "3-Year Azure Savings Plan vs 1-Year RI",
                coveredCores: 256,
                projectedCommitmentMonthlyUsd: 4850.0,
                netAnnualSavingsProjectedUsd: 22400.0,
                breakevenMonths: 5.2,
            },
        },
        {
            id: "audit-evt-005",
            minsAgo: 320,
            userEmail: "platform.engineer@cscloudsolutions.com",
            userName: "Martin Gomez",
            ipAddress: "190.220.11.85",
            userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0",
            actionType: "AKS_CHARGEBACK_REPORT",
            resourceTargetId: "/subscriptions/sub-prod-01/resourceGroups/rg-aks-prod/providers/Microsoft.ContainerService/managedClusters/aks-cluster-production",
            resourceTargetName: "aks-cluster-production (Kubernetes Cluster)",
            status: "SUCCESS",
            metadataJson: {
                namespacesCount: 14,
                topNamespace: "payment-gateway",
                unallocatedCpuPercent: 12.4,
                totalAksMonthlyCostUsd: 3420.50,
                generatedFormat: "FOCUS 1.1 CSV",
            },
        },
        {
            id: "audit-evt-006",
            minsAgo: 480,
            userEmail: "finops.lead@cscloudsolutions.com",
            userName: "Carlos Rodriguez",
            ipAddress: "181.44.120.12",
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0",
            actionType: "APPLY_RIGHTSIZING",
            resourceTargetId: "/subscriptions/sub-prod-01/resourceGroups/rg-compute-prod/providers/Microsoft.Compute/virtualMachines/vm-app-server-02",
            resourceTargetName: "vm-app-server-02 (Standard_D8s_v5 -> Standard_D4s_v5)",
            status: "SUCCESS",
            metadataJson: {
                previousSku: "Standard_D8s_v5",
                targetSku: "Standard_D4s_v5",
                avgCpu90Days: "18.2%",
                monthlySavingsUsd: 140.80,
                downtimeSeconds: 42,
            },
        },
        {
            id: "audit-evt-007",
            minsAgo: 720,
            userEmail: "governance@cscloudsolutions.com",
            userName: "Ana Clara Silva",
            ipAddress: "189.36.190.21",
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edge/128.0.0.0",
            actionType: "UPDATE_TAGS",
            resourceTargetId: "/subscriptions/sub-prod-01/resourceGroups/rg-shared-services",
            resourceTargetName: "rg-shared-services (Bulk Resource Group Tagging)",
            status: "SUCCESS",
            metadataJson: {
                resourcesUpdatedCount: 38,
                enforcedTags: {
                    CostCenter: "CC-9042-IT",
                    Environment: "Production",
                    Owner: "infra.team@cscloudsolutions.com",
                    BusinessUnit: "FinOps-Core",
                },
                complianceScoreAfter: "98.4%",
            },
        },
        {
            id: "audit-evt-008",
            minsAgo: 1440,
            userEmail: "system@automation",
            userName: "FinOps TTL Nightly Daemon",
            ipAddress: "10.0.0.4",
            userAgent: "InternalDaemon/TTL-Shutdown",
            actionType: "STOP_VM",
            resourceTargetId: "/subscriptions/sub-dev-02/resourceGroups/rg-dev-qa/providers/Microsoft.Compute/virtualMachines/vm-qa-testing-03",
            resourceTargetName: "vm-qa-testing-03 (Auto-Shutdown)",
            status: "SUCCESS",
            metadataJson: {
                ttlRule: "DevEnvironment-Nightly-20h",
                idleHoursDetected: 6,
                savedEstimatedNightlyUsd: 4.80,
            },
        },
    ];

    return mockItems.map((item) => {
        const itemDate = new Date(now.getTime() - item.minsAgo * 60000);
        return {
            id: item.id,
            tenantId,
            userEmail: item.userEmail,
            userName: item.userName,
            ipAddress: item.ipAddress,
            userAgent: item.userAgent,
            actionType: item.actionType,
            resourceTargetId: item.resourceTargetId,
            resourceTargetName: item.resourceTargetName,
            status: item.status,
            errorMessage: item.errorMessage,
            metadataJson: item.metadataJson,
            createdAtIso: itemDate.toISOString(),
            formattedCreatedAt: itemDate.toLocaleString("es-ES", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            }),
        };
    });
}

/**
 * Consulta paginada y filtrada de logs de auditoría.
 */
export async function getAuditTrailLogs(
    params: AuditTrailFilterParams
): Promise<AuditTrailPaginatedResponse> {
    const {
        tenantId,
        userEmail,
        actionType,
        status,
        fromDate,
        toDate,
        page = 1,
        pageSize = 15,
    } = params;

    if (!tenantId) {
        throw new Error("Falta tenantId");
    }

    if (isMockTenant(tenantId)) {
        let list = getMockAuditLogs(tenantId);

        if (userEmail?.trim()) {
            const q = userEmail.toLowerCase().trim();
            list = list.filter((l) => l.userEmail.toLowerCase().includes(q) || l.userName?.toLowerCase().includes(q));
        }

        if (actionType?.trim() && actionType !== "ALL" && actionType !== "TODAS") {
            list = list.filter((l) => l.actionType === actionType);
        }

        if (status?.trim() && status !== "ALL" && status !== "TODOS") {
            list = list.filter((l) => l.status === status);
        }

        if (fromDate) {
            const fTime = new Date(fromDate).getTime();
            list = list.filter((l) => new Date(l.createdAtIso).getTime() >= fTime);
        }

        if (toDate) {
            const tTime = new Date(toDate).getTime() + 86399999;
            list = list.filter((l) => new Date(l.createdAtIso).getTime() <= tTime);
        }

        const totalCount = list.length;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const startIndex = (page - 1) * pageSize;
        const items = list.slice(startIndex, startIndex + pageSize);

        return {
            items,
            totalCount,
            page,
            pageSize,
            totalPages,
        };
    }

    // Para tenants reales: consulta sobre tabla ActionLogs / SecurityAuditTrail
    const conditions: string[] = ["tenant_id = ?"];
    const values: unknown[] = [tenantId];

    if (userEmail?.trim()) {
        conditions.push("user_email LIKE ?");
        values.push(`%${userEmail.trim()}%`);
    }

    if (actionType?.trim() && actionType !== "ALL" && actionType !== "TODAS") {
        conditions.push("action_type = ?");
        values.push(actionType.trim());
    }

    if (status?.trim() && status !== "ALL" && status !== "TODOS") {
        conditions.push("status = ?");
        values.push(status.trim());
    }

    if (fromDate) {
        conditions.push("created_at >= ?");
        values.push(new Date(fromDate).toISOString());
    }

    if (toDate) {
        conditions.push("created_at <= ?");
        values.push(new Date(toDate).toISOString());
    }

    const whereClause = conditions.join(" AND ");

    // Conteo total
    let totalCount = 0;
    try {
        const [countRows]: any = await pool.query(
            `SELECT COUNT(*) as total FROM ActionLogs WHERE ${whereClause}`,
            values
        );
        totalCount = countRows?.[0]?.total || 0;
    } catch {
        // Fallback a SecurityAuditTrail
        try {
            const [countRows]: any = await pool.query(
                `SELECT COUNT(*) as total FROM SecurityAuditTrail WHERE ${whereClause}`,
                values
            );
            totalCount = countRows?.[0]?.total || 0;
        } catch {
            totalCount = 0;
        }
    }

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const offset = (page - 1) * pageSize;

    let rows: any[] = [];
    try {
        const [queryRows]: any = await pool.query(
            `SELECT id, tenant_id, user_email, user_name, ip_address, user_agent, action_type, resource_id as resource_target_id, resource_name as resource_target_name, status, error_message, metadata_json, COALESCE(created_at, timestamp) as created_at FROM ActionLogs WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...values, pageSize, offset]
        );
        rows = Array.isArray(queryRows) ? queryRows : [];
    } catch {
        try {
            const [queryRows]: any = await pool.query(
                `SELECT id, tenant_id, user_email, event_type as action_type, description as resource_target_name, 'SUCCESS' as status, created_at FROM SecurityAuditTrail WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
                [...values, pageSize, offset]
            );
            rows = Array.isArray(queryRows) ? queryRows : [];
        } catch {
            rows = [];
        }
    }

    const items: AuditTrailLogItem[] = rows.map((r) => {
        const createdAt = r.created_at ? new Date(r.created_at) : new Date();
        let meta: Record<string, unknown> = {};
        try {
            if (typeof r.metadata_json === "string") {
                meta = JSON.parse(r.metadata_json);
            } else if (typeof r.metadata_json === "object" && r.metadata_json !== null) {
                meta = r.metadata_json;
            }
        } catch {
            meta = {};
        }

        return {
            id: String(r.id),
            tenantId: r.tenant_id || tenantId,
            userEmail: r.user_email || "system@cloud",
            userName: r.user_name || undefined,
            ipAddress: r.ip_address || undefined,
            userAgent: r.user_agent || undefined,
            actionType: (r.action_type as AuditActionType) || "ROTATE_APP_SECRET",
            resourceTargetId: r.resource_target_id || undefined,
            resourceTargetName: r.resource_target_name || r.description || "Recurso Azure",
            status: (r.status as AuditStatusType) || "SUCCESS",
            errorMessage: r.error_message || undefined,
            metadataJson: meta,
            createdAtIso: createdAt.toISOString(),
            formattedCreatedAt: createdAt.toLocaleString("es-ES", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            }),
        };
    });

    return {
        items,
        totalCount,
        page,
        pageSize,
        totalPages,
    };
}

/**
 * Serializa logs de auditoría a CSV.
 */
/**
 * CSV del Audit Trail en el idioma de quien lo descarga.
 *
 * Las cabeceras estaban fijas en castellano ("Fecha_UTC", "Tipo_Accion"), asi
 * que un admin con la plataforma en ingles bajaba un archivo que no podia leer
 * ni pasarle a su auditor. El archivo sale del servidor, por eso `t` entra por
 * parametro: la ruta lo resuelve con el locale que manda el cliente.
 *
 * `actionType` NO se traduce a proposito: es el identificador de la accion
 * (START_VM, DELETE_ZOMBIE) y un CSV de auditoria tiene que ser comparable y
 * filtrable entre exportaciones de distintos idiomas. El estado si, porque es
 * un rotulo de resultado y no una clave.
 */
export function serializeAuditTrailCsv(
    items: AuditTrailLogItem[],
    t?: (key: string) => string
): string {
    /*
     * Rotulos de respaldo. Existen porque un CSV con "csvHeader_id" en la
     * primera fila es peor que uno en un idioma que no es el tuyo: si alguien
     * llama sin `t`, o si next-intl devuelve la ruta de la clave porque falta
     * una entrada, la planilla tiene que seguir siendo legible.
     */
    const FALLBACK: Record<string, string> = {
        csvHeader_id: "ID",
        csvHeader_date: "Date (UTC)",
        csvHeader_userEmail: "User email",
        csvHeader_userName: "Name",
        csvHeader_actionType: "Action type",
        csvHeader_resource: "Resource / target",
        csvHeader_status: "Status",
        csvHeader_ip: "Source IP",
    };

    const rotulo = (clave: string, crudo: string): string => {
        const v = t?.(clave);
        // next-intl devuelve "Namespace.clave" cuando no existe; ningun rotulo
        // traducido de estos tiene un punto.
        return v && !v.includes(".") ? v : crudo;
    };

    const headers = Object.keys(FALLBACK).map((k) => rotulo(k, FALLBACK[k]));

    const comilla = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const estado = (s: string) => rotulo(`status_${s}`, s);

    const rows = items.map((i) => [
        comilla(i.id),
        comilla(i.createdAtIso),
        comilla(i.userEmail),
        comilla(i.userName || ""),
        comilla(i.actionType),
        comilla(i.resourceTargetName || ""),
        comilla(estado(i.status)),
        comilla(i.ipAddress || ""),
    ]);

    return [headers.map(comilla).join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}
