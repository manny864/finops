import { getAzureCredential, getAllSubscriptionsForTenant, getCostManagementClient } from "@/lib/azure";
import { resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError, type CostColumn } from "@/lib/azureCostColumn";
import { is429, withRetry, mapWithConcurrency, isMgScopeKnownUnusable, markMgScopeUnusable, isStructuralScopeFailure } from "./billingHelpers";
import { errorMessage } from '@/lib/apiErrors';

class MgScopeBypass extends Error {
  constructor() {
    super("MG scope no existe para este tenant: se itera por suscripción");
  }
}

export async function getCostForecast(
  tenantId: string,
  subscriptionId: string,
  metricType: "ActualCost" | "AmortizedCost" = "ActualCost"
): Promise<Array<{ date: string; forecastCost: number }>> {
  let credential: Awaited<ReturnType<typeof getAzureCredential>>;
  let client: Awaited<ReturnType<typeof getCostManagementClient>>;
  try {
    credential = await getAzureCredential(tenantId);
    client = await getCostManagementClient(tenantId);
  } catch (e) {
    console.warn(`[BillingService] getCostForecast: no credentials for tenant ${tenantId}:`, errorMessage(e));
    return [];
  }

  const scope =
    subscriptionId === "All" || subscriptionId.toLowerCase() === "all"
      ? `/providers/Microsoft.Management/managementGroups/${tenantId}`
      : `/subscriptions/${subscriptionId}`;

  const today = new Date();
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (todayDate.getTime() >= endOfMonth.getTime()) {
    console.log("[BillingService] getCostForecast: last day of month, skipping forecast to avoid date-range 400.");
    return [];
  }

  const forecastOptions = (col: CostColumn) =>
    ({
      type: metricType === "ActualCost" ? "ActualCost" : "AmortizedCost",
      timeframe: "Custom",
      timePeriod: {
        from: today,
        to: endOfMonth,
      },
      dataset: {
        granularity: "Daily",
        aggregation: {
          totalCost: {
            name: col,
            function: "Sum",
          },
        },
      },
    }) as any;

  let result;
  let fallbackResults: any[] = [];
  let isFallback = false;
  let activeCol: CostColumn = await resolveCostColumn(tenantId);

  const isAllScope = subscriptionId === "All" || subscriptionId.toLowerCase() === "all";

  try {
    if (isAllScope) throw new MgScopeBypass();

    try {
      result = await withRetry(() => client.forecast.usage(scope, forecastOptions(activeCol)), {
        label: `forecast(${scope})`,
        maxRetries: 0,
      });
    } catch (colErr) {
      if (activeCol === "CostUSD" && isCostUsdUnsupportedError(colErr)) {
        console.warn(`[BillingService] CostUSD no soportado en forecast para tenant ${tenantId} — degradando a PreTaxCost.`);
        await degradeCostColumn(tenantId);
        activeCol = "PreTaxCost";
        result = await withRetry(() => client.forecast.usage(scope, forecastOptions(activeCol)), {
          label: `forecast(${scope}, PreTaxCost)`,
          maxRetries: 0,
        });
      } else {
        throw colErr;
      }
    }
  } catch (e: any) {
    const is429err = is429(e);
    const isAuthOrNotFound =
      e.statusCode === 403 ||
      e.statusCode === 401 ||
      e.code === "AuthorizationFailed" ||
      e.code === "RBACAccessDenied" ||
      e.message?.includes("AuthorizationFailed") ||
      e.code === "ManagementGroupNotFound" ||
      e.message?.includes("was not found or you don't have access") ||
      e.message?.includes("does not have authorization") ||
      e.message?.includes("does not have any valid subscriptions") ||
      e.statusCode === 400;
    const isAll = isAllScope;
    if (isAll && (e instanceof MgScopeBypass || isAuthOrNotFound || is429err)) {
      isFallback = true;
      if (!(e instanceof MgScopeBypass)) {
        if (isStructuralScopeFailure(e)) {
          markMgScopeUnusable(tenantId, errorMessage(e));
        }
        console.log(
          `[BillingService] MG scope failed for forecast (${is429err ? "429 throttled" : e.code || e.statusCode}), falling back to subscription iteration...`
        );
      }
      try {
        const subIds = await getAllSubscriptionsForTenant(tenantId, credential);
        const subs = subIds.map((subscriptionId) => ({ subscriptionId }));

        fallbackResults = (
          await mapWithConcurrency(subs, 1, async (sub: any, idx: number) => {
            if (idx > 0) {
              await new Promise((r) => setTimeout(r, 400));
            }
            try {
              const res = await withRetry(() => client.forecast.usage(`/subscriptions/${sub.subscriptionId}`, forecastOptions(activeCol)), {
                label: `forecast(sub ${sub.subscriptionId})`,
                maxRetries: 4,
                baseDelayMs: 2500,
              });
              return res;
            } catch {
              return null;
            }
          })
        ).filter((r: any) => r && r.rows);
      } catch (fallbackErr) {
        console.warn("[BillingService] getCostForecast fallback failed:", errorMessage(fallbackErr));
        return [];
      }
    } else {
      console.warn(`[BillingService] getCostForecast scope ${scope} failed (${e?.code || e?.statusCode}): ${e?.message}`);
      return [];
    }
  }

  const forecastMap: Record<string, number> = {};

  const processForecastRows = (rows: any[]) => {
    rows.forEach((row) => {
      const cost = Number(row[0]) || 0;
      const dateStr = String(row[1]);
      if (!forecastMap[dateStr]) forecastMap[dateStr] = 0;
      forecastMap[dateStr] += cost;
    });
  };

  if (isFallback) {
    fallbackResults.forEach((res) => {
      if (res.rows) processForecastRows(res.rows);
    });
  } else {
    if (!result || !result.rows) return [];
    processForecastRows(result.rows);
  }

  const forecastData = Object.keys(forecastMap)
    .sort()
    .map((dateStr) => {
      const formattedDate =
        dateStr.length === 8
          ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`
          : dateStr;
      return {
        date: formattedDate,
        forecastCost: Number(forecastMap[dateStr].toFixed(2)),
      };
    });

  return forecastData;
}
