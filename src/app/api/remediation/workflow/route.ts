import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireRequestIdentity, requireTenantAccess } from "@/lib/requestAuth";
import { notifyTenant } from "@/lib/notifications";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

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

        return NextResponse.json({ success: true, data: rows });
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
        await initializeDatabase();
        const body = await request.json();
        const { id, status, tenantId } = body;
        if (!id || !status || !['Approved', 'Rejected'].includes(status)) {
            return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
        }
        if (!tenantId) {
            return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const [result] = await pool.query(
            `UPDATE RemediationRequests
             SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
             WHERE id = ? AND tenant_id = ? AND status = 'Pending'`,
            [status, identity.email, id, tenantId]
        );

        if ((result as any).affectedRows === 0) {
            return NextResponse.json({ error: "Request not found or already resolved" }, { status: 404 });
        }

        return NextResponse.json({ success: true, message: `Request ${status}` });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        console.error("PATCH RemediationRequests Error:", error);
        return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
    }
}
