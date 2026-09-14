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
import { leerUsoApiAzure, leerUsoApiAzureHistorico } from "@/lib/azureApiMetrics";
import { isMockTenant } from "@/lib/mockData";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        await requireSuperAdmin(request);
        const { searchParams } = new URL(request.url);
        const view = searchParams.get("view") || "ai";

        if (view === "azure") {
            const horas = Math.min(24 * 90, Math.max(1, Number(searchParams.get("horas")) || 24));
            // Hasta 24 h se lee de Redis, que tiene la hora en curso al minuto.
            // Más atrás se lee del histórico en MySQL, porque el cache guarda 8
            // días y encima puede desalojar claves vigentes (`AllKeysLRU`) o
            // perderlo todo en un reinicio -- no tiene persistencia.
            const filas = horas <= 24 ? await leerUsoApiAzure(horas) : await leerUsoApiAzureHistorico(horas);

            const acumular = (
                mapa: Map<string, { llamadas: number; throttle: number; error: number; esperaMs: number }>,
                clave: string,
                f: (typeof filas)[number]
            ) => {
                const acc = mapa.get(clave) || { llamadas: 0, throttle: 0, error: 0, esperaMs: 0 };
                acc.llamadas += f.llamadas;
                acc.throttle += f.throttle;
                acc.error += f.error;
                acc.esperaMs += f.esperaMs;
                mapa.set(clave, acc);
            };

            // Por servicio: "¿estamos pegando de más?".
            // Por tenant: "¿quién se come la cuota compartida?" -- el limite de
            // Cost Management es por suscripcion, asi que un solo cliente con
            // muchas suscripciones puede frenar al resto.
            const porServicio = new Map<string, { llamadas: number; throttle: number; error: number; esperaMs: number }>();
            const porTenantApi = new Map<string, { llamadas: number; throttle: number; error: number; esperaMs: number }>();
            for (const f of filas) {
                acumular(porServicio, f.servicio, f);
                acumular(porTenantApi, f.tenantId, f);
            }

            // El nombre sale de la base: en el panel, un GUID no dice nada.
            const nombres = new Map<string, string>();
            try {
                const ids = [...porTenantApi.keys()].filter((k) => k !== "sin-tenant");
                if (ids.length > 0) {
                    const [filasTenant]: any = await pool.query(
                        `SELECT tenant_id, company_name FROM Tenants WHERE tenant_id IN (${ids.map(() => "?").join(",")})`,
                        ids
                    );
                    for (const r of filasTenant || []) nombres.set(r.tenant_id, r.company_name);
                }
            } catch { /* sin nombres se muestra el id */ }

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
                tenants: [...porTenantApi.entries()]
                    .map(([tenantId, v]) => ({
                        tenantId,
                        nombre: nombres.get(tenantId) || null,
                        ...v,
                        pctThrottle: v.llamadas > 0 ? Number(((v.throttle / v.llamadas) * 100).toFixed(1)) : 0,
                        minutosEsperando: Number((v.esperaMs / 60000).toFixed(1)),
                    }))
                    .sort((a, b) => b.llamadas - a.llamadas),
                fuente: horas <= 24 ? "redis" : "mysql",
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
            // Los tenants DEMO gastan tokens de verdad: el Copilot y el reporte
            // ejecutivo llaman al proveedor real aunque el tenant sea sintético.
            // El consumo es real y no se oculta --la casa lo paga-- pero se
            // marca, porque mezclarlo con clientes en la misma lista hace ver
            // "datos mock" en un panel operativo y ensucia la lectura.
            esDemo: r.tenant_id ? isMockTenant(r.tenant_id) : false,
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
            // Total aparte para que se vea de un vistazo cuánto se va en demos
            // sin tener que sumar filas a mano.
            demoTokens: (porTenant || [])
                .map(fila)
                .filter((r: any) => r.esDemo)
                .reduce((t: number, r: any) => t + r.inputTokens + r.outputTokens, 0),
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
