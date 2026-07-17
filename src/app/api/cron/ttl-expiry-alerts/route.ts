import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { serverError } from "@/lib/apiErrors";
import { sendEmailAsync } from "@/lib/emailHelper";
import { sendLegacyWebhookAlert } from "@/lib/notifications";
import { findExpiredResources } from "@/services/ttlService";
import { createNotification } from "@/lib/notify";

/**
 * Evaluador de reglas de alerta `ttl_expiry` (AlertRules): "El sistema te
 * alerta antes de la eliminación automática" (paso 3 del manual de TTL).
 * Para cada regla habilitada, evalúa los entornos con tag ExpireOn/TTL del
 * tenant y notifica los que vencen dentro de threshold_value días (o ya
 * vencieron) — mismo patrón que /api/cron/credential-expiry-alerts.
 *
 * Anti-spam: una notificación por regla por día (o cada
 * reminder_frequency_hours si está seteado), vía last_triggered_at.
 * Agendado en el crontab del VPS con `Authorization: Bearer $CRON_SECRET`.
 */

function fmtDays(d: number): string {
    if (d < 0) return `venció hace ${Math.abs(d)} día(s)`;
    if (d === 0) return "vence hoy";
    return `vence en ${d} día(s)`;
}

function buildTtlAlertEmailHtml(ruleName: string, thresholdDays: number, resources: any[]): string {
    const rows = resources.slice(0, 15).map(r =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${r.name || r.id}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${(r.type || '').split('/').pop()}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${r.resourceGroup || ''}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${fmtDays(r.daysUntilExpiry)}</td></tr>`
    ).join("");
    return `<div style="font-family:sans-serif">
        <h2>⏳ ${resources.length} entorno(s) próximo(s) a expirar — ${ruleName}</h2>
        <p>Umbral configurado: ${thresholdDays} día(s) antes de la expiración.</p>
        <table style="border-collapse:collapse;width:100%;font-size:13px">
            <thead><tr style="text-align:left;background:#f5f5f5">
                <th style="padding:6px 10px">Recurso</th><th style="padding:6px 10px">Tipo</th>
                <th style="padding:6px 10px">Resource Group</th><th style="padding:6px 10px">Expiración</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:16px;color:#666;font-size:12px">Revisá y renová o eliminá estos entornos desde Limpieza de Nube → Expiraciones TTL antes de que se disparen las eliminaciones automáticas.</p>
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
            `SELECT id, tenant_id, rule_name, threshold_value, channel, channel_target, reminder_frequency_hours
             FROM AlertRules
             WHERE rule_type = 'ttl_expiry' AND enabled = TRUE
               AND (
                 last_triggered_at IS NULL
                 OR (reminder_frequency_hours IS NOT NULL AND last_triggered_at < DATE_SUB(NOW(), INTERVAL reminder_frequency_hours HOUR))
               )
             LIMIT 200`
        );

        if (!rules || rules.length === 0) {
            return NextResponse.json({ success: true, evaluated: 0, notified: 0 });
        }

        const byTenant = new Map<string, any[]>();
        for (const rule of rules) {
            const list = byTenant.get(rule.tenant_id) || [];
            list.push(rule);
            byTenant.set(rule.tenant_id, list);
        }

        let notified = 0;
        const errors: string[] = [];

        for (const [tenantId, tenantRules] of byTenant.entries()) {
            let resources: any[] | null = null;
            try {
                resources = await findExpiredResources(tenantId);
            } catch (e: any) {
                errors.push(`${tenantId}: ${e?.message || "ARG error"}`);
                continue;
            }
            if (!resources) continue;

            for (const rule of tenantRules) {
                const thresholdDays = Number(rule.threshold_value) || 3;
                const matching = resources.filter(r => typeof r.daysUntilExpiry === 'number' && r.daysUntilExpiry <= thresholdDays).slice(0, 30);
                if (matching.length === 0) continue;

                const title = `⏳ ${matching.length} entorno(s) por expirar — ${rule.rule_name}`;
                const message = matching.slice(0, 10).map(r => `${r.name} (${(r.type || '').split('/').pop()}) — ${fmtDays(r.daysUntilExpiry)}`).join("\n");
                try {
                    if (rule.channel === "email") {
                        await sendEmailAsync(title, buildTtlAlertEmailHtml(rule.rule_name, thresholdDays, matching), rule.channel_target);
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
                        href: "/cleanup/ttl",
                        severity: matching.some(r => r.daysUntilExpiry < 0) ? "critical" : "warning",
                        source: "ttl_expiry",
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
        return serverError(e, { context: "GET /api/cron/ttl-expiry-alerts" });
    }
}
