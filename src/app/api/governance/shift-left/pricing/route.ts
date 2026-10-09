/**
 * PUT /api/governance/shift-left/pricing — el descuento del cliente sobre el precio
 * de lista (MEJ-20).
 *
 * La Retail API publica precios de LISTA; un cliente con contrato (EA/MCA), reservas
 * o savings plans paga menos. Un porcentaje por tenant, que el estimador aplica a
 * cada línea, acerca el delta del PR a lo que de verdad se va a facturar. Es un
 * promedio declarado por el cliente, no el precio de cada medidor.
 *
 * Un solo verbo y una fila por tenant: sin descuento (vacío o 0) borra la fila, y
 * "sin fila" significa 0 en todo el módulo.
 *
 * Rol Admin/Owner y tier Enterprise, igual que el resto de la configuración del módulo.
 */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { errorMessage, errorStatus, serverError } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
    try {
        const cuerpo = await request.json().catch(() => ({}));
        const tenantId = String(cuerpo?.tenantId || "");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const crudo = cuerpo?.discount_pct;
        const sinDescuento = crudo === null || crudo === undefined || crudo === "";
        const pct = sinDescuento ? 0 : Number(crudo);
        // Más de 100 daría un costo negativo; negativo, un recargo que el cliente no pidió.
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
            return NextResponse.json({ error: "El descuento tiene que ser un número entre 0 y 100" }, { status: 400 });
        }
        // La columna es DECIMAL(5,2): se redondea acá para que lo que se devuelve sea lo que se guardó.
        const guardado = Math.round(pct * 100) / 100;

        // La demo valida igual que producción y sólo se saltea la persistencia.
        if (isMockTenant(tenantId)) return NextResponse.json({ ok: true, mock: true, discount_pct: guardado });

        await requireTenantTier(request, tenantId, "Enterprise");
        const identidad = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        if (guardado === 0) {
            await pool.query(`DELETE FROM IacPricingSettings WHERE tenant_id = ?`, [tenantId]);
            return NextResponse.json({ ok: true, discount_pct: 0 });
        }

        await pool.query(
            `INSERT INTO IacPricingSettings (tenant_id, discount_pct, updated_by)
                  VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE discount_pct = VALUES(discount_pct), updated_by = VALUES(updated_by)`,
            [tenantId, guardado, identidad?.email || null]
        );
        return NextResponse.json({ ok: true, discount_pct: guardado });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        }
        console.error("[/api/governance/shift-left/pricing]", errorMessage(e));
        return serverError(e);
    }
}
