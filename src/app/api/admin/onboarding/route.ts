import { NextRequest, NextResponse } from "next/server";
import { generateOnboardingScript } from "@/lib/onboardingScriptTemplate";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { clientTenantId, subscriptionId, locale } = body;

        if (!clientTenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros clientTenantId o subscriptionId" }, { status: 400 });
        }

        await requireTenantAccess(request, clientTenantId);

        let tier = 'Essential';
        try {
            const [rows] = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ?", [clientTenantId]);
            if (Array.isArray(rows) && rows.length > 0 && (rows[0] as { tier?: string }).tier) {
                tier = (rows[0] as { tier: string }).tier;
            }
        } catch (e) {
            console.error("Error fetching tier:", e);
        }

        let script;
        try {
            const scriptLocale = ['es', 'en', 'pt-BR'].includes(locale) ? locale : 'es';
            script = generateOnboardingScript(clientTenantId, subscriptionId, tier, scriptLocale);
        } catch (err) {
            return NextResponse.json({ error: (err as Error).message }, { status: 400 });
        }

        return NextResponse.json({ success: true, script });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        console.error('admin/onboarding error:', e);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
