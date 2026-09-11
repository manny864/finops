import { NextRequest, NextResponse } from "next/server";
import { generateOnboardingScript } from "@/lib/onboardingScriptTemplate";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { clientTenantId, subscriptionId, locale } = body;

        if (!clientTenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros clientTenantId o subscriptionId" }, { status: 400 });
        }

        // isMockTenant ANTES del guard, como el resto de las rutas: los tenants
        // demo no estan en Tenants ni tienen membresia, asi que requireTenantAccess
        // los rechaza. La generacion en si es texto puro —no toca Azure— asi que
        // la demo produce el MISMO script que produccion, que es lo que hay que
        // poder mostrar.
        const isDemo = isMockTenant(clientTenantId);
        if (!isDemo) {
            await requireTenantAccess(request, clientTenantId);
        }

        // El tier decide que roles pide el script; el demo muestra el de Enterprise
        // (el mas completo) y no consulta Tenants, donde no tiene fila.
        let tier = 'Enterprise';
        if (!isDemo) {
            tier = 'Professional';
            try {
                const [rows] = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ?", [clientTenantId]);
                if (Array.isArray(rows) && rows.length > 0 && (rows[0] as { tier?: string }).tier) {
                    tier = (rows[0] as { tier: string }).tier;
                }
            } catch (e) {
                console.error("Error fetching tier:", e);
            }
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
