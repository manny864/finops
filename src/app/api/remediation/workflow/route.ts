import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireRequestIdentity, requireTenantAccess } from "@/lib/requestAuth";
import { notifyTenant } from "@/lib/notifications";
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { POST as resolveGovernanceApproval } from "@/app/api/governance/approvals/route";

/**
 * `SELECT * FROM RemediationRequests`, asi que el contrato es la tabla: columnas
 * de `migrations/20260728-003`. Declarado para atar el mock de la demo por
 * typecheck -- la ruta exige identidad y base, no se puede invocar con un tenant
 * de demo (MEJ-03).
 */
export interface RemediationRequestRow {
    id: number;
    tenant_id: string;
    resource_id: string;
    resource_name: string;
    action_type: string;
    estimated_savings: number;
    status: "Pending" | "Approved" | "Rejected";
    requested_by: string;
    requested_at: string | null;
    resolved_at: string | null;
    resolved_by: string | null;
}

export interface RemediationWorkflowResponse {
    success: boolean;
    data: RemediationRequestRow[];
}

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        const identity = await requireRequestIdentity(request);
        const queriedTenantId = request.nextUrl.searchParams.get('tenantId') || identity.tenantId;

        await requireTenantAccess(request, queriedTenantId, { allowSuperAdmin: true });

        const [rows] = await pool.query(
            `SELECT * FROM RemediationRequests
             WHERE tenant_id = ?
             ORDER BY requested_at DESC`,
            [queriedTenantId]
        );

        const respuesta: RemediationWorkflowResponse = { success: true, data: rows as RemediationRequestRow[] };
        return NextResponse.json(respuesta);
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        console.error("GET RemediationRequests Error:", error);
        return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        const body = await request.json();
        const { tenantId, resourceId, resourceName, actionType, estimatedSavings } = body;
        if (!tenantId || !resourceId || !resourceName || !actionType) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const [result] = await pool.query(
            `INSERT INTO RemediationRequests
             (tenant_id, resource_id, resource_name, action_type, estimated_savings, requested_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [tenantId, resourceId, resourceName, actionType, estimatedSavings || 0, identity.email]
        );

        // Best-effort: si no hay canales configurados o falla el envío, la
        // solicitud igual queda creada y visible en /remediation/approvals —
        // no se debe fallar el POST por un error de notificación.
        notifyTenant(tenantId, {
            title: "Solicitud de eliminación de recurso",
            message: `${identity.email} solicitó eliminar "${resourceName}" (${actionType}). Revisar y ejecutar en Aprobaciones de Remediación.`,
            severity: "warning",
        }).catch((e) => console.warn("[RemediationRequests] No se pudo notificar la solicitud:", e?.message));

        return NextResponse.json({ success: true, insertedId: (result as any).insertId });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        console.error("POST RemediationRequests Error:", error);
        return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, status, tenantId, rejectionReason, createBackupSnapshot } = body;
        if (!id || !status || !['Approved', 'Rejected'].includes(status)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }
        if (!tenantId) {
            return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
        }

        return resolveGovernanceApproval(new NextRequest(request.url, {
            method: "POST",
            headers: request.headers,
            body: JSON.stringify({
                tenantId, approvalId: id, decision: status === "Approved" ? "APPROVE" : "REJECT",
                rejectionReason, createBackupSnapshot,
            }),
        }));
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        console.error("PATCH RemediationRequests Error:", error);
        return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
    }
}
