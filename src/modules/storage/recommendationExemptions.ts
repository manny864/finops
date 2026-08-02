import pool from "./db";
import crypto from "crypto";

export type RecommendationExemption = {
    id: string;
    tenantId: string;
    resourceId: string;
    resourceName: string;
    recommendationType: string;
    reason: string;
    comment: string | null;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
};

// In-memory fallback per tenant for demo_tenant or when DB table is not yet reachable
const inMemoryExemptions: Record<string, Map<string, RecommendationExemption>> = {
    demo_tenant: new Map([
        [
            "/subscriptions/demo-sub-01/resourceGroups/cscs-finops-prod-westus2-backup-rg/providers/Microsoft.Compute/virtualMachines/vm-mysql-worker".toLowerCase(),
            {
                id: "exemption-demo-mysql-worker",
                tenantId: "demo_tenant",
                resourceId: "/subscriptions/demo-sub-01/resourceGroups/cscs-finops-prod-westus2-backup-rg/providers/Microsoft.Compute/virtualMachines/vm-mysql-worker",
                resourceName: "vm-mysql-worker",
                recommendationType: "rightsizing",
                reason: "VM requerida para backups periódicos de MySQL",
                comment: "Máquina virtual encendida por ventanas cortas según scheduler para respaldar bases de datos en Storage Account. Mantener aunque figure apagada.",
                createdBy: "admin@cscloudsolutions.com.ar",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }
        ]
    ])
};

export async function getExemptionsForTenant(tenantId: string): Promise<RecommendationExemption[]> {
    try {
        const [rows] = await pool.query<any[]>(
            `SELECT id, tenant_id as tenantId, resource_id as resourceId, resource_name as resourceName,
                    recommendation_type as recommendationType, reason, comment, created_by as createdBy,
                    created_at as createdAt, updated_at as updatedAt
             FROM recommendation_exemptions
             WHERE tenant_id = ?`,
            [tenantId]
        );
        return rows.map(r => ({
            id: r.id,
            tenantId: r.tenantId,
            resourceId: r.resourceId,
            resourceName: r.resourceName,
            recommendationType: r.recommendationType,
            reason: r.reason,
            comment: r.comment,
            createdBy: r.createdBy,
            createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
            updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : new Date().toISOString(),
        }));
    } catch (e) {
        // Fallback a in-memory store if DB query fails or table is being created
        const map = inMemoryExemptions[tenantId] || new Map();
        return Array.from(map.values());
    }
}

export async function upsertExemption(
    tenantId: string,
    data: {
        resourceId: string;
        resourceName: string;
        recommendationType?: string;
        reason?: string;
        comment?: string;
        createdBy?: string;
    }
): Promise<RecommendationExemption> {
    const id = `exm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const recType = data.recommendationType || "rightsizing";
    const reason = data.reason || "Eximida por el usuario";
    const comment = data.comment || null;
    const createdBy = data.createdBy || null;
    const now = new Date().toISOString();

    const resultObj: RecommendationExemption = {
        id,
        tenantId,
        resourceId: data.resourceId,
        resourceName: data.resourceName,
        recommendationType: recType,
        reason,
        comment,
        createdBy,
        createdAt: now,
        updatedAt: now,
    };

    try {
        await pool.query(
            `INSERT INTO recommendation_exemptions
                (id, tenant_id, resource_id, resource_name, recommendation_type, reason, comment, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                resource_name = VALUES(resource_name),
                recommendation_type = VALUES(recommendation_type),
                reason = VALUES(reason),
                comment = VALUES(comment),
                created_by = VALUES(created_by),
                updated_at = CURRENT_TIMESTAMP`,
            [id, tenantId, data.resourceId, data.resourceName, recType, reason, comment, createdBy]
        );
    } catch (e) {
        // Update in-memory fallback
        if (!inMemoryExemptions[tenantId]) {
            inMemoryExemptions[tenantId] = new Map();
        }
        inMemoryExemptions[tenantId].set(data.resourceId.toLowerCase(), resultObj);
    }

    return resultObj;
}

export async function deleteExemption(tenantId: string, resourceId: string): Promise<boolean> {
    try {
        await pool.query(
            `DELETE FROM recommendation_exemptions WHERE tenant_id = ? AND LOWER(resource_id) = LOWER(?)`,
            [tenantId, resourceId]
        );
    } catch (e) {
        // Remove from in-memory fallback
        if (inMemoryExemptions[tenantId]) {
            inMemoryExemptions[tenantId].delete(resourceId.toLowerCase());
        }
    }

    if (inMemoryExemptions[tenantId]) {
        inMemoryExemptions[tenantId].delete(resourceId.toLowerCase());
    }

    return true;
}
