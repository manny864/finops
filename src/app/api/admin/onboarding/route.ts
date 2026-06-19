import { NextRequest, NextResponse } from "next/server";
import { generateOnboardingScript } from "@/lib/onboardingScriptTemplate";
import pool from "@/modules/storage/db";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { clientTenantId, subscriptionId } = body;

        if (!clientTenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros clientTenantId o subscriptionId" }, { status: 400 });
        }

        let tier = 'Essential';
        try {
            const [rows] = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ?", [clientTenantId]) as any[];
            if (rows.length > 0 && rows[0].tier) {
                tier = rows[0].tier;
            }
        } catch (e: any) {
            console.error("Error fetching tier:", e.message);
        }

        let script;
        try {
            script = generateOnboardingScript(clientTenantId, subscriptionId, tier);
        } catch (err: any) {
            return NextResponse.json({ error: err.message }, { status: 400 });
        }
        
        return NextResponse.json({ success: true, script });
    } catch (e: any) {
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}
