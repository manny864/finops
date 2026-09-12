import { NextRequest, NextResponse } from "next/server";
import { AzureCommitmentSimulatorService } from "@/services/azureCommitmentSimulator.service";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        const quota = await AzureCommitmentSimulatorService.getExchangeQuota(tenantId);
        return NextResponse.json({ success: true, data: quota });
    } catch (error: any) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        return NextResponse.json({ success: false, error: error.message || "Error al obtener cuota de devolución" }, { status: 500 });
    }
}
