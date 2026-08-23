/**
 * Endpoint de información de facturación y plan SaaS para administradores.
 * Auth: requireTenantRole(['Admin', 'Owner', 'FinOps Manager'])
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { getTenantBillingDetails } from "@/services/saasBilling.service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        // Directiva 1: Mock tenant primero sin requerir OAuth
        if (isMockTenant(tenantId) || searchParams.get("mock") === "true") {
            const billingDetails = await getTenantBillingDetails(tenantId);
            return NextResponse.json({ success: true, ...billingDetails, mock: true });
        }

        // Tenants reales: validación RBAC
        await requireTenantRole(request, tenantId, ["Admin", "ADMIN", "Owner", "FinOps Manager", "Reader"]);

        const billingDetails = await getTenantBillingDetails(tenantId);
        return NextResponse.json({ success: true, ...billingDetails });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
