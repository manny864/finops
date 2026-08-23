/**
 * Endpoint para obtener el enlace de sesión al portal de pago de Paddle/Stripe.
 * Auth: requireTenantRole(['Admin', 'Owner'])
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { getCustomerPortalUrl } from "@/services/saasBilling.service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        if (isMockTenant(tenantId) || searchParams.get("mock") === "true") {
            const portal = await getCustomerPortalUrl(tenantId);
            return NextResponse.json({ url: portal.portalUrl, ...portal, mock: true });
        }

        await requireTenantRole(request, tenantId, ["Admin", "ADMIN", "Owner"]);

        const portal = await getCustomerPortalUrl(tenantId);
        return NextResponse.json({ url: portal.portalUrl, ...portal });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    return GET(request);
}
