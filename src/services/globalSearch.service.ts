/**
 * Buscador de contenido del SaaS, acotado al tenant activo.
 *
 * El buscador de la barra lateral sólo filtra los nombres de las páginas y el
 * Cmd+K era una lista fija de siete enlaces: no había forma de buscar "dónde
 * gasto en Cosmos DB" o "qué regla de alerta menciona producción". Esto agrega
 * esa capa.
 *
 * **El tenant no es un filtro de conveniencia, es el límite.** Cada consulta
 * lleva `tenant_id = ?` en el WHERE y la ruta valida con `requireTenantAccess`
 * que quien pregunta pertenece a ese tenant: sin las dos cosas, un buscador
 * global se vuelve la forma más cómoda de leer datos de otro cliente.
 *
 * Todo sale de MySQL. Ningún origen pega contra Azure: un buscador se dispara
 * en cada tecla y no puede depender de una llamada a ARM.
 */
import pool from "@/modules/storage/db";
import { RowDataPacket } from "mysql2";
import { errorMessage } from "@/lib/apiErrors";

export type SearchResultKind = "service" | "resourceGroup" | "subscription" | "waste" | "alertRule";

export interface SearchResult {
    kind: SearchResultKind;
    /** Texto que se muestra. Es dato del tenant, no se traduce. */
    title: string;
    /** Línea secundaria ya formateada por el cliente cuando hace falta. */
    subtitleKey?: string;
    subtitleParams?: Record<string, string | number>;
    href: string;
}

export interface GlobalSearchResponse {
    results: SearchResult[];
    /** Qué orígenes respondieron. Un origen caído no es un origen sin resultados. */
    sourceStatus: Array<{ source: string; ok: boolean; error?: string }>;
}

/** Tope por origen: el buscador se dispara al tipear y tiene que responder ya. */
const PER_SOURCE_LIMIT = 5;

/**
 * `%` y `_` son comodines de LIKE. Sin escaparlos, buscar "100%" trae toda la
 * tabla y una consulta con muchos `%` degenera en un escaneo completo.
 */
function likeTerm(q: string): string {
    return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

async function source<T>(name: string, fn: () => Promise<T[]>) {
    try {
        return { source: name, ok: true as const, rows: await fn() };
    } catch (err) {
        // Una tabla ausente (ZombieResources no tiene DDL en migrations) no
        // puede tumbar el resto del buscador.
        console.warn(`[globalSearch] origen "${name}" no disponible:`, errorMessage(err));
        return { source: name, ok: false as const, error: errorMessage(err), rows: [] as T[] };
    }
}

export async function searchTenantContent(tenantId: string, rawQuery: string): Promise<GlobalSearchResponse> {
    const q = rawQuery.trim();
    // Con menos de dos caracteres cualquier LIKE devuelve medio tenant.
    if (q.length < 2) return { results: [], sourceStatus: [] };
    const term = likeTerm(q);

    const [servicios, grupos, subs, desperdicio, alertas] = await Promise.all([
        source("services", async () => {
            const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT service_name AS name, SUM(COALESCE(BilledCost, cost_usd, 0)) AS total
                 FROM CostSnapshots
                 WHERE tenant_id = ? AND service_name LIKE ? ESCAPE '\\\\'
                   AND COALESCE(ChargePeriodStart, date) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
                 GROUP BY service_name ORDER BY total DESC LIMIT ?`,
                [tenantId, term, PER_SOURCE_LIMIT]
            );
            return rows;
        }),
        source("resourceGroups", async () => {
            const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT resource_group AS name, SUM(COALESCE(BilledCost, cost_usd, 0)) AS total
                 FROM CostSnapshots
                 WHERE tenant_id = ? AND resource_group LIKE ? ESCAPE '\\\\'
                   AND COALESCE(ChargePeriodStart, date) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
                 GROUP BY resource_group ORDER BY total DESC LIMIT ?`,
                [tenantId, term, PER_SOURCE_LIMIT]
            );
            return rows;
        }),
        source("subscriptions", async () => {
            const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT DISTINCT subscription_id AS name
                 FROM CostSnapshots
                 WHERE tenant_id = ? AND subscription_id LIKE ? ESCAPE '\\\\'
                 LIMIT ?`,
                [tenantId, term, PER_SOURCE_LIMIT]
            );
            return rows;
        }),
        source("waste", async () => {
            const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT resource_name AS name, resource_type AS type,
                        COALESCE(estimated_waste_usd, 0) AS total
                 FROM ZombieResources
                 WHERE tenant_id = ? AND status = 'active'
                   AND (resource_name LIKE ? ESCAPE '\\\\' OR resource_group LIKE ? ESCAPE '\\\\')
                 ORDER BY estimated_waste_usd DESC LIMIT ?`,
                [tenantId, term, term, PER_SOURCE_LIMIT]
            );
            return rows;
        }),
        source("alertRules", async () => {
            const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT rule_name AS name, channel
                 FROM AlertRules
                 WHERE tenant_id = ? AND rule_name LIKE ? ESCAPE '\\\\'
                 LIMIT ?`,
                [tenantId, term, PER_SOURCE_LIMIT]
            );
            return rows;
        }),
    ]);

    const results: SearchResult[] = [
        ...servicios.rows.map((r): SearchResult => ({
            kind: "service",
            title: String(r.name),
            subtitleKey: "spend90d",
            subtitleParams: { amount: Number(r.total || 0).toFixed(2) },
            href: `/intelligence/billing?service=${encodeURIComponent(String(r.name))}`,
        })),
        ...grupos.rows.map((r): SearchResult => ({
            kind: "resourceGroup",
            title: String(r.name),
            subtitleKey: "spend90d",
            subtitleParams: { amount: Number(r.total || 0).toFixed(2) },
            href: `/intelligence/chargeback?resourceGroup=${encodeURIComponent(String(r.name))}`,
        })),
        ...subs.rows.map((r): SearchResult => ({
            kind: "subscription",
            title: String(r.name),
            href: `/intelligence/billing?subscription=${encodeURIComponent(String(r.name))}`,
        })),
        ...desperdicio.rows.map((r): SearchResult => ({
            kind: "waste",
            title: String(r.name),
            subtitleKey: "wastePerMonth",
            subtitleParams: { amount: Number(r.total || 0).toFixed(2), type: String(r.type || "") },
            href: "/cleanup/zombies",
        })),
        ...alertas.rows.map((r): SearchResult => ({
            kind: "alertRule",
            title: String(r.name),
            subtitleKey: "alertChannel",
            subtitleParams: { channel: String(r.channel || "") },
            href: "/governance/alerts",
        })),
    ];

    return {
        results,
        sourceStatus: [servicios, grupos, subs, desperdicio, alertas].map((s) =>
            s.ok ? { source: s.source, ok: true } : { source: s.source, ok: false, error: s.error }
        ),
    };
}
