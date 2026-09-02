import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { redis } from "@/lib/redis";
import { fetchResourceCountsByRg } from "@/lib/azureResourceCounts";
import { getTagCoverage } from "@/lib/costTagCoverage";

const UNASSIGNED_NAME = "Sin asignar";

/**
 * Misma ventana que `getCostCenterSpend` (2 meses hacia atrás), en ISO.
 *
 * Clampea el día como hace `DATE_SUB(CURDATE(), INTERVAL n MONTH)` de MySQL:
 * un `setMonth()` pelado desborda (31 de agosto − 2 meses = 31 de junio, que
 * JS convierte en 1 de julio) y la ventana quedaría corrida un día respecto de
 * la del SQL que sí se usa para el gasto. Mismo bug que MEJ-31.
 */
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthsAgoIso = (months: number) => {
    const now = new Date();
    const day = now.getDate();
    const target = new Date(now.getFullYear(), now.getMonth() - months, 1);
    const lastDayOfTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, lastDayOfTarget));
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
};
const cacheKey = (tenantId: string) => `cost-centers:v2:${tenantId}`;

// Presupuesto por Centro de Costos: agrupa el gasto real (CostSnapshots) por
// el tag de Azure `CostCenter` (mismo tag que ya usa Gobernanza de Etiquetas
// como REQUERIDO y que el White Board usa para "Top 5 Cost Groups") y lo
// compara contra un presupuesto mensual opcional guardado en
// CostCenterBudgets — tabla que ya existía en el schema (usada solo por el
// teardown de tenants) pero nunca tuvo una API que la alimentara.
async function getCostCenterSpend(tenantId: string) {
    const [rows]: any = await pool.query(
        `SELECT COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')), 'null'), 'Sin asignar') AS name,
                SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS currentMonthCost,
                SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH) AND DATE(COALESCE(ChargePeriodStart, date)) < DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS previousMonthCost,
                GROUP_CONCAT(DISTINCT resource_group) AS rgNames
         FROM CostSnapshots
         WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH)
         GROUP BY name
         ORDER BY currentMonthCost DESC`,
        [tenantId]
    );
    return (rows as any[]).map(r => ({
        name: r.name as string,
        currentMonthCost: Number(r.currentMonthCost) || 0,
        previousMonthCost: Number(r.previousMonthCost) || 0,
        rgNames: String(r.rgNames || "").split(",").map((s: string) => s.trim()).filter(Boolean),
    }));
}

async function getBudgets(tenantId: string) {
    const [rows]: any = await pool.query(
        `SELECT cost_center_name, monthly_budget_usd FROM CostCenterBudgets WHERE tenant_id = ?`,
        [tenantId]
    );
    const map = new Map<string, number>();
    (rows as any[]).forEach(r => map.set(r.cost_center_name, Number(r.monthly_budget_usd) || 0));
    return map;
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantRole(request, tenantId, ["Admin", "Owner", "Reader", "Colaborador"]);
        await requireTenantTier(request, tenantId, "Business");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("cost_centers", tenantId));
        }

        const payload = await getWithStaleWhileRevalidate(cacheKey(tenantId), async () => {
            // MEJ-30 paso 3: el reparto por centro de costo sale del tag
            // `CostCenter` de `CostSnapshots.Tags`. Si el período llegó por el
            // sync vía Cost Management, esa columna viene vacía y TODO cae en
            // "Sin asignar" -- un `allocationRate` de 0% que no significa que
            // el cliente no etiquete, sino que el dato no llegó. Se informa
            // para que la UI no presente ese 0% como un hallazgo.
            const coverageWindow = { start: monthsAgoIso(2), end: todayIso() };
            const [spend, budgets, tagCoverage] = await Promise.all([
                getCostCenterSpend(tenantId),
                getBudgets(tenantId),
                getTagCoverage(tenantId, coverageWindow.start, coverageWindow.end),
            ]);

            // Proyección de cierre de mes: run-rate simple (gasto MTD / días
            // transcurridos * días del mes), mismo enfoque sin ML usado en el
            // resto del repo (ver forecast en /api/cost-groups).
            const now = new Date();
            const daysElapsed = now.getUTCDate();
            const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
            const runRateFactor = daysInMonth / Math.max(1, daysElapsed);

            const allRgNames = Array.from(new Set(spend.flatMap(s => s.rgNames.map(rg => rg.toLowerCase()))));
            const realResourceCounts = await fetchResourceCountsByRg(tenantId, allRgNames);

            const costCenters = spend.map(s => {
                const budget = budgets.has(s.name) ? budgets.get(s.name)! : null;
                const pctUsed = budget && budget > 0 ? Number(((s.currentMonthCost / budget) * 100).toFixed(1)) : null;
                const changePct = s.previousMonthCost > 0
                    ? Number((((s.currentMonthCost - s.previousMonthCost) / s.previousMonthCost) * 100).toFixed(1))
                    : 0;
                const projectedMonthEndSpend = Number((s.currentMonthCost * runRateFactor).toFixed(2));
                const projectedPctUsed = budget && budget > 0 ? Number(((projectedMonthEndSpend / budget) * 100).toFixed(1)) : null;
                const resourceCount = s.rgNames.reduce((sum, rg) => sum + (realResourceCounts.get(rg.toLowerCase()) || 0), 0);
                return {
                    name: s.name,
                    currentMonthCost: Number(s.currentMonthCost.toFixed(2)),
                    previousMonthCost: Number(s.previousMonthCost.toFixed(2)),
                    changePct,
                    budget,
                    pctUsed,
                    overBudget: budget !== null && s.currentMonthCost > budget,
                    projectedMonthEndSpend,
                    projectedPctUsed,
                    isProjectedOverBudget: budget !== null && budget > 0 && projectedMonthEndSpend > budget,
                    resourceCount,
                };
            });
            // Centros con presupuesto asignado pero sin gasto este mes (ej. recién creado) también deben verse.
            budgets.forEach((budget, name) => {
                if (!costCenters.some(c => c.name === name)) {
                    costCenters.push({
                        name, currentMonthCost: 0, previousMonthCost: 0, changePct: 0, budget, pctUsed: 0, overBudget: false,
                        projectedMonthEndSpend: 0, projectedPctUsed: 0, isProjectedOverBudget: false, resourceCount: 0,
                    });
                }
            });

            const totalSpend = costCenters.reduce((sum, c) => sum + c.currentMonthCost, 0);
            const totalBudget = costCenters.reduce((sum, c) => sum + (c.budget || 0), 0);
            const unassignedSpend = costCenters.find(c => c.name === UNASSIGNED_NAME)?.currentMonthCost || 0;
            const allocationRate = totalSpend > 0 ? Number((((totalSpend - unassignedSpend) / totalSpend) * 100).toFixed(1)) : 0;

            return {
                success: true,
                costCenters: costCenters.sort((a, b) => b.currentMonthCost - a.currentMonthCost),
                totalSpend: Number(totalSpend.toFixed(2)),
                totalBudget: Number(totalBudget.toFixed(2)),
                overBudgetCount: costCenters.filter(c => c.overBudget).length,
                unassignedSpend: Number(unassignedSpend.toFixed(2)),
                allocationRate,
                // false = "Sin asignar" incluye costo que nunca trajo etiquetas,
                // no sólo recursos realmente sin etiquetar.
                tagDataIsExact: tagCoverage.isExact,
            };
        }, 900, 300);

        return NextResponse.json(payload);
    } catch (err: unknown) {
        if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
        console.error("[cost-centers] GET error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, costCenterName, monthlyBudgetUsd } = body;
        if (!tenantId || !costCenterName || monthlyBudgetUsd === undefined) {
            return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
        }
        if (Number(monthlyBudgetUsd) < 0) {
            return NextResponse.json({ error: "El presupuesto no puede ser negativo" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
        await requireTenantTier(request, tenantId, "Business");

        await pool.query(
            `INSERT INTO CostCenterBudgets (tenant_id, cost_center_name, monthly_budget_usd)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE monthly_budget_usd = VALUES(monthly_budget_usd)`,
            [tenantId, costCenterName, Number(monthlyBudgetUsd)]
        );
        await redis.del(cacheKey(tenantId)).catch(() => {});

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
        console.error("[cost-centers] PUT error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const costCenterName = request.nextUrl.searchParams.get("costCenterName");
        if (!tenantId || !costCenterName) return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
        await requireTenantTier(request, tenantId, "Business");

        await pool.query(
            `DELETE FROM CostCenterBudgets WHERE tenant_id = ? AND cost_center_name = ?`,
            [tenantId, costCenterName]
        );
        await redis.del(cacheKey(tenantId)).catch(() => {});

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
        console.error("[cost-centers] DELETE error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
