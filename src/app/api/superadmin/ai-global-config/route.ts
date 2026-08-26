/**
 * Endpoint para Configuración Global de IA (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import {
    getPlatformGlobalAiSettings,
    savePlatformGlobalAiSettings,
} from "@/services/superAdminAiConfig.service";
import { SavePlatformAiPayload } from "@/types/superAdminAiConfig.types";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const settings = await getPlatformGlobalAiSettings(isMock);
        return NextResponse.json({ success: true, ...settings, settings });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        let email = "superadmin@cscloudsolutions.com";
        if (!isMock) {
            const identity = await requireSuperAdmin(request);
            email = identity.email || "superadmin@cscloudsolutions.com";
        }

        const body: SavePlatformAiPayload = await request.json().catch(() => ({} as SavePlatformAiPayload));
        const result = await savePlatformGlobalAiSettings(body, email, isMock);

        return NextResponse.json(result);
    } catch (error) {
        console.error("[ai-global-config] Error al guardar configuración:", error);
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
