import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { renderShowbackPdf } from "@/lib/pdf/showbackInvoice";
import { requireTenantRole, hasSystemRole } from "@/lib/requestAuth";
import { notifyTenant } from "@/lib/notifications";
import { serverError } from '@/lib/apiErrors';
import { hasAccess } from "@/lib/tierLogic";
import { resolvePeriodRange } from "@/lib/invoicingPeriod";

interface EmailRequest {
    tenantId: string;
    period: string;
    customerId: string;
    recipientEmail: string;
    recipientName?: string;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as EmailRequest;
        const { tenantId, period, customerId, recipientEmail, recipientName } = body;

        // Validate required fields
        if (!tenantId || !period || !customerId || !recipientEmail) {
            return NextResponse.json(
                { error: "Missing required fields: tenantId, period, customerId, recipientEmail" },
                { status: 400 }
            );
        }

        // Auth: Require ADMIN role
        let identity;
        try {
            identity = await requireTenantRole(request, tenantId, ["ADMIN"]);
        } catch (authErr: any) {
            return NextResponse.json(
                { error: authErr.message || "Unauthorized" },
                { status: authErr.status || 401 }
            );
        }

        // Fetch tenant data and invoicing data
        const [tenants]: any = await pool.query(
            "SELECT company_name, markup_percentage, tier FROM Tenants WHERE tenant_id = ?",
            [tenantId]
        );
        if (!tenants || tenants.length === 0) {
            return NextResponse.json({ error: "Tenant not found." }, { status: 404 });
        }

        // Feature gate: mismo requisito Business+ que GET /admin/report/invoicing
        // (antes este endpoint hermano exigía Enterprise, dejando a un tenant
        // Business ver el reporte pero recibir 403 al mandarlo por email).
        const tier = String(tenants[0].tier || "");
        const isSuperAdmin = !!identity?.isCorporateDomain && await hasSystemRole(identity.email, "SUPERADMIN");
        if (!hasAccess(tier, "Business") && !isSuperAdmin) {
            return NextResponse.json({ error: "Feature bloqueada. Requiere plan Business o superior." }, { status: 403 });
        }

        const tenantName = tenants[0].company_name || "FinOps";
        const markupPercent = tenants[0].markup_percentage != null
            ? Number(tenants[0].markup_percentage)
            : 15;

        // Mismo resolvePeriodRange que el GET principal — soporta tanto
        // "last3m" (default de la UI) como un mes puntual "YYYY-MM". Antes
        // esta query esperaba únicamente "YYYY-MM" vía DATE_FORMAT, así que
        // con la vista default el email siempre devolvía "No data found".
        const { start, end } = resolvePeriodRange(period);

        // Fetch cost data for the specific customer and period — tenant_id +
        // customer_id en el WHERE garantizan que nunca se puede pedir el
        // showback de un cliente de otro tenant.
        const [rows]: any = await pool.query(
            `SELECT
                DATE(COALESCE(cs.ChargePeriodStart, cs.date)) AS date,
                cs.customer_id AS customerId,
                cs.service_name AS service,
                cs.resource_group AS resourceGroup,
                SUM(COALESCE(cs.EffectiveCost, cs.BilledCost, cs.cost_usd, 0)) AS originalCost
             FROM CostSnapshots cs
             WHERE cs.tenant_id = ?
               AND cs.customer_id = ?
               AND DATE(COALESCE(cs.ChargePeriodStart, cs.date)) BETWEEN ? AND ?
             GROUP BY DATE(COALESCE(cs.ChargePeriodStart, cs.date)), cs.customer_id, cs.service_name, cs.resource_group
             ORDER BY DATE(COALESCE(cs.ChargePeriodStart, cs.date))`,
            [tenantId, customerId, start, end]
        );

        if (!rows || rows.length === 0) {
            return NextResponse.json({ error: "No data found for this customer and period." }, { status: 404 });
        }

        const multiplier = 1 + markupPercent / 100;
        // adjustedCost sin redondear hasta el final — redondear por línea y
        // sumar después arrastraba un drift (ver mismo fix en route.ts).
        const rawLines = rows.map((r: any) => ({
            date: String(r.date).substring(0, 10),
            customerId: r.customerId,
            service: r.service,
            resourceGroup: r.resourceGroup,
            originalCost: Number(r.originalCost),
            adjustedCostRaw: Number(r.originalCost) * multiplier,
        }));
        const lines = rawLines.map((l: any) => ({
            ...l,
            adjustedCost: Math.round(l.adjustedCostRaw * 100) / 100,
        }));

        const totalOriginal = rawLines.reduce((sum: number, l: any) => sum + l.originalCost, 0);
        const totalAdjusted = rawLines.reduce((sum: number, l: any) => sum + l.adjustedCostRaw, 0);

        const pdfData = {
            tenantName,
            period,
            generatedDate: new Date().toISOString(),
            customerName: customerId,
            customerId,
            billingPeriod: period,
            originalCost: totalOriginal,
            adjustedCost: totalAdjusted,
            markupPercent,
            markupAmount: Math.round((totalAdjusted - totalOriginal) * 100) / 100,
            currency: "USD",
            lines,
        };

        // Generate PDF
        const pdfBuffer = await renderShowbackPdf({ data: pdfData });
        const pdfBase64 = pdfBuffer.toString("base64");

        // Fetch MS Graph token
        const tokenResponse = await fetch(
            `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    client_id: process.env.AZURE_CLIENT_ID || "",
                    scope: "https://graph.microsoft.com/.default",
                    client_secret: process.env.AZURE_CLIENT_SECRET || "",
                    grant_type: "client_credentials",
                }),
            }
        );

        if (!tokenResponse.ok) {
            console.error("[Invoicing Email] Failed to fetch MS Graph Token", await tokenResponse.text());
            throw new Error("Failed to authenticate with MS Graph");
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        // Prepare email payload for MS Graph
        const sender = process.env.AZURE_SENDER_EMAIL || process.env.CONTACT_EMAIL_SENDER;
        if (!sender) {
            return NextResponse.json(
                { error: "Sender email not configured (AZURE_SENDER_EMAIL)" },
                { status: 503 }
            );
        }

        const mailPayload = {
            message: {
                subject: `Showback Report - ${customerId} - ${period}`,
                body: {
                    contentType: "HTML",
                    content: `
                        <h2>Showback / Chargeback Report</h2>
                        <p>Dear ${recipientName || "User"},</p>
                        <p>Please find attached your FinOps Showback Report for <strong>${period}</strong>.</p>
                        <h3>Summary</h3>
                        <ul>
                            <li>Customer: <strong>${customerId}</strong></li>
                            <li>Original Cost: <strong>$${totalOriginal.toFixed(2)}</strong></li>
                            <li>Markup (${markupPercent}%): <strong>$${(totalAdjusted - totalOriginal).toFixed(2)}</strong></li>
                            <li>Total to Pay: <strong>$${totalAdjusted.toFixed(2)}</strong></li>
                        </ul>
                        <p>Please contact us if you have any questions about this report.</p>
                        <hr />
                        <p style="color: #999; font-size: 12px;">
                            Generated by FinOps SaaS · CSCloudSolutions · cscloudsolutions.com.ar<br/>
                            ${new Date().toISOString()}
                        </p>
                    `,
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: recipientEmail,
                        },
                    },
                ],
                attachments: [
                    {
                        "@odata.type": "#microsoft.graph.fileAttachment",
                        name: `showback-${customerId}-${period}.pdf`,
                        contentType: "application/pdf",
                        contentBytes: pdfBase64,
                    },
                ],
            },
            saveToSentItems: "false",
        };

        // Send email via MS Graph
        const sendResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(mailPayload),
        });

        if (!sendResponse.ok) {
            console.error("[Invoicing Email] Failed to send email", await sendResponse.text());
            
            // Log failure
            await pool.query(
                `INSERT INTO ActionLogs (tenant_id, action_type, resource_id, status, user_email) 
                 VALUES (?, 'SHOWBACK_PDF_EMAIL', ?, 'FAILED', ?)`,
                [tenantId, `${customerId}:${period}`, identity.email]
            );

            throw new Error("Failed to send email via MS Graph");
        }

        // Log success
        await pool.query(
            `INSERT INTO ActionLogs (tenant_id, action_type, resource_id, status, user_email) 
             VALUES (?, 'SHOWBACK_PDF_EMAIL', ?, 'SUCCESS', ?)`,
            [tenantId, `${customerId}:${period}`, identity.email]
        );

        // Notify tenant via notifications system
        notifyTenant(tenantId, {
            title: "Showback PDF Sent",
            message: `Showback report for ${customerId} (${period}) has been sent to ${recipientEmail}.`,
            severity: "info",
        }).catch(err => {
            console.error("[Invoicing Email] Notification failed:", err);
        });

        console.log(`[Invoicing Email] Email successfully sent for ${customerId} - ${period}`);
        return NextResponse.json({ success: true, message: "Email sent successfully" });
    } catch (error: any) {
        console.error("[Invoicing Email] Error:", error);
        return serverError(error, { message: "Internal Server Error", status: 500 });
    }
}
