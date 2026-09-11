import { describe, it, expect } from "vitest";
import {
  normalizeHostPlatform,
  normalizeMode,
  isPublicIp,
  isGeoFilterRule,
  isRateLimitRule,
  looksProduction,
  calcPolicyMonthlyCost,
  calcGeoFilterSaving,
  toOriginMetrics,
  calculateWafSummary,
  generateWafRecommendations,
  getMockWafPayload,
  fetchLiveWafData,
} from "@/services/azureWaf.service";
import { buildWafRemediationCommand } from "@/lib/aiRemediations";
import type { WafPolicyResourceItem } from "@/types/azureWaf.types";

const policy = (over: Partial<WafPolicyResourceItem> = {}): WafPolicyResourceItem => ({
  id: "/subscriptions/s/resourceGroups/rg-prod/providers/Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/wafP",
  name: "wafP",
  hostPlatform: "ApplicationGateway",
  location: "eastus",
  resourceGroup: "rg-prod",
  subscriptionId: "s",
  subscriptionName: "Produccion",
  mode: "Prevention",
  state: "Enabled",
  managedRuleSet: "OWASP 3.2",
  customRulesCount: 1,
  hasGeoFilterRule: false,
  hasRateLimitRule: false,
  associatedEndpoints: ["appgw-prod"],
  totalRequestsMTD: 5_000_000,
  blockedRequestsCount: 20_000,
  detectedRequestsCount: 0,
  throughputGB: 100,
  avgCapacityUnits: 20,
  monthlyCostUSD: 0,
  isOrphan: false,
  needsPreventionMode: false,
  isProduction: true,
  ...over,
});

describe("WAF — normalizacion", () => {
  it("distingue plataforma por tipo de recurso", () => {
    expect(normalizeHostPlatform("microsoft.network/frontdoorwebapplicationfirewallpolicies")).toBe("FrontDoor");
    expect(normalizeHostPlatform("Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies")).toBe(
      "ApplicationGateway"
    );
  });

  it("cualquier modo distinto de Prevention se trata como Detection", () => {
    expect(normalizeMode("Prevention")).toBe("Prevention");
    expect(normalizeMode("prevention")).toBe("Prevention");
    expect(normalizeMode("Detection")).toBe("Detection");
    // Ante un valor desconocido, asumir Prevention ocultaria el riesgo.
    expect(normalizeMode(undefined)).toBe("Detection");
    expect(normalizeMode("Weird")).toBe("Detection");
  });

  it("excluye rangos privados, loopback, link-local y CGNAT del ranking de IPs", () => {
    expect(isPublicIp("45.155.205.233")).toBe(true);
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("10.0.0.5")).toBe(false);
    expect(isPublicIp("172.16.3.9")).toBe(false);
    expect(isPublicIp("172.32.3.9")).toBe(true); // fuera del rango 16-31
    expect(isPublicIp("192.168.1.1")).toBe(false);
    expect(isPublicIp("127.0.0.1")).toBe(false);
    expect(isPublicIp("169.254.1.1")).toBe(false);
    expect(isPublicIp("100.100.1.1")).toBe(false); // CGNAT
    expect(isPublicIp("224.0.0.1")).toBe(false); // multicast
    expect(isPublicIp("no-es-ip")).toBe(false);
    expect(isPublicIp("999.1.1.1")).toBe(false);
    // Con puerto adjunto igual debe resolver.
    expect(isPublicIp("45.155.205.233:443")).toBe(true);
  });

  it("detecta reglas de geo-filtro y de rate limiting", () => {
    expect(
      isGeoFilterRule({
        matchConditions: [{ operator: "GeoMatch", matchVariables: [{ variableName: "RemoteAddr" }] }],
      })
    ).toBe(true);
    expect(isGeoFilterRule({ matchConditions: [{ operator: "IPMatch", matchVariables: [] }] })).toBe(false);
    expect(isGeoFilterRule({})).toBe(false);

    expect(isRateLimitRule({ ruleType: "RateLimitRule" })).toBe(true);
    expect(isRateLimitRule({ ruleType: "MatchRule" })).toBe(false);
  });

  it("clasifica produccion priorizando la señal explicita de no-prod", () => {
    expect(
      looksProduction({ name: "wafDev", resourceGroup: "rg-dev", subscriptionName: "Prod", associatedEndpoints: [] })
    ).toBe(false);
    expect(
      looksProduction({ name: "wafProd", resourceGroup: "rg-x", subscriptionName: "X", associatedEndpoints: [] })
    ).toBe(true);
    // Sin señal en nombres, un dominio propio se trata como productivo:
    // equivocarse al reves callaria la alerta de Detection en produccion.
    expect(
      looksProduction({
        name: "waf1",
        resourceGroup: "rg-x",
        subscriptionName: "X",
        associatedEndpoints: ["api.cscloudsolutions.com.ar"],
      })
    ).toBe(true);
    // Un endpoint gestionado por Azure no alcanza como señal de produccion.
    expect(
      looksProduction({
        name: "waf1",
        resourceGroup: "rg-x",
        subscriptionName: "X",
        associatedEndpoints: ["myapp.azurefd.net"],
      })
    ).toBe(false);
  });
});

describe("WAF — economias distintas por plataforma", () => {
  it("Application Gateway cobra instancia fija mas Capacity Units", () => {
    const cost = calcPolicyMonthlyCost({
      hostPlatform: "ApplicationGateway",
      state: "Enabled",
      isOrphan: false,
      avgCapacityUnits: 20,
      totalRequestsMTD: 5_000_000,
      customRulesCount: 1,
    });
    // 0.36 * 730 = 262.80 fijo + 20 * 0.0144 * 730 = 210.24
    expect(cost).toBeCloseTo(262.8 + 210.24, 1);
  });

  it("Front Door cobra base plana mas cargo por millon de solicitudes", () => {
    const cost = calcPolicyMonthlyCost({
      hostPlatform: "FrontDoor",
      state: "Enabled",
      isOrphan: false,
      avgCapacityUnits: 0,
      totalRequestsMTD: 10_000_000,
      customRulesCount: 4,
    });
    // 330 base + 20 ruleset + 4 reglas + 10 por millones
    expect(cost).toBeCloseTo(330 + 20 + 4 + 10, 1);
  });

  it("una politica huerfana o deshabilitada no factura computo", () => {
    expect(
      calcPolicyMonthlyCost({
        hostPlatform: "ApplicationGateway",
        state: "Enabled",
        isOrphan: true,
        avgCapacityUnits: 20,
        totalRequestsMTD: 0,
        customRulesCount: 2,
      })
    ).toBe(0);
    expect(
      calcPolicyMonthlyCost({
        hostPlatform: "FrontDoor",
        state: "Disabled",
        isOrphan: false,
        avgCapacityUnits: 0,
        totalRequestsMTD: 5_000_000,
        customRulesCount: 0,
      })
    ).toBe(0);
  });

  it("el ahorro por geo-filtro SOLO existe en Application Gateway", () => {
    // Es la distincion clave del modulo: en Front Door la solicitud se paga
    // igual se bloquee o se permita.
    const appgw = calcGeoFilterSaving(policy({ hostPlatform: "ApplicationGateway", avgCapacityUnits: 20 }));
    expect(appgw).toBeCloseTo(20 * 0.0144 * 730 * 0.3, 1);

    expect(calcGeoFilterSaving(policy({ hostPlatform: "FrontDoor", avgCapacityUnits: 0 }))).toBe(0);
    expect(calcGeoFilterSaving(policy({ isOrphan: true }))).toBe(0);
    expect(calcGeoFilterSaving(policy({ state: "Disabled" }))).toBe(0);
  });
});

describe("WAF — agregacion", () => {
  it("toOriginMetrics ordena, recorta y calcula porcentajes sobre el total", () => {
    const m = toOriginMetrics(
      [
        { identifier: "A", blockedCount: 10 },
        { identifier: "B", blockedCount: 30 },
        { identifier: "C", blockedCount: 60 },
      ],
      2
    );
    expect(m.map((x) => x.identifier)).toEqual(["C", "B"]);
    expect(m[0].percentage).toBe(60);
    expect(toOriginMetrics([])).toEqual([]);
  });

  it("la economia unitaria no divide por cero", () => {
    const s = calculateWafSummary([], [], [], [], []);
    expect(s.costPerAppUSD).toBe(0);
    expect(s.costPerMillionRequestsUSD).toBe(0);
    expect(s.costPerGbUSD).toBe(0);
    expect(s.blockRatePercentage).toBe(0);
    expect(s.falsePositiveRatePercentage).toBe(0);
  });

  it("las politicas huerfanas no cuentan como aplicaciones protegidas", () => {
    const s = calculateWafSummary(
      [policy({ id: "p1" }), policy({ id: "p2", isOrphan: true }), policy({ id: "p3", state: "Disabled" })],
      [],
      [],
      [],
      []
    );
    expect(s.totalProtectedApps).toBe(1);
    expect(s.orphanPoliciesCount).toBe(1);
  });

  it("la tasa de falsos positivos se aproxima con los bloqueos de baja severidad", () => {
    const s = calculateWafSummary(
      [policy({ blockedRequestsCount: 1000 })],
      [
        { categoryName: "SQLi", severity: "High", attemptsCount: 900, payloadExamples: [] },
        { categoryName: "Scanner", severity: "Low", attemptsCount: 50, payloadExamples: [] },
      ],
      [],
      [],
      []
    );
    expect(s.falsePositiveRatePercentage).toBe(5);
  });
});

describe("WAF — recomendaciones", () => {
  it("Detection en produccion es RIESGO con ahorro cero", () => {
    const rec = generateWafRecommendations(
      [policy({ mode: "Detection", needsPreventionMode: true, detectedRequestsCount: 61_480 })],
      []
    ).find((r) => r.category === "ENABLE_PREVENTION");
    expect(rec).toBeDefined();
    expect(rec!.estimatedSavingsUSD).toBe(0);
    expect(rec!.params).toMatchObject({ detected: 61_480, hasEndpoints: 1 });
  });

  it("Detection fuera de produccion NO dispara la alerta", () => {
    // En Dev es justamente donde se calibran las exclusiones.
    expect(
      generateWafRecommendations(
        [policy({ mode: "Detection", needsPreventionMode: false, resourceGroup: "rg-dev" })],
        []
      ).some((r) => r.category === "ENABLE_PREVENTION")
    ).toBe(false);
  });

  it("el geo-filtro en Front Door se ofrece con ahorro CERO y lo dice", () => {
    const rec = generateWafRecommendations(
      [policy({ hostPlatform: "FrontDoor", avgCapacityUnits: 0, blockedRequestsCount: 5000 })],
      [{ identifier: "CN", countryName: "China", blockedCount: 100, percentage: 100 }]
    ).find((r) => r.category === "GEO_FILTER_RULE");
    expect(rec).toBeDefined();
    expect(rec!.estimatedSavingsUSD).toBe(0);
    expect(rec!.params).toMatchObject({ platform: "FrontDoor" });
  });

  it("el geo-filtro en Application Gateway si reclama ahorro de Capacity Units", () => {
    const rec = generateWafRecommendations(
      [policy({ hostPlatform: "ApplicationGateway", avgCapacityUnits: 20, blockedRequestsCount: 5000 })],
      [{ identifier: "CN", countryName: "China", blockedCount: 100, percentage: 100 }]
    ).find((r) => r.category === "GEO_FILTER_RULE");
    expect(rec!.estimatedSavingsUSD).toBeGreaterThan(0);
    expect(rec!.params).toMatchObject({ platform: "ApplicationGateway", ratio: 30 });
  });

  it("no propone geo-filtro si la politica ya lo tiene", () => {
    expect(
      generateWafRecommendations(
        [policy({ hasGeoFilterRule: true, blockedRequestsCount: 5000 })],
        [{ identifier: "CN", blockedCount: 100, percentage: 100 }]
      ).some((r) => r.category === "GEO_FILTER_RULE")
    ).toBe(false);
  });

  it("la politica huerfana se reporta con ahorro cero: no hay gasto que recortar", () => {
    const rec = generateWafRecommendations([policy({ isOrphan: true })], []).find(
      (r) => r.category === "PURGE_ORPHAN_POLICY"
    );
    expect(rec).toBeDefined();
    expect(rec!.estimatedSavingsUSD).toBe(0);
    // Una huerfana no debe generar ademas alertas de modo o de reglas.
    expect(generateWafRecommendations([policy({ isOrphan: true })], []).length).toBe(1);
  });

  it("el rate limiting se propone sobre volumen alto y advierte el NAT corporativo", () => {
    const rec = generateWafRecommendations([policy({ totalRequestsMTD: 5_000_000 })], []).find(
      (r) => r.category === "RATE_LIMITING"
    );
    expect(rec).toBeDefined();
    expect(rec!.params).toMatchObject({ millions: "5.0" });
    // Con poco volumen no aplica.
    expect(
      generateWafRecommendations([policy({ totalRequestsMTD: 100_000 })], []).some(
        (r) => r.category === "RATE_LIMITING"
      )
    ).toBe(false);
  });
});

describe("WAF — payload demo", () => {
  it("genera dataset con las tres reglas representadas", () => {
    const payload = getMockWafPayload("demo-tenant-2222");
    expect(payload.source).toBe("mock");
    expect(payload.policies.length).toBeGreaterThan(3);
    expect(payload.remediations.some((r) => r.category === "ENABLE_PREVENTION")).toBe(true);
    expect(payload.remediations.some((r) => r.category === "PURGE_ORPHAN_POLICY")).toBe(true);
    expect(payload.summary.threatsBreakdown.length).toBeGreaterThan(3);
    expect(payload.summary.topIps.length).toBe(5);
    expect(payload.summary.topCountries.length).toBe(5);
  });

  it("las IPs del top son todas publicas", () => {
    const payload = getMockWafPayload("demo-4444");
    expect(payload.summary.topIps.every((ip) => isPublicIp(ip.identifier))).toBe(true);
  });

  it("la politica de Dev en Detection no genera alerta de riesgo", () => {
    const payload = getMockWafPayload("demo-2222");
    const dev = payload.policies.find((p) => p.name === "wafPolicyDev");
    expect(dev).toBeDefined();
    expect(dev!.mode).toBe("Detection");
    expect(dev!.needsPreventionMode).toBe(false);
  });

  it("escala por tier y es determinista", () => {
    const pro = getMockWafPayload("demo-1111");
    const business = getMockWafPayload("demo-2222");
    const enterprise = getMockWafPayload("demo-4444");
    expect(business.policies.length).toBeGreaterThan(pro.policies.length);
    expect(enterprise.policies.length).toBeGreaterThan(business.policies.length);
    expect(getMockWafPayload("demo-4444").summary.totalMonthlyCostUSD).toBe(
      enterprise.summary.totalMonthlyCostUSD
    );
  });

  it("los porcentajes de origenes suman ~100%", () => {
    const s = getMockWafPayload("demo-4444").summary;
    expect(s.topCountries.reduce((a, c) => a + c.percentage, 0)).toBeGreaterThan(99);
    expect(s.topCountries.reduce((a, c) => a + c.percentage, 0)).toBeLessThan(101);
  });

  it("un tenant real sin credenciales recibe estado vacio legitimo, nunca el mock", async () => {
    const result = await fetchLiveWafData("real-nonexistent-tenant-999");
    expect(result.source).toBe("live");
    expect(result.policies).toEqual([]);
    expect(result.summary.threatsBreakdown).toEqual([]);
    expect(result.summary.topIps).toEqual([]);
  });
});

describe("WAF — comandos de remediacion", () => {
  const base = {
    id: "r",
    policyId: "/subscriptions/s/resourceGroups/rg-prod/providers/Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/wafP",
    policyName: "wafP",
    title: "t",
    description: "d",
    estimatedSavingsUSD: 0,
    confidence: "HIGH" as const,
    actionType: "X",
  };

  it("el cambio a Prevention revisa los eventos ANTES de cambiar el modo", () => {
    const c = buildWafRemediationCommand({ ...base, category: "ENABLE_PREVENTION" });
    expect(c.cli).toContain("#{cmt_waf_azurediagnostics}");
    // Lo que importa es el ORDEN: la consulta de diagnostico va antes del cambio
    // de modo. La consulta ahora es un marcador, el comando sigue siendo literal.
    expect(c.cli.indexOf("#{cmt_waf_summarize_count_by_ruleid_s_action}")).toBeLessThan(
      c.cli.indexOf("--mode Prevention")
    );
    expect(c.cli).toContain("#{cmt_waf_no_cambiar_en_frio_revisar_primero}");
  });

  it("el geo-filtro usa prioridad baja, que es lo que produce el ahorro", () => {
    const c = buildWafRemediationCommand({ ...base, category: "GEO_FILTER_RULE" });
    expect(c.cli).toContain("--priority 10");
    expect(c.cli).toContain("GeoMatch");
    // El porque de la prioridad baja vive en el catalogo; el builder tiene que
    // seguir emitiendo esa explicacion.
    expect(c.cli).toContain("#{cmt_waf_la_prioridad_es_lo_que_produce}");
  });

  it("el rate limiting empieza en modo Log para calibrar", () => {
    const c = buildWafRemediationCommand({ ...base, category: "RATE_LIMITING" });
    expect(c.cli).toContain("--action Log");
    expect(c.cli).toContain("#{cmt_waf_mal_elegido_bloquea_a_todos_los}");
  });

  it("la purga verifica asociaciones antes de borrar", () => {
    const c = buildWafRemediationCommand({ ...base, category: "PURGE_ORPHAN_POLICY" });
    expect(c.cli.indexOf("waf-policy show")).toBeLessThan(c.cli.indexOf("waf-policy delete"));
  });

  it("usa los comandos correctos segun la plataforma", () => {
    const afd = buildWafRemediationCommand({
      ...base,
      policyId: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/wafP",
      category: "ENABLE_PREVENTION",
    });
    expect(afd.cli).toContain("front-door waf-policy update");
    expect(afd.powershell).toContain("Update-AzFrontDoorWafPolicy");

    const appgw = buildWafRemediationCommand({ ...base, category: "ENABLE_PREVENTION" });
    expect(appgw.cli).toContain("application-gateway waf-policy");
    expect(appgw.powershell).toContain("Set-AzApplicationGatewayFirewallPolicy");
  });

  it("escapa el nombre de la politica", () => {
    const c = buildWafRemediationCommand({
      ...base,
      policyName: 'waf"; rm -rf ~; #',
      category: "PURGE_ORPHAN_POLICY",
    });
    expect(c.cli).toContain('waf\\"');
    expect(c.cli).not.toMatch(/--name "waf"; rm/);
  });
});
