/**
 * MEJ-35 — qué va adentro del correo de una suscripción.
 *
 * Un REGISTRO de generadores y no un `switch`: "cualquier reporte" significa
 * que sumar uno sea registrar una función, no tocar el cron.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL GRÁFICO VA EN HTML, NO COMO IMAGEN, y es una decisión con motivo.
 *
 * Un PNG de verdad exige renderizar del lado del servidor: puppeteer o
 * chartjs-node-canvas. Son dependencias pesadas para mandar un mail, y este
 * repo hoy no tiene ninguna (sólo `jspdf`). La otra salida usual es un servicio
 * externo tipo QuickChart, que implica MANDARLE EL COSTO DEL CLIENTE A UN
 * TERCERO — eso no se hace.
 *
 * Y hay una razón que vale aunque las dos anteriores no valieran: **Gmail no
 * renderiza SVG inline y Outlook tampoco**. Las barras hechas con celdas de
 * tabla y `background-color` se ven en todos lados, que es el único criterio
 * que importa en un correo.
 */

import { filasDeCosto, listarPerspectivas } from "@/services/perspectivesData.service";
import { repartir } from "@/services/perspectives.service";
import { csvEscape } from "@/lib/csvExport";

export interface AlcanceDelReporte {
    perspectiveId?: number | null;
    /** `null`/ausente = todos los grupos de la Perspective. */
    grupo?: string | null;
}

export interface ReporteGenerado {
    asunto: string;
    html: string;
    csv: string;
    /** Cuántas filas de datos trae. 0 = no hay nada que contar. */
    filas: number;
}

export interface Periodo { desde: string; hasta: string }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/** Escapa para HTML: los nombres de grupo los escribe el usuario. */
function esc(s: unknown): string {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** Escapa para CSV (comas, comillas y fórmulas — AISEC-07). */
const csvCampo = csvEscape;

/** Mes en curso y mes anterior completo. */
export function periodosDelReporte(referencia = new Date()): { actual: Periodo; previo: Periodo } {
    const inicioActual = new Date(Date.UTC(referencia.getUTCFullYear(), referencia.getUTCMonth(), 1));
    const finPrevio = new Date(inicioActual.getTime() - 86_400_000);
    const inicioPrevio = new Date(Date.UTC(finPrevio.getUTCFullYear(), finPrevio.getUTCMonth(), 1));
    return {
        actual: { desde: iso(inicioActual), hasta: iso(referencia) },
        previo: { desde: iso(inicioPrevio), hasta: iso(finPrevio) },
    };
}

/**
 * Una barra que se ve en cualquier cliente de correo: una tabla de dos celdas
 * con anchos en porcentaje. Nada de SVG, nada de CSS moderno.
 */
function barra(pct: number, color: string): string {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
      <tr>
        <td width="${p}%" style="background-color:${color};height:10px;font-size:0;line-height:0">&nbsp;</td>
        <td width="${100 - p}%" style="background-color:#e5e7eb;height:10px;font-size:0;line-height:0">&nbsp;</td>
      </tr>
    </table>`;
}

export interface Contexto {
    tenantId: string;
    tenantName: string;
    alcance: AlcanceDelReporte;
    /** Base pública para el link al reporte vivo. */
    baseUrl: string;
    referencia?: Date;
}

export type Generador = (ctx: Contexto) => Promise<ReporteGenerado>;

/**
 * El gasto por grupo de una Perspective, con la variación contra el mes
 * anterior. Es el caso que la propuesta nombra: "mandame el desvío de mi grupo
 * los lunes".
 */
const gastoPorGrupo: Generador = async (ctx) => {
    const { actual, previo } = periodosDelReporte(ctx.referencia ?? new Date());
    const perspectivas = await listarPerspectivas(ctx.tenantId);
    const perspectiva = ctx.alcance.perspectiveId
        ? perspectivas.find((p) => p.id === ctx.alcance.perspectiveId)
        : perspectivas[0];

    if (!perspectiva) {
        return {
            asunto: `${ctx.tenantName} — sin Perspectives definidas`,
            html: `<p>Este reporte agrupa el gasto con una Perspective y todavía no hay ninguna definida.</p>`,
            csv: "grupo,gasto_usd\n",
            filas: 0,
        };
    }

    const [fActual, fPrevio] = await Promise.all([
        filasDeCosto(ctx.tenantId, actual.desde, actual.hasta),
        filasDeCosto(ctx.tenantId, previo.desde, previo.hasta),
    ]);
    const repActual = repartir(fActual, perspectiva.reglas);
    const repPrevio = repartir(fPrevio, perspectiva.reglas);
    const previoPorGrupo = new Map(repPrevio.grupos.map((g) => [g.grupo, g.costo]));

    // Criterio 3: quien se suscribe a su grupo NO recibe el gasto de los demás.
    // El recorte se hace acá, sobre el reparto ya calculado, y no filtrando las
    // filas antes: así el porcentaje del grupo sigue siendo sobre el total real
    // y no sobre sí mismo, que daría 100% siempre.
    const todos = repActual.grupos;
    const visibles = ctx.alcance.grupo
        ? todos.filter((g) => g.grupo === ctx.alcance.grupo)
        : todos;

    const totalVisible = visibles.reduce((a, g) => a + g.costo, 0);
    const mayor = Math.max(1, ...visibles.map((g) => g.costo));

    const filasHtml = visibles.map((g) => {
        const prev = previoPorGrupo.get(g.grupo);
        const varPct = prev && prev > 0 ? ((g.costo - prev) / prev) * 100 : null;
        const color = varPct === null ? "#64748b" : varPct <= 0 ? "#059669" : "#dc2626";
        return `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9">${esc(g.grupo)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;width:40%">${barra((g.costo / mayor) * 100, "#2563eb")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap">${money(g.costo)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right;color:${color};white-space:nowrap">${
              varPct === null ? "—" : `${varPct > 0 ? "+" : ""}${varPct.toFixed(1)}%`
          }</td>
        </tr>`;
    }).join("");

    const link = `${ctx.baseUrl}/intelligence/cost-groups?perspective=${perspectiva.id}${
        ctx.alcance.grupo ? `&pgroup=${encodeURIComponent(ctx.alcance.grupo)}` : ""
    }`;

    const html = `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;max-width:680px">
      <h2 style="margin:0 0 4px">${esc(ctx.tenantName)} — gasto por equipo</h2>
      <p style="margin:0 0 16px;color:#64748b;font-size:13px">
        Perspective <strong>${esc(perspectiva.name)}</strong>${ctx.alcance.grupo ? ` · grupo <strong>${esc(ctx.alcance.grupo)}</strong>` : ""}
        · del ${actual.desde} al ${actual.hasta}
      </p>
      <p style="margin:0 0 16px;font-size:24px;font-weight:700">${money(totalVisible)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:13px">
        <tr style="text-align:left;color:#64748b">
          <th style="padding:6px 10px">Equipo</th><th style="padding:6px 10px"></th>
          <th style="padding:6px 10px;text-align:right">Gasto</th>
          <th style="padding:6px 10px;text-align:right">vs mes anterior</th>
        </tr>
        ${filasHtml || `<tr><td colspan="4" style="padding:16px;color:#64748b">Sin gasto en el período.</td></tr>`}
      </table>
      ${
        // El sin asignar se informa SIEMPRE que exista, y sólo en la vista
        // completa: en un correo de un solo grupo, el sobrante del tenant no es
        // información suya. Sin esto, el total del correo no cuadra con la
        // factura y nadie sabe por qué.
        !ctx.alcance.grupo && repActual.sinAsignar.costo > 0
          ? `<p style="margin:14px 0 0;color:#64748b;font-size:12px">
               ${money(repActual.sinAsignar.costo)} (${repActual.sinAsignar.porcentaje.toFixed(1)}%) sin asignar:
               ninguna regla lo alcanza. Entra en el total del tenant pero en ningún equipo.
             </p>` : ""
      }
      <p style="margin:20px 0 0">
        <a href="${esc(link)}" style="color:#2563eb">Ver el tablero al día →</a>
      </p>
      <p style="margin:14px 0 0;color:#94a3b8;font-size:11px">
        Adjuntamos el CSV con los mismos números, para cruzarlos con tu modelo sin pedirle nada a nadie.
      </p>
    </div>`;

    const csv = [
        "grupo,gasto_usd,gasto_mes_anterior_usd,variacion_pct",
        ...visibles.map((g) => {
            const prev = previoPorGrupo.get(g.grupo);
            const varPct = prev && prev > 0 ? (((g.costo - prev) / prev) * 100).toFixed(2) : "";
            return [csvCampo(g.grupo), g.costo.toFixed(2), prev === undefined ? "" : prev.toFixed(2), varPct].join(",");
        }),
    ].join("\n") + "\n";

    return {
        asunto: `${ctx.tenantName} — gasto por equipo${ctx.alcance.grupo ? ` · ${ctx.alcance.grupo}` : ""} (${actual.desde} a ${actual.hasta})`,
        html,
        csv,
        filas: visibles.length,
    };
};

/** Los reportes que se pueden suscribir. Sumar uno es agregar una entrada. */
export const GENERADORES: Record<string, Generador> = {
    "gasto-por-equipo": gastoPorGrupo,
};

export const TIPOS_DE_REPORTE = Object.keys(GENERADORES);
