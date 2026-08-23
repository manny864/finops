/**
 * Endpoint para Resolver una Alerta del Sistema (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { resolvePerformanceAlert } from "@/services/loadTesting.service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";
        const { id } = await params;

        let email = "superadmin@cscloudsolutions.com";
        if (!isMock) {
            const identity = await requireSuperAdmin(request);
            email = identity.email || "superadmin@cscloudsolutions.com";
        }

        const result = await resolvePerformanceAlert(id, email, isMock);
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
