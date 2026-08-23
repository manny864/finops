/**
 * Endpoint de consulta paginada y filtrado del Registro de Auditoría de Seguridad.
 * Auth: requireTenantRole(['Admin', 'Owner', 'FinOps Manager', 'Reader'])
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { getAuditTrailLogs } from "@/services/auditTrail.service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        const userEmail = searchParams.get("userEmail") || searchParams.get("user_email") || undefined;
        const actionType = searchParams.get("actionType") || searchParams.get("action_type") || undefined;
        const status = searchParams.get("status") || undefined;
        const fromDate = searchParams.get("from") || searchParams.get("fromDate") || undefined;
        const toDate = searchParams.get("to") || searchParams.get("toDate") || undefined;
        const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
        const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get("pageSize") || searchParams.get("limit") || "15", 10)));

        // Directiva 1: Mock tenant primero sin requerir OAuth
        if (isMockTenant(tenantId) || searchParams.get("mock") === "true") {
            const data = await getAuditTrailLogs({
                tenantId,
                userEmail,
                actionType,
                status,
                fromDate,
                toDate,
                page,
                pageSize,
            });
            return NextResponse.json({ success: true, ...data, mock: true });
        }

        // Tenants reales: validación RBAC
        await requireTenantRole(request, tenantId, ["Admin", "ADMIN", "Owner", "FinOps Manager", "Reader"]);

        const data = await getAuditTrailLogs({
            tenantId,
            userEmail,
            actionType,
            status,
            fromDate,
            toDate,
            page,
            pageSize,
        });

        return NextResponse.json({ success: true, ...data });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
