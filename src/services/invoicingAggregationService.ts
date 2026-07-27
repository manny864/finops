import Decimal from "decimal.js";
import { isUnattributedSubscriptionId, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { toMoneyNumber } from "@/lib/moneyDecimal";

const NO_CUSTOMER_ID = "unassigned";
const NO_CUSTOMER_LABEL = "Sin identificar (facturación EA/MCA sin cliente CSP)";
const UNATTRIBUTED_LABEL = "No atribuido a una suscripción";

interface RawInvoicingRow {
  date: string | Date;
  customerId: string | null;
  subscriptionId: string | null;
  billingProfileId: string | null;
  invoiceSectionId: string | null;
  service: string | null;
  resourceGroup: string | null;
  originalCost: string | number;
}

interface AvailableSubscription {
  id: string;
  name: string;
}

export function buildInvoicingPayload(params: {
  rows: RawInvoicingRow[];
  markupPercent: number;
  period: string;
  availableSubscriptions: AvailableSubscription[];
  subNameMap: Map<string, string>;
}) {
  const { rows, markupPercent, period, availableSubscriptions, subNameMap } = params;
  const multiplier = new Decimal(1).plus(new Decimal(markupPercent).dividedBy(100));

  const lines = rows.map((r) => {
    const original = new Decimal(r.originalCost || 0);
    return {
      date: String(r.date).substring(0, 10),
      customerId: r.customerId || null,
      subscriptionId: r.subscriptionId,
      service: r.service,
      resourceGroup: r.resourceGroup,
      billingProfileId: r.billingProfileId,
      invoiceSectionId: r.invoiceSectionId,
      originalCostDec: original,
      adjustedCostDec: original.mul(multiplier),
    };
  });

  const custMap = new Map<string, { customerId: string | null; originalCost: Decimal; adjustedCost: Decimal }>();
  const invMap = new Map<string, { invoiceSectionId: string; customerId: string | null; cost: Decimal; adjusted: Decimal }>();
  const subMap = new Map<string, { subscriptionId: string; subscriptionName: string; originalCost: Decimal; adjustedCost: Decimal }>();

  for (const l of lines) {
    const custKey = l.customerId ?? "__none__";
    const ce = custMap.get(custKey) || { customerId: l.customerId, originalCost: new Decimal(0), adjustedCost: new Decimal(0) };
    ce.originalCost = ce.originalCost.plus(l.originalCostDec);
    ce.adjustedCost = ce.adjustedCost.plus(l.adjustedCostDec);
    custMap.set(custKey, ce);

    if (l.invoiceSectionId) {
      const ie = invMap.get(l.invoiceSectionId) || {
        invoiceSectionId: l.invoiceSectionId,
        customerId: l.customerId,
        cost: new Decimal(0),
        adjusted: new Decimal(0),
      };
      ie.cost = ie.cost.plus(l.originalCostDec);
      ie.adjusted = ie.adjusted.plus(l.adjustedCostDec);
      invMap.set(l.invoiceSectionId, ie);
    }

    if (l.subscriptionId) {
      const name = isUnattributedSubscriptionId(l.subscriptionId)
        ? UNATTRIBUTED_LABEL
        : resolveSubscriptionName(l.subscriptionId, subNameMap);
      const se = subMap.get(l.subscriptionId) || {
        subscriptionId: l.subscriptionId,
        subscriptionName: name,
        originalCost: new Decimal(0),
        adjustedCost: new Decimal(0),
      };
      se.originalCost = se.originalCost.plus(l.originalCostDec);
      se.adjustedCost = se.adjustedCost.plus(l.adjustedCostDec);
      subMap.set(l.subscriptionId, se);
    }
  }

  const byCustomer = Array.from(custMap.values())
    .map((c) => ({
      customerId: c.customerId || NO_CUSTOMER_ID,
      customerName: c.customerId ? undefined : NO_CUSTOMER_LABEL,
      originalCost: toMoneyNumber(c.originalCost),
      adjustedCost: toMoneyNumber(c.adjustedCost),
    }))
    .sort((a, b) => b.originalCost - a.originalCost);

  const byInvoiceSection = Array.from(invMap.values())
    .map((i) => ({
      invoiceSectionId: i.invoiceSectionId,
      customerId: i.customerId || NO_CUSTOMER_ID,
      cost: toMoneyNumber(i.cost),
      adjusted: toMoneyNumber(i.adjusted),
    }))
    .sort((a, b) => b.cost - a.cost);

  const bySubscription = Array.from(subMap.values())
    .map((s) => ({
      subscriptionId: s.subscriptionId,
      subscriptionName: s.subscriptionName,
      originalCost: toMoneyNumber(s.originalCost),
      adjustedCost: toMoneyNumber(s.adjustedCost),
    }))
    .sort((a, b) => b.originalCost - a.originalCost);

  const totalOriginal = lines.reduce((acc, l) => acc.plus(l.originalCostDec), new Decimal(0));
  const totalAdjusted = lines.reduce((acc, l) => acc.plus(l.adjustedCostDec), new Decimal(0));

  const displayLines = lines.map((l) => ({
    date: l.date,
    customerId: l.customerId || NO_CUSTOMER_ID,
    customerName: l.customerId ? undefined : NO_CUSTOMER_LABEL,
    subscriptionId: l.subscriptionId,
    service: l.service,
    resourceGroup: l.resourceGroup,
    billingProfileId: l.billingProfileId,
    invoiceSectionId: l.invoiceSectionId,
    originalCost: toMoneyNumber(l.originalCostDec),
    adjustedCost: toMoneyNumber(l.adjustedCostDec),
  }));

  return {
    success: true,
    mock: false,
    period,
    markupPercent,
    currency: "USD",
    totals: {
      originalCost: toMoneyNumber(totalOriginal),
      adjustedCost: toMoneyNumber(totalAdjusted),
      markupAmount: toMoneyNumber(totalAdjusted.minus(totalOriginal)),
    },
    byCustomer,
    byInvoiceSection,
    bySubscription,
    availableSubscriptions,
    lines: displayLines,
  };
}
