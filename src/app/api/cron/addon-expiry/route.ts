import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { serverError } from "@/lib/apiErrors";
import { createNotification } from "@/lib/notify";
import { recordCronRun } from "@/lib/cronRunTracker";
import { ADDON_CATALOG } from "@/lib/addonCatalog";
import { sendEmailStrict } from "@/lib/emailHelper";

/**
 * Avisa que un modulo comprado suelto esta por vencer, y marca como `expired`
 * los que ya vencieron.
 *
 * Por que hace falta: el corte de acceso ya funcionaba solo --`getActiveAddons`
 * filtra por `expires_at > NOW()` y `requireTenantTier` consulta esa lista--,
 * pero era un corte MUDO. El cliente se enteraba cuando la pantalla dejaba de
 * abrir. Habia crons de vencimiento para trials, suscripciones, credenciales y
 * TTL; para los add-ons no habia ninguno.
 *
 * Anti-spam: un aviso por pase (`expiry_notified_at`), no uno por corrida.
 * Agendar diario con `Authorization: Bearer $CRON_SECRET`.
 */
const DIAS_DE_AVISO = 7;

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

        // 1. Los ya vencidos pasan a 'expired'. No cambia quien tiene acceso
        // (eso ya lo resolvia el filtro por fecha); deja la tabla diciendo la
        // verdad, que es lo que mira soporte cuando el cliente pregunta.
        const [vencidos]: any = await pool.query(
            `UPDATE TenantAddons
                SET status = 'expired'
              WHERE status = 'active'
                AND expires_at IS NOT NULL
                AND expires_at <= NOW()`
        );

        // 2. Los que entran en la ventana de aviso y todavia no se avisaron.
        const [porVencer]: any = await pool.query(
            `SELECT a.id, a.tenant_id, a.addon_key, a.expires_at,
                    DATEDIFF(a.expires_at, NOW()) AS dias,
                    (SELECT u.email FROM Users u
                      WHERE u.tenant_id = a.tenant_id AND u.role IN ('Admin','Owner')
                      ORDER BY u.role = 'Owner' DESC LIMIT 1) AS email
               FROM TenantAddons a
              WHERE a.status = 'active'
                AND a.expires_at IS NOT NULL
                AND a.expires_at > NOW()
                AND a.expires_at <= DATE_ADD(NOW(), INTERVAL ? DAY)
                AND a.expiry_notified_at IS NULL
              LIMIT 500`,
            [DIAS_DE_AVISO]
        );

        let avisados = 0;
        const errores: string[] = [];

        for (const fila of porVencer || []) {
            const producto = ADDON_CATALOG[fila.addon_key];
            const nombre = producto?.name || fila.addon_key;
            const dias = Math.max(0, Number(fila.dias) || 0);
            const titulo = `${nombre} vence en ${dias} dia(s)`;
            const mensaje = `Tu acceso a "${nombre}" vence el ${new Date(fila.expires_at).toLocaleDateString("es-AR")}. Renovalo desde el marketplace para no perderlo.`;

            try {
                await createNotification({
                    tenantId: fila.tenant_id,
                    title: titulo,
                    message: mensaje,
                    titleKey: "notif_addon_expiry_title",
                    messageKey: "notif_addon_expiry_msg",
                    params: { addonName: nombre, days: dias },
                    href: "/admin/account?tab=marketplace",
                    severity: dias <= 2 ? "critical" : "warning",
                    source: "addon_expiry",
                });

                // `sendEmailStrict` y no `sendEmailAsync`: el segundo se traga la
                // falla en un IIFE que nadie await-ea, asi que un mail que nunca
                // salio dejaria igual la corrida en "ok" -- y, peor, marcaria
                // `expiry_notified_at`, que es el anti-spam: el aviso no se
                // atrasaria, se perderia. Con strict la excepcion sube, el UPDATE
                // no corre y la corrida siguiente reintenta.
                if (fila.email) {
                    await sendEmailStrict(
                        titulo,
                        `<p>${mensaje}</p><p>Si no lo renovás, al vencer se cierra el acceso al módulo y a sus pantallas.</p>`,
                        fila.email
                    );
                }

                await pool.query("UPDATE TenantAddons SET expiry_notified_at = NOW() WHERE id = ?", [fila.id]);
                avisados++;
            } catch (e) {
                errores.push(`addon ${fila.id}: ${(e as Error)?.message || "error"}`);
            }
        }

        const respuesta = {
            success: true,
            expirados: Number(vencidos?.affectedRows) || 0,
            porVencer: (porVencer || []).length,
            avisados,
            ...(errores.length ? { errores: errores.slice(0, 10) } : {}),
        };

        await recordCronRun({
            cronName: "addon-expiry",
            status: errores.length ? "warning" : "ok",
            durationMs: Date.now() - startedAt,
            summary: `${respuesta.expirados} vencido(s), ${avisados} aviso(s)`,
            details: respuesta,
        });

        return NextResponse.json(respuesta);
    } catch (error) {
        await recordCronRun({
            cronName: "addon-expiry",
            status: "error",
            durationMs: Date.now() - startedAt,
            summary: (error as Error)?.message || "error",
        });
        return serverError(error, { context: "cron/addon-expiry", message: "Fallo el cron de vencimiento de add-ons." });
    }
}
