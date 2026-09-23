/**
 * PUT /api/governance/shift-left/gates — administra el umbral del Budget Gate
 * de un repositorio (MEJ-20).
 *
 * Un solo verbo para alta, cambio y baja: `threshold_usd: null` borra la fila.
 * Separar un DELETE acá sería una ruta más y un guard más para expresar lo mismo
 * que "este repo ya no tiene umbral".
 *
 * El listado no vive acá: viaja en el GET de `/api/governance/shift-left`, que
 * es el que la pantalla ya pide. Una ruta aparte sería un segundo fetch para
 * pintar la misma tabla.
 *
 * Rol Admin/Owner: configurar cuánto puede gastar un repo es gobernanza, no
 * lectura. Tier Business, igual que el resto del módulo.
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

export async function PUT(request: NextRequest) {
    try {
        const cuerpo = await request.json().catch(() => ({}));
        const tenantId = String(cuerpo?.tenantId || "");
        const repository = String(cuerpo?.repository || "").trim();

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        if (!repository) return NextResponse.json({ error: "Falta repository" }, { status: 400 });
        if (repository.length > 255) {
            return NextResponse.json({ error: "El repositorio no puede superar 255 caracteres" }, { status: 400 });
        }

        // null/""/ausente = sacar el gate. Undefined también: un PUT sin el campo
        // no puede significar "dejalo como está" cuando el verbo es un upsert.
        const crudo = cuerpo?.threshold_usd;
        const borrar = crudo === null || crudo === undefined || crudo === "";

        let umbral = 0;
        if (!borrar) {
            umbral = Number(crudo);
            if (!Number.isFinite(umbral) || umbral < MIN_USD || umbral > MAX_USD) {
                return NextResponse.json(
                    { error: `El umbral tiene que ser un número entre ${MIN_USD} y ${MAX_USD}` },
                    { status: 400 }
                );
            }
        }

        // La demo valida igual que producción y sólo se saltea la persistencia:
        // si aceptara lo que el producto rechaza, estaría mostrando otra cosa.
        if (isMockTenant(tenantId)) {
            return NextResponse.json({ ok: true, mock: true, threshold_usd: borrar ? null : umbral });
        }

        await requireTenantTier(request, tenantId, "Business");
        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        if (borrar) {
            await pool.query(`DELETE FROM IacBudgetGates WHERE tenant_id = ? AND repository = ?`, [tenantId, repository]);
            return NextResponse.json({ ok: true, threshold_usd: null });
        }

        await pool.query(
            `INSERT INTO IacBudgetGates (tenant_id, repository, threshold_usd)
                  VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE threshold_usd = VALUES(threshold_usd)`,
            [tenantId, repository, umbral]
        );

        return NextResponse.json({ ok: true, repository, threshold_usd: umbral });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        }
        console.error("[/api/governance/shift-left/gates]", errorMessage(e));
        return serverError(e);
    }
}
