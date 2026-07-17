import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { sendEmailAsync } from "@/lib/emailHelper";
import { mapCostSnapshotToFocus, type CostSnapshotRow } from "@/lib/focus/mapper";
import { buildFocusCsv, buildFocusJson } from "@/lib/focus/csv";

/**
 * Genera y manda por email el export FOCUS 1.1 del día anterior para cada
 * tenant con programación habilitada (FocusExportSchedules.enabled = TRUE).
 * "Programable para generación diaria automática" del manual de usuario —
 * antes /admin/focus-export solo soportaba búsqueda manual por rango de
 * fechas. Agendado en el crontab del VPS con `Authorization: Bearer $CRON_SECRET`.
 */

const MAX_ROWS = 100_000;

async function fetchFocusRows(tenantId: string, date: string, subscriptionId: string | null): Promise<CostSnapshotRow[]> {
    const where: string[] = ["tenant_id = ?", "date = ?"];
    const values: unknown[] = [tenantId, date];
    if (subscriptionId) {
        where.push("subscription_id = ?");
        values.push(subscriptionId);
    }
    const [rows] = await pool.query(
        `SELECT tenant_id, subscription_id, date, resource_group, service_name,
                cost_usd, currency,
                ChargePeriodStart, ChargePeriodEnd, ProviderName, PublisherName,
                SubAccountId, BilledCost, EffectiveCost, CommitmentDiscountId,
                MeterId, MeterName, MeterCategory, MeterSubCategory, Quantity,
                UnitOfMeasure, ResourceId, ServiceFamily, Tags
           FROM CostSnapshots
          WHERE ${where.join(" AND ")}
          ORDER BY id ASC
          LIMIT ?`,
        [...values, MAX_ROWS]
    );
    return rows as CostSnapshotRow[];
}

function buildEmailHtml(tenantName: string, date: string, count: number, format: string): string {
    return `<div style="font-family:sans-serif">
        <h2>📊 Export FOCUS 1.1 diario — ${tenantName}</h2>
        <p>Adjuntamos el export en formato <strong>${format.toUpperCase()}</strong> con el billing del <strong>${date}</strong> (${count} registro(s)).</p>
        <p style="color:#999;font-size:12px">Generado automáticamente por FinOps SaaS. Podés desactivar esta programación en Administración → FOCUS 1.1 Export.</p>
    </div>`;
}

export async function GET(request: NextRequest) {
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error("CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        await initializeDatabase();

        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const [schedules] = await pool.query(
            `SELECT fes.tenant_id, fes.format, fes.subscription_id, fes.recipient_email, t.company_name
             FROM FocusExportSchedules fes
             JOIN Tenants t ON t.tenant_id = fes.tenant_id
             WHERE fes.enabled = TRUE`
        );

        const results: Array<{ tenantId: string; sent: boolean; rows: number; error?: string }> = [];

        for (const schedule of schedules as any[]) {
            try {
                const rows = await fetchFocusRows(schedule.tenant_id, yesterday, schedule.subscription_id);
                const billingOpts = {
                    billingPeriodStart: new Date(yesterday).toISOString(),
                    billingPeriodEnd: new Date(yesterday).toISOString(),
                };
                const records = rows.map((r) => mapCostSnapshotToFocus(r, billingOpts));

                if (records.length === 0) {
                    results.push({ tenantId: schedule.tenant_id, sent: false, rows: 0 });
                } else {
                    const isCsv = schedule.format === "json" ? false : true;
                    const content = isCsv ? buildFocusCsv(records) : buildFocusJson(records);
                    const tenantName = schedule.company_name || schedule.tenant_id;

                    await sendEmailAsync(
                        `Export FOCUS 1.1 diario — ${tenantName} — ${yesterday}`,
                        buildEmailHtml(tenantName, yesterday, records.length, schedule.format),
                        schedule.recipient_email,
                        [{
                            name: `focus-${schedule.tenant_id}-${yesterday}.${isCsv ? "csv" : "json"}`,
                            contentType: isCsv ? "text/csv" : "application/json",
                            contentBase64: Buffer.from(content, "utf-8").toString("base64"),
                        }]
                    );
                    results.push({ tenantId: schedule.tenant_id, sent: true, rows: records.length });
                }

                await pool.query(
                    "UPDATE FocusExportSchedules SET last_run_at = NOW() WHERE tenant_id = ?",
                    [schedule.tenant_id]
                );
            } catch (err: any) {
                console.warn(`[focus-export-daily] failed for tenant ${schedule.tenant_id}:`, err?.message);
                results.push({ tenantId: schedule.tenant_id, sent: false, rows: 0, error: err?.message });
            }
        }

        return NextResponse.json({ success: true, date: yesterday, processed: results.length, results });
    } catch (error: unknown) {
        console.error("[cron/focus-export-daily] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
