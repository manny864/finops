/**
 * POST /api/tenants/partner-link
 * Body: { tenantId, approve: boolean }
 *
 * El cliente aprueba (o rechaza) la asociación de partner (PAL/CPOR) para
 * su tenant. Requiere rol Admin/Owner del tenant — es una decisión de la
 * organización cliente, no nuestra. Con aprobación se registra la evidencia
 * (quién/cuándo) y se intenta el link PAL; el claim CPOR se gestiona luego
 * en Partner Center usando esa evidencia.
 *
 * Porteado de M365Proyect/saas/src/app/api/m365/connections/[id]/partner-link/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import { linkPal } from "@/lib/partner/pal";

interface TenantRow {
  tenant_id: string;
  has_client_secret: number;
  partner_link_status: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const tenantId = body?.tenantId;
    const approve = body?.approve;
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    if (typeof approve !== "boolean") {
      return NextResponse.json({ error: "approve debe ser boolean" }, { status: 400 });
    }

    const identity = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

    const [rows] = await pool.query(
      `SELECT tenant_id, (client_secret IS NOT NULL AND client_secret <> '') as has_client_secret,
              partner_link_status
         FROM Tenants WHERE tenant_id = ? LIMIT 1`,
      [tenantId]
    );
    const tenant = (rows as TenantRow[])[0];
    if (!tenant) return NextResponse.json({ error: "Tenant no encontrado" }, { status: 404 });

    if (!approve) {
      await pool.query(
        `UPDATE Tenants SET partner_link_status = 'DECLINED',
           partner_link_approved_by = ?, partner_link_approved_at = NOW(),
           partner_link_detail = 'Rechazado por el cliente' WHERE tenant_id = ?`,
        [identity.email, tenantId]
      );
      return NextResponse.json({ success: true, status: "DECLINED" });
    }

    if (!tenant.has_client_secret) {
      return NextResponse.json(
        { error: "El tenant debe tener credenciales de Azure configuradas antes de asociar el partner" },
        { status: 409 }
      );
    }

    // Registrar la aprobación ANTES de intentar el link (evidencia auditable).
    await pool.query(
      `UPDATE Tenants SET partner_link_status = 'APPROVED',
         partner_link_approved_by = ?, partner_link_approved_at = NOW(),
         partner_link_detail = NULL WHERE tenant_id = ?`,
      [identity.email, tenantId]
    );

    const result = await linkPal(tenantId);
    const status = result.linked ? "LINKED" : "FAILED";
    await pool.query(
      "UPDATE Tenants SET partner_link_status = ?, partner_link_detail = ? WHERE tenant_id = ?",
      [status, result.detail.slice(0, 500), tenantId]
    );

    return NextResponse.json({ success: true, status, detail: result.detail });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[api/tenants/partner-link] error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
