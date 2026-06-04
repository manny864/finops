import { NextRequest, NextResponse } from "next/server";
import { generateOnboardingScript } from "@/lib/onboardingScriptTemplate";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { clientTenantId, subscriptionId } = body;

        if (!clientTenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros clientTenantId o subscriptionId" }, { status: 400 });
        }

        const script = generateOnboardingScript(clientTenantId, subscriptionId);
        
        return NextResponse.json({ success: true, script });
    } catch (e: any) {
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}
