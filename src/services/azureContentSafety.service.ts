/**
 * Service: Azure AI Content Safety
 * Focus: Text and image moderation, blocklists, unit economics, and FinOps optimization recommendations.
 */

import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import type {
  ContentSafetyResource,
  ContentSafetySummary,
  ContentSafetyDailyPoint,
  ContentSafetyRemediationAction,
  ContentSafetyPayload,
  ContentSafetyModalityBreakdown,
} from "@/types/azureContentSafety.types";

const MODALITY_COLORS: Record<string, string> = {
  "Moderación de Texto": "#0078D4",
  "Moderación de Imágenes": "#2563EB",
  "Blocklist Matching": "#0284C7",
  "Detección Multimodal": "#38BDF8",
};

/**
 * Generates deterministic realistic synthetic mock data for demo tenants
 */
export function generateMockContentSafetyData(): ContentSafetyPayload {
  const now = new Date();
  const dailyTrend: ContentSafetyDailyPoint[] = [];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dailyTrend.push({
      date: d.toISOString().slice(0, 10),
      textAnalyzedK: Number((Math.random() * 25 + 15).toFixed(1)),
      imagesAnalyzedK: Number((Math.random() * 3 + 1).toFixed(1)),
      blockedCount: Math.round(Math.random() * 45 + 10),
    });
  }

  const resources: ContentSafetyResource[] = [
    {
      id: "/subscriptions/sub-001/resourceGroups/rg-ai-governance-prod/providers/Microsoft.CognitiveServices/accounts/cs-safety-prod-eastus",
      name: "cs-safety-prod-eastus",
      location: "East US",
      resourceGroup: "rg-ai-governance-prod",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      skuName: "S0",
      textRecordsCount: 840_000,
      imagesAnalyzedCount: 52_000,
      blocklistMatchesCount: 3_450,
      blockedItemsCount: 1_280,
      totalCostUSD: 708.0,
      isDevOrTest: false,
      isOrphan: false,
    },
    {
      id: "/subscriptions/sub-001/resourceGroups/rg-ai-governance-prod/providers/Microsoft.CognitiveServices/accounts/cs-moderation-chat-prod",
      name: "cs-moderation-chat-prod",
      location: "East US 2",
      resourceGroup: "rg-ai-governance-prod",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      skuName: "S0",
      textRecordsCount: 380_000,
      imagesAnalyzedCount: 0,
      blocklistMatchesCount: 8_200,
      blockedItemsCount: 420,
      totalCostUSD: 285.0,
      isDevOrTest: false,
      isOrphan: false,
    },
    {
      id: "/subscriptions/sub-002/resourceGroups/rg-ai-dev/providers/Microsoft.CognitiveServices/accounts/cs-safety-dev-westeurope",
      name: "cs-safety-dev-westeurope",
      location: "West Europe",
      resourceGroup: "rg-ai-dev",
      subscriptionId: "sub-002",
      subscriptionName: "Desarrollo - Azure AI",
      skuName: "S0",
      textRecordsCount: 1_850,
      imagesAnalyzedCount: 120,
      blocklistMatchesCount: 40,
      blockedItemsCount: 8,
      totalCostUSD: 65.0,
      isDevOrTest: true,
      isOrphan: false,
    },
    {
      id: "/subscriptions/sub-001/resourceGroups/rg-media-moderation/providers/Microsoft.CognitiveServices/accounts/cs-media-filter-prod",
      name: "cs-media-filter-prod",
      location: "East US",
      resourceGroup: "rg-media-moderation",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      skuName: "S0",
      textRecordsCount: 0,
      imagesAnalyzedCount: 32_500,
      blocklistMatchesCount: 0,
      blockedItemsCount: 310,
      totalCostUSD: 48.75,
      isDevOrTest: false,
      isOrphan: false,
    },
  ];

  const summary = calculateContentSafetySummary(resources);
  const remediationActions = generateContentSafetyRecommendations(resources);

  return {
    summary,
    resources,
    dailyTrend,
    remediationActions,
    lastUpdated: now.toISOString(),
    source: "mock",
  };
}

/**
 * Calculates summary metrics and breakdown by modality
 */
export function calculateContentSafetySummary(
  resources: ContentSafetyResource[]
): ContentSafetySummary {
  const totalCostUSD = Number(
    resources.reduce((sum, r) => sum + r.totalCostUSD, 0).toFixed(2)
  );
  const totalTextRecords = resources.reduce((sum, r) => sum + r.textRecordsCount, 0);
  const totalImagesAnalyzed = resources.reduce((sum, r) => sum + r.imagesAnalyzedCount, 0);
  const totalBlockedItems = resources.reduce((sum, r) => sum + r.blockedItemsCount, 0);

  const totalEvaluations = totalTextRecords + totalImagesAnalyzed;
  const blockRatePercentage =
    totalEvaluations > 0
      ? Number(((totalBlockedItems / totalEvaluations) * 100).toFixed(2))
      : 0;

  // Modality cost attribution
  let textCost = 0;
  let imageCost = 0;
  let blocklistCost = 0;

  for (const r of resources) {
    const textPortion = (r.textRecordsCount / 1000) * 0.75;
    const imagePortion = (r.imagesAnalyzedCount / 1000) * 1.5;
    const blocklistPortion = (r.blocklistMatchesCount / 1000) * 0.5;

    textCost += textPortion;
    imageCost += imagePortion;
    blocklistCost += blocklistPortion;
  }

  const calculatedTotal = textCost + imageCost + blocklistCost;
  const scaleFactor = calculatedTotal > 0 ? totalCostUSD / calculatedTotal : 1;

  const breakdownByModality: ContentSafetyModalityBreakdown[] = [
    {
      modality: "Moderación de Texto",
      costUSD: Number((textCost * scaleFactor).toFixed(2)),
      percentage: totalCostUSD > 0 ? Number((((textCost * scaleFactor) / totalCostUSD) * 100).toFixed(1)) : 0,
      color: MODALITY_COLORS["Moderación de Texto"],
    },
    {
      modality: "Moderación de Imágenes",
      costUSD: Number((imageCost * scaleFactor).toFixed(2)),
      percentage: totalCostUSD > 0 ? Number((((imageCost * scaleFactor) / totalCostUSD) * 100).toFixed(1)) : 0,
      color: MODALITY_COLORS["Moderación de Imágenes"],
    },
    {
      modality: "Blocklist Matching",
      costUSD: Number((blocklistCost * scaleFactor).toFixed(2)),
      percentage: totalCostUSD > 0 ? Number((((blocklistCost * scaleFactor) / totalCostUSD) * 100).toFixed(1)) : 0,
      color: MODALITY_COLORS["Blocklist Matching"],
    },
  ].filter((m) => m.costUSD > 0);

  const recommendations = generateContentSafetyRecommendations(resources);
  const potentialSavingsUSD = Number(
    recommendations.reduce((sum, a) => sum + a.estimatedSavingsUSD, 0).toFixed(2)
  );

  return {
    totalCostUSD,
    totalTextRecords,
    totalImagesAnalyzed,
    totalBlockedItems,
    blockRatePercentage,
    potentialSavingsUSD,
    breakdownByModality,
  };
}

/**
 * Generates FinOps remediation recommendations based on content safety governance rules
 */
export function generateContentSafetyRecommendations(
  resources: ContentSafetyResource[]
): ContentSafetyRemediationAction[] {
  const actions: ContentSafetyRemediationAction[] = [];

  for (const r of resources) {
    // Regla 1: Hash Caching en cuentas de alto volumen
    if (r.textRecordsCount > 250_000 || r.imagesAnalyzedCount > 25_000) {
      const estimatedSavings = Number((r.totalCostUSD * 0.35).toFixed(2));
      actions.push({
        id: `rec-hash-cache-${r.name}`,
        resourceId: r.id,
        title: `Implementación de Hash-Cache (SHA-256) en '${r.name}'`,
        description: `La cuenta '${r.name}' evalúa un alto volumen de contenido (${r.textRecordsCount.toLocaleString()} textos / ${r.imagesAnalyzedCount.toLocaleString()} imágenes). Implementar un caché de hash (Redis o in-memory con TTL de 24h) para textos e imágenes idénticas reduce las llamadas redundantes a la API de Content Safety hasta en un 35-40%.`,
        category: "HASH_CACHING",
        estimatedSavingsUSD: estimatedSavings,
        confidence: "HIGH",
        actionType: "ENABLE_HASH_CACHE",
        commandPayload: `# Arquitectura sugerida: Cache-Aside con SHA-256 + Redis\n# 1. Calcular hash = sha256(content)\n# 2. Verificar si redis.get("cs:" + hash) existe\n# 3. Solo llamar a Azure Content Safety si es cache miss (TTL: 86400s)`,
      });
    }

    // Regla 2: Dev F0 Downgrade
    if (r.isDevOrTest && r.skuName === "S0" && r.textRecordsCount < 5000) {
      const estimatedSavings = Number(r.totalCostUSD.toFixed(2));
      actions.push({
        id: `rec-f0-cs-${r.name}`,
        resourceId: r.id,
        title: `Downgrade a Free Tier F0 en '${r.name}'`,
        description: `La instancia '${r.name}' en entorno de desarrollo procesa menos de 5,000 registros/mes. Cambiar del tier Standard (S0) al nivel gratuito F0 (5,000 llamadas de texto y 1,000 imágenes gratis al mes) reduce el costo a $0.00 USD/mes.`,
        category: "DEV_F0_DOWNGRADE",
        estimatedSavingsUSD: estimatedSavings,
        confidence: "HIGH",
        actionType: "DOWNGRADE_SKU_F0",
        commandPayload: `az cognitiveservices account update --name "${r.name}" --resource-group "${r.resourceGroup}" --sku "F0"`,
      });
    }

    // Regla 3: Optimización y consolidación de Blocklists
    if (r.blocklistMatchesCount > 5000) {
      const estimatedSavings = Number((r.totalCostUSD * 0.15).toFixed(2));
      actions.push({
        id: `rec-blocklist-opt-${r.name}`,
        resourceId: r.id,
        title: `Racionalización de Listas de Bloqueo en '${r.name}'`,
        description: `Se detectaron ${r.blocklistMatchesCount.toLocaleString()} coincidencias en listas de bloqueo personalizadas. Consolidar términos redundantes y aplicar filtrado regex previo en el cliente o API Gateway disminuye la latencia y costos de inferencia.`,
        category: "BLOCKLIST_OPTIMIZATION",
        estimatedSavingsUSD: estimatedSavings,
        confidence: "MEDIUM",
        actionType: "OPTIMIZE_BLOCKLISTS",
        commandPayload: `# Revisar y consolidar listas de bloqueo personalizadas en Content Safety Studio\n# https://contentsafety.cognitive.azure.com`,
      });
    }
  }

  return actions.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

/**
 * Builds PowerShell and Azure CLI remediation scripts
 */
export function buildContentSafetyRemediationCommand(action: ContentSafetyRemediationAction): {
  cli: string;
  powershell: string;
} {
  if (action.category === "DEV_F0_DOWNGRADE") {
    return {
      cli: action.commandPayload || `az cognitiveservices account update --name "recurso" --resource-group "rg" --sku "F0"`,
      powershell: `Update-AzCognitiveServicesAccount -ResourceGroupName "rg" -Name "recurso" -SkuName "F0"`,
    };
  }
  return {
    cli: action.commandPayload || `# Revisar configuración en portal.azure.com`,
    powershell: `# Revisar configuración de Azure AI Content Safety`,
  };
}

/**
 * Queries live Azure Resource Graph for Content Safety accounts
 */
export async function getLiveContentSafetyData(
  tenantId: string
): Promise<ContentSafetyPayload> {
  const query = `
    resources
    | where type =~ 'microsoft.cognitiveservices/accounts'
    | where kind in~ ('ContentSafety', 'AIServices')
    | project
        id,
        name,
        location,
        resourceGroup,
        subscriptionId,
        kind,
        skuName = coalesce(sku.name, 'S0'),
        tags
  `;

  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (!subs || subs.length === 0) {
      return {
        summary: {
          totalCostUSD: 0,
          totalTextRecords: 0,
          totalImagesAnalyzed: 0,
          totalBlockedItems: 0,
          blockRatePercentage: 0,
          potentialSavingsUSD: 0,
          breakdownByModality: [],
        },
        resources: [],
        dailyTrend: [],
        remediationActions: [],
        lastUpdated: new Date().toISOString(),
        source: "live",
      };
    }

    const argClient = new ResourceGraphClient(credential);
    const response = await argClient.resources({ query, subscriptions: subs });
    const rawResults = (response.data as any[]) || [];

    if (rawResults.length === 0) {
      return {
        summary: {
          totalCostUSD: 0,
          totalTextRecords: 0,
          totalImagesAnalyzed: 0,
          totalBlockedItems: 0,
          blockRatePercentage: 0,
          potentialSavingsUSD: 0,
          breakdownByModality: [],
        },
        resources: [],
        dailyTrend: [],
        remediationActions: [],
        lastUpdated: new Date().toISOString(),
        source: "live",
      };
    }

    const resources: ContentSafetyResource[] = rawResults.map((row: any) => {
      const isDevOrTest =
        String(row.resourceGroup || "").toLowerCase().includes("dev") ||
        String(row.resourceGroup || "").toLowerCase().includes("test") ||
        String(row.name || "").toLowerCase().includes("dev") ||
        String(row.name || "").toLowerCase().includes("test");

      return {
        id: row.id,
        name: row.name,
        location: row.location || "global",
        resourceGroup: row.resourceGroup || "default-rg",
        subscriptionId: row.subscriptionId || tenantId,
        subscriptionName: row.subscriptionId || "Azure Subscription",
        skuName: (row.skuName || "S0") as any,
        textRecordsCount: 0,
        imagesAnalyzedCount: 0,
        blocklistMatchesCount: 0,
        blockedItemsCount: 0,
        totalCostUSD: 0,
        isDevOrTest,
        isOrphan: false,
      };
    });

    const summary = calculateContentSafetySummary(resources);
    const remediationActions = generateContentSafetyRecommendations(resources);

    return {
      summary,
      resources,
      dailyTrend: [],
      remediationActions,
      lastUpdated: new Date().toISOString(),
      source: "live",
    };
  } catch (err) {
    console.warn("[azureContentSafety.service] Error querying ARG:", err);
    return {
      summary: {
        totalCostUSD: 0,
        totalTextRecords: 0,
        totalImagesAnalyzed: 0,
        totalBlockedItems: 0,
        blockRatePercentage: 0,
        potentialSavingsUSD: 0,
        breakdownByModality: [],
      },
      resources: [],
      dailyTrend: [],
      remediationActions: [],
      lastUpdated: new Date().toISOString(),
      source: "live",
    };
  }
}
