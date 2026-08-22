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

/**
 * Regla de excepción de margen resuelta para el cálculo. `scopeValue` se compara
 * contra el `subscriptionId` o el `service` de cada línea según `scopeType`.
 */
export interface MarkupOverride {
  scopeType: "SUBSCRIPTION" | "SERVICE_CATEGORY";
  scopeValue: string;
  overridePercentage: number;
}

/**
 * Elige el porcentaje aplicable a una línea. Una regla por suscripción gana
 * sobre una por categoría de servicio: es el alcance más específico, y si
 * ganara la categoría no habría forma de eximir una suscripción puntual.
 */
function resolveLinePercent(
  line: { subscriptionId: string | null; service: string | null },
  globalPercent: Decimal,
  overrides: MarkupOverride[]
): Decimal {
  const bySub = overrides.find(
    (o) => o.scopeType === "SUBSCRIPTION" && o.scopeValue === line.subscriptionId
  );
  if (bySub) return new Decimal(bySub.overridePercentage);

  const byService = overrides.find(
    (o) =>
      o.scopeType === "SERVICE_CATEGORY" &&
      o.scopeValue.toLowerCase() === String(line.service || "").toLowerCase()
  );
  if (byService) return new Decimal(byService.overridePercentage);

  return globalPercent;
}

export function buildInvoicingPayload(params: {
  rows: RawInvoicingRow[];
  markupPercent: number;
  period: string;
  availableSubscriptions: AvailableSubscription[];
  subNameMap: Map<string, string>;
  /** Tarifa fija mensual de gestión. Se suma al total, no se prorratea por línea. */
  fixedFeeUSD?: number;
  /** Excepciones por suscripción o categoría de servicio. */
  overrides?: MarkupOverride[];
}) {
  const {
    rows,
    markupPercent,
    period,
    availableSubscriptions,
    subNameMap,
    fixedFeeUSD = 0,
    overrides = [],
  } = params;
  const globalPercent = new Decimal(markupPercent);

  const lines = rows.map((r) => {
    const original = new Decimal(r.originalCost || 0);
    // El porcentaje se resuelve por línea: una excepción puede eximir una
    // suscripción o un servicio del margen global (típicamente Marketplace).
    const linePercent = resolveLinePercent(
      { subscriptionId: r.subscriptionId, service: r.service },
      globalPercent,
      overrides
    );
    const multiplier = new Decimal(1).plus(linePercent.dividedBy(100));
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

  const fixedFee = new Decimal(fixedFeeUSD || 0);

  return {
    success: true,
    mock: false,
    period,
    markupPercent,
    fixedFeeUSD: toMoneyNumber(fixedFee),
    currency: "USD",
    // `adjustedCost` es la suma exacta de las líneas (markup incluido) y NO
    // incorpora la tarifa fija: prorratearla por línea exigiría un criterio de
    // reparto arbitrario, y sumarla sólo al total rompería la comprobación
    // "suma de líneas = total". Se expone aparte y `totalBilledCost` es lo que
    // se le cobra al cliente.
    totals: {
      originalCost: toMoneyNumber(totalOriginal),
      adjustedCost: toMoneyNumber(totalAdjusted),
      markupAmount: toMoneyNumber(totalAdjusted.minus(totalOriginal)),
      fixedFeeAmount: toMoneyNumber(fixedFee),
      totalBilledCost: toMoneyNumber(totalAdjusted.plus(fixedFee)),
    },
    byCustomer,
    byInvoiceSection,
    bySubscription,
    availableSubscriptions,
    lines: displayLines,
  };
}
