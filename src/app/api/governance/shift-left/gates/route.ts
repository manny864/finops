/**
 * PUT /api/governance/shift-left/gates — administra el Budget Gate de un
 * repositorio (MEJ-20).
 *
 * Un gate tiene hasta tres datos, todos opcionales:
 *   threshold_usd              el PR no puede agregar más de N USD por mes.
 *   threshold_pct_of_remaining ni más de P% de lo que le queda al presupuesto del mes.
 *   cost_center_name           a qué centro de costos pertenece (da contexto de
 *                              presupuesto aunque no haya umbral).
 *
 * Un solo verbo para alta, cambio y baja: sin ninguno de los tres se borra la fila.
 * Separar un DELETE acá sería una ruta más y un guard más para expresar lo mismo
 * que "este repo ya no tiene gate". Es un upsert, así que un campo ausente se
 * guarda como NULL: no hay un "dejalo como está".
 *
 * El listado no vive acá: viaja en el GET de `/api/governance/shift-left`, que
 * es el que la pantalla ya pide. Una ruta aparte sería un segundo fetch para
 * pintar la misma tabla.
 *
 * Rol Admin/Owner: configurar cuánto puede gastar un repo es gobernanza, no
 * lectura. Tier Enterprise, igual que el resto del módulo.
 */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { errorMessage, errorStatus, serverError } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";

export const dynamic = "force-dynamic";

/** Un umbral negativo bloquearía todo PR que no ahorre: no es un umbral, es un paro. */
const MIN_USD = 0;
/** Techo para que un typo (12000000 por 1200) no quede guardado como "sin gate". */
const MAX_USD = 10_000_000;
/** Un porcentaje de lo que queda: más de 1000 no es un umbral, es un typo. */
const MAX_PCT = 1000;

const vacio = (v: unknown): boolean => v === null || v === undefined || v === "";

function numeroEnRango(crudo: unknown, min: number, max: number): number | null | "invalido" {
    if (vacio(crudo)) return null;
    const n = Number(crudo);
    return Number.isFinite(n) && n >= min && n <= max ? n : "invalido";
}

export async function PUT(request: NextRequest) {
    try {
        const cuerpo = await request.json().catch(() => ({}));
        const tenantId = String(cuerpo?.tenantId || "");
        const repository = String(cuerpo?.repository || "").trim();
        const centro = String(cuerpo?.cost_center_name ?? "").trim();

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        if (!repository) return NextResponse.json({ error: "Falta repository" }, { status: 400 });
        if (repository.length > 255) {
            return NextResponse.json({ error: "El repositorio no puede superar 255 caracteres" }, { status: 400 });
        }
        if (centro.length > 255) {
            return NextResponse.json({ error: "El centro de costos no puede superar 255 caracteres" }, { status: 400 });
        }

        // null/""/ausente = sin ese umbral. Undefined también: un PUT sin el campo
        // no puede significar "dejalo como está" cuando el verbo es un upsert.
        const usd = numeroEnRango(cuerpo?.threshold_usd, MIN_USD, MAX_USD);
        if (usd === "invalido") {
            return NextResponse.json(
                { error: `El umbral tiene que ser un número entre ${MIN_USD} y ${MAX_USD}` },
                { status: 400 }
            );
        }
        const pct = numeroEnRango(cuerpo?.threshold_pct_of_remaining, 0, MAX_PCT);
        if (pct === "invalido") {
            return NextResponse.json(
                { error: `El porcentaje tiene que ser un número entre 0 y ${MAX_PCT}` },
                { status: 400 }
            );
        }
        if (pct !== null && !centro) {
            // Sin centro de costos no hay presupuesto contra el cual medir el porcentaje.
            return NextResponse.json(
                { error: "El umbral por porcentaje necesita un centro de costos con presupuesto" },
                { status: 400 }
            );
        }
        const borrar = usd === null && pct === null && !centro;
        const salida = { threshold_usd: usd, threshold_pct_of_remaining: pct, cost_center_name: centro || null };

        // La demo valida igual que producción y sólo se saltea la persistencia:
        // si aceptara lo que el producto rechaza, estaría mostrando otra cosa.
        if (isMockTenant(tenantId)) {
            return NextResponse.json({ ok: true, mock: true, ...salida });
        }

        await requireTenantTier(request, tenantId, "Enterprise");
        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        if (borrar) {
            await pool.query(`DELETE FROM IacBudgetGates WHERE tenant_id = ? AND repository = ?`, [tenantId, repository]);
            return NextResponse.json({ ok: true, ...salida });
        }

        if (centro) {
            // Un centro sin presupuesto cargado dejaría un gate que nunca se evalúa y
            // un contexto que nunca aparece, sin que nadie se entere.
            const [filas]: any = await pool.query(
                `SELECT 1 FROM CostCenterBudgets WHERE tenant_id = ? AND cost_center_name = ? LIMIT 1`,
                [tenantId, centro]
            );
            if (!Array.isArray(filas) || filas.length === 0) {
                return NextResponse.json(
                    { error: "Ese centro de costos no tiene un presupuesto mensual cargado" },
                    { status: 400 }
                );
            }
        }

        await pool.query(
            `INSERT INTO IacBudgetGates (tenant_id, repository, cost_center_name, threshold_usd, threshold_pct_of_remaining)
                  VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE cost_center_name = VALUES(cost_center_name),
                                     threshold_usd = VALUES(threshold_usd),
                                     threshold_pct_of_remaining = VALUES(threshold_pct_of_remaining)`,
            [tenantId, repository, salida.cost_center_name, usd, pct]
        );

        return NextResponse.json({ ok: true, repository, ...salida });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        }
        console.error("[/api/governance/shift-left/gates]", errorMessage(e));
        return serverError(e);
    }
}
