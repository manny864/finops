import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { redis } from "@/lib/redis";
import { fetchResourceCountsByRg } from "@/lib/azureResourceCounts";
import { getTagCoverage } from "@/lib/costTagCoverage";
import {
    filtroDeLaRequest, exigirRecorte, comoFilaDeCosto, DIMENSIONES_DE_ALCANCE,
    type FilaConDimensiones, type Permiso,
} from "@/services/perspectivesData.service";
import type { FilaDeCosto } from "@/services/perspectives.service";
import { rangoDelAnioFiscal, mesFiscalDelTenant, arrastreDelMes } from "@/lib/fiscalYear";

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
type Alcance = (fila: FilaDeCosto) => boolean;

/** El balde por tag CostCenter y las dos medidas, iguales en las dos formas de la consulta. */
const BALDE_CC = `COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')), 'null'), '${UNASSIGNED_NAME}')`;
const MES_ACTUAL = `SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS currentMonthCost`;
const MES_ANTERIOR = `SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH) AND DATE(COALESCE(ChargePeriodStart, date)) < DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS previousMonthCost`;
const VENTANA = `tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH)`;

interface GastoPorCentro {
    name: string;
    currentMonthCost: number;
    previousMonthCost: number;
    rgNames: string[];
    /** Recursos distintos EN ALCANCE. Sólo se llena en el camino acotado. */
    resourcesEnAlcance: number;
}

/**
 * MEJ-34 — con alcance activo la agregación pasa de SQL a acá.
 *
 * El predicado de una Perspective se evalúa POR FILA y no se traduce a un
 * `WHERE`, así que la consulta trae el detalle por las cinco dimensiones que
 * las reglas miran y el plegado rehace lo que hacía el `GROUP BY`. Sin alcance
 * la consulta de siempre no se toca: es el camino caliente.
 */
async function getCostCenterSpend(tenantId: string, alcance?: Alcance): Promise<GastoPorCentro[]> {
    if (alcance) {
        const [detalle]: any = await pool.query(
            `SELECT ${BALDE_CC} AS name, ${DIMENSIONES_DE_ALCANCE}, ${MES_ACTUAL}, ${MES_ANTERIOR}
             FROM CostSnapshots
             WHERE ${VENTANA}
             GROUP BY name, ${DIMENSIONES_DE_ALCANCE}`,
            [tenantId]
        );
        const acc = new Map<string, { actual: number; previo: number; rgs: Set<string>; res: Set<string> }>();
        for (const f of (detalle as Array<FilaConDimensiones & { name: string; currentMonthCost: unknown; previousMonthCost: unknown }>)) {
            const actual = Number(f.currentMonthCost) || 0;
            const previo = Number(f.previousMonthCost) || 0;
            if (!alcance(comoFilaDeCosto(f, actual + previo))) continue;
            const e = acc.get(f.name) || { actual: 0, previo: 0, rgs: new Set<string>(), res: new Set<string>() };
            e.actual += actual;
            e.previo += previo;
            if (f.resource_group) e.rgs.add(f.resource_group);
            if (f.ResourceId) e.res.add(f.ResourceId);
            acc.set(f.name, e);
        }
        return [...acc.entries()]
            .map(([name, e]) => ({
                name,
                currentMonthCost: e.actual,
                previousMonthCost: e.previo,
                rgNames: [...e.rgs],
                resourcesEnAlcance: e.res.size,
            }))
            .sort((a, b) => b.currentMonthCost - a.currentMonthCost);
    }

    const [rows]: any = await pool.query(
        `SELECT ${BALDE_CC} AS name, ${MES_ACTUAL}, ${MES_ANTERIOR},
                GROUP_CONCAT(DISTINCT resource_group) AS rgNames
         FROM CostSnapshots
         WHERE ${VENTANA}
         GROUP BY name
         ORDER BY currentMonthCost DESC`,
        [tenantId]
    );
    return (rows as any[]).map(r => ({
        name: r.name as string,
        currentMonthCost: Number(r.currentMonthCost) || 0,
        previousMonthCost: Number(r.previousMonthCost) || 0,
        rgNames: String(r.rgNames || "").split(",").map((s: string) => s.trim()).filter(Boolean),
        resourcesEnAlcance: 0,
    }));
}

/** MEJ-36: el presupuesto de un centro, con su configuración de arrastre. */
interface ConfigPresupuesto {
    base: number;
    rollover: boolean;
    tope: number | null;
}

async function getBudgets(tenantId: string) {
    const [rows]: any = await pool.query(
        `SELECT cost_center_name, monthly_budget_usd, rollover_enabled, rollover_cap_usd
           FROM CostCenterBudgets WHERE tenant_id = ?`,
        [tenantId]
    );
    const map = new Map<string, ConfigPresupuesto>();
    (rows as any[]).forEach(r => map.set(r.cost_center_name, {
        base: Number(r.monthly_budget_usd) || 0,
        rollover: Number(r.rollover_enabled) === 1,
        tope: r.rollover_cap_usd == null ? null : Number(r.rollover_cap_usd),
    }));
    return map;
}

/**
 * MEJ-36 — gasto por centro de costo y por mes, desde que arrancó el ejercicio
 * hasta el mes pasado.
 *
 * Es lo que el arrastre necesita: cuánto quedó sin ejecutar en cada mes previo.
 * Se pide una sola vez para todos los centros, y sólo cuando algún presupuesto
 * tiene el arrastre encendido — con todos apagados esta consulta no corre y el
 * tablero cuesta lo mismo que antes.
 */
async function gastoMensualDelEjercicio(tenantId: string, desde: string, hasta: string) {
    const [rows]: any = await pool.query(
        `SELECT ${BALDE_CC} AS name,
                DATE_FORMAT(COALESCE(ChargePeriodStart, date), '%Y-%m') AS mes,
                SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
           FROM CostSnapshots
          WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ?
          GROUP BY name, mes
          ORDER BY mes ASC`,
        [tenantId, desde, hasta]
    );
    const porCentro = new Map<string, number[]>();
    for (const r of rows as any[]) {
        const lista = porCentro.get(r.name) || [];
        lista.push(Number(r.total) || 0);
        porCentro.set(r.name, lista);
    }
    return porCentro;
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const identidad = await requireTenantRole(request, tenantId, ["Admin", "Owner", "Reader", "Colaborador"]);
        await requireTenantTier(request, tenantId, "Business");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("cost_centers", tenantId));
        }

        // MEJ-34/38: alcance transversal, resuelto UNA vez. El asignado gana.
        const permiso: Permiso | null = identidad.alcance ?? null;
        const alcance = await filtroDeLaRequest(tenantId, request.nextUrl.searchParams, permiso);

        const calcular = async () => {
            // MEJ-30 paso 3: el reparto por centro de costo sale del tag
            // `CostCenter` de `CostSnapshots.Tags`. Si el período llegó por el
            // sync vía Cost Management, esa columna viene vacía y TODO cae en
            // "Sin asignar" -- un `allocationRate` de 0% que no significa que
            // el cliente no etiquete, sino que el dato no llegó. Se informa
            // para que la UI no presente ese 0% como un hallazgo.
            const coverageWindow = { start: monthsAgoIso(2), end: todayIso() };
            const tagCoverage = await getTagCoverage(tenantId, coverageWindow.start, coverageWindow.end);

            // UN ALCANCE SOLO SE APLICA SI SE PUEDE MEDIR. Sin procedencia en el
            // costo del período, el reparto se resuelve aproximando por Resource
            // Group y una aproximación no se recorta fila por fila: se devuelve
            // el tablero entero con `scopeApplied: false` y la pantalla lo dice.
            const recorte = alcance && tagCoverage.isExact ? alcance : null;
            exigirRecorte(permiso, recorte !== null);

            const [spend, budgets] = await Promise.all([
                getCostCenterSpend(tenantId, recorte || undefined),
                // EL PRESUPUESTO NO SE ACOTA, así que bajo alcance no se muestra.
                // Está definido para el centro de costo ENTERO: compararlo contra
                // el gasto de una porción diría "gastaste 150 de 10.000" cuando
                // los 10.000 cubren todo el centro. Un desvío que no es tal.
                recorte ? new Map<string, ConfigPresupuesto>() : getBudgets(tenantId),
            ]);

            // MEJ-36: el arrastre sólo cuesta una consulta cuando alguien lo
            // encendió. Con todos apagados el tablero vale lo mismo que antes.
            const hayArrastre = [...budgets.values()].some(b => b.rollover);
            const fy = rangoDelAnioFiscal(await mesFiscalDelTenant(tenantId));
            const finDelMesPasado = new Date();
            finDelMesPasado.setUTCDate(0);
            const gastoPrevio = hayArrastre && finDelMesPasado.toISOString().slice(0, 10) >= fy.start
                ? await gastoMensualDelEjercicio(tenantId, fy.start, finDelMesPasado.toISOString().slice(0, 10))
                : new Map<string, number[]>();

            // Proyección de cierre de mes: run-rate simple (gasto MTD / días
            // transcurridos * días del mes), mismo enfoque sin ML usado en el
            // resto del repo (ver forecast en /api/cost-groups).
            const now = new Date();
            const daysElapsed = now.getUTCDate();
            const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
            const runRateFactor = daysInMonth / Math.max(1, daysElapsed);

            // Con alcance no se enriquece: Resource Graph cuenta todos los
            // recursos del RG, incluidos los que el alcance dejó afuera. El
            // conteo acotado sale del detalle.
            const allRgNames = recorte ? [] : Array.from(new Set(spend.flatMap(s => s.rgNames.map(rg => rg.toLowerCase()))));
            const realResourceCounts = recorte ? new Map<string, number>() : await fetchResourceCountsByRg(tenantId, allRgNames);

            const costCenters = spend.map(s => {
                const cfg = budgets.get(s.name) ?? null;
                // MEJ-36: `budget` pasa a ser el EFECTIVO --base más arrastre--
                // porque es contra lo que el mes se mide; `budgetBase` viaja
                // aparte para que la pantalla pueda decir de dónde sale. Con el
                // arrastre apagado los dos son el mismo número, que es el
                // comportamiento de siempre.
                const arr = cfg
                    ? arrastreDelMes(cfg.base, gastoPrevio.get(s.name) || [], { habilitado: cfg.rollover, tope: cfg.tope })
                    : null;
                const budget = arr ? arr.efectivo : null;
                const pctUsed = budget && budget > 0 ? Number(((s.currentMonthCost / budget) * 100).toFixed(1)) : null;
                const changePct = s.previousMonthCost > 0
                    ? Number((((s.currentMonthCost - s.previousMonthCost) / s.previousMonthCost) * 100).toFixed(1))
                    : 0;
                const projectedMonthEndSpend = Number((s.currentMonthCost * runRateFactor).toFixed(2));
                const projectedPctUsed = budget && budget > 0 ? Number(((projectedMonthEndSpend / budget) * 100).toFixed(1)) : null;
                const resourceCount = recorte
                    ? s.resourcesEnAlcance
                    : s.rgNames.reduce((sum, rg) => sum + (realResourceCounts.get(rg.toLowerCase()) || 0), 0);
                return {
                    name: s.name,
                    currentMonthCost: Number(s.currentMonthCost.toFixed(2)),
                    previousMonthCost: Number(s.previousMonthCost.toFixed(2)),
                    changePct,
                    budget,
                    budgetBase: arr ? arr.base : null,
                    budgetRollover: arr ? arr.arrastre : 0,
                    pctUsed,
                    overBudget: budget !== null && s.currentMonthCost > budget,
                    projectedMonthEndSpend,
                    projectedPctUsed,
                    isProjectedOverBudget: budget !== null && budget > 0 && projectedMonthEndSpend > budget,
                    resourceCount,
                };
            });
            // Centros con presupuesto asignado pero sin gasto este mes (ej. recién creado) también deben verse.
            budgets.forEach((cfg, name) => {
                if (!costCenters.some(c => c.name === name)) {
                    // Sin gasto este mes, pero puede venir arrastrando de los
                    // anteriores del ejercicio.
                    const arr = arrastreDelMes(cfg.base, gastoPrevio.get(name) || [], { habilitado: cfg.rollover, tope: cfg.tope });
                    costCenters.push({
                        name, currentMonthCost: 0, previousMonthCost: 0, changePct: 0,
                        budget: arr.efectivo, budgetBase: arr.base, budgetRollover: arr.arrastre,
                        pctUsed: 0, overBudget: false,
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
                // MEJ-34: con un alcance pedido y esto en false, los números son
                // los del tablero SIN acotar. En true, los presupuestos vienen
                // en null a propósito (ver arriba).
                scopeApplied: recorte !== null,
            };
        };

        // El recorte no se cachea: su clave sería una por (perspective, grupo) y
        // el PUT/DELETE de presupuesto sólo invalida la del tablero sin acotar.
        const payload = alcance
            ? await calcular()
            : await getWithStaleWhileRevalidate(cacheKey(tenantId), calcular, 900, 300);

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
        const { tenantId, costCenterName, monthlyBudgetUsd, rolloverEnabled, rolloverCapUsd } = body;
        if (!tenantId || !costCenterName || monthlyBudgetUsd === undefined) {
            return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
        }
        if (Number(monthlyBudgetUsd) < 0) {
            return NextResponse.json({ error: "El presupuesto no puede ser negativo" }, { status: 400 });
        }
        // MEJ-36: un tope negativo no es "sin tope", es un error de quien llama.
        // Sin tope se manda `null`, que es el default de la columna.
        if (rolloverCapUsd != null && (Number.isNaN(Number(rolloverCapUsd)) || Number(rolloverCapUsd) < 0)) {
            return NextResponse.json({ error: "El tope de arrastre debe ser un número >= 0, o null para no tener tope" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
        await requireTenantTier(request, tenantId, "Business");

        await pool.query(
            `INSERT INTO CostCenterBudgets (tenant_id, cost_center_name, monthly_budget_usd, rollover_enabled, rollover_cap_usd)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE monthly_budget_usd = VALUES(monthly_budget_usd),
                                     rollover_enabled = VALUES(rollover_enabled),
                                     rollover_cap_usd = VALUES(rollover_cap_usd)`,
            [tenantId, costCenterName, Number(monthlyBudgetUsd),
             rolloverEnabled === true ? 1 : 0,
             rolloverCapUsd == null ? null : Number(rolloverCapUsd)]
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
