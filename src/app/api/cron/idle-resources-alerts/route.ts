import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { errorMessage, serverError } from "@/lib/apiErrors";
import { sendEmailStrict } from "@/lib/emailHelper";
import { sendLegacyWebhookAlert } from "@/lib/notifications";
import { createNotification } from "@/lib/notify";
import { recordCronRun } from "@/lib/cronRunTracker";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";
import { prewarmFetch } from "@/lib/prewarmFetch";

/**
 * Evaluador de reglas `idle_resources` (AlertRules): avisa cuando el desperdicio
 * detectado supera el umbral que configuró el tenant.
 *
 * POR QUÉ HACÍA FALTA. La detección de recursos ociosos es lo más completo que
 * tiene la plataforma --unas 20 reglas KQL contra Resource Graph-- y era 100%
 * pasiva: el número estaba ahí, fresco, y nadie se enteraba hasta abrir la
 * pantalla. Credenciales por vencer y TTL ya tenían su alerta; el desperdicio,
 * que es el corazón del producto, no.
 *
 * NO RECONSULTA AZURE. Pega al endpoint interno de zombis, que responde desde el
 * caché que `prewarm-daily` ya calienta una vez por día. Eso importa: Cost
 * Management y Resource Graph vienen throttleando, y una alerta que agrega carga
 * para avisar que hay que bajar el gasto sería un mal negocio. Si el caché está
 * frío el barrido corre igual, pero una vez al día y por tenant con regla activa
 * -- no por cada tenant del sistema.
 *
 * Anti-spam: `reminder_frequency_hours` por regla, igual que
 * `credential-expiry-alerts` y `ttl-expiry-alerts`. Con NULL avisa una sola vez.
 *
 * Agendar diario con `Authorization: Bearer $CRON_SECRET`.
 */

interface ReglaOciosos {
    id: number;
    tenant_id: string;
    rule_name: string;
    threshold_value: number | null;
    channel: string;
    channel_target: string;
}

async function leerDesperdicio(tenantId: string, cronSecret: string): Promise<{
    ahorroUSD: number;
    recursos: number;
} | null> {
    const url = `${getInternalBaseUrl()}/api/cleanup/zombies?tenantId=${encodeURIComponent(tenantId)}&subscriptionId=All`;
    const res = await prewarmFetch(url, { headers: { "X-Cron-Auth": cronSecret }, cache: "no-store" });
    if (!res.ok) throw new Error(`zombies devolvió ${res.status}`);

    const payload = await res.json();
    const metrics = payload?.metrics;
    if (!metrics) return null;

    return {
        ahorroUSD: Number(metrics.totalPotentialSavingsUSD || 0),
        recursos: Number(metrics.hardWasteZombiesCount || 0),
    };
}

export async function GET(request: NextRequest) {
    const startedAt = Date.now();
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

        const [reglas]: any = await pool.query(
            `SELECT id, tenant_id, rule_name, threshold_value, channel, channel_target
               FROM AlertRules
              WHERE rule_type = 'idle_resources' AND enabled = TRUE
                AND (
                  last_triggered_at IS NULL
                  OR (reminder_frequency_hours IS NOT NULL
                      AND last_triggered_at < DATE_SUB(NOW(), INTERVAL reminder_frequency_hours HOUR))
                )
              LIMIT 200`
        );

        if (!reglas || reglas.length === 0) {
            await recordCronRun({
                cronName: "idle-resources-alerts",
                status: "ok",
                durationMs: Date.now() - startedAt,
                summary: "sin reglas activas",
            });
            return NextResponse.json({ success: true, evaluadas: 0, notificadas: 0 });
        }

        // Un barrido por tenant aunque tenga varias reglas: el costo está en
        // consultar Azure, no en evaluar el umbral.
        const porTenant = new Map<string, ReglaOciosos[]>();
        for (const r of reglas as ReglaOciosos[]) {
            porTenant.set(r.tenant_id, [...(porTenant.get(r.tenant_id) || []), r]);
        }

        let notificadas = 0;
        const errores: string[] = [];

        for (const [tenantId, reglasDelTenant] of porTenant.entries()) {
            let desperdicio: Awaited<ReturnType<typeof leerDesperdicio>> = null;
            try {
                desperdicio = await leerDesperdicio(tenantId, cronSecret);
            } catch (e) {
                errores.push(`${tenantId}: ${errorMessage(e) || "no se pudo leer el desperdicio"}`);
                continue;
            }
            if (!desperdicio) continue;

            for (const regla of reglasDelTenant) {
                const umbral = Number(regla.threshold_value) || 0;
                if (desperdicio.ahorroUSD < umbral) continue;

                const titulo = `🧟 ${desperdicio.recursos} recurso(s) ocioso(s) — ${regla.rule_name}`;
                const mensaje =
                    `Hay ~USD ${desperdicio.ahorroUSD.toFixed(2)} al mes en recursos sin uso ` +
                    `(${desperdicio.recursos} recurso(s) detectado(s)). Umbral configurado: USD ${umbral.toFixed(2)}.`;

                try {
                    if (regla.channel === "email") {
                        await sendEmailStrict(titulo, `<p>${mensaje}</p>`, regla.channel_target);
                    } else {
                        await sendLegacyWebhookAlert(regla.channel_target, { title: titulo, message: mensaje, severity: "warning" });
                    }

                    // El UPDATE va DESPUÉS del envío y dentro del mismo try: si
                    // el mail falla, la regla no queda marcada como disparada y
                    // la corrida siguiente reintenta en vez de tapar el aviso
                    // durante `reminder_frequency_hours`.
                    await pool.query(
                        "UPDATE AlertRules SET last_triggered_at = NOW(), trigger_count = trigger_count + 1 WHERE id = ?",
                        [regla.id]
                    );

                    await createNotification({
                        tenantId,
                        title: titulo,
                        message: mensaje,
                        titleKey: "notif_idle_resources_title",
                        messageKey: "notif_idle_resources_msg",
                        params: { count: desperdicio.recursos, amount: desperdicio.ahorroUSD.toFixed(2) },
                        href: "/cleanup/zombies",
                        severity: "warning",
                        source: "idle_resources",
                    });
                    notificadas++;
                } catch (envioErr) {
                    errores.push(`regla ${regla.id}: ${errorMessage(envioErr) || "error de envío"}`);
                }
            }
        }

        const respuesta = {
            success: true,
            evaluadas: reglas.length,
            notificadas,
            ...(errores.length ? { errores: errores.slice(0, 10) } : {}),
        };

        await recordCronRun({
            cronName: "idle-resources-alerts",
            status: errores.length ? "warning" : "ok",
            durationMs: Date.now() - startedAt,
            summary: `${reglas.length} regla(s), ${notificadas} aviso(s)`,
            details: respuesta,
        });

        return NextResponse.json(respuesta);
    } catch (error) {
        await recordCronRun({
            cronName: "idle-resources-alerts",
            status: "error",
            durationMs: Date.now() - startedAt,
            summary: errorMessage(error) || "error",
        });
        return serverError(error, { context: "cron/idle-resources-alerts", message: "Fallo el cron de alertas de recursos ociosos." });
    }
}
