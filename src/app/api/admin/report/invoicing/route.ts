import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

const MOCK_LINES = [
    { date: "2026-06-01", customerId: "cust-001", customerName: "ACME Corp", service: "Virtual Machines", resourceGroup: "rg-prod-acme", originalCost: 1230.50, adjustedCost: 1415.08 },
    { date: "2026-06-01", customerId: "cust-001", customerName: "ACME Corp", service: "SQL Database", resourceGroup: "rg-prod-acme", originalCost: 850, adjustedCost: 977.50 },
    { date: "2026-06-02", customerId: "cust-002", customerName: "Globex Ltd", service: "Storage", resourceGroup: "rg-prod-globex", originalCost: 420.30, adjustedCost: 483.35 },
];

const MOCK_PAYLOAD = {
    success: true,
    mock: true,
    period: "2026-06",
    markupPercent: 15,
    currency: "USD",
    totals: { originalCost: 45230.50, adjustedCost: 52015.08, markupAmount: 6784.58 },
    byCustomer: [
        { customerId: "cust-001", customerName: "ACME Corp", originalCost: 18500, adjustedCost: 21275 },
        { customerId: "cust-002", customerName: "Globex Ltd", originalCost: 15230.50, adjustedCost: 17514.08 },
        { customerId: "cust-003", customerName: "Initech", originalCost: 11500, adjustedCost: 13225 },
    ],
    byInvoiceSection: [
        { invoiceSectionId: "inv-001", customerId: "cust-001", cost: 18500, adjusted: 21275 },
        { invoiceSectionId: "inv-002", customerId: "cust-002", cost: 15230.50, adjusted: 17514.08 },
        { invoiceSectionId: "inv-003", customerId: "cust-003", cost: 11500, adjusted: 13225 },
    ],
    lines: MOCK_LINES,
};

function serializeCSV(lines: any[], period: string): string {
    const header = "date,customerId,customerName,service,resourceGroup,originalCost,adjustedCost\r\n";
    const rows = lines.map(l =>
        [l.date, l.customerId, l.customerName ?? "", l.service, l.resourceGroup, l.originalCost, l.adjustedCost]
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
    );
    return header + rows.join("\r\n");
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const period = searchParams.get("period") || new Date().toISOString().substring(0, 7);
        const format = searchParams.get("format") || "json";

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro: tenantId" }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        }
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
        }

        // PBIT: not implemented yet
        // Future implementation: read a .pbit template file, inject data into the embedded JSON model,
        // repack the ZIP, and stream back as application/x-powerbi-template.
        if (format === "pbit") {
            return NextResponse.json({ success: false, error: "PBIT export coming soon", mock: true });
        }

        if (isMockTenant(tenantId)) {
            if (format === "csv") {
                const csv = serializeCSV(MOCK_PAYLOAD.lines, period);
                return new NextResponse(csv, {
                    headers: {
                        "Content-Type": "text/csv",
                        "Content-Disposition": `attachment; filename="invoicing-${period}.csv"`,
                    },
                });
            }
            return NextResponse.json({ ...MOCK_PAYLOAD, period });
        }

        try {
            const [tenants]: any = await pool.query(
                "SELECT tier, partner_markup_percent FROM Tenants WHERE tenant_id = ?",
                [tenantId]
            );
            if (!tenants || tenants.length === 0) {
                return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
            }
            const tier = String(tenants[0].tier || "");
            if (tier.toLowerCase() !== "enterprise" && !isSuperAdmin) {
                return NextResponse.json({ error: "Feature bloqueada. Requiere plan Enterprise." }, { status: 403 });
            }
            const markupPercent = tenants[0].partner_markup_percent != null
                ? Number(tenants[0].partner_markup_percent)
                : 15;

            const [rows]: any = await pool.query(
                `SELECT
                    DATE(cs.date) AS date,
                    cs.customer_id AS customerId,
                    cs.billing_profile_id AS billingProfileId,
                    cs.invoice_section_id AS invoiceSectionId,
                    cs.service_name AS service,
                    cs.resource_group AS resourceGroup,
                    SUM(cs.billed_cost) AS originalCost
                 FROM CostSnapshots cs
                 WHERE cs.tenant_id = ?
                   AND DATE_FORMAT(cs.date, '%Y-%m') = ?
                 GROUP BY DATE(cs.date), cs.customer_id, cs.billing_profile_id, cs.invoice_section_id, cs.service_name, cs.resource_group
                 ORDER BY cs.customer_id, DATE(cs.date)`,
                [tenantId, period]
            );

            if (!rows || rows.length === 0) {
                return NextResponse.json({ success: true, mock: false, period, markupPercent, totals: null, byCustomer: [], byInvoiceSection: [], lines: [] });
            }

            const multiplier = 1 + markupPercent / 100;
            const lines = rows.map((r: any) => ({
                date: String(r.date).substring(0, 10),
                customerId: r.customerId,
                service: r.service,
                resourceGroup: r.resourceGroup,
                billingProfileId: r.billingProfileId,
                invoiceSectionId: r.invoiceSectionId,
                originalCost: Number(r.originalCost),
                adjustedCost: Math.round(Number(r.originalCost) * multiplier * 100) / 100,
            }));

            // byCustomer aggregation
            const custMap = new Map<string, { customerId: string; originalCost: number; adjustedCost: number }>();
            const invMap = new Map<string, { invoiceSectionId: string; customerId: string; cost: number; adjusted: number }>();

            for (const l of lines) {
                const ce = custMap.get(l.customerId) || { customerId: l.customerId, originalCost: 0, adjustedCost: 0 };
                ce.originalCost += l.originalCost;
                ce.adjustedCost += l.adjustedCost;
                custMap.set(l.customerId, ce);

                if (l.invoiceSectionId) {
                    const ie = invMap.get(l.invoiceSectionId) || { invoiceSectionId: l.invoiceSectionId, customerId: l.customerId, cost: 0, adjusted: 0 };
                    ie.cost += l.originalCost;
                    ie.adjusted += l.adjustedCost;
                    invMap.set(l.invoiceSectionId, ie);
                }
            }

            const byCustomer = Array.from(custMap.values()).sort((a, b) => b.originalCost - a.originalCost);
            const byInvoiceSection = Array.from(invMap.values()).sort((a, b) => b.cost - a.cost);
            const totalOriginal = byCustomer.reduce((s, c) => s + c.originalCost, 0);
            const totalAdjusted = byCustomer.reduce((s, c) => s + c.adjustedCost, 0);

            const payload = {
                success: true,
                mock: false,
                period,
                markupPercent,
                currency: "USD",
                totals: {
                    originalCost: Math.round(totalOriginal * 100) / 100,
                    adjustedCost: Math.round(totalAdjusted * 100) / 100,
                    markupAmount: Math.round((totalAdjusted - totalOriginal) * 100) / 100,
                },
                byCustomer,
                byInvoiceSection,
                lines,
            };

            if (format === "csv") {
                const csv = serializeCSV(lines, period);
                return new NextResponse(csv, {
                    headers: {
                        "Content-Type": "text/csv",
                        "Content-Disposition": `attachment; filename="invoicing-${period}.csv"`,
                    },
                });
            }

            return NextResponse.json(payload);
        } catch (dbErr) {
            console.error("Invoicing DB error — returning mock:", dbErr);
            if (format === "csv") {
                const csv = serializeCSV(MOCK_PAYLOAD.lines, period);
                return new NextResponse(csv, {
                    headers: {
                        "Content-Type": "text/csv",
                        "Content-Disposition": `attachment; filename="invoicing-${period}.csv"`,
                    },
                });
            }
            return NextResponse.json({ ...MOCK_PAYLOAD, period });
        }
    } catch (error: any) {
        console.error("Invoicing API Error:", error);
        return NextResponse.json({ error: "Error al obtener datos de facturación.", details: error.message }, { status: 500 });
    }
}
