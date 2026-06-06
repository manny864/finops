import { NextRequest, NextResponse } from "next/server";
import { getNativeBudgets } from "@/services/budgetService";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const subscriptionId = url.searchParams.get("subscriptionId");
        
        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan tenantId o subscriptionId." }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const burnData = await getNativeBudgets(tenantId, subscriptionId);

        return NextResponse.json({ burnData });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
