/**
 * Endpoint para configurar el Microsoft Partner MPN ID del SaaS (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { configurePartnerMpn } from "@/services/superAdminPartnerCenter.service";

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const body = await request.json().catch(() => ({}));
        const { partnerMpnId } = body;

        if (!partnerMpnId) {
            return NextResponse.json({ success: false, error: "partnerMpnId es requerido." }, { status: 400 });
        }

        const result = await configurePartnerMpn({ partnerMpnId }, isMock);
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
