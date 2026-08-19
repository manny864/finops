import { Decimal } from "decimal.js";
import type {
  DocIntelligenceRemediationAction,
  DocIntelligenceResource,
} from "@/types/azureDocumentIntelligence.types";

const BASIC_F0_PAGE_LIMIT = 500;

export function buildDocIntelligenceRemediations(
  resources: DocIntelligenceResource[]
): DocIntelligenceRemediationAction[] {
  const actions: DocIntelligenceRemediationAction[] = [];
  const totalPages = resources.reduce((sum, resource) => sum + resource.totalPagesProcessed, 0);
  const totalCost = resources.reduce(
    (sum, resource) => sum.plus(resource.totalCostUSD),
    new Decimal(0)
  );

  for (const resource of resources) {
    if (resource.isOrphan && resource.totalCostUSD > 0) {
      actions.push({
        id: `doc-orphan-${resource.id}`,
        resourceId: resource.id,
        title: `Revisar cuenta sin consumo ${resource.name}`,
        description: "La cuenta no registró páginas ni llamadas en el período seleccionado.",
        category: "ORPHAN_ACCOUNT",
        estimatedSavingsUSD: resource.totalCostUSD,
        confidence: "HIGH",
        actionType: "review_or_delete",
      });
    }

    if (
      resource.customPages > 0 &&
      /invoice|receipt|id|layout|read/i.test(resource.primaryModelType)
    ) {
      const customInference = new Decimal(resource.inferenceCostUSD);
      const estimatedSavings = customInference.times("0.70");
      actions.push({
        id: `doc-arbitrage-${resource.id}`,
        resourceId: resource.id,
        title: `Migrar ${resource.name} a un modelo Prebuilt`,
        description: "El modelo custom procesa documentos estándar compatibles con Invoice, Receipt, ID, Read o Layout.",
        category: "MODEL_ARBITRAGE",
        estimatedSavingsUSD: estimatedSavings.toDecimalPlaces(2).toNumber(),
        confidence: "HIGH",
        actionType: "model_arbitrage",
      });
    }

    if (
      resource.skuName === "S0" &&
      resource.isDevOrTest &&
      resource.totalPagesProcessed < BASIC_F0_PAGE_LIMIT
    ) {
      actions.push({
        id: `doc-f0-${resource.id}`,
        resourceId: resource.id,
        title: `Evaluar F0 para ${resource.name}`,
        description: `La cuenta no productiva procesó ${resource.totalPagesProcessed} páginas, por debajo del umbral de 500 páginas/mes.`,
        category: "DEV_F0_DOWNGRADE",
        estimatedSavingsUSD: resource.totalCostUSD,
        confidence: "HIGH",
        actionType: "sku_change",
        commandPayload: `az cognitiveservices account update --name "${resource.name}" --resource-group "${resource.resourceGroup}" --sku F0`,
      });
    }
  }

  if (totalPages > 50000 && totalCost.gt(0)) {
    actions.push({
      id: "doc-commitment-tier",
      resourceId: "all",
      title: "Evaluar Commitment Tier de Document Intelligence",
      description: `${totalPages.toLocaleString()} páginas consolidadas superan el umbral de 50.000 páginas/mes en PAYG.`,
      category: "COMMITMENT_TIER",
      estimatedSavingsUSD: totalCost.times("0.40").toDecimalPlaces(2).toNumber(),
      confidence: "MEDIUM",
      actionType: "commitment_simulation",
    });
  }

  return actions.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

export function calculateDocIntelligencePotentialSavings(
  actions: DocIntelligenceRemediationAction[]
): number {
  const perResource = new Map<string, Decimal>();
  let commitment = new Decimal(0);
  for (const action of actions) {
    const savings = new Decimal(action.estimatedSavingsUSD || 0);
    if (action.category === "COMMITMENT_TIER") {
      commitment = Decimal.max(commitment, savings);
      continue;
    }
    const current = perResource.get(action.resourceId) || new Decimal(0);
    perResource.set(action.resourceId, Decimal.max(current, savings));
  }
  const resourceTotal = Array.from(perResource.values()).reduce(
    (sum, value) => sum.plus(value),
    new Decimal(0)
  );
  return Decimal.max(commitment, resourceTotal).toDecimalPlaces(2).toNumber();
}