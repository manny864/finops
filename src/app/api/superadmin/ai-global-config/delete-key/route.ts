/**
 * Endpoint para Eliminar API Key Global de IA (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { deletePlatformAiApiKey } from "@/services/superAdminAiConfig.service";

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        let email = "superadmin@cscloudsolutions.com";
        if (!isMock) {
            const identity = await requireSuperAdmin(request);
            email = identity.email || "superadmin@cscloudsolutions.com";
        }

        const body = await request.json().catch(() => ({}));
        const target: "non_enterprise" | "enterprise" =
            body.target === "enterprise" ? "enterprise" : "non_enterprise";

        const result = await deletePlatformAiApiKey(target, email, isMock);
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
