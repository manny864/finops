import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { serverError } from "@/lib/apiErrors";
import { sendEmailAsync } from "@/lib/emailHelper";
import { sendLegacyWebhookAlert } from "@/lib/notifications";
import { getExpiringCredentials, type CredItem } from "@/services/credentialExpiryService";

/**
 * Evaluador de reglas de alerta `credential_expiry` (AlertRules):
 * para cada regla habilitada, consulta Microsoft Graph (1 vez por tenant) y,
 * si hay credenciales de App Registrations que vencen dentro de
 * `threshold_value` días (o ya vencidas), notifica por el canal configurado:
 *  - email  → sendEmailAsync (Azure Communication Services)
 *  - slack / teams / webhook → POST al webhook de channel_target (SSRF-safe)
 *
 * Anti-spam: una notificación por regla por día (last_triggered_at).
 * Agendado en el crontab del VPS (diario) con `Authorization: Bearer $CRON_SECRET`.
 */

function credLine(c: CredItem): string {
    const state = c.daysTillExpiry < 0 ? `VENCIDA hace ${Math.abs(c.daysTillExpiry)} días` : `vence en ${c.daysTillExpiry} días`;
    return `${c.displayName} (${c.credentialType === "password" ? "secreto" : "certificado"}) — ${state} (${c.expiresAt.slice(0, 10)})`;
}

function buildEmailHtml(ruleName: string, thresholdDays: number, creds: CredItem[]): string {
    const rows = creds.map(c => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${c.displayName}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${c.credentialType === "password" ? "Secreto" : "Certificado"}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${c.expiresAt.slice(0, 10)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${c.daysTillExpiry < 0 ? "#c00" : c.daysTillExpiry <= 7 ? "#d60" : "#333"};font-weight:bold;">
            ${c.daysTillExpiry < 0 ? `Vencida (${Math.abs(c.daysTillExpiry)} días)` : `${c.daysTillExpiry} días`}
        </td></tr>`).join("");
    return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;">
        <h2 style="color:#0054A6;">🔑 Alerta de credenciales por expirar</h2>
        <p>La regla <b>${ruleName}</b> detectó <b>${creds.length}</b> credencial(es) que vencen dentro de <b>${thresholdDays} días</b> (o ya vencidas):</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
            <tr style="background:#f4f7fb;text-align:left;">
                <th style="padding:8px 10px;">Aplicación</th><th style="padding:8px 10px;">Tipo</th>
                <th style="padding:8px 10px;">Vence</th><th style="padding:8px 10px;">Estado</th>
            </tr>
            ${rows}
        </table>
        <p style="color:#666;font-size:12px;margin-top:16px;">
            Renová estas credenciales en Entra ID antes del vencimiento para evitar cortes de servicio.
            Detalle completo en Gobernanza → Credenciales por Expirar.
        </p>
    </div>`;
}

export async function GET(request: NextRequest) {
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error("CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        await initializeDatabase();

        const [rules]: any = await pool.query(
            `SELECT id, tenant_id, rule_name, threshold_value, channel, channel_target
             FROM AlertRules
             WHERE rule_type = 'credential_expiry' AND enabled = TRUE
               AND (last_triggered_at IS NULL OR last_triggered_at < DATE_SUB(NOW(), INTERVAL 23 HOUR))
             LIMIT 200`
        );

        if (!rules || rules.length === 0) {
            return NextResponse.json({ success: true, evaluated: 0, notified: 0 });
        }

        // 1 consulta a Graph por tenant (horizonte = mayor threshold de sus reglas).
        const byTenant = new Map<string, any[]>();
        for (const rule of rules) {
            const list = byTenant.get(rule.tenant_id) || [];
            list.push(rule);
            byTenant.set(rule.tenant_id, list);
        }

        let notified = 0;
        const errors: string[] = [];

        for (const [tenantId, tenantRules] of byTenant.entries()) {
            const maxDays = Math.max(...tenantRules.map((r: any) => Number(r.threshold_value) || 30));
            let creds: CredItem[] | null = null;
            try {
                creds = await getExpiringCredentials(tenantId, maxDays);
            } catch (e: any) {
                errors.push(`${tenantId}: ${e?.message || "Graph error"}`);
                continue;
            }
            if (creds === null) continue; // sin SP creds (onboarding incompleto)

            for (const rule of tenantRules) {
                const thresholdDays = Number(rule.threshold_value) || 30;
                const matching = creds.filter(c => c.daysTillExpiry <= thresholdDays).slice(0, 20);
                if (matching.length === 0) continue;

                const title = `🔑 ${matching.length} credencial(es) por vencer — ${rule.rule_name}`;
                const message = matching.slice(0, 10).map(credLine).join("\n");
                try {
                    if (rule.channel === "email") {
                        await sendEmailAsync(title, buildEmailHtml(rule.rule_name, thresholdDays, matching), rule.channel_target);
                    } else {
                        await sendLegacyWebhookAlert(rule.channel_target, { title, message, severity: "warning" });
                    }
                    await pool.query(
                        "UPDATE AlertRules SET last_triggered_at = NOW(), trigger_count = trigger_count + 1 WHERE id = ?",
                        [rule.id]
                    );
                    notified++;
                } catch (sendErr: any) {
                    errors.push(`rule ${rule.id}: ${sendErr?.message || "send error"}`);
                }
            }
        }

        return NextResponse.json({
            success: true,
            evaluated: rules.length,
            notified,
            ...(errors.length ? { errors: errors.slice(0, 10) } : {}),
        });
    } catch (e: unknown) {
        return serverError(e, { context: "GET /api/cron/credential-expiry-alerts" });
    }
}
