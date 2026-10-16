/**
 * MEJ-35 — armar y mandar el correo de una suscripción.
 *
 * Vive aparte del cron para que "enviar ahora" desde la pantalla y el envío
 * programado sean EXACTAMENTE el mismo camino. Si fueran dos, la prueba podría
 * andar y el envío real no — que es la peor forma de tener un botón de prueba.
 */

import pool from "@/modules/storage/db";
import { sendEmailStrict } from "@/lib/emailHelper";
import { GENERADORES, type AlcanceDelReporte } from "@/services/reportRenderers.service";
import { alcanceDelUsuario } from "@/services/userScope.service";
import { AuthError } from "@/lib/requestAuth";
import type { RowDataPacket } from "mysql2";

export interface SuscripcionAEnviar {
    id: number;
    tenantId: string;
    reportType: string;
    scope: AlcanceDelReporte | null;
    recipients: string[];
}

export interface ResultadoEnvio {
    enviados: number;
    filas: number;
    omitido?: string;
}

function baseUrl(): string {
    return (
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.APP_BASE_URL ||
        "https://app.cscloudsolutions.com.ar"
    ).replace(/\/+$/, "");
}

async function exigirSuscripcionVigente(sub: SuscripcionAEnviar): Promise<void> {
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT created_by FROM ReportSubscriptions
         WHERE id = ? AND tenant_id = ? AND active = 1 AND report_type = ?
           AND scope_json <=> CAST(? AS JSON) AND recipients_json = CAST(? AS JSON) LIMIT 1`,
        [sub.id, sub.tenantId, sub.reportType, sub.scope ? JSON.stringify(sub.scope) : null,
            JSON.stringify(sub.recipients)],
    );
    if (!rows.length) {
        throw new AuthError("La suscripción cambió o ya no está activa.", 409, "REPORT_SUBSCRIPTION_CHANGED");
    }
    const author: unknown = rows[0].created_by;
    if (author == null) return; // Suscripciones históricas de procesos, sin autor humano.
    if (typeof author !== "string" || !author.trim()) {
        throw new AuthError("Falta identidad del autor.", 403, "IDENTITY_EMAIL_REQUIRED");
    }
    const [users] = await pool.query<RowDataPacket[]>(
        "SELECT account_status FROM Users WHERE tenant_id = ? AND email = ?",
        [sub.tenantId, author],
    );
    if (users.some((user) => String(user.account_status).toUpperCase() !== "ACTIVE")) {
        throw new AuthError("El autor ya no está activo.", 403, "ACCOUNT_DISABLED");
    }
    if (await alcanceDelUsuario(sub.tenantId, author)) {
        throw new AuthError("El alcance del autor no permite este envío.", 403, "SCOPE_ROUTE_NOT_AWARE");
    }
}

export async function enviarSuscripcion(
    sub: SuscripcionAEnviar,
    opciones: { marcarEnviado: boolean; periodo?: string | null } = { marcarEnviado: true }
): Promise<ResultadoEnvio> {
    const generar = GENERADORES[sub.reportType];
    if (!generar) throw new Error(`No hay generador para el reporte "${sub.reportType}"`);
    await exigirSuscripcionVigente(sub);

    const [filasTenant] = await pool.query<any[]>(
        "SELECT company_name FROM Tenants WHERE tenant_id = ? LIMIT 1",
        [sub.tenantId]
    );
    const tenantName = filasTenant?.[0]?.company_name || sub.tenantId;

    const reporte = await generar({
        tenantId: sub.tenantId,
        tenantName,
        alcance: sub.scope || {},
        baseUrl: baseUrl(),
    });

    /**
     * UN REPORTE VACÍO NO SE MANDA, y se deja registrado que tocaba.
     *
     * Un correo con la tabla vacía se lee como "tu equipo no gastó nada", que es
     * una afirmación sobre la factura del cliente y casi siempre es falsa —lo
     * normal es que la ingesta todavía no corrió—. Callar es más honesto que
     * afirmar mal, pero callar en silencio no: por eso vuelve en el resultado.
     */
    if (reporte.filas === 0) {
        await exigirSuscripcionVigente(sub);
        if (opciones.marcarEnviado) await marcarEnviado(sub.id, sub.tenantId);
        return { enviados: 0, filas: 0, omitido: "sin-datos" };
    }

    const adjunto = {
        name: `${sub.reportType}-${new Date().toISOString().slice(0, 10)}.csv`,
        contentType: "text/csv",
        contentBase64: Buffer.from(reporte.csv, "utf8").toString("base64"),
    };

    // Un destinatario por correo, no todos en el mismo: así nadie se entera de
    // a quién más le llega, y un rebote no se lleva puesto el envío del resto.
    let enviados = 0;
    for (const destinatario of sub.recipients) {
        await exigirSuscripcionVigente(sub);
        try {
            await sendEmailStrict(reporte.asunto, reporte.html, destinatario, [adjunto]);
            enviados += 1;
        } catch (e) {
            console.error(`[reports] fallo el envio a ${destinatario} (sub ${sub.id}):`, e);
        }
    }

    // Se marca si AL MENOS UNO salió. Con cero, la próxima corrida reintenta;
    // marcarlo igual convertiría una caída de Graph en un período perdido.
    if (opciones.marcarEnviado && enviados > 0) await marcarEnviado(sub.id, sub.tenantId);

    return { enviados, filas: reporte.filas };
}

async function marcarEnviado(id: number, tenantId: string): Promise<void> {
    await pool.query("UPDATE ReportSubscriptions SET last_sent_at = UTC_TIMESTAMP() WHERE id = ? AND tenant_id = ?", [id, tenantId]);
}
