/**
 * GET /api/cost-groups — listado de Cost Groups (Budget & Forecast por
 * Business Unit) para la nueva pantalla "Cost Groups".
 *
 * Un Cost Group = valor del tag CostCenter en CostSnapshots (misma fuente que
 * getTop5CostGroups en /api/intelligence/whiteboard). El budget mensual se
 * lee de la tabla `Budgets` (ya usada por /api/budgets); la metadata
 * adicional (description, owner, created_by/created_at) vive en la nueva
 * tabla `CostGroups` (lectura, sin CRUD todavía).
 *
 * period: "30d" | "90d" | "fy" (default "30d").
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { getWithStaleWhileRevalidate, invalidateCache, costGroupsCacheKeys } from "@/lib/cache";
import { fetchResourceCountsByRg, fetchResourceGroupsByTag } from "@/lib/azureResourceCounts";
import { getTagCoverage } from "@/lib/costTagCoverage";

/**
 * Heurística simple de clustering: agrupa los Resource Groups de 'Untagged'
 * por prefijo común (primeros 2 segmentos separados por '-') para sugerir
 * Cost Groups nuevos por patrón de nombre. Solo sugiere clusters con 2+ RGs
 * para evitar ruido de un solo recurso suelto.
 */
function buildUntaggedSuggestions(untaggedRgNames: string[], untaggedPeriodCost: number): Array<{
    pattern: string; matchType: "name_pattern"; estimatedResourceGroups: number; estimatedCostUsd: number;
}> {
    if (untaggedRgNames.length === 0) return [];
    const clusters = new Map<string, string[]>();
    for (const rg of untaggedRgNames) {
        const segments = rg.split("-").filter(Boolean);
        const prefix = segments.length >= 2 ? segments.slice(0, 2).join("-") : segments[0] || rg;
        const list = clusters.get(prefix) || [];
        list.push(rg);
        clusters.set(prefix, list);
    }
    const totalRgs = untaggedRgNames.length;
    return Array.from(clusters.entries())
        .filter(([, rgs]) => rgs.length >= 2)
        .map(([prefix, rgs]) => ({
            pattern: `${prefix}-%`,
            matchType: "name_pattern" as const,
            estimatedResourceGroups: rgs.length,
            estimatedCostUsd: Number((untaggedPeriodCost * (rgs.length / totalRgs)).toFixed(2)),
        }))
        .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
        .slice(0, 5);
}

function periodRange(period: string): { start: string; end: string } {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    if (period === "fy") {
        return { start: `${now.getUTCFullYear()}-01-01`, end };
    }
    const days = period === "90d" ? 90 : 30;
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - days);
    return { start: start.toISOString().slice(0, 10), end };
}

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const period = url.searchParams.get("period") || "30d";
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // Cost Groups es exclusivo de los planes Business y Enterprise.
        await requireTenantTier(request, tenantId, "Business");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("cost_groups", tenantId));
        }

        const result = await getWithStaleWhileRevalidate(
            `cost-groups:v2:${tenantId}:${period}`,
            () => fetchCostGroups(tenantId, period),
            1800,
            600
        );

        return NextResponse.json({ success: true, mock: false, groups: result.groups, summary: result.summary, suggestions: result.suggestions });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[cost-groups] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

async function fetchCostGroups(tenantId: string, period: string) {
        const { start, end } = periodRange(period);
        const days = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) || 30);

        // COUNT(DISTINCT subscription_id) excluye 'mg-aggregated'/'default': el
        // sync diario a veces graba un placeholder ahí en vez del GUID real
        // (ver azureSubscriptionNames.ts) — contarlo inflaría "suscripciones"
        // con una que no existe.
        const [rows]: any = await pool.query(
            `SELECT
                COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')), 'null'), 'Untagged') AS name,
                SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS periodCost,
                COUNT(DISTINCT CASE WHEN subscription_id NOT IN ('mg-aggregated', 'default') THEN subscription_id END) AS subscriptions,
                COUNT(DISTINCT resource_group) AS resourceGroups,
                COUNT(DISTINCT ResourceId) AS resources,
                GROUP_CONCAT(DISTINCT resource_group) AS rgNames,
                MAX(COALESCE(ChargePeriodStart, date)) AS lastUpdated
             FROM CostSnapshots
             WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ?
             GROUP BY name`,
            [tenantId, start, end]
        );

        const [budgetRows]: any = await pool.query(
            `SELECT cost_center_tag_value AS name, monthly_limit_usd AS budget FROM Budgets WHERE tenant_id = ?`,
            [tenantId]
        );
        const budgetByName = new Map<string, number>((budgetRows as any[]).map(b => [b.name, Number(b.budget) || 0]));

        const [metaRows]: any = await pool.query(
            `SELECT cg.name, cg.description, cg.match_type, cg.match_tag_key, cg.match_tag_value, cg.match_rg_pattern,
                    cg.created_by, cg.created_at, u.display_name AS ownerName, u.email AS ownerEmail
             FROM CostGroups cg LEFT JOIN Users u ON u.id = cg.owner_user_id
             WHERE cg.tenant_id = ?`,
            [tenantId]
        );
        const metaByName = new Map<string, any>((metaRows as any[]).map(m => [m.name, m]));
        const customGroupMetas = (metaRows as any[]).filter(m => m.match_type != null);
        const customNames = new Set(customGroupMetas.map(m => m.name));

        // Los grupos custom (con regla propia) reemplazan por completo a
        // cualquier grupo auto-descubierto que casualmente comparta nombre
        // con el valor de un tag CostCenter — la definición explícita gana.
        const tagBasedRows = (rows as any[]).filter(r => !customNames.has(r.name));

        // MEJ-30 paso 3: si el período ya tiene etiquetas reales (ingesta por
        // export), el predicado exacto alcanza y la aproximación por Resource
        // Group sobra. Se resuelve UNA vez por request, no por grupo.
        const tagCoverage = await getTagCoverage(tenantId, start, end);

        const customRowsResults = await Promise.all(customGroupMetas.map(async (m) => {
            // Un grupo por ETIQUETA daba siempre $0.00: el predicado comparaba
            // `CostSnapshots.Tags`, columna que ningún INSERT escribía (el sync
            // diario agrupa por ServiceName/ResourceGroupName, sin pedir tags).
            // Las etiquetas sí existen en vivo en Resource Graph, así que se
            // traducen al conjunto de RGs que las portan — que es la dimensión
            // por la que el costo SÍ está agregado.
            //
            // Con `Tags` poblado (MEJ-30 paso 1) ese respaldo deja de hacer
            // falta: se saltea la consulta a Resource Graph — una llamada menos
            // a Azure por grupo — y el número deja de ser una sobreestimación.
            //
            // Tercera fuente, entre el dato exacto del export y la
            // aproximación: `CostTagSnapshots`, que el sync llena pidiéndole a
            // Cost Management el costo agrupado por TagKey (MEJ-30 paso 2).
            // También es exacto -- la atribución la hizo Azure a nivel de
            // recurso -- así que gana sobre la aproximación por RG.
            let tagSliceRows: any[] = [];
            if (m.match_type !== "name_pattern" && !tagCoverage.isExact) {
                const [sliceRows]: any = await pool.query(
                    `SELECT resource_group, SUM(cost_usd) AS cost
                     FROM CostTagSnapshots
                     WHERE tenant_id = ? AND tag_key = ? AND tag_value = ?
                       AND date BETWEEN ? AND ?
                     GROUP BY resource_group`,
                    [tenantId, m.match_tag_key, m.match_tag_value, start, end]
                );
                tagSliceRows = sliceRows as any[];
            }

            if (tagSliceRows.length > 0) {
                const periodCost = tagSliceRows.reduce((sum, r) => sum + (Number(r.cost) || 0), 0);
                const rgNames = tagSliceRows.map(r => String(r.resource_group)).filter(Boolean);
                return {
                    name: m.name,
                    periodCost,
                    // En `CostSnapshots` ese mismo dinero está en filas sin
                    // `Tags`, o sea dentro de 'Untagged'. Se reclama entero
                    // para que el resumen no lo cuente dos veces.
                    untaggedPortion: periodCost,
                    subscriptions: 0,
                    resourceGroups: rgNames.length,
                    resources: 0,
                    rgNames: rgNames.join(","),
                    lastUpdated: null,
                    // Exacto: lo atribuyó Azure por recurso, no se infirió del RG.
                    tagMatchIsApproximate: false,
                    tagResolvedResourceGroups: 0,
                };
            }

            let tagResolvedRgs: string[] = [];
            if (m.match_type !== "name_pattern" && !tagCoverage.isExact) {
                tagResolvedRgs = await fetchResourceGroupsByTag(tenantId, m.match_tag_key, m.match_tag_value);
            }

            const patternPredicate = m.match_type === "name_pattern"
                ? "resource_group LIKE ?"
                : tagResolvedRgs.length > 0
                    ? `(JSON_UNQUOTE(JSON_EXTRACT(Tags, CONCAT('$.', ?))) = ? OR LOWER(resource_group) IN (${tagResolvedRgs.map(() => "?").join(",")}))`
                    : "JSON_UNQUOTE(JSON_EXTRACT(Tags, CONCAT('$.', ?))) = ?";
            const patternParams = m.match_type === "name_pattern"
                ? [m.match_rg_pattern]
                : [m.match_tag_key, m.match_tag_value, ...tagResolvedRgs];

            const [customRows]: any = await pool.query(
                `SELECT
                    SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS periodCost,
                    -- Cuánto del costo de este grupo viene de filas que la
                    -- agrupación por tag manda al balde 'Untagged'. Misma
                    -- expresión que la consulta principal, para que los dos
                    -- baldes se definan igual. Se descuenta de Untagged y así
                    -- el mismo gasto no se cuenta dos veces.
                    SUM(CASE WHEN COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')), 'null'), 'Untagged') = 'Untagged'
                             THEN COALESCE(EffectiveCost, BilledCost, cost_usd, 0) ELSE 0 END) AS untaggedPortion,
                    COUNT(DISTINCT CASE WHEN subscription_id NOT IN ('mg-aggregated', 'default') THEN subscription_id END) AS subscriptions,
                    COUNT(DISTINCT resource_group) AS resourceGroups,
                    COUNT(DISTINCT ResourceId) AS resources,
                    GROUP_CONCAT(DISTINCT resource_group) AS rgNames,
                    MAX(COALESCE(ChargePeriodStart, date)) AS lastUpdated
                 FROM CostSnapshots
                 WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ?
                   AND (
                     resource_group IN (SELECT resource_group FROM CostGroupResourceGroups WHERE tenant_id = ? AND group_name = ?)
                     OR ${patternPredicate}
                   )`,
                [tenantId, start, end, tenantId, m.name, ...patternParams]
            );
            return {
                name: m.name,
                ...(customRows?.[0] || {}),
                // El costo está agregado por RG: si un RG mezcla recursos con y
                // sin la etiqueta, se atribuye completo. Se informa para que la
                // UI no muestre el número como exacto.
                tagMatchIsApproximate: tagResolvedRgs.length > 0,
                tagResolvedResourceGroups: tagResolvedRgs.length,
            };
        }));

        // Un grupo custom NO agrega gasto nuevo: reclama gasto que ya estaba
        // contado en algún balde por tag — con la columna `Tags` sin poblar,
        // siempre en 'Untagged'. Sin descontarlo, cada Cost Group nuevo inflaba
        // el total: Untagged seguía con el monto completo y el grupo lo sumaba
        // otra vez (861.31 + 552.31 + 168.01 + 3.68 = 1585.31 cuando el gasto
        // real del período era 861.31).
        //
        // Se descuenta sólo la porción que efectivamente venía de filas sin tag,
        // no el total del grupo: si mañana `Tags` se puebla (MEJ-30), un grupo
        // que matchea filas ya etiquetadas no debe restarle nada a Untagged.
        const claimedFromUntagged = customRowsResults.reduce(
            (sum, r: any) => sum + (Number(r.untaggedPortion) || 0),
            0
        );
        const adjustedTagBasedRows = (tagBasedRows as any[]).map(r => {
            if (r.name !== RESERVED_NAME) return r;
            // Clamp en 0: dos reglas custom solapadas pueden reclamar la misma
            // fila y restar de más. Preferible 0 antes que un negativo absurdo.
            const restante = Math.max(0, (Number(r.periodCost) || 0) - claimedFromUntagged);
            return { ...r, periodCost: restante };
        });

        const groups = ([...adjustedTagBasedRows, ...customRowsResults]).map(r => {
            const periodCost = Number(r.periodCost) || 0;
            const avgDailyCost = periodCost / days;
            const budget = budgetByName.get(r.name) || 0;
            const meta = metaByName.get(r.name);
            const rgNames: string[] = String(r.rgNames || "").split(",").map((s: string) => s.trim()).filter(Boolean);
            // Proyección run-rate: mismo enfoque que el resto del repo (sin ML de forecasting).
            const forecast = Number((avgDailyCost * 30).toFixed(2));
            return {
                name: r.name,
                description: meta?.description || null,
                avgDailyCost: Number(avgDailyCost.toFixed(2)),
                periodCost: Number(periodCost.toFixed(2)),
                monthlyBilledCost: Number((avgDailyCost * 30).toFixed(2)),
                budget: Number(budget.toFixed(2)),
                forecast,
                owner: meta?.ownerName || meta?.ownerEmail || null,
                createdBy: meta?.created_by || null,
                lastUpdated: r.lastUpdated,
                subscriptions: Number(r.subscriptions) || 0,
                resourceGroups: Number(r.resourceGroups) || 0,
                resources: Number(r.resources) || 0,
                rgNames,
                // Sólo lo traen los grupos por etiqueta resueltos vía Resource
                // Graph; el mapeo es explícito, así que hay que propagarlos a
                // mano o la UI no puede advertir que el número es aproximado.
                tagMatchIsApproximate: (r as any).tagMatchIsApproximate === true,
                tagResolvedResourceGroups: Number((r as any).tagResolvedResourceGroups) || 0,
            };
        }).sort((a, b) => b.periodCost - a.periodCost);

        // Conteo real de recursos vía Resource Graph (CostSnapshots.ResourceId
        // suele venir vacío). Best-effort: si falla, se conserva el conteo
        // aproximado de CostSnapshots calculado arriba.
        const allRgNames = Array.from(new Set(groups.flatMap(g => g.rgNames.map(rg => rg.toLowerCase()))));
        const realResourceCounts = await fetchResourceCountsByRg(tenantId, allRgNames);
        const enrichedGroups = groups.map(({ rgNames, ...g }) => {
            if (realResourceCounts.size === 0) return g;
            const realCount = rgNames.reduce((sum, rg) => sum + (realResourceCounts.get(rg.toLowerCase()) || 0), 0);
            return { ...g, resources: realCount > 0 ? realCount : g.resources };
        });

        const totalCost = enrichedGroups.reduce((s, g) => s + g.periodCost, 0);
        const untaggedGroup = groups.find(g => g.name === RESERVED_NAME);
        const unallocatedCostUsd = untaggedGroup?.periodCost || 0;
        const allocatedCostUsd = Number((totalCost - unallocatedCostUsd).toFixed(2));
        const allocatedPercent = totalCost > 0 ? Number(((allocatedCostUsd / totalCost) * 100).toFixed(1)) : 0;

        const suggestions = untaggedGroup
            ? buildUntaggedSuggestions(untaggedGroup.rgNames, untaggedGroup.periodCost)
            : [];

        return {
            groups: enrichedGroups,
            summary: {
                totalCostUsd: Number(totalCost.toFixed(2)),
                allocatedCostUsd,
                unallocatedCostUsd: Number(unallocatedCostUsd.toFixed(2)),
                allocatedPercent,
                // MEJ-30 paso 3: si es false, el costo del período todavía
                // llega sin etiquetas (sync vía Cost Management) y el reparto
                // por etiqueta se resolvió aproximando por Resource Group.
                tagDataIsExact: tagCoverage.isExact,
            },
            suggestions,
        };
}

const NAME_MAX_LEN = 255;
const RESERVED_NAME = "Untagged";

/**
 * POST /api/cost-groups — crea un Cost Group con una regla de membresía
 * propia (por tag arbitrario, o por patrón de nombre de Resource Group).
 * A diferencia de los grupos "legacy" (auto-descubiertos por el tag
 * CostCenter, sin fila en esta tabla hasta ahora), un grupo creado acá SÍ
 * vive en `CostGroups` con `match_type` seteado — así el GET de listado y
 * detalle saben que deben resolver su costo vía la regla en vez de por
 * igualdad de tag CostCenter.
 *
 * No hay concepto de "por resource individual" acá: CostSnapshots no trae
 * ResourceId poblado (el sync agrega por resource group), así que la regla de
 * patrón de nombre matchea contra `resource_group` — el grano más fino que
 * se puede filtrar de forma confiable al agregar costo. Ver
 * /api/cost-groups/[name]/resource-groups para el ajuste manual.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, name, description, matchType, tagKey, tagValue, rgPattern, budget, ownerUserId, previewOnly } = body;

        if (!tenantId || !name || typeof name !== "string" || !name.trim()) {
            return NextResponse.json({ error: "Faltan tenantId o name" }, { status: 400 });
        }
        if (name.trim().length > NAME_MAX_LEN) {
            return NextResponse.json({ error: `El nombre no puede superar ${NAME_MAX_LEN} caracteres` }, { status: 400 });
        }
        if (name.trim() === RESERVED_NAME) {
            return NextResponse.json({ error: `"${RESERVED_NAME}" es un nombre reservado` }, { status: 400 });
        }
        if (matchType !== "tag" && matchType !== "name_pattern") {
            return NextResponse.json({ error: "matchType debe ser 'tag' o 'name_pattern'" }, { status: 400 });
        }
        if (matchType === "tag" && (!tagKey || !String(tagKey).trim() || !tagValue || !String(tagValue).trim())) {
            return NextResponse.json({ error: "tagKey y tagValue son requeridos para matchType='tag'" }, { status: 400 });
        }
        if (matchType === "name_pattern" && (!rgPattern || !String(rgPattern).trim())) {
            return NextResponse.json({ error: "rgPattern es requerido para matchType='name_pattern'" }, { status: 400 });
        }
        if (budget != null && (Number.isNaN(Number(budget)) || Number(budget) < 0)) {
            return NextResponse.json({ error: "budget debe ser un número >= 0" }, { status: 400 });
        }

        // Creación de grupos es una acción de gobernanza financiera — mismo
        // nivel que crear/editar un presupuesto (Admin/Owner).
        const identity = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        if (previewOnly === true) {
            if (isMockTenant(tenantId)) {
                const estRgs = matchType === "name_pattern" ? Math.max(1, (String(rgPattern).length % 4) + 1) : 2;
                const estCost = Number((estRgs * 32.5).toFixed(2));
                return NextResponse.json({
                    success: true,
                    mock: true,
                    preview: {
                        monthlyCost: estCost,
                        subscriptions: 1,
                        resourceGroups: estRgs,
                        resources: estRgs * 6,
                    },
                });
            }

            const patternPredicate = matchType === "name_pattern"
                ? "resource_group LIKE ?"
                : "JSON_UNQUOTE(JSON_EXTRACT(Tags, CONCAT('$.', ?))) = ?";
            const patternParams = matchType === "name_pattern"
                ? [String(rgPattern).trim()]
                : [String(tagKey).trim(), String(tagValue).trim()];

            const [previewRows]: any = await pool.query(
                `SELECT
                    SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS monthlyCost,
                    COUNT(DISTINCT CASE WHEN subscription_id NOT IN ('mg-aggregated', 'default') THEN subscription_id END) AS subscriptions,
                    COUNT(DISTINCT resource_group) AS resourceGroups,
                    COUNT(DISTINCT ResourceId) AS resources
                 FROM CostSnapshots
                 WHERE tenant_id = ?
                   AND DATE(COALESCE(ChargePeriodStart, date)) BETWEEN DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND CURDATE()
                   AND ${patternPredicate}`,
                [tenantId, ...patternParams]
            );

            const row = previewRows?.[0] || {};
            return NextResponse.json({
                success: true,
                preview: {
                    monthlyCost: Number(row.monthlyCost) || 0,
                    subscriptions: Number(row.subscriptions) || 0,
                    resourceGroups: Number(row.resourceGroups) || 0,
                    resources: Number(row.resources) || 0,
                },
            });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, name: name.trim() });
        }

        // Cost Groups es exclusivo de Business+ (mismo tier que el GET) — el
        // check de tier en el frontend (Sidebar/FeatureGuard) es client-only,
        // sin esto un Admin de un tenant Professional podría crear
        // grupos pegándole directo a la API.
        await requireTenantTier(request, tenantId, "Business");

        try {
            await pool.query(
                `INSERT INTO CostGroups (tenant_id, name, description, match_type, match_tag_key, match_tag_value, match_rg_pattern, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tenantId,
                    name.trim(),
                    description ? String(description).trim().slice(0, 1000) : null,
                    matchType,
                    matchType === "tag" ? String(tagKey).trim().slice(0, 255) : null,
                    matchType === "tag" ? String(tagValue).trim().slice(0, 255) : null,
                    matchType === "name_pattern" ? String(rgPattern).trim().slice(0, 255) : null,
                    identity.email,
                ]
            );

            if (budget != null) {
                await pool.query(
                    `INSERT INTO Budgets (
                        tenant_id,
                        cost_center_tag_key,
                        cost_center_tag_value,
                        monthly_limit_usd,
                        alert_threshold_percent,
                        active,
                        subscription_id,
                        period,
                        created_at,
                        updated_at
                    ) VALUES (?, 'CostCenter', ?, ?, 80, 1, 'default', 'monthly', NOW(), NOW())
                    ON DUPLICATE KEY UPDATE monthly_limit_usd = VALUES(monthly_limit_usd), updated_at = NOW()`,
                    [tenantId, name.trim(), Number(budget)]
                );
            }

            if (ownerUserId) {
                await pool.query(
                    `UPDATE CostGroups SET owner_user_id = ? WHERE tenant_id = ? AND name = ?`,
                    [String(ownerUserId).trim(), tenantId, name.trim()]
                );
            }
        } catch (e: any) {
            if (e?.code === "ER_DUP_ENTRY") {
                return NextResponse.json({ error: `Ya existe un Cost Group llamado "${name.trim()}"` }, { status: 409 });
            }
            throw e;
        }

        await invalidateCache(...costGroupsCacheKeys(tenantId));

        return NextResponse.json({ success: true, name: name.trim() }, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[cost-groups] POST error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
