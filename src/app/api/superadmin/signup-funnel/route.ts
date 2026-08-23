/**
 * Endpoint para Analítica del Embudo de Inscripción (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { getSignupFunnelAnalytics } from "@/services/superAdminFunnel.service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const status = searchParams.get("status") || undefined;
        const plan = searchParams.get("plan") || undefined;
        const searchEmail = searchParams.get("q") || searchParams.get("email") || undefined;

        const result = await getSignupFunnelAnalytics(
            { status, plan, searchEmail },
            isMock
        );

        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
