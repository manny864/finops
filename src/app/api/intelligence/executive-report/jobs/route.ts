import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import { generateExecutiveReportEmailIntro, getAssessment } from "@/modules/core/aiProvider";
import rateLimiter from "@/lib/rateLimiter";
import { isAiGloballyEnabled } from "@/services/aiService";
import { createNotification } from "@/lib/notify";
import { notifyTenant } from "@/lib/notifications";
import { sendEmailStrict, type EmailAttachment } from "@/lib/emailHelper";
import { escapeHtml } from "@/lib/htmlEscape";
import { jsPDF } from "jspdf";
import { isMockTenant } from "@/lib/mockData";
import { getMockExecutiveReportJob } from "@/lib/executiveReportMock";
import {
    EXECUTIVE_REPORT_RETENTION_DAYS,
    saveExecutiveReportMarkdown,
    readExecutiveReportMarkdown,
    deleteExecutiveReportMarkdown,
} from "@/lib/executiveReportStorage";

const AI_RL_LIMIT = 5;
const AI_RL_WINDOW_MS = 5 * 60_000;

type JobStatus = "queued" | "processing" | "completed" | "failed";
let hasStoredNameColumnCache: boolean | null = null;

async function hasStoredNameColumn(): Promise<boolean> {
    if (hasStoredNameColumnCache !== null) return hasStoredNameColumnCache;
    const [rows] = await pool.query(`SHOW COLUMNS FROM ExecutiveReportJobs LIKE 'report_stored_name'`);
    hasStoredNameColumnCache = Array.isArray(rows) && rows.length > 0;
    return hasStoredNameColumnCache;
}

async function cleanupExpiredExecutiveReportJobs(): Promise<void> {
    try {
        const withStoredName = await hasStoredNameColumn();
        const [rows] = await pool.query(
            `SELECT id${withStoredName ? ", report_stored_name" : ""}
             FROM ExecutiveReportJobs
             WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
             ORDER BY id ASC
             LIMIT 50`,
            [EXECUTIVE_REPORT_RETENTION_DAYS]
        );
        for (const row of rows as Array<{ id: number; report_stored_name?: string | null }>) {
            if (row.report_stored_name) {
                await deleteExecutiveReportMarkdown(row.report_stored_name);
            }
            await pool.query(`DELETE FROM ExecutiveReportJobs WHERE id = ?`, [row.id]);
        }
    } catch (error) {
        console.warn(
            "[executive-report-jobs] cleanup expired reports failed:",
            error instanceof Error ? error.message : error
        );
    }
}

function reportToHtml(reportMarkdown: string, tenantName: string, scopeLabel: string, introMessage?: string): string {
    const rendered = escapeHtml(reportMarkdown).replace(/\n/g, "<br/>");
    return `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:900px;margin:0 auto;color:#0f172a">
        <h2 style="color:#0054A6;margin-bottom:8px;">CSCloudSolutions · Reporte Ejecutivo FinOps</h2>
        <p style="margin:0 0 4px 0;"><strong>Tenant:</strong> ${escapeHtml(tenantName)}</p>
        <p style="margin:0 0 16px 0;"><strong>Alcance:</strong> ${escapeHtml(scopeLabel)}</p>
        ${introMessage ? `<p style="margin:0 0 16px 0;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;color:#0f172a;">${escapeHtml(introMessage)}</p>` : ""}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;" />
        <div style="line-height:1.55;font-size:14px;">${rendered}</div>
      </div>
    `;
}

function buildReportFileBaseName(tenantName: string): string {
    const safeTenant = String(tenantName || "Cliente")
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "");
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `Reporte_Ejecutivo_${safeTenant || "Cliente"}_${yyyy}-${mm}-${dd}`;
}

function reportMarkdownToPlainText(reportMarkdown: string): string {
    return reportMarkdown
        .replace(/\r\n/g, "\n")
        .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
        .replace(/^#{1,6}\s*/gm, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
        .replace(/^\s*[-*+]\s+/gm, "• ")
        .replace(/^\s*\d+\.\s+/gm, "• ")
        .trim();
}

function buildExecutiveReportPdfAttachment(params: {
    fileBaseName: string;
    tenantName: string;
    scopeLabel: string;
    reportMarkdown: string;
}): EmailAttachment {
    const { fileBaseName, tenantName, scopeLabel, reportMarkdown } = params;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const margin = 20;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const maxWidth = pageWidth - margin * 2;
    const maxY = pageHeight - margin;

    let y = margin;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.setTextColor(0, 84, 166);
    pdf.text("CSCloudSolutions - Reporte Ejecutivo FinOps", margin, y);
    y += 8;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(70, 70, 70);
    pdf.text(`Tenant: ${tenantName}`, margin, y);
    y += 6;
    pdf.text(`Alcance: ${scopeLabel}`, margin, y);
    y += 6;
    const generatedAt = new Date().toLocaleString("es-AR", { hour12: false });
    pdf.text(`Generado: ${generatedAt}`, margin, y);
    y += 10;

    pdf.setFontSize(11);
    pdf.setTextColor(15, 23, 42);
    const body = reportMarkdownToPlainText(reportMarkdown);
    const lines = pdf.splitTextToSize(body, maxWidth);
    for (const line of lines) {
        if (y > maxY) {
            pdf.addPage("a4", "portrait");
            y = margin;
        }
        pdf.text(line, margin, y);
        y += 5.6;
    }

    const contentBase64 = Buffer.from(pdf.output("arraybuffer")).toString("base64");
    return {
        name: `${fileBaseName}.pdf`,
        contentType: "application/pdf",
        contentBase64,
    };
}

function buildExecutiveReportHtmlAttachment(fileBaseName: string, htmlBody: string): EmailAttachment {
    const htmlDoc = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="background:#ffffff;margin:0;padding:24px;">${htmlBody}</body></html>`;
    return {
        name: `${fileBaseName}.html`,
        contentType: "text/html",
        contentBase64: Buffer.from(htmlDoc, "utf8").toString("base64"),
    };
}

async function processExecutiveReportJob(params: {
    jobId: number;
    tenantId: string;
    requestedByEmail: string;
    tenantName: string;
    locale: string;
    metricsData: any;
    scopeSubscriptionName: string;
    sendEmailToRequester: boolean;
}) {
    const {
        jobId,
        tenantId,
        requestedByEmail,
        tenantName,
        locale,
        metricsData,
        scopeSubscriptionName,
        sendEmailToRequester,
    } = params;
    const reportHref = `/${locale}/admin/reports?tab=executive&reportJob=${jobId}`;
    const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
    const reportAbsoluteHref = appBaseUrl ? `${appBaseUrl}${reportHref}` : reportHref;

    try {
        await pool.query(
            `UPDATE ExecutiveReportJobs
             SET status = 'processing', started_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
             WHERE id = ? AND tenant_id = ?`,
            [jobId, tenantId]
        );

        const report = await getAssessment(metricsData, tenantId);
        let storedName: string | null = null;
        try {
            storedName = await saveExecutiveReportMarkdown(report);
        } catch (storageError) {
            console.warn("[executive-report-jobs] blob/local report storage failed:", storageError);
        }

        // Extraer con precisión total_cost_usd y total_savings_usd si vienen en metricsData
        let snapshotCost: number | null = null;
        let snapshotSavings: number | null = null;

        if (metricsData && typeof metricsData === "object") {
            const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
            snapshotCost = num(metricsData.mtdSpendUSD) ?? num(metricsData.kpiMetrics?.mtdSpendUSD) ?? num(metricsData.totalCost);
            snapshotSavings = num(metricsData.monthlySavingsIdentifiedUSD) ?? num(metricsData.kpiMetrics?.monthlySavingsIdentifiedUSD) ?? num(metricsData.totalSavings);
        }

        const withStoredName = await hasStoredNameColumn();
        if (withStoredName) {
            await pool.query(
                `UPDATE ExecutiveReportJobs
                 SET status = 'completed', report_markdown = ?, report_stored_name = ?,
                     total_cost_usd = COALESCE(?, total_cost_usd),
                     total_savings_usd = COALESCE(?, total_savings_usd),
                     completed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
                 WHERE id = ? AND tenant_id = ?`,
                [report, storedName, snapshotCost, snapshotSavings, jobId, tenantId]
            );
        } else {
            await pool.query(
                `UPDATE ExecutiveReportJobs
                 SET status = 'completed', report_markdown = ?,
                     total_cost_usd = COALESCE(?, total_cost_usd),
                     total_savings_usd = COALESCE(?, total_savings_usd),
                     completed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
                 WHERE id = ? AND tenant_id = ?`,
                [report, snapshotCost, snapshotSavings, jobId, tenantId]
            );
        }

        await createNotification({
            tenantId,
            title: "Reporte ejecutivo listo",
            message: `El reporte ejecutivo para ${scopeSubscriptionName} ya está disponible.`,
            href: reportHref,
            severity: "info",
            source: "executive-report",
        });

        await notifyTenant(tenantId, {
            title: "Reporte ejecutivo listo",
            message: `El reporte ejecutivo para ${scopeSubscriptionName} ya está disponible.`,
            severity: "info",
            link: reportAbsoluteHref,
        });

        if (sendEmailToRequester) {
            try {
                const subject = `Reporte Ejecutivo FinOps listo — ${tenantName}`;
                let introMessage =
                    "Hola, tu reporte ejecutivo FinOps ya esta listo. Fue generado con IA y te lo enviamos en PDF y HTML para que puedas revisarlo y compartirlo facilmente.";
                try {
                    introMessage = await generateExecutiveReportEmailIntro({
                        tenantId,
                        tenantName,
                        scopeSubscriptionName,
                        reportMarkdown: report,
                    });
                } catch (introError) {
                    console.warn(
                        "[executive-report-jobs] AI intro generation failed; using fallback:",
                        introError instanceof Error ? introError.message : introError
                    );
                }

                const html = reportToHtml(report, tenantName, scopeSubscriptionName, introMessage);
                const fileBaseName = buildReportFileBaseName(tenantName);
                const attachments: EmailAttachment[] = [
                    buildExecutiveReportHtmlAttachment(fileBaseName, html),
                ];
                try {
                    attachments.unshift(
                        buildExecutiveReportPdfAttachment({
                            fileBaseName,
                            tenantName,
                            scopeLabel: scopeSubscriptionName,
                            reportMarkdown: report,
                        })
                    );
                } catch (pdfError) {
                    console.warn(
                        "[executive-report-jobs] pdf attachment generation failed; sending HTML only:",
                        pdfError instanceof Error ? pdfError.message : pdfError
                    );
                }
                await sendEmailStrict(subject, html, requestedByEmail, attachments);
                await pool.query(
                    `UPDATE ExecutiveReportJobs
                     SET emailed_to_requester_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
                     WHERE id = ? AND tenant_id = ?`,
                    [jobId, tenantId]
                );
            } catch (emailError: unknown) {
                const emailMsg = emailError instanceof Error ? emailError.message : "Error desconocido";
                console.error("[executive-report-jobs] email send failed:", emailMsg);
                await createNotification({
                    tenantId,
                    title: "Reporte listo (correo no enviado)",
                    message: `El reporte está disponible, pero no se pudo enviar por correo: ${emailMsg}`,
                    href: reportHref,
                    severity: "warning",
                    source: "executive-report",
                });
            }
        }
        void cleanupExpiredExecutiveReportJobs();
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Error desconocido";
        await pool.query(
            `UPDATE ExecutiveReportJobs
             SET status = 'failed', error_message = ?, completed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
             WHERE id = ? AND tenant_id = ?`,
            [message.slice(0, 2000), jobId, tenantId]
        );

        await createNotification({
            tenantId,
            title: "Fallo al generar reporte ejecutivo",
            message: `No se pudo generar el reporte para ${scopeSubscriptionName}.`,
            href: reportHref,
            severity: "warning",
            source: "executive-report",
        });
        void cleanupExpiredExecutiveReportJobs();
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const {
            tenantId,
            metricsData,
            locale = "es",
            subscriptionId = "All",
            subscriptionName = "Tenant completo",
            sendEmailToRequester = false,
        } = body as {
            tenantId?: string;
            metricsData?: any;
            locale?: string;
            subscriptionId?: string;
            subscriptionName?: string;
            sendEmailToRequester?: boolean;
        };

        if (!tenantId || !metricsData) {
            return NextResponse.json({ error: "Faltan parámetros (tenantId, metricsData)" }, { status: 400 });
        }

        if (isMockTenant(tenantId)) {
            const mockJobId = Number(Date.now());
            return NextResponse.json({ success: true, jobId: mockJobId, status: "queued" satisfies JobStatus });
        }

        if (!(await isAiGloballyEnabled())) {
            return NextResponse.json({
                error: "Las funciones de IA están deshabilitadas a nivel plataforma por un Super Administrador.",
                aiDisabled: true,
            }, { status: 403 });
        }

        const identity = await requireTenantAccess(request, tenantId);
        const rl = await rateLimiter.checkByKeyDistributed(`ai:executive-report:${tenantId}:${identity.email}`, AI_RL_LIMIT, AI_RL_WINDOW_MS);
        if (!rl.allowed) {
            return NextResponse.json(
                { error: `Límite alcanzado (${AI_RL_LIMIT} reportes cada 5 min). Reintentá después de ${rl.resetAt.toISOString()}.` },
                { status: 429 }
            );
        }

        const [tenantRows] = await pool.query(
            "SELECT company_name, ai_enabled FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId]
        );
        const tenant = (tenantRows as Array<{ company_name?: string; ai_enabled?: number | boolean }>)[0];
        if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
        if (!tenant.ai_enabled) {
            return NextResponse.json({
                error: "Las funciones de IA están deshabilitadas para este tenant. Un administrador puede reactivarlas en Configuración de IA.",
                aiDisabled: true,
            }, { status: 403 });
        }

        const [insertResult] = await pool.query(
            `INSERT INTO ExecutiveReportJobs (
                tenant_id, requested_by_email, scope_subscription_id, scope_subscription_name, locale, status
            ) VALUES (?, ?, ?, ?, ?, 'queued')`,
            [tenantId, identity.email, subscriptionId, subscriptionName, locale]
        );
        const jobId = Number((insertResult as { insertId?: number }).insertId || 0);

        void processExecutiveReportJob({
            jobId,
            tenantId,
            requestedByEmail: identity.email,
            tenantName: tenant.company_name || "Tenant",
            locale,
            metricsData,
            scopeSubscriptionName: subscriptionName,
            sendEmailToRequester: Boolean(sendEmailToRequester),
        });

        return NextResponse.json({ success: true, jobId, status: "queued" satisfies JobStatus });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[api/intelligence/executive-report/jobs] POST error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const jobId = Number(searchParams.get("jobId")) || 0;
        const subscriptionId = searchParams.get("subscriptionId") || "All";

        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }

        if (isMockTenant(tenantId)) {
            const mockJob = getMockExecutiveReportJob({
                jobId: jobId > 0 ? jobId : 90003,
                subscriptionId,
                subscriptionName: subscriptionId === "All" ? "Tenant completo" : subscriptionId,
            });
            return NextResponse.json({ success: true, job: mockJob });
        }

        const identity = await requireTenantAccess(request, tenantId);
        const withStoredName = await hasStoredNameColumn();
        const storedNameSelect = withStoredName ? ", report_stored_name" : "";

        let rows: any[] = [];
        if (jobId > 0) {
            const [jobRows] = await pool.query(
                `SELECT id, status, report_markdown${storedNameSelect}, error_message, scope_subscription_id, scope_subscription_name,
                        created_at, started_at, completed_at, emailed_to_requester_at
                 FROM ExecutiveReportJobs
                 WHERE tenant_id = ? AND id = ? AND requested_by_email = ?
                 LIMIT 1`,
                [tenantId, jobId, identity.email]
            );
            rows = jobRows as any[];
        } else {
            const [jobRows] = await pool.query(
                `SELECT id, status, report_markdown${storedNameSelect}, error_message, scope_subscription_id, scope_subscription_name,
                        created_at, started_at, completed_at, emailed_to_requester_at
                 FROM ExecutiveReportJobs
                 WHERE tenant_id = ? AND requested_by_email = ? AND scope_subscription_id = ?
                 ORDER BY id DESC
                 LIMIT 1`,
                [tenantId, identity.email, subscriptionId]
            );
            rows = jobRows as any[];
        }

        if (!rows.length) {
            return NextResponse.json({ success: true, job: null });
        }

        const row = rows[0];
        let report = row.report_markdown || "";
        if (!report && withStoredName && row.report_stored_name) {
            report = (await readExecutiveReportMarkdown(row.report_stored_name)) || "";
        }

        return NextResponse.json({
            success: true,
            job: {
                id: row.id,
                status: row.status as JobStatus,
                report,
                error: row.error_message || null,
                scopeSubscriptionId: row.scope_subscription_id,
                scopeSubscriptionName: row.scope_subscription_name,
                createdAt: row.created_at,
                startedAt: row.started_at,
                completedAt: row.completed_at,
                emailedAt: row.emailed_to_requester_at,
            },
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[api/intelligence/executive-report/jobs] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
