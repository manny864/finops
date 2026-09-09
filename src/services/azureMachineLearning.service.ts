/**
 * Service: Azure Machine Learning (AML) MLOps FinOps
 * Focus: Workspaces, Compute Instances, Training Clusters, Online Endpoints, Spot optimization and idle leak elimination.
 */

import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import type {
  AmlComputeResource,
  AmlSummaryMetrics,
  AmlDailyPoint,
  AmlRemediationAction,
  AmlPayload,
  AmlComputeTypeBreakdown,
} from "@/types/azureMachineLearning.types";

const COMPUTE_COLORS: Record<string, string> = {
  "Compute Instances (Notebooks)": "#0078D4",
  "Training Clusters (AmlCompute)": "#2563EB",
  "Managed Online Endpoints": "#0284C7",
  "Serverless Compute & Pipelines": "#38BDF8",
};

/**
 * Generates deterministic realistic synthetic mock data for demo tenants
 */
export function generateMockAmlData(): AmlPayload {
  const now = new Date();
  const dailyTrend: AmlDailyPoint[] = [];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dailyTrend.push({
      date: d.toISOString().slice(0, 10),
      computeHours: Number((Math.random() * 45 + 20).toFixed(1)),
      avgCpuPercent: Math.round(Math.random() * 35 + 15),
      activeNodes: Math.round(Math.random() * 8 + 3),
    });
  }

  const resources: AmlComputeResource[] = [
    {
      id: "/subscriptions/sub-001/resourceGroups/rg-mlops-prod/providers/Microsoft.MachineLearningServices/workspaces/aml-workspace-prod/computes/ci-data-science-01",
      name: "ci-data-science-01",
      location: "East US",
      resourceGroup: "rg-mlops-prod",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      computeType: "ComputeInstance",
      vmSize: "Standard_DS3_v2 (4 vCPUs, 14 GiB RAM)",
      state: "Running",
      minNodes: 1,
      maxNodes: 1,
      currentNodes: 1,
      hasAutoShutdownSchedule: false,
      avgCpuPercentage: 12.4,
      monthlyCostUSD: 168.0,
      isWasteful: true,
    },
    {
      id: "/subscriptions/sub-001/resourceGroups/rg-mlops-prod/providers/Microsoft.MachineLearningServices/workspaces/aml-workspace-prod/computes/gpu-cluster-training",
      name: "gpu-cluster-training",
      location: "East US",
      resourceGroup: "rg-mlops-prod",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      computeType: "AmlComputeCluster",
      vmSize: "Standard_NC6s_v3 (6 vCPUs, 112 GiB, 1x V100 GPU)",
      state: "Idle",
      minNodes: 2,
      maxNodes: 8,
      currentNodes: 2,
      hasAutoShutdownSchedule: false,
      avgCpuPercentage: 4.2,
      avgGpuPercentage: 0.0,
      monthlyCostUSD: 1_872.0,
      isWasteful: true,
    },
    {
      id: "/subscriptions/sub-001/resourceGroups/rg-mlops-prod/providers/Microsoft.MachineLearningServices/workspaces/aml-workspace-prod/onlineEndpoints/endpoint-fraud-detection",
      name: "endpoint-fraud-detection",
      location: "East US",
      resourceGroup: "rg-mlops-prod",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      computeType: "OnlineEndpoint",
      vmSize: "Standard_F4s_v2 (4 vCPUs, 8 GiB RAM)",
      state: "Running",
      minNodes: 2,
      maxNodes: 4,
      currentNodes: 2,
      hasAutoShutdownSchedule: false,
      avgCpuPercentage: 8.5,
      monthlyCostUSD: 345.6,
      isWasteful: false,
    },
    {
      id: "/subscriptions/sub-002/resourceGroups/rg-ml-dev/providers/Microsoft.MachineLearningServices/workspaces/aml-workspace-dev/computes/ci-dev-nlp",
      name: "ci-dev-nlp",
      location: "West Europe",
      resourceGroup: "rg-ml-dev",
      subscriptionId: "sub-002",
      subscriptionName: "Desarrollo - Azure AI",
      computeType: "ComputeInstance",
      vmSize: "Standard_E4s_v5 (4 vCPUs, 32 GiB RAM)",
      state: "Stopped",
      minNodes: 1,
      maxNodes: 1,
      currentNodes: 0,
      hasAutoShutdownSchedule: true,
      autoShutdownTime: "19:00 UTC",
      avgCpuPercentage: 42.0,
      monthlyCostUSD: 45.0,
      isWasteful: false,
    },
    {
      id: "/subscriptions/sub-002/resourceGroups/rg-ml-dev/providers/Microsoft.MachineLearningServices/workspaces/aml-workspace-dev/computes/cpu-cluster-batch",
      name: "cpu-cluster-batch",
      location: "West Europe",
      resourceGroup: "rg-ml-dev",
      subscriptionId: "sub-002",
      subscriptionName: "Desarrollo - Azure AI",
      computeType: "AmlComputeCluster",
      vmSize: "Standard_D4s_v5 (4 vCPUs, 16 GiB RAM)",
      state: "Idle",
      minNodes: 0,
      maxNodes: 6,
      currentNodes: 0,
      hasAutoShutdownSchedule: false,
      avgCpuPercentage: 0.0,
      monthlyCostUSD: 85.0,
      isWasteful: false,
    },
  ];

  const summary = calculateAmlSummary(resources);
  const remediationActions = generateAmlRecommendations(resources);

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
 * Calculates summary metrics and breakdown by compute type
 */
export function calculateAmlSummary(resources: AmlComputeResource[]): AmlSummaryMetrics {
  const totalMonthlyCostUSD = Number(
    resources.reduce((sum, r) => sum + r.monthlyCostUSD, 0).toFixed(2)
  );
  const computeInstancesCount = resources.filter((r) => r.computeType === "ComputeInstance").length;
  const activeTrainingClustersCount = resources.filter(
    (r) => r.computeType === "AmlComputeCluster"
  ).length;
  const onlineEndpointsCount = resources.filter((r) => r.computeType === "OnlineEndpoint").length;

  const idleNodesCount = resources
    .filter((r) => r.state === "Idle" || (r.computeType === "AmlComputeCluster" && r.minNodes > 0))
    .reduce((sum, r) => sum + r.currentNodes, 0);

  const typeCosts: Record<string, number> = {};
  for (const r of resources) {
    let typeName = "Compute Instances (Notebooks)";
    if (r.computeType === "AmlComputeCluster") typeName = "Training Clusters (AmlCompute)";
    else if (r.computeType === "OnlineEndpoint") typeName = "Managed Online Endpoints";
    else if (r.computeType === "Serverless") typeName = "Serverless Compute & Pipelines";

    typeCosts[typeName] = (typeCosts[typeName] || 0) + r.monthlyCostUSD;
  }

  const breakdownByComputeType: AmlComputeTypeBreakdown[] = Object.entries(typeCosts)
    .map(([type, cost]) => ({
      type,
      costUSD: Number(cost.toFixed(2)),
      percentage: totalMonthlyCostUSD > 0 ? Number(((cost / totalMonthlyCostUSD) * 100).toFixed(1)) : 0,
      color: COMPUTE_COLORS[type] || "#0078D4",
    }))
    .sort((a, b) => b.costUSD - a.costUSD);

  const recommendations = generateAmlRecommendations(resources);
  const potentialSavingsUSD = Number(
    recommendations.reduce((sum, a) => sum + a.estimatedSavingsUSD, 0).toFixed(2)
  );

  return {
    totalMonthlyCostUSD,
    computeInstancesCount,
    activeTrainingClustersCount,
    onlineEndpointsCount,
    idleNodesCount,
    potentialSavingsUSD,
    breakdownByComputeType,
  };
}

/**
 * Generates FinOps remediation recommendations for AML resources
 */
export function generateAmlRecommendations(
  resources: AmlComputeResource[]
): AmlRemediationAction[] {
  const actions: AmlRemediationAction[] = [];

  for (const r of resources) {
    // Regla 1: Auto-Shutdown en Compute Instances
    if (r.computeType === "ComputeInstance" && !r.hasAutoShutdownSchedule && r.state === "Running") {
      const estimatedSavings = Number((r.monthlyCostUSD * 0.65).toFixed(2));
      const wsName = r.id.split("/workspaces/")[1]?.split("/")[0] || "workspace";

      actions.push({
        id: `rec-autoshutdown-${r.name}`,
        resourceId: r.id,
        params: { name: r.name, savings: estimatedSavings },
        category: "AUTO_SHUTDOWN_CI",
        estimatedSavingsUSD: estimatedSavings,
        confidence: "HIGH",
        actionType: "ENABLE_AUTO_SHUTDOWN",
        commandPayload: `az ml compute update --name "${r.name}" --workspace-name "${wsName}" --resource-group "${r.resourceGroup}" --idle-time-before-shutdown "PT30M"`,
      });
    }

    // Regla 2: Fijar min_nodes = 0 en Training Clusters
    if (r.computeType === "AmlComputeCluster" && r.minNodes > 0) {
      const estimatedSavings = Number((r.monthlyCostUSD * 0.8).toFixed(2));
      const wsName = r.id.split("/workspaces/")[1]?.split("/")[0] || "workspace";

      actions.push({
        id: `rec-scalezero-${r.name}`,
        resourceId: r.id,
        params: { name: r.name, minNodes: r.minNodes, vmSize: r.vmSize },
        category: "SCALE_TO_ZERO_CLUSTER",
        estimatedSavingsUSD: estimatedSavings,
        confidence: "HIGH",
        actionType: "SCALE_CLUSTER_TO_ZERO",
        commandPayload: `az ml compute update --name "${r.name}" --workspace-name "${wsName}" --resource-group "${r.resourceGroup}" --min-instances 0`,
      });
    }

    // Regla 3: Oportunidad de Spot Instances para Training GPU/CPU
    if (
      r.computeType === "AmlComputeCluster" &&
      r.monthlyCostUSD > 500 &&
      !r.name.includes("spot")
    ) {
      const estimatedSavings = Number((r.monthlyCostUSD * 0.7).toFixed(2));
      const wsName = r.id.split("/workspaces/")[1]?.split("/")[0] || "workspace";

      actions.push({
        id: `rec-spot-${r.name}`,
        resourceId: r.id,
        params: { name: r.name, cost: r.monthlyCostUSD },
        category: "SPOT_TRAINING",
        estimatedSavingsUSD: estimatedSavings,
        confidence: "MEDIUM",
        actionType: "ENABLE_SPOT_TRAINING",
        commandPayload: `# Recrear clúster con prioridad LowPriority (Azure Spot):\naz ml compute create --name "${r.name}-spot" --workspace-name "${wsName}" --resource-group "${r.resourceGroup}" --type AmlCompute --size "${r.vmSize.split(" ")[0]}" --min-instances 0 --max-instances ${r.maxNodes} --tier LowPriority`,
      });
    }

    // Regla 4: Inferencia en Tiempo Real Inactiva (Online Endpoints)
    if (r.computeType === "OnlineEndpoint" && r.avgCpuPercentage < 10) {
      const estimatedSavings = Number((r.monthlyCostUSD * 0.5).toFixed(2));
      const wsName = r.id.split("/workspaces/")[1]?.split("/")[0] || "workspace";

      actions.push({
        id: `rec-endpoint-opt-${r.name}`,
        resourceId: r.id,
        params: { name: r.name, cpu: r.avgCpuPercentage },
        category: "IDLE_ENDPOINT",
        estimatedSavingsUSD: estimatedSavings,
        confidence: "MEDIUM",
        actionType: "RESIZE_ENDPOINT",
        commandPayload: `az ml online-endpoint update --name "${r.name}" --workspace-name "${wsName}" --resource-group "${r.resourceGroup}"`,
      });
    }
  }

  return actions.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

/**
 * Builds PowerShell and Azure CLI remediation scripts
 */
export function buildAmlRemediationCommand(action: AmlRemediationAction): {
  cli: string;
  powershell: string;
} {
  return {
    cli: action.commandPayload || `az ml compute update --name "recurso"`,
    powershell: `# Ejecutar comando en Azure CLI o portal de Azure Machine Learning Studio\n# https://ml.azure.com`,
  };
}

/**
 * Queries live Azure Resource Graph for Azure Machine Learning workspaces
 */
export async function getLiveAmlData(tenantId: string): Promise<AmlPayload> {
  const query = `
    resources
    | where type =~ 'microsoft.machinelearningservices/workspaces'
    | project
        id,
        name,
        location,
        resourceGroup,
        subscriptionId,
        tags
  `;

  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (!subs || subs.length === 0) {
      return {
        summary: {
          totalMonthlyCostUSD: 0,
          computeInstancesCount: 0,
          activeTrainingClustersCount: 0,
          onlineEndpointsCount: 0,
          idleNodesCount: 0,
          potentialSavingsUSD: 0,
          breakdownByComputeType: [],
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
          totalMonthlyCostUSD: 0,
          computeInstancesCount: 0,
          activeTrainingClustersCount: 0,
          onlineEndpointsCount: 0,
          idleNodesCount: 0,
          potentialSavingsUSD: 0,
          breakdownByComputeType: [],
        },
        resources: [],
        dailyTrend: [],
        remediationActions: [],
        lastUpdated: new Date().toISOString(),
        source: "live",
      };
    }

    const resources: AmlComputeResource[] = rawResults.map((row: any) => ({
      id: row.id,
      name: row.name,
      location: row.location || "global",
      resourceGroup: row.resourceGroup || "default-rg",
      subscriptionId: row.subscriptionId || tenantId,
      subscriptionName: row.subscriptionId || "Azure Subscription",
      computeType: "ComputeInstance",
      vmSize: "Standard_DS3_v2",
      state: "Running",
      minNodes: 1,
      maxNodes: 1,
      currentNodes: 1,
      hasAutoShutdownSchedule: false,
      avgCpuPercentage: 0,
      monthlyCostUSD: 0,
      isWasteful: false,
    }));

    const summary = calculateAmlSummary(resources);
    const remediationActions = generateAmlRecommendations(resources);

    return {
      summary,
      resources,
      dailyTrend: [],
      remediationActions,
      lastUpdated: new Date().toISOString(),
      source: "live",
    };
  } catch (err) {
    console.warn("[azureMachineLearning.service] Error querying ARG:", err);
    return {
      summary: {
        totalMonthlyCostUSD: 0,
        computeInstancesCount: 0,
        activeTrainingClustersCount: 0,
        onlineEndpointsCount: 0,
        idleNodesCount: 0,
        potentialSavingsUSD: 0,
        breakdownByComputeType: [],
      },
      resources: [],
      dailyTrend: [],
      remediationActions: [],
      lastUpdated: new Date().toISOString(),
      source: "live",
    };
  }
}
