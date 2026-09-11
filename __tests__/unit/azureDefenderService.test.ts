import { describe, it, expect } from "vitest";
import {
  normalizePlanName,
  normalizeSubPlan,
  classifyEnvironment,
  dominantEnvironment,
  unitPriceFor,
  calcPlanMonthlyCost,
  deriveCoverageStatus,
  generateDefenderRecommendations,
  calculateDefenderSummary,
  getMockDefenderPayload,
  fetchLiveDefenderData,
} from "@/services/azureDefender.service";
import { buildDefenderRemediationCommand } from "@/lib/aiRemediations";
import type { DefenderAssociatedResource, DefenderPlanItem } from "@/types/azureDefender.types";

const resource = (over: Partial<DefenderAssociatedResource> = {}): DefenderAssociatedResource => ({
  resourceId: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm",
  resourceName: "vm",
  resourceType: "Microsoft.Compute/virtualMachines",
  resourceGroup: "rg",
  location: "eastus",
  environment: "Production",
  isProtected: true,
  ...over,
});

const plan = (over: Partial<DefenderPlanItem> = {}): DefenderPlanItem => ({
  id: "s/VirtualMachines",
  planKey: "VirtualMachines",
  planDisplayName: "Defender for Servers",
  category: "Servers",
  subscriptionId: "s",
  subscriptionName: "Produccion",
  pricingTier: "Standard",
  subPlan: "Plan2",
  coveredResourcesCount: 1,
  uncoveredResourcesCount: 0,
  monthlyCostUSD: 15,
  coverageStatus: "Full",
  dominantEnvironment: "Production",
  hasUnprotectedProduction: false,
  associatedResources: [resource()],
  ...over,
});

describe("Defender for Cloud — normalizacion de planes", () => {
  it("traduce los nombres tecnicos de Azure a su denominacion comercial", () => {
    expect(normalizePlanName("VirtualMachines").displayName).toBe("Defender for Servers");
    expect(normalizePlanName("StorageAccounts").displayName).toBe("Defender for Storage");
    expect(normalizePlanName("SqlServers").category).toBe("Databases");
    expect(normalizePlanName("CloudPosture").displayName).toBe("Defender CSPM");
    expect(normalizePlanName("Arm").displayName).toBe("Defender for Resource Manager");
    // Case-insensitive: Azure no es consistente con las mayusculas.
    expect(normalizePlanName("virtualmachines").displayName).toBe("Defender for Servers");
  });

  it("un plan desconocido conserva un nombre legible en vez de caer a 'Other'", () => {
    // Era exactamente el defecto de la version anterior del tablero.
    const unknown = normalizePlanName("SomeBrandNewPlan");
    expect(unknown.displayName).toBe("Defender for Some Brand New Plan");
    expect(unknown.category).toBe("Other");
    expect(unknown.displayName).not.toBe("Other");
  });

  it("normaliza el subPlan en las dos formas que devuelve Azure", () => {
    expect(normalizeSubPlan("P1")).toBe("Plan1");
    expect(normalizeSubPlan("Plan1")).toBe("Plan1");
    expect(normalizeSubPlan("p2")).toBe("Plan2");
    expect(normalizeSubPlan("Plan2")).toBe("Plan2");
    expect(normalizeSubPlan(null)).toBeUndefined();
    expect(normalizeSubPlan("P3")).toBeUndefined();
  });
});

describe("Defender for Cloud — clasificacion de entorno", () => {
  it("el tag Environment gana sobre el nombre del grupo de recursos", () => {
    // El RG dice dev pero el tag dice prod: manda el tag.
    expect(classifyEnvironment("rg-dev-app", { Environment: "Production" })).toBe("Production");
    expect(classifyEnvironment("rg-prod-app", { environment: "dev" })).toBe("Development");
    expect(classifyEnvironment("rg-x", { Ambiente: "staging" })).toBe("Staging");
  });

  it("cae al nombre del RG cuando no hay tag", () => {
    expect(classifyEnvironment("rg-dev-ci", null)).toBe("Development");
    expect(classifyEnvironment("rg-staging-app", null)).toBe("Staging");
    expect(classifyEnvironment("rg-qa-web", {})).toBe("Development");
  });

  it("sin señal asume produccion: clasificar mal hacia Dev llevaria a recomendar bajar seguridad", () => {
    expect(classifyEnvironment("rg-app-core", null)).toBe("Production");
    expect(classifyEnvironment("", null)).toBe("Production");
    // No debe disparar por subcadenas dentro de otra palabra.
    expect(classifyEnvironment("rg-device-mgmt", null)).toBe("Production");
  });

  it("deriva el entorno dominante por mayoria", () => {
    expect(
      dominantEnvironment([
        resource({ environment: "Development" }),
        resource({ environment: "Development" }),
        resource({ environment: "Production" }),
      ])
    ).toBe("Development");
    expect(dominantEnvironment([])).toBe("Production");
  });
});

describe("Defender for Cloud — costo y cobertura", () => {
  it("aplica la tarifa correcta por plan y sub-plan", () => {
    expect(unitPriceFor("Servers", "Plan1")).toBe(5);
    expect(unitPriceFor("Servers", "Plan2")).toBe(15);
    // Sin subPlan explicito Azure aplica Plan 2, que es el default de Standard.
    expect(unitPriceFor("Servers", undefined)).toBe(15);
    expect(unitPriceFor("Storage")).toBe(10);
    expect(unitPriceFor("Databases")).toBe(15);
  });

  it("el tier Free cuesta $0.00 real, no 'sin datos'", () => {
    expect(calcPlanMonthlyCost("Free", "Servers", "Plan2", 10)).toBe(0);
    expect(calcPlanMonthlyCost("Standard", "Servers", "Plan2", 10)).toBe(150);
    expect(calcPlanMonthlyCost("Standard", "Servers", "Plan1", 10)).toBe(50);
  });

  it("un plan Standard sin recursos igual factura su unidad base", () => {
    // CSPM y ARM cobran a nivel suscripcion aunque no haya recurso contable.
    expect(calcPlanMonthlyCost("Standard", "CSPM", undefined, 0)).toBe(5);
  });

  it("deriva el estado de cobertura", () => {
    expect(deriveCoverageStatus(5, 0)).toBe("Full");
    expect(deriveCoverageStatus(3, 2)).toBe("Partial");
    expect(deriveCoverageStatus(0, 4)).toBe("None");
    expect(deriveCoverageStatus(0, 0)).toBe("None");
  });
});

describe("Defender for Cloud — motor de recomendaciones", () => {
  it("Regla 1: propone Plan 1 solo para las VMs no productivas", () => {
    const recs = generateDefenderRecommendations([
      plan({
        associatedResources: [
          resource({ resourceName: "vm-prod", environment: "Production", isProtected: true }),
          resource({ resourceName: "vm-dev", environment: "Development", isProtected: true }),
          resource({ resourceName: "vm-stg", environment: "Staging", isProtected: true }),
        ],
        coveredResourcesCount: 3,
      }),
    ]);
    const downgrade = recs.find((r) => r.category === "DOWNGRADE_SERVERS_TIER");
    expect(downgrade).toBeDefined();
    // 2 VMs no productivas x (15 - 5) de delta.
    expect(downgrade?.estimatedSavingsUSD).toBe(20);
    // Advierte que el tier es por suscripcion, que es la restriccion real.
    expect(downgrade?.description).toContain("por suscripcion");
  });

  it("Regla 1 no dispara sobre Plan 1 ni sobre VMs productivas", () => {
    expect(
      generateDefenderRecommendations([
        plan({ subPlan: "Plan1", associatedResources: [resource({ environment: "Development" })] }),
      ]).some((r) => r.category === "DOWNGRADE_SERVERS_TIER")
    ).toBe(false);

    expect(
      generateDefenderRecommendations([
        plan({ associatedResources: [resource({ environment: "Production" })] }),
      ]).some((r) => r.category === "DOWNGRADE_SERVERS_TIER")
    ).toBe(false);
  });

  it("Regla 2: detecta cuentas de respaldo y logs por nombre", () => {
    const recs = generateDefenderRecommendations([
      plan({
        planKey: "StorageAccounts",
        category: "Storage",
        subPlan: undefined,
        associatedResources: [
          resource({ resourceName: "safinopsbackups", isProtected: true }),
          resource({ resourceName: "stdiaglogs", isProtected: true }),
          resource({ resourceName: "sawebapp", isProtected: true }),
        ],
        coveredResourcesCount: 3,
      }),
    ]);
    const exclude = recs.find((r) => r.category === "EXCLUDE_STORAGE_BACKUP");
    expect(exclude).toBeDefined();
    // Solo las dos frias: $10/cuenta.
    expect(exclude?.estimatedSavingsUSD).toBe(20);
  });

  it("Regla 3: una base productiva en Free es riesgo, con ahorro CERO", () => {
    const recs = generateDefenderRecommendations([
      plan({
        planKey: "SqlServers",
        category: "Databases",
        pricingTier: "Free",
        subPlan: undefined,
        coveredResourcesCount: 0,
        uncoveredResourcesCount: 2,
        associatedResources: [
          resource({ resourceName: "sql-prod-1", environment: "Production", isProtected: false }),
          resource({ resourceName: "sql-prod-2", environment: "Production", isProtected: false }),
        ],
      }),
    ]);
    const risk = recs.find((r) => r.category === "ENABLE_DB_PROTECTION");
    expect(risk).toBeDefined();
    // Activar proteccion aumenta el gasto: no debe sumar al ahorro potencial.
    expect(risk?.estimatedSavingsUSD).toBe(0);
    expect(risk?.title).toContain("RIESGO");
  });

  it("marca los planes Standard sin recursos como auto-provisioning", () => {
    const recs = generateDefenderRecommendations([
      plan({
        planKey: "Api",
        category: "Other",
        subPlan: undefined,
        coveredResourcesCount: 0,
        uncoveredResourcesCount: 0,
        associatedResources: [],
        monthlyCostUSD: 0,
      }),
    ]);
    expect(recs.some((r) => r.category === "GOVERN_AUTO_PROVISIONING")).toBe(true);
  });

  it("no marca CSPM ni ARM como auto-provisioning: cobran a nivel suscripcion por diseño", () => {
    const recs = generateDefenderRecommendations([
      plan({ planKey: "CloudPosture", category: "CSPM", subPlan: undefined, coveredResourcesCount: 0, associatedResources: [] }),
      plan({ planKey: "Arm", category: "ResourceManager", subPlan: undefined, coveredResourcesCount: 0, associatedResources: [] }),
    ]);
    expect(recs.some((r) => r.category === "GOVERN_AUTO_PROVISIONING")).toBe(false);
  });
});

describe("Defender for Cloud — payload demo y agregacion", () => {
  it("genera dataset sintetico con las tres reglas representadas", () => {
    const payload = getMockDefenderPayload("demo-tenant-2222");
    expect(payload.source).toBe("mock");
    expect(payload.plans.length).toBeGreaterThan(4);
    expect(payload.remediations.some((r) => r.category === "DOWNGRADE_SERVERS_TIER")).toBe(true);
    expect(payload.remediations.some((r) => r.category === "EXCLUDE_STORAGE_BACKUP")).toBe(true);
    expect(payload.remediations.some((r) => r.category === "ENABLE_DB_PROTECTION")).toBe(true);
    expect(payload.summary.totalUnprotectedCriticalResources).toBeGreaterThan(0);
  });

  it("ningun plan queda con la etiqueta generica 'Other' como nombre", () => {
    const payload = getMockDefenderPayload("demo-4444");
    expect(payload.plans.every((p) => p.planDisplayName.startsWith("Defender"))).toBe(true);
  });

  it("el ahorro potencial excluye los hallazgos de riesgo", () => {
    const payload = getMockDefenderPayload("demo-4444");
    const riskTotal = payload.remediations
      .filter((r) => r.category === "ENABLE_DB_PROTECTION")
      .reduce((a, r) => a + r.estimatedSavingsUSD, 0);
    expect(riskTotal).toBe(0);
    expect(payload.summary.potentialSavingsUSD).toBe(
      Number(
        payload.remediations
          .filter((r) => r.category !== "ENABLE_DB_PROTECTION")
          .reduce((a, r) => a + r.estimatedSavingsUSD, 0)
          .toFixed(2)
      )
    );
  });

  it("escala por tier y es determinista", () => {
    const pro = getMockDefenderPayload("demo-1111");
    const business = getMockDefenderPayload("demo-2222");
    const enterprise = getMockDefenderPayload("demo-4444");
    expect(business.plans.length).toBeGreaterThan(pro.plans.length);
    expect(enterprise.plans.length).toBeGreaterThan(business.plans.length);
    expect(getMockDefenderPayload("demo-4444").summary.totalMonthlyCostUSD).toBe(
      enterprise.summary.totalMonthlyCostUSD
    );
  });

  it("la cobertura porcentual es coherente y el desglose suma 100%", () => {
    const s = getMockDefenderPayload("demo-4444").summary;
    expect(s.coveragePercentage).toBeGreaterThan(0);
    expect(s.coveragePercentage).toBeLessThanOrEqual(100);
    expect(s.totalProtectedResources).toBeLessThanOrEqual(s.totalEvaluatedResources);
    const pct = s.breakdownByPlan.reduce((a, b) => a + b.percentage, 0);
    expect(pct).toBeGreaterThan(99);
    expect(pct).toBeLessThan(101);
  });

  it("summary vacio no divide por cero", () => {
    const s = calculateDefenderSummary([], []);
    expect(s.totalMonthlyCostUSD).toBe(0);
    expect(s.coveragePercentage).toBe(0);
    expect(s.projectedMonthEndCostUSD).toBe(0);
    expect(s.breakdownByPlan).toEqual([]);
  });

  it("un tenant real sin credenciales recibe estado vacio legitimo, nunca el mock", async () => {
    const result = await fetchLiveDefenderData("real-nonexistent-tenant-999");
    expect(result.source).toBe("live");
    expect(result.plans).toEqual([]);
    expect(result.summary.totalMonthlyCostUSD).toBe(0);
    expect(result.remediations).toEqual([]);
  });
});

describe("Defender for Cloud — comandos de remediacion", () => {
  const base = {
    id: "r",
    planKey: "VirtualMachines",
    subscriptionId: "00000000-0000-0000-0000-000000000001",
    title: "t",
    description: "d",
    estimatedSavingsUSD: 10,
    confidence: "HIGH" as const,
    actionType: "X",
  };

  it("entrega CLI y PowerShell por categoria", () => {
    const dg = buildDefenderRemediationCommand({ ...base, category: "DOWNGRADE_SERVERS_TIER" });
    expect(dg.cli).toContain("--subplan P1");
    // Debe ofrecer tambien la exclusion por recurso, porque el tier es por suscripcion.
    expect(dg.cli).toContain("excludeFromDefenderForServers");

    const ex = buildDefenderRemediationCommand({ ...base, category: "EXCLUDE_STORAGE_BACKUP" });
    expect(ex.cli).toContain("atp storage update");
    expect(ex.cli).toContain("--is-enabled false");

    const en = buildDefenderRemediationCommand({ ...base, category: "ENABLE_DB_PROTECTION" });
    expect(en.cli).toContain("--tier Standard");
    // Debe dejar claro que no es una accion de ahorro. La frase ya no viaja en
    // el script --viene del catalogo en el idioma del lector-- asi que lo que se
    // afirma es que el builder siga emitiendo ESE marcador y no otro.
    expect(en.cli).toContain("#{cmt_df_hallazgo_de_riesgo_no_de_ahorro}");

    const gv = buildDefenderRemediationCommand({ ...base, category: "GOVERN_AUTO_PROVISIONING" });
    expect(gv.cli).toContain("--tier Free");
    expect(gv.cli).toContain("security pricing list");
  });

  it("escapa el planKey y el subscriptionId", () => {
    const hostil = buildDefenderRemediationCommand({
      ...base,
      planKey: 'VM"; rm -rf ~; #',
      category: "GOVERN_AUTO_PROVISIONING",
    });
    expect(hostil.cli).toContain('VM\\"');
    expect(hostil.cli).not.toMatch(/--name "VM"; rm/);
  });
});
