import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";

async function hasTenantColumn(columnName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT 1
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'Tenants'
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [columnName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    await requireSuperAdmin(request);

    const requiredColumns = [
      "partner_link_status",
      "partner_link_detail",
      "partner_link_approved_by",
      "partner_link_approved_at",
    ];
    const checks = await Promise.all(requiredColumns.map((c) => hasTenantColumn(c)));
    const hasPartnerColumns = checks.every(Boolean);

    if (!hasPartnerColumns) {
      return NextResponse.json({
        success: true,
        summary: { linked: 0, approvedPending: 0, failed: 0, recent7d: 0 },
        alerts: [],
        schemaReady: false,
      });
    }

    const [rows] = await pool.query(
      `SELECT
         tenant_id AS tenantId,
         company_name AS tenantName,
         tier,
         partner_link_status AS status,
         partner_link_detail AS detail,
         partner_link_approved_by AS approvedBy,
         partner_link_approved_at AS approvedAt
       FROM Tenants
       WHERE partner_link_status IN ('APPROVED', 'LINKED', 'FAILED', 'DECLINED')
       ORDER BY COALESCE(partner_link_approved_at, '1970-01-01') DESC
       LIMIT 200`
    );

    const alerts = (rows as any[]).map((r) => {
      const status = String(r.status || "NONE");
      const severity =
        status === "FAILED" ? "error" : status === "APPROVED" ? "warning" : "success";
      const baseAt = r.approvedAt || null;
      const ageMs = baseAt ? Date.now() - new Date(baseAt).getTime() : Number.MAX_SAFE_INTEGER;
      return {
        ...r,
        severity,
        isRecent: ageMs <= 7 * 24 * 60 * 60 * 1000,
      };
    });

    const summary = {
      linked: alerts.filter((a) => a.status === "LINKED").length,
      approvedPending: alerts.filter((a) => a.status === "APPROVED").length,
      failed: alerts.filter((a) => a.status === "FAILED").length,
      recent7d: alerts.filter((a) => a.isRecent).length,
    };

    return NextResponse.json({
      success: true,
      summary,
      alerts,
      schemaReady: true,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[superadmin/partner-alerts] GET error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
