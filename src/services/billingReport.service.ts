/**
 * billingReport.service.ts — Motor de Facturación Cloud con Markup para Partners/MSPs/CSPs,
 * Esquema FOCUS 1.0, Showback y Conectores de Exportación.
 */
import Decimal from 'decimal.js';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import pool from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import { getMarkupSettings, getActiveOverrides } from '@/services/tenantPartnerMarkup.service';
import { resolvePeriodRange } from '@/lib/invoicingPeriod';
import { getAzureCredential } from '@/lib/azure';
import { getSubscriptionNameMap, resolveSubscriptionName, isUnattributedSubscriptionId } from '@/lib/azureSubscriptionNames';
import { triggerBackfillIfStale } from '@/lib/historicalGapBackfill';
import { toMoneyNumber } from '@/lib/moneyDecimal';
import type {
    BillingReportApiResponse,
    CustomerBillingSummaryItem,
    InvoiceSectionBillingItem,
    SubscriptionBillingSummaryItem,
    BillingLineDetailItem,
    MapVirtualCustomerPayload,
} from '@/types/billingReport.types';

const NO_CUSTOMER_ID = 'unassigned';
const NO_CUSTOMER_LABEL = 'Sin identificar (facturación EA/MCA sin cliente CSP)';
const UNATTRIBUTED_LABEL = 'No atribuido a una suscripción';

export const MOCK_BILLING_LINES: BillingLineDetailItem[] = [
    { id: '1', dateIso: '2026-07-01', formattedDate: '01/07/2026', customerId: 'cust-001', customerName: 'ACME Corp', billingProfileId: 'bp-acme-01', invoiceSectionId: 'inv-001', serviceName: 'Virtual Machines', resourceGroup: 'rg-prod-acme', originalCostUSD: 1230.50, adjustedCostUSD: 1415.08 },
    { id: '2', dateIso: '2026-07-01', formattedDate: '01/07/2026', customerId: 'cust-001', customerName: 'ACME Corp', billingProfileId: 'bp-acme-01', invoiceSectionId: 'inv-001', serviceName: 'SQL Database', resourceGroup: 'rg-prod-acme', originalCostUSD: 850.00, adjustedCostUSD: 977.50 },
    { id: '3', dateIso: '2026-07-02', formattedDate: '02/07/2026', customerId: 'cust-002', customerName: 'Globex Ltd', billingProfileId: 'bp-globex-01', invoiceSectionId: 'inv-002', serviceName: 'Storage', resourceGroup: 'rg-prod-globex', originalCostUSD: 420.30, adjustedCostUSD: 483.35 },
    { id: '4', dateIso: '2026-07-03', formattedDate: '03/07/2026', customerId: 'cust-003', customerName: 'Initech', billingProfileId: 'bp-initech-01', invoiceSectionId: 'inv-003', serviceName: 'Container Registry', resourceGroup: 'rg-prod-initech', originalCostUSD: 310.00, adjustedCostUSD: 356.50 },
    { id: '5', dateIso: '2026-07-04', formattedDate: '04/07/2026', customerId: 'unassigned', customerName: NO_CUSTOMER_LABEL, billingProfileId: 'bp-direct-01', invoiceSectionId: 'inv-004', serviceName: 'Azure DNS', resourceGroup: 'rg-network-core', originalCostUSD: 154.20, adjustedCostUSD: 177.33 },
];

export const MOCK_BILLING_DATA: BillingReportApiResponse = {
    success: true,
    mock: true,
    period: '2026-07',
    markupPercent: 15,
    currency: 'USD',
    totals: { originalCost: 18454.00, markupAmount: 2768.10, adjustedCost: 21222.10 },
    byCustomer: [
        { customerId: 'cust-001', customerDisplayName: 'ACME Corp', originalCostUSD: 8500.00, markupAmountUSD: 1275.00, adjustedCostUSD: 9775.00, isAssigned: true },
        { customerId: 'cust-002', customerDisplayName: 'Globex Ltd', originalCostUSD: 5230.50, markupAmountUSD: 784.58, adjustedCostUSD: 6015.08, isAssigned: true },
        { customerId: 'cust-003', customerDisplayName: 'Initech', originalCostUSD: 3500.00, markupAmountUSD: 525.00, adjustedCostUSD: 4025.00, isAssigned: true },
        { customerId: 'unassigned', customerDisplayName: NO_CUSTOMER_LABEL, originalCostUSD: 1223.50, markupAmountUSD: 183.52, adjustedCostUSD: 1407.02, isAssigned: false },
    ],
    byInvoiceSection: [
        { invoiceSectionId: 'inv-001', billingProfileId: 'bp-acme-01', customerId: 'cust-001', originalCostUSD: 8500.00, adjustedCostUSD: 9775.00 },
        { invoiceSectionId: 'inv-002', billingProfileId: 'bp-globex-01', customerId: 'cust-002', originalCostUSD: 5230.50, adjustedCostUSD: 6015.08 },
        { invoiceSectionId: 'inv-003', billingProfileId: 'bp-initech-01', customerId: 'cust-003', originalCostUSD: 3500.00, adjustedCostUSD: 4025.00 },
        { invoiceSectionId: 'inv-004', billingProfileId: 'bp-direct-01', customerId: 'unassigned', originalCostUSD: 1223.50, adjustedCostUSD: 1407.02 },
    ],
    bySubscription: [
        { subscriptionId: 'sub-prod-001', subscriptionName: 'CSCS-Production-01', originalCostUSD: 8500.00, markupAmountUSD: 1275.00, adjustedCostUSD: 9775.00 },
        { subscriptionId: 'sub-prod-002', subscriptionName: 'CSCS-Staging-02', originalCostUSD: 5230.50, markupAmountUSD: 784.58, adjustedCostUSD: 6015.08 },
        { subscriptionId: 'sub-prod-003', subscriptionName: 'CSCS-SharedServices', originalCostUSD: 4723.50, markupAmountUSD: 708.52, adjustedCostUSD: 5432.02 },
    ],
    availableSubscriptions: [
        { id: 'sub-prod-001', name: 'CSCS-Production-01' },
        { id: 'sub-prod-002', name: 'CSCS-Staging-02' },
        { id: 'sub-prod-003', name: 'CSCS-SharedServices' },
    ],
    lines: MOCK_BILLING_LINES,
};

/**
 * Obtiene el reporte consolidado de facturación aplicando reglas de markup y FOCUS 1.0.
 */
export async function getBillingReportData(
    tenantId: string,
    period: string = 'last30d',
    subscriptionId?: string
): Promise<BillingReportApiResponse> {
    if (isMockTenant(tenantId)) {
        let lines = [...MOCK_BILLING_LINES];
        let bySub = [...MOCK_BILLING_DATA.bySubscription];

        if (subscriptionId) {
            bySub = bySub.filter((s) => s.subscriptionId === subscriptionId);
        }

        return {
            ...MOCK_BILLING_DATA,
            period,
            bySubscription: bySub,
            lines,
        };
    }

    // Fire-and-forget: si los datos de este tenant están stale (sin filas recientes en CostSnapshots),
    // dispara en background el backfill histórico que corre el cron.
    triggerBackfillIfStale(tenantId);

    const markupSettings = await getMarkupSettings(tenantId);
    const markupPercent = markupSettings.isMarkupEnabled ? markupSettings.globalMarkupPercentage : 0;
    const fixedFeeUSD = markupSettings.isMarkupEnabled ? markupSettings.fixedManagementFeeUSD : 0;
    const overrides = markupSettings.isMarkupEnabled ? await getActiveOverrides(tenantId) : [];

    const { start, end } = resolvePeriodRange(period);

    // Resolver nombres de suscripción vía Azure Management
    let subNameMap = new Map<string, string>();
    try {
        const credential = await getAzureCredential(tenantId);
        subNameMap = await getSubscriptionNameMap(tenantId, credential);
    } catch {
        // Fallback a GUIDs si Azure Management falla
    }

    const [subRows]: any = await pool.query(
        `SELECT DISTINCT cs.subscription_id AS subscriptionId
         FROM CostSnapshots cs
         WHERE cs.tenant_id = ?
           AND DATE(COALESCE(cs.ChargePeriodStart, cs.date)) BETWEEN ? AND ?
           AND cs.subscription_id IS NOT NULL
         ORDER BY cs.subscription_id`,
        [tenantId, start, end]
    );

    const availableSubscriptions = (subRows as any[])
        .map((r) => r.subscriptionId as string)
        .filter((id) => !isUnattributedSubscriptionId(id))
        .map((id) => ({ id, name: resolveSubscriptionName(id, subNameMap) }));

    const subFilter = subscriptionId ? ' AND cs.subscription_id = ?' : '';
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
        return {
            success: true,
            mock: false,
            period,
            markupPercent,
            currency: 'USD',
            totals: { originalCost: 0, markupAmount: 0, adjustedCost: 0 },
            byCustomer: [],
            byInvoiceSection: [],
            bySubscription: [],
            availableSubscriptions,
            lines: [],
        };
    }

    const globalPercent = new Decimal(markupPercent);

    const lines: (BillingLineDetailItem & { subscriptionId?: string })[] = (rows as any[]).map((r, idx) => {
        const original = new Decimal(r.originalCost || 0);

        // Buscar override
        let appliedPercent = globalPercent;
        const bySub = overrides.find((o) => o.scopeType === 'SUBSCRIPTION' && o.scopeValue === r.subscriptionId);
        if (bySub) {
            appliedPercent = new Decimal(bySub.overridePercentage);
        } else {
            const byService = overrides.find(
                (o) => o.scopeType === 'SERVICE_CATEGORY' && o.scopeValue.toLowerCase() === String(r.service || '').toLowerCase()
            );
            if (byService) appliedPercent = new Decimal(byService.overridePercentage);
        }

        const multiplier = new Decimal(1).plus(appliedPercent.dividedBy(100));
        const adjusted = original.mul(multiplier);

        const dateStr = String(r.date).substring(0, 10);
        const [y, m, d] = dateStr.split('-');
        const formattedDate = y && m && d ? `${d}/${m}/${y}` : dateStr;

        const isCustAssigned = !!r.customerId && r.customerId !== NO_CUSTOMER_ID;

        return {
            id: `line-${idx + 1}`,
            dateIso: dateStr,
            formattedDate,
            customerId: r.customerId || NO_CUSTOMER_ID,
            customerName: isCustAssigned ? r.customerId : NO_CUSTOMER_LABEL,
            subscriptionId: r.subscriptionId || undefined,
            billingProfileId: r.billingProfileId || undefined,
            invoiceSectionId: r.invoiceSectionId || undefined,
            serviceName: r.service || 'Azure General',
            resourceGroup: r.resourceGroup || 'Sin Grupo',
            originalCostUSD: toMoneyNumber(original),
            adjustedCostUSD: toMoneyNumber(adjusted),
        };
    });

    // Agrupación por Cliente
    const custMap = new Map<string, { customerId: string; displayName: string; original: Decimal; adjusted: Decimal; isAssigned: boolean }>();
    const invMap = new Map<string, { sectionId: string; profileId: string; customerId: string; original: Decimal; adjusted: Decimal }>();
    const subMap = new Map<string, { subscriptionId: string; name: string; original: Decimal; adjusted: Decimal }>();

    let totalOrig = new Decimal(0);
    let totalAdj = new Decimal(0);

    for (const l of lines) {
        const origDec = new Decimal(l.originalCostUSD);
        const adjDec = new Decimal(l.adjustedCostUSD);
        totalOrig = totalOrig.plus(origDec);
        totalAdj = totalAdj.plus(adjDec);

        // Cliente
        const custKey = l.customerId;
        const isAssigned = custKey !== NO_CUSTOMER_ID;
        const cEntry = custMap.get(custKey) || {
            customerId: custKey,
            displayName: isAssigned ? custKey : NO_CUSTOMER_LABEL,
            original: new Decimal(0),
            adjusted: new Decimal(0),
            isAssigned,
        };
        cEntry.original = cEntry.original.plus(origDec);
        cEntry.adjusted = cEntry.adjusted.plus(adjDec);
        custMap.set(custKey, cEntry);

        // Invoice Section
        if (l.invoiceSectionId) {
            const iEntry = invMap.get(l.invoiceSectionId) || {
                sectionId: l.invoiceSectionId,
                profileId: l.billingProfileId || 'bp-default',
                customerId: l.customerId,
                original: new Decimal(0),
                adjusted: new Decimal(0),
            };
            iEntry.original = iEntry.original.plus(origDec);
            iEntry.adjusted = iEntry.adjusted.plus(adjDec);
            invMap.set(l.invoiceSectionId, iEntry);
        }

        // Suscripción real por cada línea
        const subId = l.subscriptionId || 'sub-unattributed';
        const sName = isUnattributedSubscriptionId(subId)
            ? 'No atribuido a una suscripción'
            : resolveSubscriptionName(subId, subNameMap);
        const sEntry = subMap.get(subId) || {
            subscriptionId: subId,
            name: sName,
            original: new Decimal(0),
            adjusted: new Decimal(0),
        };
        sEntry.original = sEntry.original.plus(origDec);
        sEntry.adjusted = sEntry.adjusted.plus(adjDec);
        subMap.set(subId, sEntry);
    }

    const byCustomer: CustomerBillingSummaryItem[] = Array.from(custMap.values())
        .map((c) => ({
            customerId: c.customerId,
            customerDisplayName: c.displayName,
            customerName: c.displayName,
            originalCostUSD: toMoneyNumber(c.original),
            originalCost: toMoneyNumber(c.original),
            markupAmountUSD: toMoneyNumber(c.adjusted.minus(c.original)),
            markupAmount: toMoneyNumber(c.adjusted.minus(c.original)),
            adjustedCostUSD: toMoneyNumber(c.adjusted),
            adjustedCost: toMoneyNumber(c.adjusted),
            isAssigned: c.isAssigned,
        }))
        .sort((a, b) => b.originalCostUSD - a.originalCostUSD);

    const byInvoiceSection: InvoiceSectionBillingItem[] = Array.from(invMap.values())
        .map((i) => ({
            invoiceSectionId: i.sectionId,
            billingProfileId: i.profileId,
            customerId: i.customerId,
            originalCostUSD: toMoneyNumber(i.original),
            originalCost: toMoneyNumber(i.original),
            adjustedCostUSD: toMoneyNumber(i.adjusted),
            adjustedCost: toMoneyNumber(i.adjusted),
            cost: toMoneyNumber(i.original),
            adjusted: toMoneyNumber(i.adjusted),
        }))
        .sort((a, b) => b.originalCostUSD - a.originalCostUSD);

    const bySubscription: SubscriptionBillingSummaryItem[] = Array.from(subMap.values())
        .map((s) => ({
            subscriptionId: s.subscriptionId,
            subscriptionName: s.name,
            originalCostUSD: toMoneyNumber(s.original),
            originalCost: toMoneyNumber(s.original),
            markupAmountUSD: toMoneyNumber(s.adjusted.minus(s.original)),
            markupAmount: toMoneyNumber(s.adjusted.minus(s.original)),
            adjustedCostUSD: toMoneyNumber(s.adjusted),
            adjustedCost: toMoneyNumber(s.adjusted),
        }))
        .sort((a, b) => b.originalCostUSD - a.originalCostUSD);

    return {
        success: true,
        mock: false,
        period,
        markupPercent,
        currency: 'USD',
        totals: {
            originalCost: toMoneyNumber(totalOrig),
            markupAmount: toMoneyNumber(totalAdj.minus(totalOrig)),
            adjustedCost: toMoneyNumber(totalAdj),
        },
        byCustomer,
        byInvoiceSection,
        bySubscription,
        availableSubscriptions,
        lines,
    };
}

/**
 * Genera el conector Power BI Data Source (.pbids) con la URL OData/Web API del tenant.
 */
export function generatePbidsConnector(tenantId: string, period: string, origin: string): string {
    const feedUrl = `${origin}/api/exports/powerbi-feed?type=invoicing&tenantId=${encodeURIComponent(tenantId)}&period=${encodeURIComponent(period)}`;
    const pbids = {
        version: '0.1',
        connections: [
            {
                details: {
                    protocol: 'https',
                    address: {
                        url: feedUrl,
                    },
                },
                options: {},
                mode: 'Import',
            },
        ],
    };
    return JSON.stringify(pbids, null, 2);
}

/**
 * Serializa líneas a CSV estándar.
 */
export function serializeBillingCsv(lines: BillingLineDetailItem[]): string {
    const header = 'Fecha,Customer ID,Cliente,Billing Profile,Invoice Section,Servicio,Resource Group,Costo Original USD,Costo Ajustado USD\r\n';
    const rows = lines.map((l) =>
        [
            l.formattedDate || l.dateIso,
            l.customerId,
            l.customerName,
            l.billingProfileId || '',
            l.invoiceSectionId || '',
            l.serviceName,
            l.resourceGroup,
            l.originalCostUSD.toFixed(2),
            l.adjustedCostUSD.toFixed(2),
        ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
    );
    return header + rows.join('\r\n');
}

/**
 * Empaqueta un ZIP completo con CSVs, JSON y Conector Power BI.
 */
export async function generateBillingZipPackage(
    reportData: BillingReportApiResponse,
    tenantId: string,
    period: string,
    origin: string
): Promise<Buffer> {
    const zip = new JSZip();

    // 1. Facturacion Detallada CSV
    const detailedCsv = serializeBillingCsv(reportData.lines);
    zip.file(`Facturacion_Detallada_FOCUS_${period}.csv`, detailedCsv);

    // 2. Resumen por Cliente CSV
    const custCsvHeader = 'Customer ID,Cliente,Costo Original USD,Markup USD,Costo Ajustado USD\r\n';
    const custCsvRows = reportData.byCustomer
        .map((c) => `"${c.customerId}","${c.customerDisplayName}",${c.originalCostUSD.toFixed(2)},${c.markupAmountUSD.toFixed(2)},${c.adjustedCostUSD.toFixed(2)}`)
        .join('\r\n');
    zip.file(`Resumen_Por_Cliente_${period}.csv`, custCsvHeader + custCsvRows);

    // 3. Resumen por Suscripcion CSV
    const subCsvHeader = 'Subscription ID,Suscripcion,Costo Original USD,Markup USD,Costo Ajustado USD\r\n';
    const subCsvRows = reportData.bySubscription
        .map((s) => `"${s.subscriptionId}","${s.subscriptionName}",${s.originalCostUSD.toFixed(2)},${s.markupAmountUSD.toFixed(2)},${s.adjustedCostUSD.toFixed(2)}`)
        .join('\r\n');
    zip.file(`Resumen_Por_Suscripcion_${period}.csv`, subCsvHeader + subCsvRows);

    // 4. JSON Dataset
    zip.file(`Dataset_Facturacion_${period}.json`, JSON.stringify(reportData, null, 2));

    // 5. Power BI Connector (.pbids)
    const pbidsContent = generatePbidsConnector(tenantId, period, origin);
    zip.file(`Conector_PowerBI_${period}.pbids`, pbidsContent);

    return await zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * Genera una factura / estado de cuenta proforma en PDF A4 para un cliente específico.
 */
export async function generateCustomerInvoicePdf(
    reportData: BillingReportApiResponse,
    customerId: string,
    tenantName: string = 'CSCloudSolutions'
): Promise<Buffer> {
    const customer = reportData.byCustomer.find((c) => c.customerId === customerId) || {
        customerId,
        customerDisplayName: customerId === NO_CUSTOMER_ID ? NO_CUSTOMER_LABEL : customerId,
        originalCostUSD: 0,
        markupAmountUSD: 0,
        adjustedCostUSD: 0,
        isAssigned: false,
    };

    const customerLines = reportData.lines.filter((l) => l.customerId === customerId);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Cabecera Corporativa
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(0, 84, 166);
    doc.text('CSCloudSolutions · Factura de Consumo Cloud', 18, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`Proveedor MSP: ${tenantName} | Período: ${reportData.period} | Fecha: ${new Date().toLocaleDateString('es-AR')}`, 18, 26);

    // Línea separadora
    doc.setDrawColor(0, 120, 212);
    doc.setLineWidth(0.6);
    doc.line(18, 29, 192, 29);

    // Cuadro Cliente
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(18, 33, 174, 22, 2, 2, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(18, 33, 174, 22, 2, 2, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('CLIENTE / ENTIDAD', 24, 39);
    doc.text('SUBTOTAL AZURE', 90, 39);
    doc.text('MARGEN PARTNER', 130, 39);
    doc.text('TOTAL A FACTURAR', 160, 39);

    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(customer.customerDisplayName.substring(0, 28), 24, 47);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 84, 166);
    doc.text(`$${customer.originalCostUSD.toFixed(2)}`, 90, 47);
    doc.text(`+$${customer.markupAmountUSD.toFixed(2)}`, 130, 47);
    doc.text(`$${customer.adjustedCostUSD.toFixed(2)}`, 160, 47);

    // Tabla de Líneas de Servicio
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Desglose de Servicios Imputados', 18, 63);

    // Encabezado de tabla
    doc.setFillColor(241, 245, 249);
    doc.rect(18, 67, 174, 7, 'F');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text('Fecha', 22, 72);
    doc.text('Servicio', 45, 72);
    doc.text('Resource Group', 95, 72);
    doc.text('Costo Base', 145, 72);
    doc.text('Costo Final', 170, 72);

    let y = 79;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);

    const displayLines = customerLines.length > 0 ? customerLines : (
        customer.originalCostUSD > 0
            ? [{ formattedDate: '—', serviceName: 'Consumo Azure Consolidado', resourceGroup: '—', originalCostUSD: customer.originalCostUSD, adjustedCostUSD: customer.adjustedCostUSD } as any]
            : []
    );

    for (const line of displayLines.slice(0, 25)) {
        if (y > 270) {
            doc.addPage('a4', 'portrait');
            y = 20;
        }
        doc.text(line.formattedDate || line.dateIso || '—', 22, y);
        doc.text(String(line.serviceName || '').substring(0, 22), 45, y);
        doc.text(String(line.resourceGroup || '').substring(0, 22), 95, y);
        doc.text(`$${Number(line.originalCostUSD || 0).toFixed(2)}`, 145, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 84, 166);
        doc.text(`$${Number(line.adjustedCostUSD || 0).toFixed(2)}`, 170, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);

        doc.setDrawColor(226, 232, 240);
        doc.line(18, y + 2, 192, y + 2);
        y += 7;
    }

    // Pie de página
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text('Documento proforma emitido por CSCloudSolutions FinOps Management Platform. No válido como factura fiscal.', 18, 285);

    return Buffer.from(doc.output('arraybuffer'));
}
