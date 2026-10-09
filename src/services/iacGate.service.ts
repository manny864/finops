import pool from "@/modules/storage/db";
import { createNotification } from "@/lib/notify";
import { notifyTenant } from "@/lib/notifications";
import { errorMessage } from "@/lib/apiErrors";

/**
 * MEJ-20 — Budget Gates de Shift-Left: la regla que decide si un PR "cabe".
 *
 * Un gate tiene hasta dos condiciones, y alcanza con que se cumpla una:
 *
 *   `threshold_usd`              el PR agrega más de N USD por mes.
 *   `threshold_pct_of_remaining` el PR agrega más de P% de lo que le queda al
 *                                presupuesto mensual del centro de costos.
 *
 * Y un tercer dato, sin umbral: `cost_center_name`, que sólo da contexto ("este PR
 * consume el 40% del presupuesto de Plataforma") y no bloquea nada.
 *
 * La lógica está acá, separada de la ruta, porque es la que decide si se rompe el
 * build de un equipo: tiene que poder probarse sin base de datos.
 */

export type EstadoGate = "NOT_EVALUATED" | "OK" | "EXCEEDED";

export interface FilaGate {
    threshold_usd: number | null;
    threshold_pct_of_remaining: number | null;
    cost_center_name: string | null;
}

export interface PresupuestoCentro {
    centro: string;
    /** Presupuesto mensual base del centro (`CostCenterBudgets.monthly_budget_usd`). */
    mensual: number;
    /** Gasto del mes en curso hasta hoy. */
    gastado: number;
}

export interface ContextoPresupuesto {
    cost_center: string;
    monthly_usd: number;
    spent_usd: number;
    /** Lo que queda del mes. Puede ser negativo: el centro ya se pasó. */
    remaining_usd: number;
    /** Cuánto pesa el delta del PR sobre el presupuesto mensual completo. */
    delta_pct_of_budget: number | null;
    /** Cuánto pesa sobre lo que queda. `null` si no queda nada (no hay base para el porcentaje). */
    delta_pct_of_remaining: number | null;
}

export interface ResultadoGate {
    status: EstadoGate;
    threshold_usd: number | null;
    threshold_pct_of_remaining: number | null;
    /** Cuál de las dos condiciones se cumplió. */
    reason: "usd" | "pct" | null;
}

const redondear2 = (n: number): number => Number(n.toFixed(2));

export function contextoDePresupuesto(p: PresupuestoCentro, delta: number): ContextoPresupuesto {
    const remaining = p.mensual - p.gastado;
    return {
        cost_center: p.centro,
        monthly_usd: redondear2(p.mensual),
        spent_usd: redondear2(p.gastado),
        remaining_usd: redondear2(remaining),
        delta_pct_of_budget: p.mensual > 0 ? redondear2((delta / p.mensual) * 100) : null,
        delta_pct_of_remaining: remaining > 0 ? redondear2((delta / remaining) * 100) : null,
    };
}

const numeroONull = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * Evalúa el gate de un repositorio contra el delta de un PR.
 *
 * Un PR que ahorra (delta ≤ 0) nunca dispara un gate: con un umbral de 0 USD el
 * gate pasa a ser "no se permite agregar costo", pero ahorrar no es agregar.
 */
export function evaluarGate(fila: FilaGate | null, delta: number, ctx: ContextoPresupuesto | null): ResultadoGate {
    const usd = numeroONull(fila?.threshold_usd);
    const pct = numeroONull(fila?.threshold_pct_of_remaining);
    const sinEvaluar: ResultadoGate = { status: "NOT_EVALUATED", threshold_usd: usd, threshold_pct_of_remaining: pct, reason: null };
    if (!fila || (usd === null && pct === null)) return sinEvaluar;

    const pasaUsd = usd !== null && delta > usd;

    // El porcentaje se mide contra lo que queda. Si no queda nada (o se pasó), cualquier
    // aumento lo supera; si no hay presupuesto que consultar, esta condición no se puede evaluar.
    let evaluablePct = false;
    let pasaPct = false;
    if (pct !== null && ctx) {
        evaluablePct = true;
        pasaPct = ctx.remaining_usd <= 0 ? delta > 0 : delta > (ctx.remaining_usd * pct) / 100;
    }

    if (pasaUsd) return { ...sinEvaluar, status: "EXCEEDED", reason: "usd" };
    if (pasaPct) return { ...sinEvaluar, status: "EXCEEDED", reason: "pct" };
    if (usd !== null || evaluablePct) return { ...sinEvaluar, status: "OK" };
    return sinEvaluar;
}

/** Fila de gate del repositorio, o null. Una falla de lectura no bloquea nada. */
export async function leerGate(tenantId: string, repository: string): Promise<FilaGate | null> {
    if (!repository) return null;
    try {
        const [filas]: any = await pool.query(
            `SELECT threshold_usd, threshold_pct_of_remaining, cost_center_name
               FROM IacBudgetGates
              WHERE tenant_id = ? AND repository = ?
              LIMIT 1`,
            [tenantId, repository]
        );
        const f = filas?.[0];
        if (!f) return null;
        // DECIMAL vuelve como string desde mysql2; sin Number() la comparación sería
        // lexicográfica y "9" > "10".
        return {
            threshold_usd: numeroONull(f.threshold_usd),
            threshold_pct_of_remaining: numeroONull(f.threshold_pct_of_remaining),
            cost_center_name: f.cost_center_name ? String(f.cost_center_name) : null,
        };
    } catch (e) {
        // Es un control de costo: frenar el trabajo de un equipo por una falla nuestra
        // es peor que dejar pasar un cambio caro.
        console.error("[shift-left] no se pudo leer el Budget Gate:", errorMessage(e));
        return null;
    }
}

/**
 * Presupuesto del mes del centro de costos y lo gastado hasta hoy. Usa las mismas
 * fuentes que la pantalla de Centros de Costo: `CostCenterBudgets` y el tag
 * `CostCenter` de `CostSnapshots`.
 *
 * Devuelve null si el centro no tiene presupuesto (no hay contra qué comparar).
 */
export async function presupuestoDelCentro(tenantId: string, centro: string): Promise<PresupuestoCentro | null> {
    if (!centro) return null;
    try {
        const [b]: any = await pool.query(
            `SELECT monthly_budget_usd FROM CostCenterBudgets WHERE tenant_id = ? AND cost_center_name = ? LIMIT 1`,
            [tenantId, centro]
        );
        if (!Array.isArray(b) || b.length === 0) return null;
        const mensual = Number(b[0].monthly_budget_usd) || 0;

        const [g]: any = await pool.query(
            `SELECT SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS gasto
               FROM CostSnapshots
              WHERE tenant_id = ?
                AND JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')) = ?
                AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
            [tenantId, centro]
        );
        return { centro, mensual, gastado: Number(g?.[0]?.gasto) || 0 };
    } catch (e) {
        console.error("[shift-left] no se pudo leer el presupuesto del centro de costos:", errorMessage(e));
        return null;
    }
}

/** Descuento del cliente sobre el precio de lista (0–100). Sin fila o ante una falla: 0. */
export async function leerDescuento(tenantId: string): Promise<number> {
    try {
        const [filas]: any = await pool.query(
            `SELECT discount_pct FROM IacPricingSettings WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
        );
        const d = numeroONull(filas?.[0]?.discount_pct);
        return d === null ? 0 : Math.min(Math.max(d, 0), 100);
    } catch (e) {
        console.error("[shift-left] no se pudo leer el descuento del tenant:", errorMessage(e));
        return 0;
    }
}

export interface EstimacionPrevia {
    delta_cost_usd: number;
    commit_sha: string | null;
    gate_status: EstadoGate;
    created_at: string;
}

/** La estimación anterior del MISMO PR (el push previo), para mostrar cómo cambió. */
export async function leerEstimacionPrevia(
    tenantId: string, repository: string, prNumber: number | null
): Promise<EstimacionPrevia | null> {
    if (!repository || prNumber === null) return null;
    try {
        const [filas]: any = await pool.query(
            `SELECT delta_cost_usd, commit_sha, gate_status, created_at
               FROM IacCostEstimations
              WHERE tenant_id = ? AND repository = ? AND pr_number = ?
              ORDER BY id DESC
              LIMIT 1`,
            [tenantId, repository, prNumber]
        );
        const f = filas?.[0];
        if (!f) return null;
        return {
            delta_cost_usd: Number(f.delta_cost_usd) || 0,
            commit_sha: f.commit_sha ? String(f.commit_sha) : null,
            gate_status: f.gate_status as EstadoGate,
            created_at: new Date(f.created_at).toISOString(),
        };
    } catch (e) {
        console.error("[shift-left] no se pudo leer la estimación previa:", errorMessage(e));
        return null;
    }
}

/**
 * Avisa al tenant que un PR superó su Budget Gate: campana en la plataforma y los
 * canales que tenga configurados (Teams, Slack, correo, webhook).
 *
 * Sólo en la TRANSICIÓN a EXCEEDED: un PR se re-estima en cada push y avisar cada vez
 * convertiría el aviso en ruido que nadie lee. Nunca lanza: es un aviso, y la
 * estimación ya está calculada y es lo que el CI está esperando.
 */
export async function avisarGateSuperado(
    tenantId: string,
    d: { repository: string; prNumber: number | null; delta: number; gate: ResultadoGate }
): Promise<void> {
    const pr = d.prNumber ? ` #${d.prNumber}` : "";
    const porPct = d.gate.reason === "pct";
    const valor = porPct ? d.gate.threshold_pct_of_remaining : d.gate.threshold_usd;
    const delta = Number(d.delta.toFixed(2));
    // Los params se arman con nombres sueltos y no con plantillas: la prueba de i18n los lee
    // del fuente con una regex que corta en la primera llave.
    const repo = `${d.repository}${pr}`;
    const value = valor ?? 0;

    // Texto de respaldo en castellano: es lo que consumen los canales que no son la
    // UI localizada (Teams, Slack, correo) y el fallback si faltara la clave.
    const title = `Shift-Left: ${d.repository}${pr} superó su Budget Gate`;
    const message = `El Pull Request agrega ${delta.toFixed(2)} USD/mes y el umbral configurado es ` +
        (porPct ? `${valor}% del presupuesto restante.` : `${valor} USD/mes.`);

    // Un call site por motivo, cada uno con sus claves literales: el mensaje cambia de forma
    // según cuál umbral se superó, y las pruebas de i18n leen las claves del fuente.
    const aviso = porPct
        ? createNotification({
            tenantId,
            title,
            message,
            titleKey: "notif_shift_left_gate_title",
            messageKey: "notif_shift_left_gate_pct_msg",
            // Números y nombres, nunca frases: la fila no expira y el idioma se resuelve al mostrarla.
            params: { repo: repo, delta: delta, value: value },
            href: "/governance/shift-left",
            severity: "warning",
            source: "shift-left",
        })
        : createNotification({
            tenantId,
            title,
            message,
            titleKey: "notif_shift_left_gate_title",
            messageKey: "notif_shift_left_gate_usd_msg",
            params: { repo: repo, delta: delta, value: value },
            href: "/governance/shift-left",
            severity: "warning",
            source: "shift-left",
        });

    await Promise.allSettled([
        aviso,
        notifyTenant(tenantId, { title, message, severity: "warning", link: "/governance/shift-left" }),
    ]);
}
