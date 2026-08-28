import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantTier } from "@/lib/requestAuth";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { isMockTenant } from "@/lib/mockData";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import {
  distributeCostPerResource,
  getMonthlyCostByType,
  getMtdCostByResourceId,
  listResourcesByTypes,
  type ArgResourceRow,
} from "@/app/api/intelligence/databases/diagnosticsShared";
import pool from "@/modules/storage/db";

type IntegrationService =
  | "logic-apps"
  | "apim"
  | "service-bus"
  | "event-grid"
  | "event-hubs"
  | "adf";

const RESOURCE_TYPES: Record<IntegrationService, string[]> = {
  "logic-apps": ["microsoft.logic/workflows"],
  apim: ["microsoft.apimanagement/service"],
  "service-bus": ["microsoft.servicebus/namespaces"],
  "event-grid": ["microsoft.eventgrid/topics", "microsoft.eventgrid/domains", "microsoft.eventgrid/systemtopics"],
  "event-hubs": ["microsoft.eventhub/namespaces"],
  adf: ["microsoft.datafactory/factories"],
};

const COST_TYPES: Record<IntegrationService, string[]> = {
  "logic-apps": ["Microsoft.Logic/workflows"],
  apim: ["Microsoft.ApiManagement/service"],
  "service-bus": ["Microsoft.ServiceBus/namespaces"],
  "event-grid": ["Microsoft.EventGrid/topics", "Microsoft.EventGrid/domains", "Microsoft.EventGrid/systemTopics"],
  "event-hubs": ["Microsoft.EventHub/namespaces"],
  adf: ["Microsoft.DataFactory/factories"],
};

const COST_FALLBACK_TYPES: Partial<Record<IntegrationService, string[]>> = {
  "logic-apps": ["Microsoft.Logic/workflows", "microsoft.logic/workflows"],
  apim: ["Microsoft.ApiManagement/service", "microsoft.apimanagement/service"],
  "service-bus": ["Microsoft.ServiceBus/namespaces", "microsoft.servicebus/namespaces"],
  "event-grid": [
    "Microsoft.EventGrid/topics",
    "Microsoft.EventGrid/domains",
    "Microsoft.EventGrid/systemTopics",
    "microsoft.eventgrid/topics",
    "microsoft.eventgrid/domains",
    "microsoft.eventgrid/systemtopics",
  ],
  "event-hubs": ["Microsoft.EventHub/namespaces", "microsoft.eventhub/namespaces"],
  adf: ["Microsoft.DataFactory/factories", "microsoft.datafactory/factories"],
};

const SNAPSHOT_SERVICE_HINTS: Record<IntegrationService, string[]> = {
  "logic-apps": ["logic app", "logicapps", "workflow"],
  apim: ["api management", "apim", "gateway"],
  "service-bus": ["service bus"],
  "event-grid": ["event grid"],
  "event-hubs": ["event hubs", "event hub"],
  adf: ["data factory", "adf"],
};

const METRIC_NAMES: Record<IntegrationService, [string, string]> = {
  "logic-apps": ["RunsStarted", "RunsFailed"],
  apim: ["TotalRequests", "Capacity"],
  "service-bus": ["ActiveMessages", "DeadletteredMessages"],
  "event-grid": ["PublishSuccessCount", "DeliveryFailedCount"],
  "event-hubs": ["IncomingBytes", "ThrottledRequests"],
  adf: ["SuccessfulPipelineRuns", "FailedPipelineRuns"],
};

const MOCK_MULTIPLIER: Record<string, number> = {
  "11111111-2222-3333-4444-555555555555": 1,
  "22222222-3333-4444-5555-666666666666": 3,
  "44444444-5555-6666-7777-888888888888": 10,
  "33333333-4444-5555-6666-777777777777": 50,
};

function isIntegrationService(value: string): value is IntegrationService {
  return value in RESOURCE_TYPES;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumCostMap(costByType: Map<string, { toNumber: () => number }>): number {
  return [...costByType.values()].reduce((sum, value) => sum + value.toNumber(), 0);
}

function forecastEomFromMtd(mtd: number): number {
  const now = new Date();
  const day = Math.max(1, now.getDate());
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return round2((mtd / day) * days);
}

function resolveResourceHealth(
  service: IntegrationService,
  resource: ArgResourceRow,
  metrics: Record<string, number | null>,
  provisioningState: string
): string {
  const properties = (resource.properties || {}) as Record<string, any>;
  const directHealth = String(
    properties?.availabilityState ||
      properties?.healthStatus ||
      properties?.resourceHealth ||
      ""
  ).trim();
  if (directHealth) return directHealth;

  if (service === "logic-apps") {
    const logicState = String(properties?.state || properties?.status || "").toLowerCase();
    if (logicState.includes("enabled") || logicState.includes("running")) return "Available";
    if (logicState.includes("disabled") || logicState.includes("stopped")) return "Degraded";

    const runsStarted = Number(metrics?.RunsStarted || 0);
    const runsFailed = Number(metrics?.RunsFailed || 0);
    if (runsStarted > 0 && runsFailed <= runsStarted * 0.2) return "Available";
    if (runsStarted > 0 && runsFailed > runsStarted * 0.2) return "Degraded";
  }

  const normalizedProvisioning = provisioningState.toLowerCase();
  if (normalizedProvisioning === "succeeded") return "Available";
  if (normalizedProvisioning === "failed" || normalizedProvisioning === "canceled") return "Degraded";
  return "unknown";
}

function buildMock(tenantId: string, service: IntegrationService) {
  const multiplier = MOCK_MULTIPLIER[tenantId] || 1;
  const metricNames = METRIC_NAMES[service];
  const baseCost = 120 * multiplier;
  const items = Array.from({ length: 6 }).map((_, index) => {
    const mtdCostUsd = round2(baseCost + index * 27.5);
    return {
      id: `/subscriptions/mock-sub-${(index % 2) + 1}/resourceGroups/mock-rg-${(index % 3) + 1}/providers/${RESOURCE_TYPES[service][0]}/resource-${index + 1}`,
      name: `${service}-resource-${index + 1}`,
      type: RESOURCE_TYPES[service][0],
      region: ["eastus", "westus2", "brazilsouth"][index % 3],
      resourceGroup: `mock-rg-${(index % 3) + 1}`,
      subscriptionId: `mock-sub-${(index % 2) + 1}`,
      subscriptionName: `Mock Subscription ${(index % 2) + 1}`,
      tags: { Environment: index % 2 ? "prod" : "dev", Owner: "finops", CostCenter: "cc-platform" },
      provisioningState: "Succeeded",
      resourceHealth: "Available",
      mtdCostUsd,
      previousPeriodCostUsd: round2(mtdCostUsd * 0.9),
      forecastEomUsd: forecastEomFromMtd(mtdCostUsd),
      metrics: {
        [metricNames[0]]: round2(1500 + index * 100 * multiplier),
        [metricNames[1]]: round2(12 + index * multiplier),
      },
    };
  });

  const mtdTotal = round2(items.reduce((acc, item) => acc + item.mtdCostUsd, 0));
  const previousTotal = round2(items.reduce((acc, item) => acc + item.previousPeriodCostUsd, 0));

  return {
    ok: true,
    mock: true,
    service,
    data: {
      summary: {
        resourceCount: items.length,
        mtdCostUsd: mtdTotal,
        previousPeriodCostUsd: previousTotal,
        forecastEomUsd: forecastEomFromMtd(mtdTotal),
      },
      metricNames,
      items,
      enterpriseConnectors:
        service === "logic-apps"
          ? {
              enterpriseConnectorCalls: round2(300 * multiplier),
              enterpriseConnectorCostUsd: round2(180 * multiplier),
              enterpriseConnectorRatioPct: 24,
              topConnectors: [
                { name: "SAP", calls: 140 * multiplier, estimatedCostUsd: round2(92 * multiplier) },
                { name: "SFTP", calls: 90 * multiplier, estimatedCostUsd: round2(54 * multiplier) },
                { name: "Oracle DB", calls: 70 * multiplier, estimatedCostUsd: round2(34 * multiplier) },
              ],
            }
          : null,
    },
  };
}

async function getMetrics(
  credential: Awaited<ReturnType<typeof getAzureCredential>>,
  resourceId: string,
  metricNames: [string, string]
): Promise<Record<string, number | null>> {
  try {
    const token = await credential.getToken("https://management.azure.com/.default");
    if (!token?.token) return {};
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const url = new URL(`https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics`);
    url.searchParams.set("api-version", "2018-01-01");
    url.searchParams.set("metricnames", `${metricNames[0]},${metricNames[1]}`);
    url.searchParams.set("timespan", `${start.toISOString()}/${now.toISOString()}`);
    url.searchParams.set("interval", "PT1H");
    url.searchParams.set("aggregation", "Average,Total");

    const response = await fetch(url.toString(), {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token.token}` },
    });
    if (!response.ok) return {};
    const body: any = await response.json();
    const metrics: Record<string, number | null> = {};
    for (const metric of body?.value || []) {
      const name = String(metric?.name?.value || "");
      const points = (metric?.timeseries?.[0]?.data || []) as Array<Record<string, number>>;
      const values = points
        .map((point) => {
          if (typeof point.total === "number") return point.total;
          if (typeof point.average === "number") return point.average;
          return null;
        })
        .filter((value): value is number => typeof value === "number");
      metrics[name] = values.length > 0 ? round2(values.reduce((a, b) => a + b, 0)) : null;
    }
    return metrics;
  } catch {
    return {};
  }
}

async function getMonthlyIntegrationCostFromSnapshots(
  tenantId: string,
  subscriptionIds: string[],
  service: IntegrationService
): Promise<number> {
  if (subscriptionIds.length === 0) return 0;
  const hints = SNAPSHOT_SERVICE_HINTS[service];
  if (hints.length === 0) return 0;

  const subscriptionPlaceholders = subscriptionIds.map(() => "?").join(",");
  const hintClauses = hints.map(() => "LOWER(COALESCE(service_name, '')) LIKE ?").join(" OR ");
  const query = `
    SELECT COALESCE(SUM(cost_usd), 0) AS total
    FROM CostSnapshots
    WHERE tenant_id = ?
      AND subscription_id IN (${subscriptionPlaceholders})
      AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
      AND (${hintClauses})
  `;

  try {
    const params: Array<string> = [
      tenantId,
      ...subscriptionIds,
      ...hints.map((hint) => `%${hint}%`),
    ];
    const [rows]: any = await pool.query(query, params);
    return round2(Number(rows?.[0]?.total || 0));
  } catch {
    return 0;
  }
}

function parseEnterpriseConnectorSummary(resources: ArgResourceRow[], runsByResourceId: Map<string, number>) {
  const enterpriseNames = ["sap", "oracle", "ibm", "mq", "sftp", "edifact", "x12", "as2"];
  const connectorCalls = new Map<string, number>();
  let enterpriseCalls = 0;

  for (const resource of resources) {
    const actions = (resource.properties as any)?.definition?.actions as Record<string, any> | undefined;
    if (!actions) continue;
    const runs = runsByResourceId.get(resource.id) || 0;
    for (const action of Object.values(actions)) {
      const connectionName = String(
        action?.inputs?.host?.connection?.name ||
          action?.inputs?.host?.api?.name ||
          action?.inputs?.host?.apiId ||
          ""
      ).toLowerCase();
      if (!connectionName) continue;
      const matched = enterpriseNames.find((name) => connectionName.includes(name));
      if (!matched) continue;
      const estimatedCalls = Math.max(1, runs);
      connectorCalls.set(matched, (connectorCalls.get(matched) || 0) + estimatedCalls);
      enterpriseCalls += estimatedCalls;
    }
  }

  const topConnectors = Array.from(connectorCalls.entries())
    .map(([name, calls]) => ({
      name: name.toUpperCase(),
      calls,
      estimatedCostUsd: round2(calls * 0.02),
    }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 5);

  const enterpriseCost = round2(topConnectors.reduce((acc, connector) => acc + connector.estimatedCostUsd, 0));
  const ratio = enterpriseCalls > 0 ? 100 : 0;

  return {
    enterpriseConnectorCalls: enterpriseCalls,
    enterpriseConnectorCostUsd: enterpriseCost,
    enterpriseConnectorRatioPct: ratio,
    topConnectors,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ service: string }> }
) {
  try {
    const { service: rawService } = await context.params;
    if (!isIntegrationService(rawService)) {
      return NextResponse.json({ error: "Invalid service" }, { status: 400 });
    }
    const service = rawService;
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const forceMock = searchParams.get("mock") === "true";
    if (!tenantId) return NextResponse.json({ error: "tenantId is required" }, { status: 400 });

    if (forceMock || isMockTenant(tenantId)) {
      return NextResponse.json(buildMock(tenantId, service));
    }

    await requireTenantTier(request, tenantId, "Business");

    const credential = await getAzureCredential(tenantId);
    const subscriptionIds = await getSubscriptionsForTenant(tenantId, credential);
    if (subscriptionIds.length === 0) {
      return NextResponse.json({
        ok: true,
        mock: false,
        service,
        data: {
          summary: { resourceCount: 0, mtdCostUsd: 0, previousPeriodCostUsd: 0, forecastEomUsd: 0 },
          metricNames: METRIC_NAMES[service],
          items: [],
          enterpriseConnectors: service === "logic-apps" ? { enterpriseConnectorCalls: 0, enterpriseConnectorCostUsd: 0, enterpriseConnectorRatioPct: 0, topConnectors: [] } : null,
        },
      });
    }

    const resources = await listResourcesByTypes(
      tenantId,
      RESOURCE_TYPES[service],
      subscriptionIds,
      credential
    );

    let { costByType, dataAvailable } = await getMonthlyCostByType(
      tenantId,
      credential,
      subscriptionIds,
      COST_TYPES[service]
    );

    if (sumCostMap(costByType) <= 0 && COST_FALLBACK_TYPES[service]) {
      const fallback = await getMonthlyCostByType(
        tenantId,
        credential,
        subscriptionIds,
        COST_FALLBACK_TYPES[service]!
      );
      if (sumCostMap(fallback.costByType) > 0) {
        costByType = fallback.costByType;
      }
      dataAvailable = dataAvailable && fallback.dataAvailable;
    }

    // Costo exacto por ResourceId; el reparto por tipo queda de respaldo
    // para los recursos que aún no tienen facturación propia.
    const exactCostById = await getMtdCostByResourceId(tenantId, credential, resources);
    const costPerResource = distributeCostPerResource(resources, costByType, exactCostById);
    const subscriptionNameMap = await getSubscriptionNameMap(tenantId, credential);
    const metricNames = METRIC_NAMES[service];
    const runsByResourceId = new Map<string, number>();

    const items = await Promise.all(
      resources.slice(0, 200).map(async (resource) => {
        const metrics = await getMetrics(credential, resource.id, metricNames);
        const runs = Number(metrics[metricNames[0]] || 0);
        runsByResourceId.set(resource.id, runs);
        const mtdCostUsd = costPerResource.get(resource.id) || 0;
        const previousPeriodCostUsd = round2(mtdCostUsd * 0.9);
        const provisioningState =
          resource.provisioningState ||
          String((resource.properties as any)?.provisioningState || "unknown");
        const resourceHealth = resolveResourceHealth(
          service,
          resource,
          metrics,
          provisioningState
        );
        return {
          id: resource.id,
          name: resource.name,
          type: resource.type,
          region: resource.location || "unknown",
          resourceGroup: resource.resourceGroup || "unknown",
          subscriptionId: resource.subscriptionId || "",
          subscriptionName: resolveSubscriptionName(resource.subscriptionId, subscriptionNameMap) || "unknown",
          tags: ((resource as any).tags || {}) as Record<string, string>,
          provisioningState,
          resourceHealth,
          mtdCostUsd: round2(mtdCostUsd),
          previousPeriodCostUsd,
          forecastEomUsd: forecastEomFromMtd(mtdCostUsd),
          metrics: {
            [metricNames[0]]: metrics[metricNames[0]] ?? null,
            [metricNames[1]]: metrics[metricNames[1]] ?? null,
          },
        };
      })
    );

    let mtdTotal = round2(items.reduce((acc, item) => acc + item.mtdCostUsd, 0));
    if (mtdTotal <= 0 && items.length > 0) {
      const snapshotsTotal = await getMonthlyIntegrationCostFromSnapshots(
        tenantId,
        subscriptionIds,
        service
      );
      if (snapshotsTotal > 0) {
        const evenShare = round2(snapshotsTotal / items.length);
        for (const item of items) {
          item.mtdCostUsd = evenShare;
          item.previousPeriodCostUsd = round2(evenShare * 0.9);
          item.forecastEomUsd = forecastEomFromMtd(evenShare);
        }
        mtdTotal = round2(items.reduce((acc, item) => acc + item.mtdCostUsd, 0));
      }
    }
    const previousTotal = round2(items.reduce((acc, item) => acc + item.previousPeriodCostUsd, 0));

    return NextResponse.json({
      ok: true,
      mock: false,
      service,
      data: {
        summary: {
          resourceCount: items.length,
          mtdCostUsd: mtdTotal,
          previousPeriodCostUsd: previousTotal,
          forecastEomUsd: forecastEomFromMtd(mtdTotal),
          dataAvailable,
        },
        metricNames,
        items,
        enterpriseConnectors:
          service === "logic-apps"
            ? parseEnterpriseConnectorSummary(resources, runsByResourceId)
            : null,
      },
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
