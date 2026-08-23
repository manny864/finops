/**
 * billingReport.types.ts — Contratos y modelos de datos para el Reporte de Facturación
 * con Markup para Partners/MSPs/CSPs, Esquema FOCUS 1.0 y Showback.
 */

export interface CustomerBillingSummaryItem {
    customerId: string;
    customerDisplayName: string;
    originalCostUSD: number;
    markupAmountUSD: number;
    adjustedCostUSD: number;
    isAssigned: boolean;
}

export interface InvoiceSectionBillingItem {
    invoiceSectionId: string;
    billingProfileId: string;
    customerId: string;
    originalCostUSD: number;
    adjustedCostUSD: number;
}

export interface SubscriptionBillingSummaryItem {
    subscriptionId: string;
    subscriptionName: string;
    originalCostUSD: number;
    markupAmountUSD: number;
    adjustedCostUSD: number;
}

export interface BillingLineDetailItem {
    id: string;
    dateIso: string;
    formattedDate: string;
    customerName: string;
    customerId: string;
    billingProfileId?: string;
    invoiceSectionId?: string;
    serviceName: string;
    resourceGroup: string;
    originalCostUSD: number;
    adjustedCostUSD: number;
}

export interface BillingReportSummaryMetrics {
    totalOriginalCostUSD: number;
    totalMarkupAmountUSD: number;
    totalAdjustedCostUSD: number;
    appliedMarkupPercentage: number;
    fixedManagementFeeUSD: number;
    periodLabel: string;
    customers: CustomerBillingSummaryItem[];
    invoiceSections: InvoiceSectionBillingItem[];
    subscriptions: SubscriptionBillingSummaryItem[];
    lineDetails: BillingLineDetailItem[];
}

export interface ExportPbidsPayload {
    tenantId: string;
    period: string;
}

export interface MapVirtualCustomerPayload {
    tenantId: string;
    resourceGroupName?: string;
    subscriptionId?: string;
    targetCustomerId: string;
    customerName: string;
}

export interface BillingReportApiResponse {
    success: boolean;
    mock?: boolean;
    period: string;
    markupPercent: number;
    currency: string;
    totals: {
        originalCost: number;
        adjustedCost: number;
        markupAmount: number;
    } | null;
    byCustomer: CustomerBillingSummaryItem[];
    byInvoiceSection: InvoiceSectionBillingItem[];
    bySubscription: SubscriptionBillingSummaryItem[];
    availableSubscriptions: Array<{ id: string; name: string }>;
    lines: BillingLineDetailItem[];
    error?: string;
}
