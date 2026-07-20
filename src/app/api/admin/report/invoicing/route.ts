import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { renderShowbackPdf } from "@/lib/pdf/showbackInvoice";
import { requireTenantRole } from "@/lib/requestAuth";
import { hasAccess } from "@/lib/tierLogic";
import { getAzureCredential } from "@/lib/azure";
import { getSubscriptionNameMap, resolveSubscriptionName, isUnattributedSubscriptionId } from "@/lib/azureSubscriptionNames";
import { resolvePeriodRange } from "@/lib/invoicingPeriod";
import { triggerBackfillIfStale } from "@/lib/historicalGapBackfill";
import JSZip from "jszip";
import { serverError } from '@/lib/apiErrors';

const UNATTRIBUTED_LABEL = "No atribuido a una suscripción";

const MOCK_LINES = [
    { date: "2026-06-01", customerId: "cust-001", customerName: "ACME Corp", subscriptionId: "sub-prod-001", service: "Virtual Machines", resourceGroup: "rg-prod-acme", originalCost: 1230.50, adjustedCost: 1415.08 },
    { date: "2026-06-01", customerId: "cust-001", customerName: "ACME Corp", subscriptionId: "sub-prod-001", service: "SQL Database", resourceGroup: "rg-prod-acme", originalCost: 850, adjustedCost: 977.50 },
    { date: "2026-06-02", customerId: "cust-002", customerName: "Globex Ltd", subscriptionId: "sub-prod-002", service: "Storage", resourceGroup: "rg-prod-globex", originalCost: 420.30, adjustedCost: 483.35 },
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
    bySubscription: [
        { subscriptionId: "sub-prod-001", subscriptionName: "Producción 001", originalCost: 18500, adjustedCost: 21275 },
        { subscriptionId: "sub-prod-002", subscriptionName: "Producción 002", originalCost: 15230.50, adjustedCost: 17514.08 },
        { subscriptionId: "sub-prod-003", subscriptionName: "Producción 003", originalCost: 11500, adjustedCost: 13225 },
    ],
    lines: MOCK_LINES,
};

function serializeCSV(lines: any[], period: string): string {
    const header = "date,customerId,customerName,subscriptionId,service,resourceGroup,originalCost,adjustedCost\r\n";
    const rows = lines.map(l =>
        [l.date, l.customerId, l.customerName ?? "", l.subscriptionId ?? "", l.service, l.resourceGroup, l.originalCost, l.adjustedCost]
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
    );
    return header + rows.join("\r\n");
}

async function handlePdfGeneration(
    payload: any,
    period: string,
    customerId: string | null,
    tenantId: string,
    tenantName: string | null
): Promise<NextResponse> {
    try {
        const isMock = payload.mock === true;

        // Un customerId literal "null"/"undefined" solo puede venir de un
        // frontend con datos stale (byCustomer cacheado de antes de este fix,
        // cuando el campo todavía podía ser JS null) — se corta acá con un
        // mensaje claro en vez de un 404 sin contexto.
        if (customerId === "null" || customerId === "undefined") {
            return NextResponse.json({ error: "Datos desactualizados en el navegador. Recargá la página (Ctrl+Shift+R) e intentá de nuevo." }, { status: 400 });
        }

        // Get customer details for single PDF
        if (customerId) {
            const customer = payload.byCustomer?.find((c: any) => c.customerId === customerId);
            if (!customer) {
                return NextResponse.json({ error: "Customer not found." }, { status: 404 });
            }

            const customerLines = payload.lines.filter((l: any) => l.customerId === customerId);

            const pdfData = {
                tenantName: tenantName || "Unknown Tenant",
                period,
                generatedDate: new Date().toISOString(),
                customerName: customer.customerName || customer.customerId,
                customerId: customer.customerId,
                billingPeriod: period,
                originalCost: customer.originalCost,
                adjustedCost: customer.adjustedCost,
                markupPercent: payload.markupPercent,
                markupAmount: Math.round((customer.adjustedCost - customer.originalCost) * 100) / 100,
                currency: payload.currency || "USD",
                lines: customerLines,
            };

            const buffer = await renderShowbackPdf({ data: pdfData });
            
            // Log audit
            if (!isMock) {
                await pool.query(
                    `INSERT INTO ActionLogs (tenant_id, action_type, resource_id, status, user_email) 
                     VALUES (?, 'SHOWBACK_PDF_GENERATED', ?, 'SUCCESS', ?)`,
                    [tenantId, `${customerId}:${period}`, "system"]
                );
            }

            return new NextResponse(new Uint8Array(buffer), {
                headers: {
                    "Content-Type": "application/pdf",
                    "Content-Disposition": `attachment; filename="showback-${customerId}-${period}.pdf"`,
                },
            });
        }

        // Generate ZIP with all customer PDFs
        const zip = new JSZip();
        const customerPromises = payload.byCustomer.map(async (customer: any) => {
            const customerLines = payload.lines.filter((l: any) => l.customerId === customer.customerId);
            
            const pdfData = {
                tenantName: tenantName || "Unknown Tenant",
                period,
                generatedDate: new Date().toISOString(),
                customerName: customer.customerName || customer.customerId,
                customerId: customer.customerId,
                billingPeriod: period,
                originalCost: customer.originalCost,
                adjustedCost: customer.adjustedCost,
                markupPercent: payload.markupPercent,
                markupAmount: Math.round((customer.adjustedCost - customer.originalCost) * 100) / 100,
                currency: payload.currency || "USD",
                lines: customerLines,
            };

            const buffer = await renderShowbackPdf({ data: pdfData });
            zip.file(`showback-${customer.customerId}-${period}.pdf`, buffer);
        });

        await Promise.all(customerPromises);

        // Log audit for batch
        if (!isMock) {
            await pool.query(
                `INSERT INTO ActionLogs (tenant_id, action_type, resource_id, status, user_email) 
                 VALUES (?, 'SHOWBACK_PDF_GENERATED', ?, 'SUCCESS', ?)`,
                [tenantId, `all:${period}`, "system"]
            );
        }

        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
        return new NextResponse(new Uint8Array(zipBuffer), {
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="showback-${period}.zip"`,
            },
        });
    } catch (err: any) {
        console.error("PDF generation error:", err);
        return NextResponse.json({ error: "Failed to generate PDF: " + err.message }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        const period = searchParams.get("period") || "last3m";
        const format = searchParams.get("format") || "json";
        const customerId = searchParams.get("customerId");
        const subscriptionId = searchParams.get("subscriptionId");

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro: tenantId" }, { status: 400 });
        }

        // Auth: Use requireTenantRole with special handling for mock tenants
        let identity;
        if (!isMockTenant(tenantId)) {
            try {
                identity = await requireTenantRole(request, tenantId, ["ADMIN", "Owner"]);
            } catch (authErr: any) {
                return NextResponse.json(
                    { error: authErr.message || "Unauthorized" },
                    { status: authErr.status || 401 }
                );
            }
        }

        // Power BI: en vez de intentar armar a mano el binario .pbit (ZIP con
        // varias partes internas de Power BI Desktop — modelo, layout, etc.
        // — muy fácil de dejar corrupto), generamos un .pbids (Power BI Data
        // Source, formato JSON documentado por Microsoft) que abre Power BI
        // Desktop y autoconfigura el conector Web apuntando al feed de
        // /api/exports/powerbi-feed. Ese feed se autentica con una MCP API
        // Key (no con el JWT de MSAL, que expira y Power BI no puede
        // refrescar) — el usuario la pega una sola vez como credencial "Web
        // API" en Power BI Desktop. Las keys se generan en Configuración > API Keys.
        if (format === "pbit") {
            const origin = request.nextUrl.origin;
            const feedUrl = `${origin}/api/exports/powerbi-feed?type=invoicing&period=${encodeURIComponent(period)}`;
            const pbids = {
                version: "0.1",
                connections: [
                    {
                        details: { protocol: "https", address: { url: feedUrl } },
                        options: {},
                        mode: "Import",
                    },
                ],
            };
            return new NextResponse(JSON.stringify(pbids, null, 2), {
                headers: {
                    "Content-Type": "application/json",
                    "Content-Disposition": `attachment; filename="invoicing-${period}.pbids"`,
                },
            });
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
            if (format === "pdf") {
                return await handlePdfGeneration(MOCK_PAYLOAD, period, customerId, tenantId, "Mock Tenant");
            }
            return NextResponse.json({
                ...MOCK_PAYLOAD,
                period,
                availableSubscriptions: MOCK_PAYLOAD.bySubscription.map(s => ({ id: s.subscriptionId, name: s.subscriptionName })),
            });
        }

        try {
            const [tenants]: any = await pool.query(
                "SELECT tier, markup_percentage, company_name FROM Tenants WHERE tenant_id = ?",
                [tenantId]
            );
            if (!tenants || tenants.length === 0) {
                return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
            }
            const tier = String(tenants[0].tier || "");
            if (!hasAccess(tier, "Business")) {
                return NextResponse.json({ error: "Feature bloqueada. Requiere plan Business o superior." }, { status: 403 });
            }
            const markupPercent = tenants[0].markup_percentage != null
                ? Number(tenants[0].markup_percentage)
                : 15;
            const tenantName = tenants[0].company_name || "Unknown Tenant";

            // Fire-and-forget: si los datos de este tenant están stale (sin
            // filas recientes en CostSnapshots), dispara en background el
            // mismo backfill histórico que corre el cron — así el hueco se
            // autocura la próxima vez que alguien mira el reporte, sin
            // esperar a la corrida diaria. Debounced por Redis (6h) para no
            // pegarle a Cost Management en cada carga de página.
            triggerBackfillIfStale(tenantId);

            const { start, end } = resolvePeriodRange(period);

            // Lista completa de suscripciones con datos en el rango, SIN aplicar
            // el filtro subscriptionId — así el selector del frontend siempre
            // muestra todas las opciones disponibles, no solo la elegida.
            const [subRows]: any = await pool.query(
                `SELECT DISTINCT cs.subscription_id AS subscriptionId
                 FROM CostSnapshots cs
                 WHERE cs.tenant_id = ?
                   AND DATE(COALESCE(cs.ChargePeriodStart, cs.date)) BETWEEN ? AND ?
                   AND cs.subscription_id IS NOT NULL
                 ORDER BY cs.subscription_id`,
                [tenantId, start, end]
            );

            // CostSnapshots sólo guarda el GUID de la suscripción; resolvemos el
            // nombre real vía Azure Management (mismo patrón que top-expenses /
            // cost-groups). Si falla, el selector cae al GUID sin romperse.
            let subNameMap = new Map<string, string>();
            try {
                const credential = await getAzureCredential(tenantId);
                subNameMap = await getSubscriptionNameMap(tenantId, credential);
            } catch (e: any) {
                console.warn("[invoicing] subscriptionNames:", e?.message);
            }
            const availableSubscriptions = (subRows as any[])
                .map(r => r.subscriptionId as string)
                .filter(id => !isUnattributedSubscriptionId(id))
                .map(id => ({ id, name: resolveSubscriptionName(id, subNameMap) }));

            const subFilter = subscriptionId ? " AND cs.subscription_id = ?" : "";
            const queryParams = subscriptionId ? [tenantId, start, end, subscriptionId] : [tenantId, start, end];

            const [rows]: any = await pool.query(
                `SELECT
                    DATE(COALESCE(cs.ChargePeriodStart, cs.date)) AS date,
                    cs.customer_id AS customerId,
                    cs.subscription_id AS subscriptionId,
                    cs.billing_profile_id AS billingProfileId,
                    cs.invoice_section_id AS invoiceSectionId,
                    cs.service_name AS service,
                    cs.resource_group AS resourceGroup,
                    SUM(COALESCE(cs.EffectiveCost, cs.BilledCost, cs.cost_usd, 0)) AS originalCost
                 FROM CostSnapshots cs
                 WHERE cs.tenant_id = ?
                   AND DATE(COALESCE(cs.ChargePeriodStart, cs.date)) BETWEEN ? AND ?${subFilter}
                 GROUP BY DATE(COALESCE(cs.ChargePeriodStart, cs.date)), cs.customer_id, cs.subscription_id, cs.billing_profile_id, cs.invoice_section_id, cs.service_name, cs.resource_group
                 ORDER BY cs.customer_id, DATE(COALESCE(cs.ChargePeriodStart, cs.date))`,
                queryParams
            );

            if (!rows || rows.length === 0) {
                return NextResponse.json({ success: true, mock: false, period, markupPercent, totals: null, byCustomer: [], byInvoiceSection: [], bySubscription: [], availableSubscriptions, lines: [] });
            }

            const multiplier = 1 + markupPercent / 100;
            const round2 = (n: number) => Math.round(n * 100) / 100;
            // customer_id puede venir NULL en billing EA/MCA sin cliente CSP
            // asociado. Se usa un sentinel corto y estable como customerId
            // (nunca el label largo) — el customerId viaja en URLs/query
            // params (descarga de PDF, email), y un valor largo/no-ASCII ahí
            // es fragil. El texto legible va aparte, en customerName.
            const NO_CUSTOMER_ID = "unassigned";
            const NO_CUSTOMER_LABEL = "Sin identificar (facturación EA/MCA sin cliente CSP)";
            // adjustedCost se mantiene SIN redondear acá — redondear por línea
            // y después sumar los redondeos introducía un drift acumulado
            // (ej. markup 0% mostraba "Monto Markup: -$0.06" en vez de $0).
            // El redondeo se aplica una sola vez, al final, sobre cada total.
            const lines = rows.map((r: any) => ({
                date: String(r.date).substring(0, 10),
                customerId: r.customerId || null,
                subscriptionId: r.subscriptionId,
                service: r.service,
                resourceGroup: r.resourceGroup,
                billingProfileId: r.billingProfileId,
                invoiceSectionId: r.invoiceSectionId,
                originalCost: Number(r.originalCost),
                adjustedCostRaw: Number(r.originalCost) * multiplier,
            }));

            // byCustomer / bySubscription aggregation
            const custMap = new Map<string, { customerId: string | null; originalCost: number; adjustedCost: number }>();
            const invMap = new Map<string, { invoiceSectionId: string; customerId: string | null; cost: number; adjusted: number }>();
            const subMap = new Map<string, { subscriptionId: string; subscriptionName: string; originalCost: number; adjustedCost: number }>();

            for (const l of lines) {
                const custKey = l.customerId ?? "__none__";
                const ce = custMap.get(custKey) || { customerId: l.customerId, originalCost: 0, adjustedCost: 0 };
                ce.originalCost += l.originalCost;
                ce.adjustedCost += l.adjustedCostRaw;
                custMap.set(custKey, ce);

                if (l.invoiceSectionId) {
                    const ie = invMap.get(l.invoiceSectionId) || { invoiceSectionId: l.invoiceSectionId, customerId: l.customerId, cost: 0, adjusted: 0 };
                    ie.cost += l.originalCost;
                    ie.adjusted += l.adjustedCostRaw;
                    invMap.set(l.invoiceSectionId, ie);
                }

                if (l.subscriptionId) {
                    const name = isUnattributedSubscriptionId(l.subscriptionId)
                        ? UNATTRIBUTED_LABEL
                        : resolveSubscriptionName(l.subscriptionId, subNameMap);
                    const se = subMap.get(l.subscriptionId) || { subscriptionId: l.subscriptionId, subscriptionName: name, originalCost: 0, adjustedCost: 0 };
                    se.originalCost += l.originalCost;
                    se.adjustedCost += l.adjustedCostRaw;
                    subMap.set(l.subscriptionId, se);
                }
            }

            const byCustomer = Array.from(custMap.values())
                .map(c => ({
                    customerId: c.customerId || NO_CUSTOMER_ID,
                    customerName: c.customerId ? undefined : NO_CUSTOMER_LABEL,
                    originalCost: round2(c.originalCost),
                    adjustedCost: round2(c.adjustedCost),
                }))
                .sort((a, b) => b.originalCost - a.originalCost);
            const byInvoiceSection = Array.from(invMap.values())
                .map(i => ({ ...i, customerId: i.customerId || NO_CUSTOMER_ID, cost: round2(i.cost), adjusted: round2(i.adjusted) }))
                .sort((a, b) => b.cost - a.cost);
            const bySubscription = Array.from(subMap.values())
                .map(s => ({ ...s, originalCost: round2(s.originalCost), adjustedCost: round2(s.adjustedCost) }))
                .sort((a, b) => b.originalCost - a.originalCost);
            const totalOriginal = lines.reduce((s: number, l: any) => s + l.originalCost, 0);
            const totalAdjusted = lines.reduce((s: number, l: any) => s + l.adjustedCostRaw, 0);

            // Lines de salida (CSV/JSON/PDF): redondeadas a 2 decimales recién
            // acá, y con el mismo fallback de customerId que byCustomer/byInvoiceSection
            // para que el filtro por cliente en el PDF siga matcheando.
            const displayLines = lines.map((l: any) => ({
                date: l.date,
                customerId: l.customerId || NO_CUSTOMER_ID,
                customerName: l.customerId ? undefined : NO_CUSTOMER_LABEL,
                subscriptionId: l.subscriptionId,
                service: l.service,
                resourceGroup: l.resourceGroup,
                billingProfileId: l.billingProfileId,
                invoiceSectionId: l.invoiceSectionId,
                originalCost: round2(l.originalCost),
                adjustedCost: round2(l.adjustedCostRaw),
            }));

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
                bySubscription,
                availableSubscriptions,
                lines: displayLines,
            };

            if (format === "csv") {
                const csv = serializeCSV(displayLines, period);
                return new NextResponse(csv, {
                    headers: {
                        "Content-Type": "text/csv",
                        "Content-Disposition": `attachment; filename="invoicing-${period}.csv"`,
                    },
                });
            }

            if (format === "pdf") {
                return await handlePdfGeneration(payload, period, customerId, tenantId, tenantName);
            }

            return NextResponse.json(payload);
        } catch (dbErr: any) {
            console.error("Invoicing DB error for real tenant:", tenantId, dbErr?.message);
            return NextResponse.json({
                success: false, mock: false,
                period,
                lines: [], summary: { totalCustomers: 0, totalNetCost: 0, totalGrossPrice: 0, totalMargin: 0 },
                error: `No se pudo generar la facturación: ${dbErr?.message || "error"}`,
            }, { status: 500 });
        }
    } catch (error: any) {
        console.error("Invoicing API Error:", error);
        return serverError(error, { message: "Error al obtener datos de facturación.", status: 500 });
    }
}
