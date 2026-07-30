import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { getCachedCarbonFootprint } from "@/lib/carbonFootprint";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const subscriptionId = searchParams.get("subscriptionId") || "All";
        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        // IA-6: subscriptionId se interpola en un query KQL (Resource Graph).
        // Se acepta solo "all" o un UUID válido para prevenir inyección KQL.
        if (subscriptionId.toLowerCase() !== "all" &&
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscriptionId)) {
            return NextResponse.json({ success: false, error: "subscriptionId inválido" }, { status: 400 });
        }

        const payload = await getCachedCarbonFootprint(tenantId, subscriptionId);
        return NextResponse.json(payload);
    } catch (error: any) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        console.error("Sustainability Fetch Error:", error);
        return NextResponse.json({
            success: false,
            error: error?.message || "Fallo al calcular emisiones.",
        }, { status: 500 });
    }
}
