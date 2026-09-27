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

export async function enviarSuscripcion(
    sub: SuscripcionAEnviar,
    opciones: { marcarEnviado: boolean; periodo?: string | null } = { marcarEnviado: true }
): Promise<ResultadoEnvio> {
    const generar = GENERADORES[sub.reportType];
    if (!generar) throw new Error(`No hay generador para el reporte "${sub.reportType}"`);

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
        if (opciones.marcarEnviado) await marcarEnviado(sub.id);
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
        try {
            await sendEmailStrict(reporte.asunto, reporte.html, destinatario, [adjunto]);
            enviados += 1;
        } catch (e) {
            console.error(`[reports] fallo el envio a ${destinatario} (sub ${sub.id}):`, e);
        }
    }

    // Se marca si AL MENOS UNO salió. Con cero, la próxima corrida reintenta;
    // marcarlo igual convertiría una caída de Graph en un período perdido.
    if (opciones.marcarEnviado && enviados > 0) await marcarEnviado(sub.id);

    return { enviados, filas: reporte.filas };
}

async function marcarEnviado(id: number): Promise<void> {
    await pool.query("UPDATE ReportSubscriptions SET last_sent_at = UTC_TIMESTAMP() WHERE id = ?", [id]);
}
