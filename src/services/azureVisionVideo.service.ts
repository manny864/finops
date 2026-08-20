/**
 * Service: Azure AI Vision & Video Indexer
 * Focus: Inventory, telemetry aggregation, unit economics, and FinOps optimization recommendations.
 */

import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import type {
  VisionVideoResource,
  VisionVideoSummary,
  VisionVideoDailyPoint,
  VisionVideoRemediationAction,
  VisionVideoPayload,
  VisionVideoServiceBreakdown,
} from "@/types/azureVisionVideo.types";

const SERVICE_COLORS: Record<string, string> = {
  "Computer Vision (OCR)": "#0078D4",
  "Video Indexer": "#2563EB",
  "Face API": "#0284C7",
  "Custom Vision": "#38BDF8",
  "AI Services (Multi-service)": "#94A3B8",
};

/**
 * Generates deterministic realistic synthetic mock data for demo tenants
 */
export function generateMockVisionVideoData(): VisionVideoPayload {
  const now = new Date();
  const dailyTrend: VisionVideoDailyPoint[] = [];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dailyTrend.push({
      date: d.toISOString().slice(0, 10),
      imagesK: Number((Math.random() * 8 + 4).toFixed(1)),
      videoMinutes: Math.round(Math.random() * 60 + 20),
      faceCallsK: Number((Math.random() * 2 + 0.5).toFixed(1)),
    });
  }

  const resources: VisionVideoResource[] = [
    {
      id: "/subscriptions/sub-001/resourceGroups/rg-ai-vision-prod/providers/Microsoft.CognitiveServices/accounts/cv-prod-eastus-01",
      name: "cv-prod-eastus-01",
      location: "East US",
      resourceGroup: "rg-ai-vision-prod",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      kind: "ComputerVision",
      skuName: "S0",
      imagesAnalyzed: 185_400,
      videoMinutesProcessed: 0,
      faceCallsCount: 0,
      trainingHours: 0,
      totalCostUSD: 463.5,
      isDevOrTest: false,
      isOrphan: false,
    },
    {
      id: "/subscriptions/sub-001/resourceGroups/rg-media-indexer/providers/Microsoft.VideoIndexer/accounts/vi-media-hub-prod",
      name: "vi-media-hub-prod",
      location: "East US 2",
      resourceGroup: "rg-media-indexer",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      kind: "VideoIndexer",
      skuName: "S0",
      imagesAnalyzed: 0,
      videoMinutesProcessed: 1_420,
      faceCallsCount: 0,
      trainingHours: 0,
      totalCostUSD: 213.0,
      isDevOrTest: false,
      isOrphan: false,
    },
    {
      id: "/subscriptions/sub-002/resourceGroups/rg-ai-dev/providers/Microsoft.CognitiveServices/accounts/cv-dev-westeurope",
      name: "cv-dev-westeurope",
      location: "West Europe",
      resourceGroup: "rg-ai-dev",
      subscriptionId: "sub-002",
      subscriptionName: "Desarrollo - Azure AI",
      kind: "ComputerVision",
      skuName: "S0",
      imagesAnalyzed: 420,
      videoMinutesProcessed: 0,
      faceCallsCount: 0,
      trainingHours: 0,
      totalCostUSD: 85.0,
      isDevOrTest: true,
      isOrphan: false,
    },
    {
      id: "/subscriptions/sub-001/resourceGroups/rg-security-biometrics/providers/Microsoft.CognitiveServices/accounts/face-auth-prod",
      name: "face-auth-prod",
      location: "East US",
      resourceGroup: "rg-security-biometrics",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      kind: "Face",
      skuName: "S0",
      imagesAnalyzed: 0,
      videoMinutesProcessed: 0,
      faceCallsCount: 38_500,
      trainingHours: 0,
      totalCostUSD: 57.75,
      isDevOrTest: false,
      isOrphan: false,
    },
    {
      id: "/subscriptions/sub-001/resourceGroups/rg-custom-models/providers/Microsoft.CognitiveServices/accounts/customvision-train-prod",
      name: "customvision-train-prod",
      location: "East US",
      resourceGroup: "rg-custom-models",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      kind: "CustomVision.Training",
      skuName: "S0",
      imagesAnalyzed: 0,
      videoMinutesProcessed: 0,
      faceCallsCount: 0,
      trainingHours: 14.5,
      totalCostUSD: 145.0,
      isDevOrTest: false,
      isOrphan: false,
    },
    {
      id: "/subscriptions/sub-002/resourceGroups/rg-ai-dev/providers/Microsoft.CognitiveServices/accounts/face-dev-test",
      name: "face-dev-test",
      location: "West Europe",
      resourceGroup: "rg-ai-dev",
      subscriptionId: "sub-002",
      subscriptionName: "Desarrollo - Azure AI",
      kind: "Face",
      skuName: "S0",
      imagesAnalyzed: 0,
      videoMinutesProcessed: 0,
      faceCallsCount: 150,
      trainingHours: 0,
      totalCostUSD: 45.0,
      isDevOrTest: true,
      isOrphan: true,
    },
  ];

  const summary = calculateVisionVideoSummary(resources);
  const remediationActions = generateVisionVideoRecommendations(resources);

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
 * Calculates summary metrics and breakdown by service
 */
export function calculateVisionVideoSummary(resources: VisionVideoResource[]): VisionVideoSummary {
  const totalCostUSD = Number(
    resources.reduce((sum, r) => sum + r.totalCostUSD, 0).toFixed(2)
  );
  const totalImages = resources.reduce((sum, r) => sum + r.imagesAnalyzed, 0);
  const totalVideoMinutes = resources.reduce((sum, r) => sum + r.videoMinutesProcessed, 0);
  const totalFaceCalls = resources.reduce((sum, r) => sum + r.faceCallsCount, 0);

  const serviceCosts: Record<string, number> = {};
  for (const r of resources) {
    let serviceName = "Computer Vision (OCR)";
    if (r.kind === "VideoIndexer") serviceName = "Video Indexer";
    else if (r.kind === "Face") serviceName = "Face API";
    else if (r.kind.startsWith("CustomVision")) serviceName = "Custom Vision";
    else if (r.kind === "AIServices") serviceName = "AI Services (Multi-service)";

    serviceCosts[serviceName] = (serviceCosts[serviceName] || 0) + r.totalCostUSD;
  }

  const breakdownByService: VisionVideoServiceBreakdown[] = Object.entries(serviceCosts)
    .map(([serviceName, cost]) => ({
      serviceName,
      costUSD: Number(cost.toFixed(2)),
      percentage: totalCostUSD > 0 ? Number(((cost / totalCostUSD) * 100).toFixed(1)) : 0,
      color: SERVICE_COLORS[serviceName] || "#0078D4",
    }))
    .sort((a, b) => b.costUSD - a.costUSD);

  const recommendations = generateVisionVideoRecommendations(resources);
  const potentialSavingsUSD = Number(
    recommendations.reduce((sum, a) => sum + a.estimatedSavingsUSD, 0).toFixed(2)
  );

  return {
    totalCostUSD,
    totalImages,
    totalVideoMinutes,
    totalFaceCalls,
    potentialSavingsUSD,
    breakdownByService,
  };
}

/**
 * Generates FinOps remediation recommendations based on capacity rules
 */
export function generateVisionVideoRecommendations(
  resources: VisionVideoResource[]
): VisionVideoRemediationAction[] {
  const actions: VisionVideoRemediationAction[] = [];

  for (const r of resources) {
    // Regla 1: Dev F0 Downgrade
    if (
      r.isDevOrTest &&
      r.skuName === "S0" &&
      (r.imagesAnalyzed < 1000 || r.faceCallsCount < 1000)
    ) {
      const savings = Number(r.totalCostUSD.toFixed(2));
      actions.push({
        id: `rec-f0-${r.name}`,
        resourceId: r.id,
        title: `Downgrade a Free Tier F0 en '${r.name}'`,
        description: `La cuenta '${r.name}' en entorno de desarrollo está en tier Standard (S0) pero procesa muy bajo volumen (< 1,000 transacciones/mes). Cambiar al tier gratuito F0 (20 llamadas/minuto, 5K llamadas/mes) reduce el costo base a $0.00 USD/mes.`,
        category: "DEV_F0_DOWNGRADE",
        estimatedSavingsUSD: savings,
        confidence: "HIGH",
        actionType: "DOWNGRADE_SKU_F0",
        commandPayload: `az cognitiveservices account update --name "${r.name}" --resource-group "${r.resourceGroup}" --sku "F0"`,
      });
    }

    // Regla 2: Optimización de Presets en Video Indexer
    if (r.kind === "VideoIndexer" && r.videoMinutesProcessed > 500) {
      // 60% savings by using audio-only or optimized preset
      const savings = Number((r.totalCostUSD * 0.45).toFixed(2));
      actions.push({
        id: `rec-video-preset-${r.name}`,
        resourceId: r.id,
        title: `Optimización de Preset en Video Indexer '${r.name}'`,
        description: `Se detectaron ${r.videoMinutesProcessed} minutos indexados con preset completo (Video+Audio). Para cargas de trabajo que solo requieren transcripción y traducción de voz, configurar el preset 'AudioOnly' o 'BasicVideo' ahorra hasta un 45% del costo por minuto indexado.`,
        category: "VIDEO_PRESET_OPTIMIZE",
        estimatedSavingsUSD: savings,
        confidence: "HIGH",
        actionType: "OPTIMIZE_VIDEO_PRESET",
        commandPayload: `# Configurar preset AudioOnly en Azure Video Indexer API\n# POST https://api.videoindexer.ai/{location}/Accounts/{accountId}/Videos?indexingPreset=AudioOnly`,
      });
    }

    // Regla 3: Batch vs Realtime en Computer Vision
    if (r.kind === "ComputerVision" && r.imagesAnalyzed > 50_000) {
      const savings = Number((r.totalCostUSD * 0.25).toFixed(2));
      actions.push({
        id: `rec-batch-${r.name}`,
        resourceId: r.id,
        title: `Implementación de Batch OCR API en '${r.name}'`,
        description: `La cuenta '${r.name}' procesa más de ${r.imagesAnalyzed.toLocaleString()} imágenes en llamadas síncronas individuales. Implementar Azure Computer Vision Batch Read API o Storage Queue batching reduce la sobrecarga de concurrencia y optimiza la tasa de procesamiento por volumen.`,
        category: "BATCH_PROCESSING",
        estimatedSavingsUSD: savings,
        confidence: "MEDIUM",
        actionType: "ENABLE_BATCH_OCR",
        commandPayload: `# Utilizar Image Analysis 4.0 Batch API\n# POST https://${r.name}.cognitiveservices.azure.com/computervision/imageanalysis:analyze?api-version=2024-02-01`,
      });
    }

    // Regla 4: Cuentas Huérfanas / Inactivas
    if (r.isOrphan) {
      const savings = Number(r.totalCostUSD.toFixed(2));
      actions.push({
        id: `rec-orphan-${r.name}`,
        resourceId: r.id,
        title: `Eliminar cuenta huérfana / sin uso '${r.name}'`,
        description: `La cuenta '${r.name}' en el grupo '${r.resourceGroup}' no registra consumo productivo en el ciclo actual pero genera cargos fijos o de infraestructura.`,
        category: "ORPHAN_ACCOUNT",
        estimatedSavingsUSD: savings,
        confidence: "HIGH",
        actionType: "DELETE_ORPHAN_ACCOUNT",
        commandPayload: `az cognitiveservices account delete --name "${r.name}" --resource-group "${r.resourceGroup}"`,
      });
    }
  }

  return actions.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

/**
 * Builds PowerShell and Azure CLI remediation scripts
 */
export function buildVisionRemediationCommand(action: VisionVideoRemediationAction): {
  cli: string;
  powershell: string;
} {
  if (action.category === "DEV_F0_DOWNGRADE") {
    return {
      cli: action.commandPayload || `az cognitiveservices account update --name "recurso" --resource-group "rg" --sku "F0"`,
      powershell: `Update-AzCognitiveServicesAccount -ResourceGroupName "rg" -Name "recurso" -SkuName "F0"`,
    };
  }
  if (action.category === "ORPHAN_ACCOUNT") {
    return {
      cli: action.commandPayload || `az cognitiveservices account delete --name "recurso" --resource-group "rg"`,
      powershell: `Remove-AzCognitiveServicesAccount -ResourceGroupName "rg" -Name "recurso" -Force`,
    };
  }
  return {
    cli: action.commandPayload || `# Revisar configuración en portal.azure.com`,
    powershell: `# Revisar configuración de Azure Video Indexer / Computer Vision`,
  };
}

/**
 * Queries live Azure Resource Graph for Vision and Video accounts
 */
export async function getLiveVisionVideoData(
  tenantId: string
): Promise<VisionVideoPayload> {
  const query = `
    resources
    | where type in~ ('microsoft.cognitiveservices/accounts', 'microsoft.videoindexer/accounts')
    | where kind in~ ('ComputerVision', 'Face', 'CustomVision.Training', 'CustomVision.Prediction', 'AIServices') or type =~ 'microsoft.videoindexer/accounts'
    | project
        id,
        name,
        location,
        resourceGroup,
        subscriptionId,
        kind = coalesce(kind, 'VideoIndexer'),
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
          totalImages: 0,
          totalVideoMinutes: 0,
          totalFaceCalls: 0,
          potentialSavingsUSD: 0,
          breakdownByService: [],
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
          totalImages: 0,
          totalVideoMinutes: 0,
          totalFaceCalls: 0,
          potentialSavingsUSD: 0,
          breakdownByService: [],
        },
        resources: [],
        dailyTrend: [],
        remediationActions: [],
        lastUpdated: new Date().toISOString(),
        source: "live",
      };
    }

    const resources: VisionVideoResource[] = rawResults.map((row: any) => {
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
        kind: row.kind as any,
        skuName: (row.skuName || "S0") as any,
        imagesAnalyzed: 0,
        videoMinutesProcessed: 0,
        faceCallsCount: 0,
        trainingHours: 0,
        totalCostUSD: 0,
        isDevOrTest,
        isOrphan: false,
      };
    });

    const summary = calculateVisionVideoSummary(resources);
    const remediationActions = generateVisionVideoRecommendations(resources);

    return {
      summary,
      resources,
      dailyTrend: [],
      remediationActions,
      lastUpdated: new Date().toISOString(),
      source: "live",
    };
  } catch (err) {
    console.warn("[azureVisionVideo.service] Error querying ARG:", err);
    return {
      summary: {
        totalCostUSD: 0,
        totalImages: 0,
        totalVideoMinutes: 0,
        totalFaceCalls: 0,
        potentialSavingsUSD: 0,
        breakdownByService: [],
      },
      resources: [],
      dailyTrend: [],
      remediationActions: [],
      lastUpdated: new Date().toISOString(),
      source: "live",
    };
  }
}
