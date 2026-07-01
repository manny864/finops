import { NextRequest, NextResponse } from "next/server";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { getCurrentMonthAmortizedCosts } from "@/modules/collectors/azure/billingService";

type AuditResults = Record<string, unknown[]>;

function mapAuditData(auditResults: AuditResults) {
  const resourceConfig: Record<string, { type: string; savings: number; issueType: string }> = {
    unattachedDisks: { type: "Disk", savings: 15.0, issueType: "cost" },
    unusedIps: { type: "Public IP", savings: 3.5, issueType: "cost" },
    staleSnapshots: { type: "Snapshot", savings: 5.0, issueType: "cost" },
    emptyAppServicePlans: { type: "App Service Plan", savings: 45.0, issueType: "cost" },
    elasticPools: { type: "SQL Elastic Pool", savings: 250.0, issueType: "cost" },
    loadBalancers: { type: "Load Balancer", savings: 18.0, issueType: "cost" },
    frontDoorWaf: { type: "Front Door WAF", savings: 5.0, issueType: "cost" },
    trafficManager: { type: "Traffic Manager", savings: 3.0, issueType: "cost" },
    appGateways: { type: "App Gateway", savings: 180.0, issueType: "cost" },
    natGateways: { type: "NAT Gateway", savings: 32.0, issueType: "cost" },
    privateEndpoints: { type: "Private Endpoint", savings: 7.0, issueType: "cost" },
    vnetGateways: { type: "VNet Gateway", savings: 130.0, issueType: "cost" },
    ddos: { type: "DDoS Plan", savings: 2944.0, issueType: "cost" },
    orphanedNics: { type: "NIC", savings: 0, issueType: "governance" },
    orphanedNsgs: { type: "NSG", savings: 0, issueType: "governance" },
    availabilitySets: { type: "Availability Set", savings: 0, issueType: "governance" },
    routeTables: { type: "Route Table", savings: 0, issueType: "governance" },
    emptyVnets: { type: "VNet", savings: 0, issueType: "governance" },
    emptySubnets: { type: "Subnet", savings: 0, issueType: "governance" },
    ipGroups: { type: "IP Group", savings: 0, issueType: "governance" },
    privateDnsZones: { type: "Private DNS", savings: 0.25, issueType: "cost" },
    emptyRgs: { type: "Resource Group", savings: 0, issueType: "governance" },
    apiConnections: { type: "API Connection", savings: 0, issueType: "governance" },
    expiredCerts: { type: "Certificate", savings: 0, issueType: "governance" },
    emptySqlServers: { type: "SQL Server", savings: 0, issueType: "governance" },
    stoppedFlexibleServers: { type: "Flexible Server", savings: 25.0, issueType: "cost" },
    emptyCosmosDbAccounts: { type: "Cosmos DB", savings: 24.0, issueType: "cost" },
    emptyEventHubNamespaces: { type: "Event Hub", savings: 11.0, issueType: "cost" },
    emptyServiceBusNamespaces: { type: "Service Bus", savings: 10.0, issueType: "cost" },
    emptyApiManagement: { type: "API Management", savings: 50.0, issueType: "cost" },
    unprovisionedExpressRoute: { type: "ExpressRoute", savings: 55.0, issueType: "cost" },
    unattachedWafPolicies: { type: "WAF Policy", savings: 5.0, issueType: "cost" },
    stoppedVirtualMachines: { type: "VM (Stopped)", savings: 30.0, issueType: "cost" },
    emptyAse: { type: "App Service Env", savings: 300.0, issueType: "cost" },
    taggingNonCompliance: { type: "Tag Issue", savings: 0, issueType: "governance" },
    allVirtualMachines: { type: "__skip__", savings: 0, issueType: "governance" },
    devVirtualMachines: { type: "__skip__", savings: 0, issueType: "governance" },
    expiredTtlResources: { type: "TTL Expired", savings: 10.0, issueType: "cost" },
  };

  const mappedData: Array<Record<string, unknown>> = [];
  for (const [key, config] of Object.entries(resourceConfig)) {
    if (config.type === "__skip__") continue;
    const items = Array.isArray(auditResults[key]) ? (auditResults[key] as Record<string, unknown>[]) : [];
    mappedData.push(
      ...items.map((r) => {
        const estimatedMonthlyCost = Number(r.estimatedMonthlyCost || 0);
        const diskSizeGB = Number(r.diskSizeGB || 0);
        const sizeGB = Number(r.sizeGB || 0);
        const fallbackSavings = diskSizeGB ? diskSizeGB * 0.15 : (sizeGB ? sizeGB * 0.05 : config.savings);
        const potentialSavings = estimatedMonthlyCost || fallbackSavings;
        return {
          ...r,
          type: config.type,
          issueType: config.issueType,
          potentialSavings,
        };
      })
    );
  }

  const zombieCount = Object.values(auditResults).reduce(
    (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
    0
  );

  return { mappedData, zombieCount };
}

async function fetchActualCostMTD(tenantId: string, subscriptionId: string): Promise<number> {
  try {
    const params: any[] = [tenantId];
    let where = 'WHERE tenant_id = ?';
    if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {
      where += ' AND subscription_id = ?';
      params.push(subscriptionId);
    }
    const [rows]: any = await pool.query(
      `SELECT COALESCE(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 0) AS total
       FROM CostSnapshots
       ${where}
         AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
      params
    );
    return Number(rows?.[0]?.total || 0);
  } catch (e: any) {
    console.warn('[Summary] MTD cost DB read failed:', e?.message);
    return 0;
  }
}

async function fetchHistogramFromDb(tenantId: string, subscriptionId: string): Promise<{ date: string; cost: number }[]> {
  try {
    const params: any[] = [tenantId];
    let where = 'WHERE tenant_id = ?';
    if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {
      where += ' AND subscription_id = ?';
      params.push(subscriptionId);
    }
    const [rows]: any = await pool.query(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d,
              ROUND(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 2) AS cost
       FROM CostSnapshots
       ${where}
         AND date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)
       GROUP BY d
       ORDER BY d ASC`,
      params
    );
    return (rows || []).map((r: any) => ({ date: String(r.d), cost: Number(r.cost) || 0 }));
  } catch (e: any) {
    console.warn('[Summary] histogram DB read failed:', e?.message);
    return [];
  }
}

function buildHistogramRows(data: unknown[]) {
  const aggregated = new Map<string, number>();

  const normalizeDate = (value: unknown): string | null => {
    const raw = String(value || "").trim();
    if (!raw) return null;

    const isoDate = raw.includes("T") ? raw.split("T")[0] : raw;
    const compactMatch = isoDate.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compactMatch) {
      const [, y, m, d] = compactMatch;
      return `${y}-${m}-${d}`;
    }

    const dashedMatch = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dashedMatch) return isoDate;

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getUTCFullYear();
      const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
      const d = String(parsed.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }

    return null;
  };

  (Array.isArray(data) ? data : []).forEach((entryRaw) => {
    const entry = entryRaw as Record<string, unknown>;
    const usageDate =
      entry.UsageDate ||
      entry.date ||
      (entry.ChargePeriodStart ? String(entry.ChargePeriodStart).split("T")[0] : null);
    if (!usageDate) return;

    const normalizedDate = normalizeDate(usageDate);
    if (!normalizedDate) return;

    const costValue = Number(entry.EffectiveCost ?? entry.BilledCost ?? entry.cost ?? 0);
    const previous = aggregated.get(normalizedDate) || 0;
    aggregated.set(normalizedDate, previous + (Number.isFinite(costValue) ? costValue : 0));
  });

  return [...aggregated.entries()]
    .map(([date, cost]) => ({ date, cost: Number(cost.toFixed(2)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const subscriptionId = searchParams.get("subscriptionId") || "All";
    const authHeader = request.headers.get("authorization");
    const cronAuth = request.headers.get("x-cron-auth");

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    // Auth: o Bearer token de usuario, o X-Cron-Auth interno.
    if (!cronAuth && (!authHeader || !authHeader.startsWith("Bearer "))) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

    const cacheKey = `dashboard:summary:v6:${tenantId}:${subscriptionId.toLowerCase()}`;
    const data = await getWithStaleWhileRevalidate(
      cacheKey,
      async () => {
        const origin = request.nextUrl.origin;
        const subParam = subscriptionId && subscriptionId.toLowerCase() !== "all"
          ? `&subscriptionId=${encodeURIComponent(subscriptionId)}`
          : "";
        const headers: Record<string, string> = {};
        if (authHeader) headers["Authorization"] = authHeader;
        // Forwardear X-Cron-Auth si vino, para que el pre-warm vía cron
        // pueda llamar audit/forecast sin necesidad de un token de usuario.
        if (cronAuth) headers["X-Cron-Auth"] = cronAuth;

        // Helper: fetch with a hard timeout so un sub-endpoint lento no detiene
        // toda la respuesta del dashboard. AbortController evita request colgados.
        const timedFetch = async (url: string, ms: number) => {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), ms);
          try {
            return await fetch(url, { headers, cache: "no-store", signal: ctrl.signal });
          } finally {
            clearTimeout(t);
          }
        };

        // Disparamos audit, forecast y MTD cost en paralelo. NINGUNO bloquea al resto:
        // si audit falla o tarda, el dashboard sigue mostrando costos (de DB) y viceversa.
        const [auditSettled, forecastSettled, mtdActual] = await Promise.all([
          timedFetch(
            `${origin}/api/audit/full?tenantId=${encodeURIComponent(tenantId)}${subParam}`,
            18000
          ).then(async r => {
            if (r.ok) return r.json();
            // 403 con MISSING_RBAC_ROLE / MISSING_ADMIN_CONSENT = SP sin permisos.
            // No es un fallo de infraestructura: el tenant aún no completó onboarding
            // técnico. Tratamos como auditoría vacía (no degraded) en lugar de failure.
            if (r.status === 403) {
              try {
                const body = await r.json().catch(() => ({}));
                if (body.error === 'MISSING_RBAC_ROLE' || body.error === 'MISSING_ADMIN_CONSENT') {
                  console.warn('[Summary] audit returned 403 (SP sin permisos) — tratado como vacío');
                  return { auditResults: {}, __noPermissions: true };
                }
              } catch { /* ignore */ }
            }
            return Promise.reject(new Error(`audit ${r.status}`));
          })
           .catch(e => ({ __failed: true, error: String(e?.message || e) })),
          timedFetch(
            `${origin}/api/intelligence/forecast?tenantId=${encodeURIComponent(tenantId)}&subscriptionId=${encodeURIComponent(subscriptionId)}`,
            12000
          ).then(r => r.ok ? r.json() : Promise.reject(new Error(`forecast ${r.status}`)))
           .catch(e => ({ __failed: true, error: String(e?.message || e) })),
          fetchActualCostMTD(tenantId, subscriptionId),
        ]);

        const auditFailed = (auditSettled as any).__failed === true;
        const forecastFailed = (forecastSettled as any).__failed === true;
        // Audit without permissions = empty results, not a failure
        const auditNoPerms = (auditSettled as any).__noPermissions === true;
        // Azure Cost Management unavailable = SP has no Cost Management Reader or subscriptions have no data
        const forecastAzureUnavailable = !forecastFailed && (forecastSettled as any).azureUnavailable === true;

        const auditJson = (auditFailed || auditNoPerms) ? { auditResults: {} } : auditSettled;
        // If forecast returned { data: [], azureUnavailable: true } it's a 200 (not failed)
        const forecastJson = forecastFailed ? {} : forecastSettled;

        if (auditFailed) console.warn('[Summary] audit failed (degraded):', (auditSettled as any).error);
        if (forecastFailed) console.warn('[Summary] forecast failed (degraded):', (forecastSettled as any).error);
        if (forecastAzureUnavailable) console.warn('[Summary] Azure Cost Management unavailable or no data for this scope');

        const auditResults = (auditJson.auditResults || {}) as AuditResults;
        const { mappedData, zombieCount } = mapAuditData(auditResults);
        const totalSavings = mappedData.reduce((sum, item) => sum + Number(item.potentialSavings || 0), 0);
        const environmentalImpact = Number(((totalSavings / 100) * 15).toFixed(1));

        // actualCost: fuente primaria — forecast data (que incluye live Azure MTD)
        // Si forecast vino vacío/falló, fallback a CostSnapshots DB (MTD).
        let actualCost = 0;
        let forecastSum = 0;
        const combinedData = Array.isArray((forecastJson as any).data) ? (forecastJson as any).data : [];
        combinedData.forEach((itemRaw: unknown) => {
          const item = itemRaw as Record<string, unknown>;
          const current = Number(item.actualCost || 0);
          const forecast = Number(item.forecastCost || 0);
          if (Number.isFinite(current)) actualCost += current;
          if (Number.isFinite(forecast)) forecastSum += forecast;
        });
        if (actualCost === 0) actualCost = mtdActual;

        // projectedCost: si tenemos forecast, actualCost + forecastSum.
        // Si no, proyección lineal: MTD * (díasMes / díaActual).
        let projectedCost: number;
        if (forecastSum > 0 || actualCost > 0) {
          if (forecastSum > 0) {
            projectedCost = actualCost + forecastSum;
          } else {
            const today = new Date();
            const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
            const currentDay = Math.max(today.getDate(), 1);
            projectedCost = actualCost * (daysInMonth / currentDay);
          }
        } else {
          projectedCost = 0;
        }

        // Histograma: pull directo de CostSnapshots (FOCUS) últimos 365 días.
        // Si está vacío, fallback live (best-effort, sin throw).
        let histogram = await fetchHistogramFromDb(tenantId, subscriptionId);
        let liveData: Awaited<ReturnType<typeof getCurrentMonthAmortizedCosts>> | null = null;
        if (histogram.length === 0) {
          try {
            liveData = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId, 'ActualCost');
            histogram = buildHistogramRows(liveData || []);
          } catch (e: any) {
            console.warn('[Summary] live billing fallback failed:', e?.message);
          }
        }

        // Si actualCost sigue en 0 (DB vacía y forecast sin datos) pero hay datos live,
        // usar el live para mostrar costo real del mes actual en lugar de $0.
        if (actualCost === 0 && liveData && liveData.length > 0) {
          const currYM = new Date().toISOString().slice(0, 7); // YYYY-MM
          let liveActual = 0;
          for (const entry of liveData) {
            const rawDate = String(
              (entry as any).ChargePeriodStart ?? (entry as any).UsageDate ?? ''
            ).slice(0, 7);
            if (rawDate === currYM) {
              liveActual += Number((entry as any).EffectiveCost ?? (entry as any).BilledCost ?? 0);
            }
          }
          if (liveActual > 0) {
            console.log(`[Summary] actualCost computed from live Azure data: ${liveActual.toFixed(2)}`);
            actualCost = liveActual;
            if (projectedCost === 0) {
              const today = new Date();
              const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
              const currentDay = Math.max(today.getDate(), 1);
              projectedCost = actualCost * (daysInMonth / currentDay);
            }
          }
        }

        return {
          actualCost,
          projectedCost,
          zombieCount,
          totalSavings,
          environmentalImpact,
          histogram,
          dashboardData: mappedData,
          auditResults,
          degraded: auditFailed || forecastFailed,
          degradedReason: auditFailed && forecastFailed
            ? 'audit+forecast'
            : auditFailed ? 'audit' : forecastFailed ? 'forecast' : null,
          // Inform UI when SP has no Azure permissions (tenant not yet fully onboarded)
          auditNoPermissions: auditNoPerms,
          // Inform UI when Azure Cost Management is unavailable AND DB is also empty
          // (SP needs Cost Management Reader role, or subscriptions have no spending yet)
          azureNoAccess: forecastAzureUnavailable && mtdActual === 0 && actualCost === 0,
        };
      },
      900,  // hard TTL: 15 min
      300   // soft TTL: 5 min (revalida en background a partir de aquí)
    );

    return NextResponse.json({ success: true, ...data, fromCache: true });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Dashboard summary error:", error);
    return NextResponse.json({ error: "Error interno del dashboard" }, { status: 500 });
  }
}
