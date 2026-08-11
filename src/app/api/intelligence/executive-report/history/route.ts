import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { EXECUTIVE_REPORT_RETENTION_DAYS } from "@/lib/executiveReportStorage";

let hasStoredNameColumnCache: boolean | null = null;

async function hasStoredNameColumn(): Promise<boolean> {
    if (hasStoredNameColumnCache !== null) return hasStoredNameColumnCache;
    const [rows] = await pool.query(`SHOW COLUMNS FROM ExecutiveReportJobs LIKE 'report_stored_name'`);
    hasStoredNameColumnCache = Array.isArray(rows) && rows.length > 0;
    return hasStoredNameColumnCache;
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const page = Math.max(1, Number(searchParams.get("page")) || 1);
        const pageSize = [15, 30, 45, 60].includes(Number(searchParams.get("pageSize")))
            ? Number(searchParams.get("pageSize"))
            : 15;
        const offset = (page - 1) * pageSize;

        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);
        const withStoredName = await hasStoredNameColumn();

        const [countRows] = await pool.query(
            `SELECT COUNT(*) AS total
             FROM ExecutiveReportJobs
             WHERE tenant_id = ?
               AND status = 'completed'
               AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
            [tenantId, EXECUTIVE_REPORT_RETENTION_DAYS]
        );
        const total = Number((countRows as Array<{ total?: number }>)[0]?.total || 0);

        const [rows] = await pool.query(
            `SELECT id, requested_by_email, scope_subscription_id, scope_subscription_name, locale,
                    created_at, completed_at, emailed_to_requester_at${withStoredName ? ", report_stored_name" : ""}
             FROM ExecutiveReportJobs
             WHERE tenant_id = ?
               AND status = 'completed'
               AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
             ORDER BY id DESC
             LIMIT ? OFFSET ?`,
            [tenantId, EXECUTIVE_REPORT_RETENTION_DAYS, pageSize, offset]
        );

        return NextResponse.json({
            success: true,
            retentionDays: EXECUTIVE_REPORT_RETENTION_DAYS,
            page,
            pageSize,
            total,
            items: rows,
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[api/intelligence/executive-report/history] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
