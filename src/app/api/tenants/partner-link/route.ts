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
import { notifyTenant } from "@/lib/notifications";

interface TenantRow {
  tenant_id: string;
  company_name: string;
  has_client_secret: number;
  partner_link_status: string;
}

async function notifySuperAdminsPartnerEvent(args: {
  status: string;
  tenantId: string;
  tenantName: string;
  detail: string;
  origin: string;
}): Promise<void> {
  const [rows] = await pool.query(
    `SELECT DISTINCT tenant_id
       FROM Users
      WHERE system_role='SUPERADMIN'`
  );
  const superAdminTenantIds = (rows as Array<{ tenant_id: string }>).map((r) => r.tenant_id);
  if (superAdminTenantIds.length === 0) return;

  const severity = args.status === "FAILED" ? "error" : args.status === "APPROVED" ? "warning" : "info";
  const title = `PAL/CPOR tenant ${args.status}`;
  const message =
    `Tenant: ${args.tenantName} (${args.tenantId}) · ` +
    `Estado: ${args.status} · ` +
    `Detalle: ${args.detail || "-"}`;

  await Promise.all(
    superAdminTenantIds.map((superAdminTenantId) =>
      notifyTenant(superAdminTenantId, {
        title,
        message,
        severity,
        link: `${args.origin}/superadmin/partner-alerts`,
        metadata: {
          source: "partner_link",
          tenantId: args.tenantId,
          tenantName: args.tenantName,
          status: args.status,
        },
      })
    )
  );
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
      `SELECT tenant_id, company_name, (client_secret IS NOT NULL AND client_secret <> '') as has_client_secret,
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
      try {
        await notifySuperAdminsPartnerEvent({
          status: "DECLINED",
          tenantId,
          tenantName: tenant.company_name || tenantId,
          detail: "Rechazado por el cliente",
          origin: request.nextUrl.origin,
        });
      } catch (notifyError) {
        console.warn("[api/tenants/partner-link] notify declination failed:", notifyError);
      }
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

    let result: { linked: boolean; detail: string; reason?: "NOT_CONFIGURED" | "CONFLICT" | "HTTP_ERROR" };
    try {
      result = await linkPal(tenantId);
    } catch (palError: unknown) {
      const message = palError instanceof Error ? palError.message : String(palError);
      result = {
        linked: false,
        reason: "HTTP_ERROR",
        detail: `PAL falló por excepción: ${message}`.slice(0, 500),
      };
    }
    // Si falta config interna del Partner ID, mantenemos APPROVED (consentimiento
    // del cliente ya registrado) en lugar de marcar FAILED al tenant.
    const status = result.linked
      ? "LINKED"
      : result.reason === "NOT_CONFIGURED"
        ? "APPROVED"
        : "FAILED";
    await pool.query(
      "UPDATE Tenants SET partner_link_status = ?, partner_link_detail = ? WHERE tenant_id = ?",
      [status, result.detail.slice(0, 500), tenantId]
    );
    try {
      await notifySuperAdminsPartnerEvent({
        status,
        tenantId,
        tenantName: tenant.company_name || tenantId,
        detail: result.detail,
        origin: request.nextUrl.origin,
      });
    } catch (notifyError) {
      console.warn("[api/tenants/partner-link] notify status failed:", notifyError);
    }

    return NextResponse.json({ success: true, status, detail: result.detail });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if ((e as any)?.code === "ER_BAD_FIELD_ERROR") {
      return NextResponse.json(
        { error: "Schema desactualizado para PAL/CPOR. Ejecutar migraciones de Tenants." },
        { status: 409 }
      );
    }
    console.error("[api/tenants/partner-link] error:", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
