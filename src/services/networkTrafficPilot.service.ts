import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";

const ARM_BASE = "https://management.azure.com";
const LOGS_BASE = "https://api.loganalytics.azure.com/v1/workspaces";
const MAX_WORKSPACES = 5;
const WORKSPACE_CONCURRENCY = 3;
const MAX_EDGES_PER_WORKSPACE = 100;

export type TrafficPilotStatus = "ready" | "partial" | "not_configured" | "no_data" | "unavailable";

export interface NetworkTrafficEdge {
  source: string;
  destination: string;
  sourceRegion: string;
  destinationRegion: string;
  flowType: string;
  bytes: number;
  records: number;
}

export interface NetworkTrafficPilotResult {
  status: TrafficPilotStatus;
  days: number;
  configuredFlowLogs: number;
  activeFlowLogs: number;
  workspaceCount: number;
  queriedWorkspaceCount: number;
  workspacesWithoutId: number;
  skippedWorkspaceCount: number;
  truncated: boolean;
  totalObservedBytes: number;
  edges: NetworkTrafficEdge[];
  issues: Array<{ workspace: string; reason: "permission_denied" | "workspace_unavailable" | "traffic_table_unavailable" }>;
}

interface WorkspaceTarget {
  resourceId: string;
  name: string;
}

interface LogQueryTable {
  name?: string;
  columns?: Array<{ name?: string }>;
  rows?: unknown[][];
}

class WorkspaceAccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanWorkspaceTarget(resourceId: string): WorkspaceTarget {
  const match = /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.OperationalInsights\/workspaces\/([^/]+)$/i.exec(resourceId);
  if (!match) throw new Error("Traffic Analytics returned an invalid workspace resource ID.");
  return { resourceId, name: decodeURIComponent(match[1]) };
}

function getApiError(body: unknown): string | undefined {
  const error = asRecord(asRecord(body).error);
  return typeof error.message === "string" ? error.message : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Azure returned an invalid JSON response (HTTP ${response.status}).`);
  }
}

async function resolveWorkspaceId(resourceId: string, armToken: string): Promise<string> {
  const target = cleanWorkspaceTarget(resourceId);
  const path = resourceId.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${ARM_BASE}${path}?api-version=2023-09-01`, {
    headers: { Authorization: `Bearer ${armToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new WorkspaceAccessError(response.status, getApiError(body) || `Workspace lookup failed (HTTP ${response.status}).`);
  }
  const customerId = asRecord(asRecord(body).properties).customerId;
  if (typeof customerId !== "string" || !/^[0-9a-f-]{36}$/i.test(customerId)) {
    throw new WorkspaceAccessError(400, `Workspace ${target.name} has no valid customer ID.`);
  }
  return customerId;
}

export function buildTrafficAnalyticsQuery(days: number): string {
  return `NTANetAnalytics
| where TimeProcessed >= ago(${days}d)
| where SubType == "FlowLog"
| extend
    SourceSubnetName = tostring(SrcSubnet),
    DestinationSubnetName = tostring(DestSubnet),
    SourceRegionName = tostring(SrcRegion),
    DestinationRegionName = tostring(DestRegion),
    TrafficKind = tostring(FlowType),
    Direction = tostring(FlowDirection),
    TrafficBytes = tolong(BytesSrcToDest) + tolong(BytesDestToSrc)
| extend
    Source = case(
        isnotempty(SourceSubnetName), strcat("Subnet: ", SourceSubnetName),
        isnotempty(SourceRegionName), strcat("Region: ", SourceRegionName),
        TrafficKind in ("AzurePublic", "ExternalPublic") and Direction == "I", "Internet",
        "Unattributed source"
    ),
    Destination = case(
        isnotempty(DestinationSubnetName), strcat("Subnet: ", DestinationSubnetName),
        isnotempty(DestinationRegionName), strcat("Region: ", DestinationRegionName),
        TrafficKind in ("AzurePublic", "ExternalPublic") and Direction == "O", "Internet",
        "Unattributed destination"
    )
| where TrafficBytes > 0
| summarize Bytes = sum(TrafficBytes), Records = count() by Source, Destination, SourceRegionName, DestinationRegionName, TrafficKind
| top ${MAX_EDGES_PER_WORKSPACE} by Bytes desc
| project Source, Destination, SourceRegion = SourceRegionName, DestinationRegion = DestinationRegionName, FlowType = TrafficKind, Bytes, Records`;
}

async function queryWorkspace(
  customerId: string,
  days: number,
  logsToken: string
): Promise<{ edges: NetworkTrafficEdge[]; truncated: boolean }> {
  const response = await fetch(`${LOGS_BASE}/${encodeURIComponent(customerId)}/query?timespan=P${days}D`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${logsToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: buildTrafficAnalyticsQuery(days) }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new WorkspaceAccessError(response.status, getApiError(body) || `Traffic query failed (HTTP ${response.status}).`);
  }

  const result = asRecord(body);
  const tables = Array.isArray(result.tables) ? result.tables as LogQueryTable[] : [];
  const table = tables.find((candidate) => candidate.name === "PrimaryResult") || tables[0];
  if (!table) return { edges: [], truncated: false };

  const columns = new Map((table.columns || []).map((column, index) => [column.name || "", index]));
  const required = ["Source", "Destination", "SourceRegion", "DestinationRegion", "FlowType", "Bytes", "Records"];
  if (required.some((name) => !columns.has(name))) {
    throw new WorkspaceAccessError(400, "Traffic Analytics returned an incompatible table schema.");
  }

  const edges = (table.rows || []).map((row): NetworkTrafficEdge => ({
    source: String(row[columns.get("Source")!] ?? ""),
    destination: String(row[columns.get("Destination")!] ?? ""),
    sourceRegion: String(row[columns.get("SourceRegion")!] ?? ""),
    destinationRegion: String(row[columns.get("DestinationRegion")!] ?? ""),
    flowType: String(row[columns.get("FlowType")!] ?? ""),
    bytes: Math.max(0, Number(row[columns.get("Bytes")!]) || 0),
    records: Math.max(0, Number(row[columns.get("Records")!]) || 0),
  })).filter((edge) => edge.bytes > 0);

  return { edges, truncated: edges.length === MAX_EDGES_PER_WORKSPACE };
}

function workspaceIssue(workspace: string, error: WorkspaceAccessError) {
  const reason =
    error.status === 403 ? "permission_denied" :
    error.status === 404 ? "workspace_unavailable" :
    "traffic_table_unavailable";
  return { workspace, reason } as const;
}

function emptyResult(
  status: TrafficPilotStatus,
  values: Pick<NetworkTrafficPilotResult, "days" | "configuredFlowLogs" | "activeFlowLogs" | "workspaceCount" | "workspacesWithoutId" | "skippedWorkspaceCount">
): NetworkTrafficPilotResult {
  return {
    ...values,
    status,
    queriedWorkspaceCount: 0,
    truncated: false,
    totalObservedBytes: 0,
    edges: [],
    issues: [],
  };
}

/**
 * Read-only pilot over workspaces already linked to enabled Traffic Analytics
 * flow logs. It never enables or changes Azure resources and intentionally
 * aggregates by subnet/region instead of returning source or destination IPs.
 */
export async function getNetworkTrafficPilot(tenantId: string, days = 7): Promise<NetworkTrafficPilotResult> {
  const boundedDays = Number.isFinite(days) && days > 0 ? Math.min(Math.trunc(days), 30) : 7;
  const credential = await getAzureCredential(tenantId);
  const graph = await getResourceGraphClient(tenantId, credential);
  const response = await graph.resources({
    query: `
      Resources
      | where type =~ 'microsoft.network/networkwatchers/flowlogs'
      | project name, properties
    `,
  });
  const flowLogs = (response.data || []) as Array<Record<string, unknown>>;
  const configuredFlowLogs = flowLogs.length;
  const targets = new Map<string, WorkspaceTarget>();
  let activeFlowLogs = 0;
  let workspacesWithoutId = 0;
  const issues: NetworkTrafficPilotResult["issues"] = [];

  for (const flowLog of flowLogs) {
    const properties = asRecord(flowLog.properties);
    const analytics = asRecord(asRecord(properties.flowAnalyticsConfiguration).networkWatcherFlowAnalyticsConfiguration);
    if (properties.enabled === false || analytics.enabled !== true) continue;
    activeFlowLogs += 1;
    const resourceId = analytics.workspaceResourceId;
    if (typeof resourceId !== "string" || !resourceId) {
      workspacesWithoutId += 1;
      issues.push({
        workspace: String(flowLog.name || "Unknown flow log"),
        reason: "workspace_unavailable",
      });
      continue;
    }
    const key = resourceId.toLowerCase();
    if (!targets.has(key)) targets.set(key, cleanWorkspaceTarget(resourceId));
  }

  const allTargets = [...targets.values()];
  const selectedTargets = allTargets.slice(0, MAX_WORKSPACES);
  const base = {
    days: boundedDays,
    configuredFlowLogs,
    activeFlowLogs,
    workspaceCount: allTargets.length,
    workspacesWithoutId,
    skippedWorkspaceCount: Math.max(0, allTargets.length - selectedTargets.length),
  };
  if (activeFlowLogs === 0 || (allTargets.length === 0 && workspacesWithoutId === 0)) {
    return emptyResult("not_configured", base);
  }
  if (allTargets.length === 0) {
    return { ...emptyResult("unavailable", base), issues };
  }

  const armToken = await credential.getToken(`${ARM_BASE}/.default`);
  const logsToken = await credential.getToken("https://api.loganalytics.io/.default");
  if (!armToken?.token || !logsToken?.token) {
    throw new Error("Azure did not issue the tokens required to read Network Watcher traffic.");
  }

  const edgesByKey = new Map<string, NetworkTrafficEdge>();
  let queriedWorkspaceCount = 0;
  let truncated = base.skippedWorkspaceCount > 0;

  for (let offset = 0; offset < selectedTargets.length; offset += WORKSPACE_CONCURRENCY) {
    const batch = selectedTargets.slice(offset, offset + WORKSPACE_CONCURRENCY);
    const results = await Promise.all(batch.map(async (target) => {
      try {
        const customerId = await resolveWorkspaceId(target.resourceId, armToken.token);
        const result = await queryWorkspace(customerId, boundedDays, logsToken.token);
        return { target, result };
      } catch (error) {
        if (!(error instanceof WorkspaceAccessError) || ![400, 403, 404].includes(error.status)) throw error;
        return { target, issue: workspaceIssue(target.name, error) };
      }
    }));

    for (const item of results) {
      if ("issue" in item) {
        issues.push(item.issue);
        continue;
      }
      queriedWorkspaceCount += 1;
      truncated ||= item.result.truncated;
      for (const edge of item.result.edges) {
        const key = [edge.source, edge.destination, edge.sourceRegion, edge.destinationRegion, edge.flowType].join("\u0000");
        const current = edgesByKey.get(key);
        if (current) {
          current.bytes += edge.bytes;
          current.records += edge.records;
        } else {
          edgesByKey.set(key, { ...edge });
        }
      }
    }
  }

  const edges = [...edgesByKey.values()]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, MAX_EDGES_PER_WORKSPACE);
  truncated ||= edgesByKey.size > edges.length;
  const status: TrafficPilotStatus =
    issues.length > 0 || base.skippedWorkspaceCount > 0
      ? (queriedWorkspaceCount > 0 ? "partial" : "unavailable") :
    edges.length > 0 ? "ready" : "no_data";

  return {
    ...base,
    status,
    queriedWorkspaceCount,
    truncated,
    totalObservedBytes: edges.reduce((sum, edge) => sum + edge.bytes, 0),
    edges,
    issues,
  };
}
