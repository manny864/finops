"use client";
import { AlertCircle, AlertTriangle } from "lucide-react";
import useSWR from "swr";
import { useTranslations } from "next-intl";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface CapabilityMetrics {
  capability: string;
  name: string;
  description: string;
  monthlyCostUSD: number;
  costBreakdown?: {
    computeCost: number;
    storageCost: number;
    queryTransactionCost: number;
    overheadCost: number;
  };
  usage?: Array<{ metric: string; value: number; unit: string; costPer?: number }>;
  resources?: Array<{ name: string; region: string; resourceGroup: string; monthlyCost: number; utilizationPercent: number }>;
  wasteMetrics?: { orphanedResourceCount: number; underutilizedResourceCount: number; idleResourceCount: number; estimatedWasteUSD: number };
  recommendations?: Array<{ id: string; title: string; description: string; potentialSavingsUSD: number; effort: string; confidence: number }>;
}

interface AzureServiceTabProps {
  tenantId: string;
  capability: string;
}

export function AzureServiceTab({ tenantId, capability }: AzureServiceTabProps) {
  const t = useTranslations("AzureAI");
  const { data, error, isLoading } = useSWR<{ capabilities: CapabilityMetrics[] }>(
    `/api/intelligence/azure-ai?tenantId=${tenantId}`,
    fetcher,
    { revalidateOnFocus: true }
  );

  const capabilityData = data?.capabilities?.find((c) => c.capability === capability);

  if (isLoading) {
    return <div className="h-32 bg-muted animate-pulse rounded" />;
  }

  if (error || !capabilityData) {
    return (
      <div className="card p-6 border-destructive/50 bg-destructive/5">
        <div className="flex gap-2 items-start">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
          <div>
            <h3 className="font-semibold text-destructive">{t("noDataTitle")}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {t("noDataBody")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cost Overview */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-4">
        <div className="card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Monthly Cost</h3>
          <p className="text-2xl font-bold mt-2">${capabilityData.monthlyCostUSD.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-1">{capabilityData.resources?.length || 0} resources</p>
        </div>

        <div className="card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Compute Cost</h3>
          <p className="text-2xl font-bold mt-2">${(capabilityData.costBreakdown?.computeCost || 0).toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {(((capabilityData.costBreakdown?.computeCost || 0) / capabilityData.monthlyCostUSD) * 100).toFixed(0)}% of total
          </p>
        </div>

        <div className="card p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Storage Cost</h3>
          <p className="text-2xl font-bold mt-2">${(capabilityData.costBreakdown?.storageCost || 0).toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {(((capabilityData.costBreakdown?.storageCost || 0) / capabilityData.monthlyCostUSD) * 100).toFixed(0)}% of total
          </p>
        </div>

        <div className="card p-6 border-destructive/30 bg-destructive/5">
          <h3 className="text-sm font-medium text-destructive">Estimated Waste</h3>
          <p className="text-2xl font-bold text-destructive mt-2">
            ${(capabilityData.wasteMetrics?.estimatedWasteUSD || 0).toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {capabilityData.wasteMetrics?.underutilizedResourceCount || 0} underutilized
          </p>
        </div>
      </div>

      {/* Usage Metrics */}
      {capabilityData.usage && capabilityData.usage.length > 0 && (
        <div className="card p-6">
          <h3 className="font-semibold mb-4">Usage Metrics</h3>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
            {capabilityData.usage.map((metric: any, idx: number) => (
              <div key={idx} className="rounded-lg border p-4 bg-muted/30">
                <p className="text-sm text-muted-foreground">{metric.metric}</p>
                <p className="text-xl font-bold mt-2">{metric.value}</p>
                {metric.unit && <p className="text-xs text-muted-foreground">{metric.unit}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resources Table */}
      {capabilityData.resources && capabilityData.resources.length > 0 && (
        <div className="card p-6">
          <h3 className="font-semibold mb-4">{capabilityData.resources.length} Resources</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium">Name</th>
                  <th className="text-left p-2 font-medium">Region</th>
                  <th className="text-left p-2 font-medium">Resource Group</th>
                  <th className="text-right p-2 font-medium">Cost/mo</th>
                  <th className="text-right p-2 font-medium">Utilization</th>
                </tr>
              </thead>
              <tbody>
                {capabilityData.resources.map((resource: any, idx: number) => (
                  <tr key={idx} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="p-2 font-mono text-xs">{resource.name}</td>
                    <td className="p-2 text-sm">{resource.region}</td>
                    <td className="p-2 text-sm">{resource.resourceGroup}</td>
                    <td className="p-2 text-right font-medium">${resource.monthlyCost.toFixed(2)}</td>
                    <td className="p-2 text-right">
                      {resource.utilizationPercent ? (
                        <span className={resource.utilizationPercent < 20 ? "text-destructive font-bold" : ""}>
                          {resource.utilizationPercent.toFixed(0)}%
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {capabilityData.recommendations && capabilityData.recommendations.length > 0 && (
        <div className="card p-6 border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/10">
          <div className="flex gap-2 items-start mb-4">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
            <h3 className="font-semibold">Optimization Recommendations</h3>
          </div>
          <div className="space-y-3">
            {capabilityData.recommendations.map((rec: any, idx: number) => (
              <div key={idx} className="rounded-lg border border-yellow-200 bg-white dark:bg-slate-950 p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-sm">{rec.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{rec.description}</p>
                  </div>
                  <div className="text-right ml-4">
                    <p className="font-bold text-green-600">${rec.potentialSavingsUSD.toFixed(2)}/mo</p>
                    <p className="text-xs text-muted-foreground">Effort: {rec.effort}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
