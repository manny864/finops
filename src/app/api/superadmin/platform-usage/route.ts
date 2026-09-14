/**
 * Consumo de la plataforma: IA (tokens) y APIs de Azure (llamadas y throttling).
 * Auth: requireSuperAdmin — es costo operativo de la casa, no del tenant.
 *
 * GET ?view=ai[&dias=30]     → tokens por tenant, feature, modelo y origen
 * GET ?view=azure[&horas=24] → llamadas a Azure por servicio y operación
 *
 * Las dos mediciones ya existían y nadie las leía: `PlatformAiUsage` se escribe
 * desde julio sin un solo SELECT en todo el repo --con `pricing.ts` diciendo que
 * la IA "se cobra por consumo" sobre ese dato-- y el throttling de Azure sólo se
 * podía contar leyendo los `console.warn` del backoff en Log Analytics.
 */
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import pool from "@/modules/storage/db";
import { leerUsoApiAzure } from "@/lib/azureApiMetrics";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        await requireSuperAdmin(request);
        const { searchParams } = new URL(request.url);
        const view = searchParams.get("view") || "ai";

        if (view === "azure") {
            const horas = Math.min(168, Math.max(1, Number(searchParams.get("horas")) || 24));
            const filas = await leerUsoApiAzure(horas);

            // Por servicio: el resumen que responde "¿estamos pegando de más?".
            const porServicio = new Map<string, { llamadas: number; throttle: number; error: number; esperaMs: number }>();
            for (const f of filas) {
                const acc = porServicio.get(f.servicio) || { llamadas: 0, throttle: 0, error: 0, esperaMs: 0 };
                acc.llamadas += f.llamadas;
                acc.throttle += f.throttle;
                acc.error += f.error;
                acc.esperaMs += f.esperaMs;
                porServicio.set(f.servicio, acc);
            }

            return NextResponse.json({
                success: true,
                horas,
                servicios: [...porServicio.entries()].map(([servicio, v]) => ({
                    servicio,
                    ...v,
                    // El porcentaje es el número accionable: 429 sueltos no
                    // dicen nada sin saber sobre cuántas llamadas fueron.
                    pctThrottle: v.llamadas > 0 ? Number(((v.throttle / v.llamadas) * 100).toFixed(1)) : 0,
                    minutosEsperando: Number((v.esperaMs / 60000).toFixed(1)),
                })),
                detalle: filas.slice(0, 200),
            });
        }

        // ── Consumo de IA ──────────────────────────────────────────────────
        const dias = Math.min(365, Math.max(1, Number(searchParams.get("dias")) || 30));

        const [porTenant]: any = await pool.query(
            `SELECT u.tenant_id, t.company_name, u.source,
                    COUNT(*) AS llamadas,
                    SUM(u.input_tokens) AS inputTokens,
                    SUM(u.output_tokens) AS outputTokens
               FROM PlatformAiUsage u
               LEFT JOIN Tenants t ON t.tenant_id = u.tenant_id
              WHERE u.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
              GROUP BY u.tenant_id, t.company_name, u.source
              ORDER BY (SUM(u.input_tokens) + SUM(u.output_tokens)) DESC
              LIMIT 200`,
            [dias]
        );

        const [porFeature]: any = await pool.query(
            `SELECT u.feature, u.provider, u.model_name, u.source,
                    COUNT(*) AS llamadas,
                    SUM(u.input_tokens) AS inputTokens,
                    SUM(u.output_tokens) AS outputTokens
               FROM PlatformAiUsage u
              WHERE u.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
              GROUP BY u.feature, u.provider, u.model_name, u.source
              ORDER BY (SUM(u.input_tokens) + SUM(u.output_tokens)) DESC
              LIMIT 100`,
            [dias]
        );

        const [porDia]: any = await pool.query(
            `SELECT DATE(u.created_at) AS dia, u.source,
                    SUM(u.input_tokens) AS inputTokens,
                    SUM(u.output_tokens) AS outputTokens
               FROM PlatformAiUsage u
              WHERE u.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
              GROUP BY DATE(u.created_at), u.source
              ORDER BY dia ASC`,
            [dias]
        );

        const fila = (r: any) => ({
            ...r,
            llamadas: Number(r.llamadas || 0),
            inputTokens: Number(r.inputTokens || 0),
            outputTokens: Number(r.outputTokens || 0),
        });

        return NextResponse.json({
            success: true,
            dias,
            // `platform` es lo que absorbe la casa y `byok` lo que el cliente
            // paga con su propia clave: mezclarlos haría ver un costo que no es.
            porTenant: (porTenant || []).map(fila),
            porFeature: (porFeature || []).map(fila),
            porDia: (porDia || []).map((r: any) => ({
                dia: r.dia instanceof Date ? r.dia.toISOString().slice(0, 10) : String(r.dia),
                source: r.source,
                inputTokens: Number(r.inputTokens || 0),
                outputTokens: Number(r.outputTokens || 0),
            })),
        });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        console.error("[superadmin/platform-usage]", errorMessage(error));
        return NextResponse.json({ error: "No se pudo leer el consumo de la plataforma." }, { status: 500 });
    }
}
