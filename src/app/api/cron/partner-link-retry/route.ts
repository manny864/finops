import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { linkPal } from "@/lib/partner/pal";
import { recordCronRun } from "@/lib/cronRunTracker";
import { notifyTenant } from "@/lib/notifications";

type TenantRow = {
  tenant_id: string;
  company_name: string;
  partner_link_status: "APPROVED" | "FAILED";
  partner_link_detail: string | null;
};

async function notifySuperAdmins(args: {
  tenantId: string;
  tenantName: string;
  fromStatus: string;
  toStatus: string;
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

  const severity = args.toStatus === "FAILED" ? "error" : args.toStatus === "APPROVED" ? "warning" : "info";
  const title = `PAL retry ${args.fromStatus} -> ${args.toStatus}`;
  const message =
    `Tenant: ${args.tenantName} (${args.tenantId}) · ` +
    `Cambio: ${args.fromStatus} -> ${args.toStatus} · ` +
    `Detalle: ${args.detail || "-"}`;

  await Promise.all(
    superAdminTenantIds.map((superAdminTenantId) =>
      notifyTenant(superAdminTenantId, {
        title,
        message,
        severity,
        link: `${args.origin}/superadmin/partner-alerts`,
        metadata: {
          source: "partner_link_retry",
          tenantId: args.tenantId,
          fromStatus: args.fromStatus,
          toStatus: args.toStatus,
        },
      })
    )
  );
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const cronName = "partner-link-retry";
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || cronSecret.length < 16) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }
    if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initializeDatabase();

    const [rows] = await pool.query(
      `SELECT tenant_id, company_name, partner_link_status, partner_link_detail
         FROM Tenants
        WHERE (client_secret IS NOT NULL AND client_secret <> '')
          AND partner_link_status IN ('APPROVED', 'FAILED')
        ORDER BY partner_link_approved_at DESC
        LIMIT 300`
    );
    const tenants = rows as TenantRow[];
    let linked = 0;
    let stillApproved = 0;
    let failed = 0;
    const transitions: Array<{ tenantId: string; fromStatus: string; toStatus: string }> = [];

    for (const tenant of tenants) {
      const result = await linkPal(tenant.tenant_id);
      const nextStatus = result.linked
        ? "LINKED"
        : result.reason === "NOT_CONFIGURED"
          ? "APPROVED"
          : "FAILED";

      await pool.query(
        "UPDATE Tenants SET partner_link_status = ?, partner_link_detail = ? WHERE tenant_id = ?",
        [nextStatus, result.detail.slice(0, 500), tenant.tenant_id]
      );

      if (nextStatus === "LINKED") linked++;
      else if (nextStatus === "APPROVED") stillApproved++;
      else failed++;

      if (nextStatus !== tenant.partner_link_status) {
        transitions.push({
          tenantId: tenant.tenant_id,
          fromStatus: tenant.partner_link_status,
          toStatus: nextStatus,
        });
        try {
          await notifySuperAdmins({
            tenantId: tenant.tenant_id,
            tenantName: tenant.company_name || tenant.tenant_id,
            fromStatus: tenant.partner_link_status,
            toStatus: nextStatus,
            detail: result.detail,
            origin: request.nextUrl.origin,
          });
        } catch (notifyError) {
          console.warn("[cron/partner-link-retry] notify failed:", notifyError);
        }
      }
    }

    const response = {
      success: true,
      evaluated: tenants.length,
      linked,
      approved: stillApproved,
      failed,
      transitions,
    };
    await recordCronRun({
      cronName,
      status: failed > 0 ? "warning" : "ok",
      durationMs: Date.now() - startedAt,
      summary: `evaluated=${tenants.length} linked=${linked} approved=${stillApproved} failed=${failed}`,
      details: response as unknown as Record<string, unknown>,
    });
    return NextResponse.json(response);
  } catch (error: unknown) {
    await recordCronRun({
      cronName,
      status: "error",
      durationMs: Date.now() - startedAt,
      summary: error instanceof Error ? error.message : "cron failed",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    console.error("[cron/partner-link-retry] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

