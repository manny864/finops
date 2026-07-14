import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { sendEmailAsync } from "@/lib/emailHelper";
import { sendLegacyWebhookAlert } from "@/lib/notifications";
import { getExpiringCredentials, credLine, buildCredentialAlertEmailHtml } from "@/services/credentialExpiryService";

/**
 * Dispara AHORA MISMO una notificación de prueba para una regla de alerta,
 * usando el canal/destino ya configurado — sin esperar al cron diario ni
 * afectar la recurrencia real (no toca last_triggered_at/trigger_count).
 * Por ahora solo soporta rule_type='credential_expiry' (la única con un
 * evaluador automático real hoy — ver credential-expiry-alerts/route.ts).
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
        const { id } = await params;

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, message: "[SIMULACIÓN DEMO] Notificación de prueba enviada." });
        }

        const [rows]: any = await pool.query(
            `SELECT id, rule_name, rule_type, threshold_value, channel, channel_target
             FROM AlertRules WHERE id = ? AND tenant_id = ? LIMIT 1`,
            [id, tenantId]
        );
        const rule = rows?.[0];
        if (!rule) {
            return NextResponse.json({ error: "Regla de alerta no encontrada." }, { status: 404 });
        }
        if (rule.rule_type !== "credential_expiry") {
            return NextResponse.json({ error: "Probar alertas solo está disponible para reglas de tipo 'Credenciales por vencer' por ahora." }, { status: 400 });
        }

        const thresholdDays = Number(rule.threshold_value) || 30;
        const creds = await getExpiringCredentials(tenantId, thresholdDays);
        if (creds === null) {
            return NextResponse.json({ error: "No se pudo consultar Microsoft Graph (¿el Service Principal del tenant tiene el rol Application.Read.All?)." }, { status: 502 });
        }
        const matching = creds.filter(c => c.daysTillExpiry <= thresholdDays).slice(0, 20);

        const title = `🔑 [PRUEBA] ${matching.length} credencial(es) por vencer — ${rule.rule_name}`;
        const message = matching.slice(0, 10).map(credLine).join("\n") || "(sin credenciales dentro del umbral configurado en este momento)";

        if (rule.channel === "email") {
            await sendEmailAsync(title, buildCredentialAlertEmailHtml(rule.rule_name, thresholdDays, matching, true), rule.channel_target);
        } else {
            await sendLegacyWebhookAlert(rule.channel_target, { title, message, severity: "info" });
        }

        return NextResponse.json({ success: true, matchedCount: matching.length });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[budgets/alerts/test] error:", error);
        return NextResponse.json({ error: "No se pudo enviar la prueba." }, { status: 500 });
    }
}
