import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { EXECUTIVE_REPORT_RETENTION_DAYS, readExecutiveReportMarkdown } from "@/lib/executiveReportStorage";

let hasStoredNameColumnCache: boolean | null = null;

async function hasStoredNameColumn(): Promise<boolean> {
    if (hasStoredNameColumnCache !== null) return hasStoredNameColumnCache;
    const [rows] = await pool.query(`SHOW COLUMNS FROM ExecutiveReportJobs LIKE 'report_stored_name'`);
    hasStoredNameColumnCache = Array.isArray(rows) && rows.length > 0;
    return hasStoredNameColumnCache;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const jobId = Number(id);
        if (!Number.isInteger(jobId) || jobId <= 0) {
            return NextResponse.json({ error: "ID inválido" }, { status: 400 });
        }

        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);
        const withStoredName = await hasStoredNameColumn();
        const storedNameSelect = withStoredName ? ", report_stored_name" : "";

        const [rows] = await pool.query(
            `SELECT id, requested_by_email, scope_subscription_id, scope_subscription_name, locale,
                    report_markdown${storedNameSelect}, created_at, completed_at
             FROM ExecutiveReportJobs
             WHERE tenant_id = ?
               AND id = ?
               AND status = 'completed'
             LIMIT 1`,
            [tenantId, jobId]
        );
        const row = (rows as any[])[0];
        if (!row) {
            return NextResponse.json({ error: "Reporte no encontrado" }, { status: 404 });
        }

        const createdAt = new Date(row.created_at);
        const expiresAt = new Date(createdAt.getTime() + EXECUTIVE_REPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        if (Date.now() > expiresAt.getTime()) {
            return NextResponse.json({ error: "Reporte expirado (retención de 90 días)." }, { status: 410 });
        }

        let report = String(row.report_markdown || "");
        if (!report && withStoredName && row.report_stored_name) {
            report = (await readExecutiveReportMarkdown(String(row.report_stored_name))) || "";
        }
        if (!report) {
            return NextResponse.json({ error: "El contenido del reporte no está disponible." }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            retentionDays: EXECUTIVE_REPORT_RETENTION_DAYS,
            report,
            metadata: {
                id: row.id,
                requestedBy: row.requested_by_email,
                scopeSubscriptionId: row.scope_subscription_id,
                scopeSubscriptionName: row.scope_subscription_name,
                locale: row.locale,
                createdAt: row.created_at,
                completedAt: row.completed_at,
                expiresAt: expiresAt.toISOString(),
            },
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[api/intelligence/executive-report/history/[id]] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
