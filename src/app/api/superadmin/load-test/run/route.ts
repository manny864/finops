/**
 * Endpoint para Ejecutar Pruebas de Carga en Servidor (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { executeLoadTest } from "@/services/loadTesting.service";
import { LoadTestEndpoint } from "@/types/loadTesting.types";

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        let executedBy = "superadmin@cscloudsolutions.com";
        if (!isMock) {
            const identity = await requireSuperAdmin(request);
            executedBy = identity.email || "superadmin@cscloudsolutions.com";
        }

        const body = await request.json().catch(() => ({}));
        const targetEndpoint: LoadTestEndpoint = body.targetEndpoint || body.target || "/api/health";
        const concurrencyLevel = Number(body.concurrencyLevel || body.concurrency) || 10;
        const durationSeconds = Number(body.durationSeconds) || 5;

        if (concurrencyLevel < 1 || concurrencyLevel > 50) {
            return NextResponse.json({ success: false, error: "Concurrencia debe estar entre 1 y 50." }, { status: 400 });
        }
        if (durationSeconds < 1 || durationSeconds > 15) {
            return NextResponse.json({ success: false, error: "Duración debe estar entre 1 y 15 segundos." }, { status: 400 });
        }

        const result = await executeLoadTest(
            { targetEndpoint, concurrencyLevel, durationSeconds },
            executedBy,
            isMock
        );

        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
