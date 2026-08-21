/**
 * Service: Azure Databricks Analytics FinOps
 * Focus: Workspaces, DBUs, All-Purpose vs Jobs compute, VM infrastructure and auto-termination optimization.
 */

import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import type {
  DatabricksWorkspaceResource,
  DatabricksClusterItem,
  DatabricksSummary,
  DatabricksDailyPoint,
  DatabricksRemediationAction,
  DatabricksPayload,
  DatabricksComponentBreakdown,
} from "@/types/azureDatabricks.types";

const COMPONENT_COLORS: Record<string, string> = {
  "Automated Jobs Compute (DBU)": "#0078D4",
  "All-Purpose Compute (DBU)": "#2563EB",
  "Infraestructura de VMs Azure": "#0284C7",
  "Almacenamiento DBFS / Discos": "#38BDF8",
};

/**
 * Generates deterministic realistic synthetic mock data for demo tenants
 */
export function generateMockDatabricksData(): DatabricksPayload {
  const now = new Date();
  const dailyTrend: DatabricksDailyPoint[] = [];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dbus = Math.round(Math.random() * 120 + 80);
    dailyTrend.push({
      date: d.toISOString().slice(0, 10),
      dbusConsumed: dbus,
      costUSD: Number((dbus * 0.35 + Math.random() * 25 + 15).toFixed(2)),
    });
  }

  const workspaces: DatabricksWorkspaceResource[] = [
    {
      id: "/subscriptions/sub-001/resourceGroups/rg-analytics-prod/providers/Microsoft.Databricks/workspaces/dbx-analytics-prod",
      name: "dbx-analytics-prod",
      location: "East US 2",
      resourceGroup: "rg-analytics-prod",
      subscriptionId: "sub-001",
      subscriptionName: "Producción - Azure AI",
      skuTier: "Premium",
      managedResourceGroupId: "/subscriptions/sub-001/resourceGroups/databricks-rg-dbx-analytics-prod",
      totalDbuConsumed: 3_250,
      dbuCostUSD: 1_137.5,
      vmComputeCostUSD: 845.0,
      storageCostUSD: 125.0,
      totalMonthlyCostUSD: 2_107.5,
      allPurposePercentage: 35,
      jobsPercentage: 65,
      activeClustersCount: 3,
      isOrphan: false,
    },
    {
      id: "/subscriptions/sub-002/resourceGroups/rg-analytics-dev/providers/Microsoft.Databricks/workspaces/dbx-analytics-dev",
      name: "dbx-analytics-dev",
      location: "West Europe",
      resourceGroup: "rg-analytics-dev",
      subscriptionId: "sub-002",
      subscriptionName: "Desarrollo - Azure AI",
      skuTier: "Standard",
      managedResourceGroupId: "/subscriptions/sub-002/resourceGroups/databricks-rg-dbx-analytics-dev",
      totalDbuConsumed: 1_000,
      dbuCostUSD: 350.0,
      vmComputeCostUSD: 290.0,
      storageCostUSD: 45.0,
      totalMonthlyCostUSD: 685.0,
      allPurposePercentage: 80,
      jobsPercentage: 20,
      activeClustersCount: 2,
      isOrphan: false,
    },
  ];

  const clusters: DatabricksClusterItem[] = [
    {
      clusterId: "0820-143021-prod-etl",
      clusterName: "prod-daily-etl-pipeline",
      workspaceId: workspaces[0].id,
      workspaceName: workspaces[0].name,
      resourceGroup: workspaces[0].resourceGroup,
      subscriptionName: workspaces[0].subscriptionName,
      computeType: "AllPurpose",
      nodeType: "Standard_D8s_v5 (8 cores, 32 GB)",
      driverNodeType: "Standard_D8s_v5",
      minWorkers: 2,
      maxWorkers: 6,
      autoterminationMinutes: 120,
      state: "Running",
      dbuRatePerHour: 3.5,
      monthlyCostUSD: 740.0,
      isInefficient: true,
    },
    {
      clusterId: "0820-151044-jobs-stream",
      clusterName: "jobs-clickstream-aggregation",
      workspaceId: workspaces[0].id,
      workspaceName: workspaces[0].name,
      resourceGroup: workspaces[0].resourceGroup,
      subscriptionName: workspaces[0].subscriptionName,
      computeType: "Job",
      nodeType: "Standard_E8s_v5 (8 cores, 64 GB)",
      driverNodeType: "Standard_E8s_v5",
      minWorkers: 2,
      maxWorkers: 4,
      autoterminationMinutes: 20,
      state: "Running",
      dbuRatePerHour: 1.8,
      monthlyCostUSD: 820.0,
      isInefficient: false,
    },
    {
      clusterId: "0820-160012-dev-interactive",
      clusterName: "dev-interactive-notebook",
      workspaceId: workspaces[1].id,
      workspaceName: workspaces[1].name,
      resourceGroup: workspaces[1].resourceGroup,
      subscriptionName: workspaces[1].subscriptionName,
      computeType: "AllPurpose",
      nodeType: "Standard_D4s_v5 (4 cores, 16 GB)",
      driverNodeType: "Standard_D4s_v5",
      minWorkers: 2,
      maxWorkers: 2,
      autoterminationMinutes: 0,
      state: "Running",
      dbuRatePerHour: 1.5,
      monthlyCostUSD: 380.0,
      isInefficient: true,
    },
    {
      clusterId: "0820-170023-sql-warehouse",
      clusterName: "serverless-bi-warehouse",
      workspaceId: workspaces[0].id,
      workspaceName: workspaces[0].name,
      resourceGroup: workspaces[0].resourceGroup,
      subscriptionName: workspaces[0].subscriptionName,
      computeType: "ServerlessSQL",
      nodeType: "Serverless (2X-Small)",
      driverNodeType: "Managed",
      minWorkers: 1,
      maxWorkers: 3,
      autoterminationMinutes: 15,
      state: "Terminated",
      dbuRatePerHour: 2.0,
      monthlyCostUSD: 547.5,
      isInefficient: false,
    },
  ];

  const summary = calculateDatabricksSummary(workspaces, clusters);
  const remediationActions = generateDatabricksRecommendations(workspaces, clusters);

  return {
    summary,
    workspaces,
    clusters,
    dailyTrend,
    remediationActions,
    lastUpdated: now.toISOString(),
    source: "mock",
  };
}

/**
 * Calculates summary metrics and component cost breakdown
 */
export function calculateDatabricksSummary(
  workspaces: DatabricksWorkspaceResource[],
  clusters: DatabricksClusterItem[]
): DatabricksSummary {
  const totalCostUSD = Number(
    workspaces.reduce((sum, w) => sum + w.totalMonthlyCostUSD, 0).toFixed(2)
  );
  const totalDbus = workspaces.reduce((sum, w) => sum + w.totalDbuConsumed, 0);
  const dbuSpendUSD = Number(
    workspaces.reduce((sum, w) => sum + w.dbuCostUSD, 0).toFixed(2)
  );
  const azureComputeSpendUSD = Number(
    workspaces.reduce((sum, w) => sum + w.vmComputeCostUSD, 0).toFixed(2)
  );
  const storageSpendUSD = Number(
    workspaces.reduce((sum, w) => sum + w.storageCostUSD, 0).toFixed(2)
  );

  const totalAllPurposeDbuCost = workspaces.reduce(
    (sum, w) => sum + w.dbuCostUSD * (w.allPurposePercentage / 100),
    0
  );
  const totalJobsDbuCost = workspaces.reduce(
    (sum, w) => sum + w.dbuCostUSD * (w.jobsPercentage / 100),
    0
  );

  const jobsEfficiencyRatio =
    totalDbus > 0
      ? Number(
          (
            workspaces.reduce(
              (sum, w) => sum + (w.totalDbuConsumed * w.jobsPercentage) / 100,
              0
            ) / totalDbus
          ).toFixed(2)
        ) * 100
      : 0;

  const breakdownByComponent: DatabricksComponentBreakdown[] = [
    {
      component: "Automated Jobs Compute (DBU)",
      costUSD: Number(totalJobsDbuCost.toFixed(2)),
      percentage: totalCostUSD > 0 ? Number(((totalJobsDbuCost / totalCostUSD) * 100).toFixed(1)) : 0,
      color: COMPONENT_COLORS["Automated Jobs Compute (DBU)"],
    },
    {
      component: "All-Purpose Compute (DBU)",
      costUSD: Number(totalAllPurposeDbuCost.toFixed(2)),
      percentage: totalCostUSD > 0 ? Number(((totalAllPurposeDbuCost / totalCostUSD) * 100).toFixed(1)) : 0,
      color: COMPONENT_COLORS["All-Purpose Compute (DBU)"],
    },
    {
      component: "Infraestructura de VMs Azure",
      costUSD: azureComputeSpendUSD,
      percentage: totalCostUSD > 0 ? Number(((azureComputeSpendUSD / totalCostUSD) * 100).toFixed(1)) : 0,
      color: COMPONENT_COLORS["Infraestructura de VMs Azure"],
    },
    {
      component: "Almacenamiento DBFS / Discos",
      costUSD: storageSpendUSD,
      percentage: totalCostUSD > 0 ? Number(((storageSpendUSD / totalCostUSD) * 100).toFixed(1)) : 0,
      color: COMPONENT_COLORS["Almacenamiento DBFS / Discos"],
    },
  ];

  const recommendations = generateDatabricksRecommendations(workspaces, clusters);
  const potentialSavingsUSD = Number(
    recommendations.reduce((sum, a) => sum + a.estimatedSavingsUSD, 0).toFixed(2)
  );

  return {
    totalCostUSD,
    totalDbus,
    dbuSpendUSD,
    azureComputeSpendUSD,
    jobsEfficiencyRatio,
    potentialSavingsUSD,
    breakdownByComponent,
  };
}

/**
 * Generates FinOps remediation recommendations for Databricks
 */
export function generateDatabricksRecommendations(
  workspaces: DatabricksWorkspaceResource[],
  clusters: DatabricksClusterItem[]
): DatabricksRemediationAction[] {
  const actions: DatabricksRemediationAction[] = [];

  for (const c of clusters) {
    // Regla 1: Migrar notebooks de producción a Jobs Compute
    if (c.computeType === "AllPurpose" && c.clusterName.toLowerCase().includes("pipeline")) {
      const estimatedSavings = Number((c.monthlyCostUSD * 0.55).toFixed(2));
      actions.push({
        id: `rec-migrate-job-${c.clusterId}`,
        targetId: c.clusterId,
        title: `Migrar clúster '${c.clusterName}' a Automated Job Compute`,
        description: `El clúster '${c.clusterName}' ejecuta pipelines programados bajo tarifa All-Purpose ($0.40-$0.55/DBU). Migrar la ejecución a un Workflow Job automatizado aplica la tarifa reducida Jobs DBU ($0.15-$0.20/DBU), ahorrando un 55-65% en costos de DBU.`,
        category: "MIGRATE_TO_JOBS",
        estimatedSavingsUSD: estimatedSavings,
        confidence: "HIGH",
        actionType: "MIGRATE_TO_JOB_CLUSTER",
        commandPayload: `# Databricks CLI: Crear Job automatizado con new_cluster\ndatabricks jobs create --json '{"name": "${c.clusterName}", "tasks": [{"task_key": "task1", "new_cluster": {"spark_version": "14.3.x-scala2.12", "node_type_id": "${c.nodeType.split(" ")[0]}", "num_workers": ${c.minWorkers}}}]}'`,
      });
    }

    // Regla 2: Auto-Termination excesivo o desactivado
    if (c.computeType === "AllPurpose" && (c.autoterminationMinutes > 60 || c.autoterminationMinutes === 0)) {
      const estimatedSavings = Number((c.monthlyCostUSD * 0.35).toFixed(2));
      actions.push({
        id: `rec-autoterm-${c.clusterId}`,
        targetId: c.clusterId,
        title: `Reducir Auto-Termination a 20 min en '${c.clusterName}'`,
        description: `El clúster interactivo '${c.clusterName}' tiene el auto-apagado ${c.autoterminationMinutes === 0 ? "DESACTIVADO" : `configurado en ${c.autoterminationMinutes} minutos`}. Reducirlo a 20 minutos de inactividad evita facturar horas ociosas de VMs y DBUs.`,
        category: "REDUCE_AUTOTERMINATION",
        estimatedSavingsUSD: estimatedSavings,
        confidence: "HIGH",
        actionType: "UPDATE_AUTOTERMINATION",
        commandPayload: `databricks clusters edit --json '{"cluster_id": "${c.clusterId}", "autotermination_minutes": 20}'`,
      });
    }

    // Regla 3: Dev clústeres a Single-Node
    if (c.computeType === "AllPurpose" && c.clusterName.toLowerCase().includes("dev") && c.minWorkers >= 2) {
      const estimatedSavings = Number((c.monthlyCostUSD * 0.45).toFixed(2));
      actions.push({
        id: `rec-singlenode-${c.clusterId}`,
        targetId: c.clusterId,
        title: `Convertir clúster '${c.clusterName}' a Single-Node`,
        description: `El clúster de desarrollo '${c.clusterName}' tiene ${c.minWorkers} workers aprovisionados. Convertirlo a clúster Single-Node (1 nodo driver sin workers adicionales) reduce a la mitad el consumo de VMs y DBUs sin afectar el desarrollo interactivo.`,
        category: "SINGLE_NODE_DEV",
        estimatedSavingsUSD: estimatedSavings,
        confidence: "MEDIUM",
        actionType: "ENABLE_SINGLE_NODE",
        commandPayload: `databricks clusters edit --json '{"cluster_id": "${c.clusterId}", "num_workers": 0, "spark_conf": {"spark.databricks.cluster.profile": "singleNode", "spark.master": "local[*]"}}'`,
      });
    }
  }

  return actions.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

/**
 * Builds PowerShell and Azure / Databricks CLI remediation scripts
 */
export function buildDatabricksRemediationCommand(action: DatabricksRemediationAction): {
  cli: string;
  powershell: string;
} {
  return {
    cli: action.commandPayload || `databricks clusters edit --json '{"cluster_id": "${action.targetId}"}'`,
    powershell: `# Ejecutar comando en Databricks CLI o Portal Web\n# https://accounts.azuredatabricks.net`,
  };
}

/**
 * Queries live Azure Resource Graph for Databricks workspaces
 */
export async function getLiveDatabricksData(tenantId: string): Promise<DatabricksPayload> {
  const query = `
    resources
    | where type =~ 'microsoft.databricks/workspaces'
    | project
        id,
        name,
        location,
        resourceGroup,
        subscriptionId,
        skuTier = coalesce(sku.name, 'Premium'),
        managedResourceGroupId = properties.managedResourceGroupId,
        tags
  `;

  try {
    const credential = await getAzureCredential(tenantId);
    const subs = await getSubscriptionsForTenant(tenantId, credential);
    if (!subs || subs.length === 0) {
      return {
        summary: {
          totalCostUSD: 0,
          totalDbus: 0,
          dbuSpendUSD: 0,
          azureComputeSpendUSD: 0,
          jobsEfficiencyRatio: 0,
          potentialSavingsUSD: 0,
          breakdownByComponent: [],
        },
        workspaces: [],
        clusters: [],
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
          totalDbus: 0,
          dbuSpendUSD: 0,
          azureComputeSpendUSD: 0,
          jobsEfficiencyRatio: 0,
          potentialSavingsUSD: 0,
          breakdownByComponent: [],
        },
        workspaces: [],
        clusters: [],
        dailyTrend: [],
        remediationActions: [],
        lastUpdated: new Date().toISOString(),
        source: "live",
      };
    }

    const workspaces: DatabricksWorkspaceResource[] = rawResults.map((row: any) => ({
      id: row.id,
      name: row.name,
      location: row.location || "global",
      resourceGroup: row.resourceGroup || "default-rg",
      subscriptionId: row.subscriptionId || tenantId,
      subscriptionName: row.subscriptionId || "Azure Subscription",
      skuTier: (row.skuTier === "Standard" ? "Standard" : "Premium") as any,
      managedResourceGroupId: row.managedResourceGroupId || "",
      totalDbuConsumed: 0,
      dbuCostUSD: 0,
      vmComputeCostUSD: 0,
      storageCostUSD: 0,
      totalMonthlyCostUSD: 0,
      allPurposePercentage: 50,
      jobsPercentage: 50,
      activeClustersCount: 0,
      isOrphan: false,
    }));

    const summary = calculateDatabricksSummary(workspaces, []);
    const remediationActions = generateDatabricksRecommendations(workspaces, []);

    return {
      summary,
      workspaces,
      clusters: [],
      dailyTrend: [],
      remediationActions,
      lastUpdated: new Date().toISOString(),
      source: "live",
    };
  } catch (err) {
    console.warn("[azureDatabricks.service] Error querying ARG:", err);
    return {
      summary: {
        totalCostUSD: 0,
        totalDbus: 0,
        dbuSpendUSD: 0,
        azureComputeSpendUSD: 0,
        jobsEfficiencyRatio: 0,
        potentialSavingsUSD: 0,
        breakdownByComponent: [],
      },
      workspaces: [],
      clusters: [],
      dailyTrend: [],
      remediationActions: [],
      lastUpdated: new Date().toISOString(),
      source: "live",
    };
  }
}
