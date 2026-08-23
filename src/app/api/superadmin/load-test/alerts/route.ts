/**
 * Endpoint para Listar Alertas del Sistema generadas por Pruebas de Carga y Telemetría (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { getSystemPerformanceAlerts } from "@/services/loadTesting.service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";
        const onlyPending = searchParams.get("unacknowledged") === "true" || searchParams.get("pending") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const alerts = await getSystemPerformanceAlerts(onlyPending, isMock);
        return NextResponse.json({ success: true, alerts });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
