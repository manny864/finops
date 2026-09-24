import Decimal from "decimal.js";
import pool from "@/modules/storage/db";

/**
 * MEJ-40 — ESR (Effective Savings Rate): qué porcentaje del gasto a precio de
 * lista se está ahorrando, todo junto y en un solo número.
 *
 * Es el KPI con el que ProsperOps resume una cartera entera. La gracia es que
 * no se puede maquillar: la cobertura sube comprando reservas de más y la
 * utilización sube comprando de menos, así que cada una por separado se puede
 * optimizar en contra del bolsillo. El ESR no, porque mide plata contra plata.
 *
 *     ESR = (ListCost - EffectiveCost) / ListCost
 *
 * SÓLO SE MIDE LO QUE TIENE PRECIO DE LISTA. `ListCost` es NULL en las filas
 * que entran por la Query API de Cost Management, que no devuelve precio
 * público. Esas filas quedan FUERA del cálculo y se informan como gasto no
 * evaluado, en vez de entrar con ListCost = 0 —que se leería como 100% de
 * descuento— o con ListCost = costo —que se leería como 0% y hundiría el
 * promedio—. Las dos alternativas dan un número que parece completo y no lo es.
 */

export interface TasaEfectivaAhorro {
    /** Porcentaje 0-100, o null si no hay nada con precio de lista para medir. */
    esr: number | null;
    /** Gasto a precio público de lo que sí se pudo evaluar. */
    listCost: number;
    /** Lo que ese mismo gasto costó de verdad, amortizado. */
    effectiveCost: number;
    ahorro: number;
    /** Porcentaje del gasto del período que entró en el cálculo. */
    cobertura: number;
    gastoEvaluado: number;
    gastoTotal: number;
}

const VACIO: TasaEfectivaAhorro = {
    esr: null, listCost: 0, effectiveCost: 0, ahorro: 0,
    cobertura: 0, gastoEvaluado: 0, gastoTotal: 0,
};

function pct(parte: Decimal, total: Decimal): number {
    if (total.lte(0)) return 0;
    return Number(parte.dividedBy(total).times(100).toFixed(2));
}

export interface AgregadoAhorro {
    listCost: number;
    effectiveCost: number;
    gastoEvaluado: number;
    gastoTotal: number;
}

export function tasaEfectivaDeAhorro(agg: AgregadoAhorro): TasaEfectivaAhorro {
    const list = new Decimal(Number(agg?.listCost) || 0);
    const efectivo = new Decimal(Number(agg?.effectiveCost) || 0);
    const evaluado = new Decimal(Number(agg?.gastoEvaluado) || 0);
    const total = new Decimal(Number(agg?.gastoTotal) || 0);

    const cobertura = pct(evaluado, total);

    // Sin precio de lista no hay contra qué comparar. Devolver 0% diría "no
    // estás ahorrando nada", que es una afirmación sobre la cartera; null dice
    // "no lo sé", que es lo único cierto.
    if (list.lte(0)) return { ...VACIO, cobertura, gastoTotal: Number(total.toFixed(4)) };

    const ahorro = list.minus(efectivo);

    return {
        // Puede dar negativo si lo efectivo superó al precio de lista. No se
        // recorta a 0: es señal de datos mal cargados y taparla la esconde.
        esr: Number(ahorro.dividedBy(list).times(100).toFixed(2)),
        listCost: Number(list.toFixed(4)),
        effectiveCost: Number(efectivo.toFixed(4)),
        ahorro: Number(ahorro.toFixed(4)),
        cobertura,
        gastoEvaluado: Number(evaluado.toFixed(4)),
        gastoTotal: Number(total.toFixed(4)),
    };
}

/**
 * Lee el agregado del período y devuelve el ESR. Una sola consulta, sin
 * llamadas nuevas a Azure: el dato ya está en la base desde que la ingesta del
 * export FOCUS guarda `ListCost` (migración 20260923-001).
 */
export async function tasaDeAhorroDelTenant(tenantId: string, dias = 30): Promise<TasaEfectivaAhorro> {
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    try {
        const [filas] = await pool.query<any[]>(
            `SELECT
                COALESCE(SUM(CASE WHEN ListCost IS NOT NULL THEN ListCost END), 0) AS listCost,
                COALESCE(SUM(CASE WHEN ListCost IS NOT NULL THEN COALESCE(EffectiveCost, cost_usd) END), 0) AS effectiveCost,
                COALESCE(SUM(CASE WHEN ListCost IS NOT NULL THEN cost_usd END), 0) AS gastoEvaluado,
                COALESCE(SUM(cost_usd), 0) AS gastoTotal
               FROM CostSnapshots
              WHERE tenant_id = ? AND date >= ?`,
            [tenantId, desde]
        );
        const f = filas?.[0] || {};
        return tasaEfectivaDeAhorro({
            listCost: Number(f.listCost) || 0,
            effectiveCost: Number(f.effectiveCost) || 0,
            gastoEvaluado: Number(f.gastoEvaluado) || 0,
            gastoTotal: Number(f.gastoTotal) || 0,
        });
    } catch {
        // El ESR es un agregado más de una pantalla: si la consulta falla, la
        // pantalla se dibuja sin él.
        return { ...VACIO };
    }
}
