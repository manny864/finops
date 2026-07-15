import { NextRequest, NextResponse } from "next/server";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { redis } from "@/lib/redis";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { getCurrentMonthAmortizedCosts, getHistoricalDailyCosts, AZURE_COST_HISTORY_MAX_MONTHS } from "@/modules/collectors/azure/billingService";
import { isMockTenant } from "@/lib/mockData";
import { recordDailySnapshotAsync } from "@/services/snapshotService";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";

type AuditResults = Record<string, unknown[]>;

/**
 * Claves del catálogo KQL que NO representan "recursos zombies/huérfanos"
 * borrables y por lo tanto NO deben contarse en el KPI "Recursos Zombies" del
 * dashboard/whiteboard. Sin este filtro, `zombieCount` sumaba las ~60 claves
 * del audit completo (inventario, gobernanza de tags, licencias, higiene de
 * red), inflando el número y contradiciendo la página de Recursos Zombies —
 * ej. un Network Watcher sin Flow Logs aparecía como "1 recurso zombie" en el
 * KPI pero no en la página de limpieza (bug reportado: KPI muestra 1, la
 * página no muestra nada).
 *
 * Criterio de exclusión:
 *  - Inventario ("todos los X", usados por otras vistas, no son zombies).
 *  - Gobernanza de etiquetas (falta de tags no es un recurso huérfano borrable).
 *  - Optimización de licencias (recomendación de ahorro, no un recurso a borrar).
 *  - Higiene de red / certificados ($0 de ahorro: es "activá esta feature", no
 *    "eliminá este recurso").
 */
const NON_ZOMBIE_AUDIT_KEYS = new Set<string>([
  // Inventario
  "allVirtualMachines",
  "devVirtualMachines",
  "allBastionHosts",
  // Gobernanza de etiquetas
  "taggingNonCompliance",
  "completelyUntaggedResources",
  "missingMandatoryTags",
  // Optimización de licencias
  "missingAhubSql",
  "missingAhubWindowsVMs",
  // Higiene de red / certificados
  "networkWatchersNoFlowLogs",
  "flowLogsWithoutTrafficAnalytics",
  "expiredCerts",
]);

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

  const zombieCount = Object.entries(auditResults).reduce(
    (acc, [key, arr]) =>
      acc + (!NON_ZOMBIE_AUDIT_KEYS.has(key) && Array.isArray(arr) ? arr.length : 0),
    0
  );

  return { mappedData, zombieCount };
}

async function fetchActualCostMTD(tenantId: string, subscriptionId: string): Promise<number> {
  // 1. Redis first (written after a successful live Azure fetch — sub-ms read)
  try {
    const ym = new Date().toISOString().slice(0, 7);
    const redisMtdKey = `cost:mtd:v1:${tenantId}:${subscriptionId.toLowerCase()}:${ym}`;
    const cached = await redis.get(redisMtdKey);
    if (cached !== null) {
      const val = Number(cached);
      if (Number.isFinite(val) && val > 0) {
        console.log(`[Summary] MTD cost from Redis: ${val.toFixed(2)}`);
        return val;
      }
    }
  } catch (e: any) {
    console.warn('[Summary] Redis MTD read failed:', e?.message);
  }

  // 2. MySQL CostSnapshots fallback
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

/**
 * Desglose del costo del mes en curso separando CONSUMO (ChargeType=Usage) de
 * CARGOS ÚNICOS (Purchase de reservas/savings plans/marketplace, Refund, Tax…).
 * El KPI "acumulado" suma ambos, pero el desglose se expone aparte y la
 * proyección se hace solo sobre el consumo — así una compra puntual no infla la
 * proyección ni se atribuye como gasto recurrente de una suscripción.
 *
 * Fuente autoritativa: getCurrentMonthAmortizedCosts (Azure live, trae
 * ChargeCategory por fila). Se cachea el split en Redis hasta fin de día.
 * Devuelve null si Azure no está disponible (el caller cae al total sin split).
 */
async function fetchMTDBreakdown(
  tenantId: string,
  subscriptionId: string
): Promise<{ usageCost: number; purchaseCost: number } | null> {
  const ym = new Date().toISOString().slice(0, 7);
  const key = `cost:mtdsplit:v1:${tenantId}:${subscriptionId.toLowerCase()}:${ym}`;
  try {
    const cached = await redis.get(key);
    if (cached) {
      const p = JSON.parse(cached);
      if (typeof p.usage === 'number' && typeof p.purchase === 'number') {
        return { usageCost: p.usage, purchaseCost: p.purchase };
      }
    }
  } catch { /* Redis miss/parse error — recompute below */ }

  try {
    const entries = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId, 'ActualCost');
    if (!entries || entries.length === 0) return null;
    let usage = 0;
    let purchase = 0;
    for (const e of entries) {
      const c = Number((e as any).EffectiveCost ?? (e as any).BilledCost ?? 0);
      if (!Number.isFinite(c)) continue;
      // ChargeCategory viene de la dimensión ChargeType de Azure; 'Usage' es
      // consumo, cualquier otro valor (Purchase/Refund/Tax/…) es cargo único.
      if (((e as any).ChargeCategory || 'Usage') === 'Usage') usage += c;
      else purchase += c;
    }
    usage = Number(usage.toFixed(2));
    purchase = Number(purchase.toFixed(2));
    const secsUntilMidnight = Math.floor(
      (new Date(new Date().toISOString().slice(0, 10) + 'T23:59:59Z').getTime() - Date.now()) / 1000
    ) + 3600;
    redis.set(key, JSON.stringify({ usage, purchase }), 'EX', Math.max(secsUntilMidnight, 3600))
      .catch((e: any) => console.warn('[Summary] Redis MTD split write failed:', e?.message));
    return { usageCost: usage, purchaseCost: purchase };
  } catch (e: any) {
    console.warn('[Summary] MTD breakdown failed (Azure unavailable):', e?.message);
    return null;
  }
}

async function fetchHistogramFromDb(tenantId: string, subscriptionId: string, days: number = 400): Promise<{ date: string; cost: number }[]> {
  try {
    const params: any[] = [tenantId];
    let where = 'WHERE tenant_id = ?';
    if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {
      where += ' AND subscription_id = ?';
      params.push(subscriptionId);
    }
    // `days` va parametrizado como valor entero validado por el caller (nunca
    // interpolado directo en el SQL) para permitir ventanas > 365 días sin
    // reescribir el query. mysql2 no soporta bind params dentro de INTERVAL,
    // por eso se castea a entero seguro antes de interpolar.
    const safeDays = Math.max(1, Math.min(Math.round(days), 3000));
    const [rows]: any = await pool.query(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d,
              ROUND(SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)), 2) AS cost
       FROM CostSnapshots
       ${where}
         AND date >= DATE_SUB(CURDATE(), INTERVAL ${safeDays} DAY)
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
    // Ventana del histograma en meses, solicitada por el selector del dashboard.
    // Tope duro = límite documentado de Azure Cost Management Query API (ver
    // AZURE_COST_HISTORY_MAX_MONTHS en billingService.ts): más atrás requiere
    // Cost Management Exports, no disponible retroactivamente vía API.
    const monthsParam = Number(searchParams.get("months"));
    const histogramMonths = Number.isFinite(monthsParam) && monthsParam > 0
      ? Math.min(Math.round(monthsParam), AZURE_COST_HISTORY_MAX_MONTHS)
      : 12;

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    // Auth: o Bearer token de usuario, o X-Cron-Auth interno.
    if (!cronAuth && (!authHeader || !authHeader.startsWith("Bearer "))) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

    const cacheKey = `dashboard:summary:v6:${tenantId}:${subscriptionId.toLowerCase()}:${histogramMonths}m`;

    // Bust cache on explicit retry (bust=1) so re-configured tenants see fresh data immediately.
    const bust = searchParams.get("bust") === "1";
    if (bust) {
      try { await redis.del(cacheKey); } catch { /* ignore */ }
      console.log(`[Summary] Cache busted for key ${cacheKey}`);
    }

    const data = await getWithStaleWhileRevalidate(
      cacheKey,
      async () => {
        // Self-fetch server-side: usar loopback interno, NO la origin pública
        // (evita el NAT hairpin que causaba "fetch failed" en audit/forecast).
        const origin = getInternalBaseUrl();
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
            // El catálogo KQL ya supera 45 consultas (batches de 16 con delay
            // de 1500ms + reintentos por 429). Con 30s el audit se abortaba
            // silenciosamente en tenants grandes y el dashboard mostraba
            // zombieCount=0 sin ningún error visible para el usuario.
            60000
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
            25000
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

        // Desglose Consumo vs Compras (cargos únicos). El acumulado (actualCost)
        // sigue siendo el TOTAL, pero exponemos ambos componentes por separado.
        let usageCost = 0;
        let purchaseCost = 0;
        const mtdBreakdown = await fetchMTDBreakdown(tenantId, subscriptionId);
        if (mtdBreakdown) {
          usageCost = mtdBreakdown.usageCost;
          purchaseCost = mtdBreakdown.purchaseCost;
          const breakdownTotal = Number((usageCost + purchaseCost).toFixed(2));
          // Fuente live autoritativa: reemplaza el total de Redis/DB/forecast.
          if (breakdownTotal > 0) actualCost = breakdownTotal;
        }
        // Sin split disponible (Azure caído → total vino de DB/Redis/forecast, que
        // no distinguen ChargeType): tratamos todo como consumo, compras = 0.
        if (usageCost === 0 && purchaseCost === 0 && actualCost > 0) {
          usageCost = Number(actualCost.toFixed(2));
        }

        // projectedCost: proyectar SOLO el consumo a fin de mes; los cargos
        // únicos (purchaseCost) ya ocurridos se suman una vez, nunca se
        // extrapolan como si se repitieran cada día.
        //  - Con forecast de Azure: forecastSum cubre solo días futuros (hoy→fin
        //    de mes) y no incluye la compra pasada, así que actualCost + forecastSum
        //    ya cuenta la compra una sola vez.
        //  - Sin forecast: run-rate lineal sobre el consumo + compras del mes.
        let projectedCost: number;
        if (forecastSum > 0) {
          projectedCost = Number((actualCost + forecastSum).toFixed(2));
        } else if (usageCost > 0) {
          const today = new Date();
          const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
          const currentDay = Math.max(today.getDate(), 1);
          const projectedUsage = usageCost * (daysInMonth / currentDay);
          projectedCost = Number((projectedUsage + purchaseCost).toFixed(2));
        } else if (actualCost > 0) {
          const today = new Date();
          const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
          const currentDay = Math.max(today.getDate(), 1);
          projectedCost = Number((actualCost * (daysInMonth / currentDay)).toFixed(2));
        } else {
          projectedCost = 0;
        }

        // Histograma: pull directo de CostSnapshots (FOCUS) para la ventana
        // solicitada (hasta AZURE_COST_HISTORY_MAX_MONTHS meses, tope de la
        // Query API de Azure). Si está vacío, fallback live (best-effort, sin throw).
        const histogramDays = histogramMonths * 31; // margen holgado por mes calendario
        let histogram = await fetchHistogramFromDb(tenantId, subscriptionId, histogramDays);
        let liveData: Awaited<ReturnType<typeof getCurrentMonthAmortizedCosts>> | null = null;
        if (histogram.length === 0) {
          try {
            liveData = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId, 'ActualCost');
            histogram = buildHistogramRows(liveData || []);
          } catch (e: any) {
            console.warn('[Summary] live billing fallback failed:', e?.message);
          }
        } else if (histogramMonths > 1) {
          // El snapshot diario local puede no cubrir toda la ventana pedida
          // (p.ej. tenants nuevos cuyo job de snapshots arrancó hace poco).
          // Si la fecha más antigua en DB es más reciente que la requerida,
          // completar el resto directo desde Azure Cost Management (best-effort).
          const requiredFrom = new Date();
          requiredFrom.setMonth(requiredFrom.getMonth() - histogramMonths);
          const earliestInDb = histogram[0]?.date;
          if (earliestInDb && new Date(earliestInDb) > requiredFrom) {
            try {
              const historical = await getHistoricalDailyCosts(tenantId, subscriptionId, histogramMonths);
              const byDate = new Map(histogram.map((h) => [h.date, h.cost]));
              for (const { date, cost } of historical) {
                if (!byDate.has(date)) byDate.set(date, cost);
              }
              histogram = Array.from(byDate.entries())
                .map(([date, cost]) => ({ date, cost }))
                .sort((a, b) => a.date.localeCompare(b.date));
            } catch (e: any) {
              console.warn('[Summary] historical Azure fallback for extended histogram failed:', e?.message);
            }
          }
        }

        // Si actualCost sigue en 0 (DB vacía y forecast sin datos) pero hay datos live,
        // usar el live para mostrar costo real del mes actual en lugar de $0.
        if (actualCost === 0 && liveData && liveData.length > 0) {
          const currYM = new Date().toISOString().slice(0, 7); // YYYY-MM
          let liveActual = 0;
          let liveUsage = 0;
          let livePurchase = 0;
          for (const entry of liveData) {
            const rawStr = String(
              (entry as any).ChargePeriodStart ?? (entry as any).UsageDate ?? ''
            );
            // Azure returns dates as YYYYMMDD (compact, no dashes). Normalize to YYYY-MM-DD
            // before slicing to YYYY-MM, otherwise "20260615".slice(0,7) = "2026061" ≠ "2026-06".
            const compact = rawStr.match(/^(\d{4})(\d{2})(\d{2})$/);
            const normalizedDate = compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : rawStr.slice(0, 10);
            if (normalizedDate.slice(0, 7) === currYM) {
              const c = Number((entry as any).EffectiveCost ?? (entry as any).BilledCost ?? 0);
              liveActual += c;
              if (((entry as any).ChargeCategory || 'Usage') === 'Usage') liveUsage += c;
              else livePurchase += c;
            }
          }
          if (liveActual > 0) {
            console.log(`[Summary] actualCost computed from live Azure data: ${liveActual.toFixed(2)}`);
            actualCost = liveActual;
            usageCost = Number(liveUsage.toFixed(2));
            purchaseCost = Number(livePurchase.toFixed(2));
            if (projectedCost === 0) {
              const today = new Date();
              const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
              const currentDay = Math.max(today.getDate(), 1);
              // Run-rate solo sobre consumo; la compra puntual se suma una vez.
              const base = usageCost > 0 ? usageCost : actualCost;
              const oneTime = usageCost > 0 ? purchaseCost : 0;
              projectedCost = Number((base * (daysInMonth / currentDay) + oneTime).toFixed(2));
            }
            // Cache computed MTD cost in Redis so the next request reads it directly
            // instead of going through Azure API again. TTL = rest of day + 1h buffer.
            const ym = new Date().toISOString().slice(0, 7);
            const redisMtdKey = `cost:mtd:v1:${tenantId}:${subscriptionId.toLowerCase()}:${ym}`;
            const secsUntilMidnight = Math.floor(
              (new Date(new Date().toISOString().slice(0, 10) + 'T23:59:59Z').getTime() - Date.now()) / 1000
            ) + 3600; // + 1h buffer past midnight
            redis.set(redisMtdKey, String(liveActual), 'EX', Math.max(secsUntilMidnight, 3600))
              .catch((e: any) => console.warn('[Summary] Redis MTD cache write failed:', e?.message));
          }
        }

        return {
          actualCost,
          usageCost,
          purchaseCost,
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
          // (SP needs Cost Management Reader role, or subscriptions have no spending yet).
          // Also fires when forecast timed out (forecastFailed) but DB is empty — same root cause.
          azureNoAccess: (forecastAzureUnavailable || (forecastFailed && mtdActual === 0)) && actualCost === 0,
        };
      },
      900,  // hard TTL: 15 min
      300,  // soft TTL: 5 min (revalida en background a partir de aquí)
      // No envenenar el cache con resultados degradados: un fallo transitorio
      // del audit/forecast se cachea sólo 60s (en vez de 15 min), así el banner
      // "modo degradado" desaparece apenas Azure se recupera.
      (d: any) => (d && d.degraded ? 60 : 900)
    );

    // Write-through de historial diario (best-effort, solo datos frescos no degradados).
    if (!isMockTenant(tenantId) && data && !data.degraded && !data.azureNoAccess) {
      recordDailySnapshotAsync(tenantId, 'dashboard_summary', {
        actualCost: Number(data.actualCost || 0),
        projectedCost: Number(data.projectedCost || 0),
        totalSavings: Number(data.totalSavings || 0),
        zombieCount: Number(data.zombieCount || 0),
        environmentalImpact: Number(data.environmentalImpact || 0),
      }, subscriptionId);
    }

    return NextResponse.json({ success: true, ...data, fromCache: true });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Dashboard summary error:", error);
    return NextResponse.json({ error: "Error interno del dashboard" }, { status: 500 });
  }
}
