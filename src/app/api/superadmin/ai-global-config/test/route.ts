/**
 * Endpoint para Probar Conectividad con Proveedor de IA Global (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { testPlatformAiConnection } from "@/services/superAdminAiConfig.service";
import { TestPlatformAiPayload } from "@/types/superAdminAiConfig.types";

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const body: TestPlatformAiPayload = await request.json().catch(() => ({ testType: "non_enterprise" }));
        const result = await testPlatformAiConnection(body, isMock);

        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
