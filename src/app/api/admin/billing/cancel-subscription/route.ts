/**
 * Endpoint para programar la cancelación de la suscripción SaaS al final del período.
 * Auth: requireTenantRole(['Admin', 'Owner'])
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { cancelTenantSubscription } from "@/services/saasBilling.service";

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantIdFromQuery = searchParams.get("tenantId");

        const body = await request.json().catch(() => ({}));
        const tenantId = body.tenantId || tenantIdFromQuery;

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        if (isMockTenant(tenantId)) {
            const res = await cancelTenantSubscription(tenantId, "demo.user@cscloudsolutions.com");
            return NextResponse.json({ ...res, mock: true });
        }

        const identity = await requireTenantRole(request, tenantId, ["Admin", "ADMIN", "Owner"]);

        const res = await cancelTenantSubscription(tenantId, identity.email);
        return NextResponse.json({ ...res });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
