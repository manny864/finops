import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { serverError } from "@/lib/apiErrors";
import { sendEmailAsync } from "@/lib/emailHelper";
import { sendLegacyWebhookAlert } from "@/lib/notifications";
import { getExpiringCredentials, credLine, buildCredentialAlertEmailHtml, type CredItem } from "@/services/credentialExpiryService";
import { createNotification } from "@/lib/notify";

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
 *
 * credLine/buildCredentialAlertEmailHtml viven en credentialExpiryService.ts
 * (compartidas con /api/budgets/alerts/[id]/test, el botón "Probar" del panel).
 */

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

        // Recurrencia por-regla (reminder_frequency_hours): NULL = alertar una
        // sola vez (nunca vuelve a matchear si last_triggered_at ya está seteado);
        // si tiene un valor, re-alerta cada esa cantidad de horas mientras la
        // condición se siga cumpliendo. Antes era un hardcode de 23h para todas.
        const [rules]: any = await pool.query(
            `SELECT id, tenant_id, rule_name, threshold_value, channel, channel_target, reminder_frequency_hours
             FROM AlertRules
             WHERE rule_type = 'credential_expiry' AND enabled = TRUE
               AND (
                 last_triggered_at IS NULL
                 OR (reminder_frequency_hours IS NOT NULL AND last_triggered_at < DATE_SUB(NOW(), INTERVAL reminder_frequency_hours HOUR))
               )
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
                        await sendEmailAsync(title, buildCredentialAlertEmailHtml(rule.rule_name, thresholdDays, matching), rule.channel_target);
                    } else {
                        await sendLegacyWebhookAlert(rule.channel_target, { title, message, severity: "warning" });
                    }
                    await pool.query(
                        "UPDATE AlertRules SET last_triggered_at = NOW(), trigger_count = trigger_count + 1 WHERE id = ?",
                        [rule.id]
                    );
                    await createNotification({
                        tenantId,
                        title,
                        message,
                        href: "/governance/credentials",
                        severity: matching.some(c => c.daysTillExpiry < 0) ? "critical" : "warning",
                        source: "credential_expiry",
                    });
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
