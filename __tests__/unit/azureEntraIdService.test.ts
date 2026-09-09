import { describe, it, expect } from "vitest";
import {
  daysSince,
  deriveActivityStatus,
  normalizeEdsSku,
  isDevOrTestScope,
  licenseUnitPrice,
  isAuditedEntraSku,
  calcDomainServicesCost,
  calcSkuWaste,
  calculateEntraIdSummary,
  generateEntraIdRecommendations,
  getMockEntraIdPayload,
  fetchLiveEntraIdData,
} from "@/services/azureEntraId.service";
import { buildEntraIdRemediationCommand } from "@/lib/aiRemediations";
import type { EntraIdResourceItem, EntraLicenseSkuSummary } from "@/types/azureEntraId.types";
import { EDS_SKU_MONTHLY_USD } from "@/types/azureEntraId.types";

const user = (over: Partial<EntraIdResourceItem> = {}): EntraIdResourceItem => ({
  id: "user-a@x.com",
  name: "a@x.com",
  displayName: "A",
  resourceType: "UserLicense",
  principalIdentifier: "a@x.com",
  location: "Global",
  subscriptionId: "tenant",
  subscriptionName: "Tenant Scope",
  skuTier: "Microsoft Entra ID P1",
  assignedLicenses: ["AAD_PREMIUM"],
  inactiveDays: 200,
  isAccountEnabled: true,
  activityStatus: "Inactive",
  monthlyCostUSD: 6,
  potentialSavingsUSD: 6,
  isWasteful: true,
  ...over,
});

const sku = (over: Partial<EntraLicenseSkuSummary> = {}): EntraLicenseSkuSummary => ({
  skuPartNumber: "AAD_PREMIUM",
  displayName: "Microsoft Entra ID P1",
  prepaidUnits: 10,
  consumedUnits: 8,
  unassignedUnits: 2,
  inactiveAssignedUnits: 1,
  unitPriceUSD: 6,
  wastedMonthlyUSD: 18,
  ...over,
});

describe("Entra ID — normalizacion y clasificacion", () => {
  it("daysSince distingue ausencia de fecha de cero dias", () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince(undefined)).toBeNull();
    expect(daysSince("no-es-fecha")).toBeNull();
    expect(daysSince(new Date().toISOString())).toBe(0);
    expect(daysSince(new Date(Date.now() - 100 * 86400000).toISOString())).toBe(100);
  });

  it("Disabled gana sobre cualquier actividad: licencia en cuenta deshabilitada es desperdicio puro", () => {
    expect(deriveActivityStatus(false, 1, true)).toBe("Disabled");
    expect(deriveActivityStatus(false, null, true)).toBe("Disabled");
    // Incluso sin telemetria, una cuenta deshabilitada es inequivoca.
    expect(deriveActivityStatus(false, null, false)).toBe("Disabled");
  });

  it("sin signInActivity el estado es Unknown, no Active ni Inactive", () => {
    // Asumir Active ocultaria la fuga; asumir Inactive haria revocar licencias
    // a gente que si trabaja. Ninguna de las dos es aceptable.
    expect(deriveActivityStatus(true, null, false)).toBe("Unknown");
    expect(deriveActivityStatus(true, 500, false)).toBe("Unknown");
  });

  it("con telemetria clasifica por el umbral de 90 dias", () => {
    expect(deriveActivityStatus(true, 1, true)).toBe("Active");
    expect(deriveActivityStatus(true, 90, true)).toBe("Active");
    expect(deriveActivityStatus(true, 91, true)).toBe("Inactive");
    // Nunca inicio sesion: inactivo, no activo.
    expect(deriveActivityStatus(true, null, true)).toBe("Inactive");
  });

  it("normaliza el SKU de Domain Services y su precio", () => {
    expect(normalizeEdsSku("Premium")).toBe("Premium");
    expect(normalizeEdsSku("enterprise")).toBe("Enterprise");
    expect(normalizeEdsSku("Standard")).toBe("Standard");
    expect(normalizeEdsSku(undefined)).toBe("Standard");
    expect(calcDomainServicesCost("Standard")).toBe(110);
    expect(calcDomainServicesCost("Enterprise")).toBe(290);
    expect(calcDomainServicesCost("Premium")).toBe(580);
  });

  it("detecta scopes no productivos sin falsos positivos", () => {
    expect(isDevOrTestScope("rg-dev-identity", "Prod")).toBe(true);
    expect(isDevOrTestScope("rg-x", "Desarrollo y QA")).toBe(true);
    expect(isDevOrTestScope("rg-prod-identity", "Produccion")).toBe(false);
    expect(isDevOrTestScope("rg-device-mgmt", "Produccion")).toBe(false);
  });

  it("resuelve el precio de los SKUs de Entra y reconoce los auditados", () => {
    expect(licenseUnitPrice("AAD_PREMIUM")).toBe(6);
    expect(licenseUnitPrice("AAD_PREMIUM_P2")).toBe(9);
    expect(licenseUnitPrice("ENTRA_ID_GOVERNANCE")).toBe(7);
    expect(licenseUnitPrice("WORKLOAD_IDENTITIES")).toBe(3);

    expect(isAuditedEntraSku("AAD_PREMIUM_P2")).toBe(true);
    // Un SKU de M365 no es materia de este modulo.
    expect(isAuditedEntraSku("SPB")).toBe(false);
  });

  it("el desperdicio de un SKU suma las no asignadas y las asignadas a inactivos", () => {
    expect(calcSkuWaste(2, 3, 6)).toBe(30);
    expect(calcSkuWaste(0, 0, 9)).toBe(0);
    // Mas consumidas que compradas no debe producir un desperdicio negativo.
    expect(calcSkuWaste(-4, 0, 6)).toBe(0);
  });
});

describe("Entra ID — recomendaciones", () => {
  it("Regla 1: agrupa por SKU y marca HIGH cuando hay cuentas deshabilitadas", () => {
    const recs = generateEntraIdRecommendations(
      [
        user({ id: "u1", principalIdentifier: "u1@x.com", activityStatus: "Inactive" }),
        user({ id: "u2", principalIdentifier: "u2@x.com", activityStatus: "Disabled", isAccountEnabled: false }),
      ],
      [],
      true
    );
    const reclaim = recs.find((r) => r.category === "RECLAIM_USER_LICENSE");
    expect(reclaim).toBeDefined();
    expect(reclaim!.estimatedSavingsUSD).toBe(12); // 2 usuarios x $6
    expect(reclaim!.confidence).toBe("HIGH"); // hay una deshabilitada
    expect(reclaim!.affectedPrincipals).toEqual(["u1@x.com", "u2@x.com"]);
    // Debe advertir sobre las cuentas que no inician sesion por diseño.
    expect(reclaim!.params).toMatchObject({ disabled: 1, days: 90 });
  });

  it("sin signInActivity NO se recomienda revocar licencias por inactividad", () => {
    // Es la salvaguarda clave: sin telemetria no se puede afirmar inactividad.
    const recs = generateEntraIdRecommendations([user({ activityStatus: "Unknown" })], [], false);
    expect(recs.some((r) => r.category === "RECLAIM_USER_LICENSE" && r.affectedPrincipals)).toBe(false);
  });

  it("las licencias compradas y sin asignar se reportan aunque no haya telemetria", () => {
    const recs = generateEntraIdRecommendations([], [sku({ unassignedUnits: 4 })], false);
    const unassigned = recs.find((r) => r.id === "unassigned-AAD_PREMIUM");
    expect(unassigned).toBeDefined();
    expect(unassigned!.estimatedSavingsUSD).toBe(24); // 4 x $6
    expect(unassigned!.confidence).toBe("HIGH");
  });

  it("Regla 2: solo baja Domain Services marcado como wasteful y no si ya es Standard", () => {
    const eds = (skuTier: string, isWasteful: boolean): EntraIdResourceItem => ({
      ...user(),
      id: "/subscriptions/s/resourceGroups/rg-dev/providers/Microsoft.AAD/domainServices/aadds",
      name: "aadds",
      resourceType: "DomainServices",
      assignedLicenses: [],
      skuTier,
      isWasteful,
      activityStatus: "Active",
      monthlyCostUSD: calcDomainServicesCost(skuTier as "Enterprise"),
      potentialSavingsUSD: 0,
    });

    const rec = generateEntraIdRecommendations([eds("Enterprise", true)], [], true).find(
      (r) => r.category === "DOWNGRADE_DOMAIN_SERVICES"
    );
    expect(rec).toBeDefined();
    expect(rec!.estimatedSavingsUSD).toBe(180); // 290 - 110
    // Debe advertir que bajar desde Premium exige recrear la instancia.
    expect(rec!.params).toMatchObject({ name: "aadds", standardCost: EDS_SKU_MONTHLY_USD.Standard });

    expect(
      generateEntraIdRecommendations([eds("Standard", true)], [], true).some(
        (r) => r.category === "DOWNGRADE_DOMAIN_SERVICES"
      )
    ).toBe(false);
    expect(
      generateEntraIdRecommendations([eds("Enterprise", false)], [], true).some(
        (r) => r.category === "DOWNGRADE_DOMAIN_SERVICES"
      )
    ).toBe(false);
  });

  it("Regla 3: service principals inactivos con Workload ID Premium", () => {
    const sp: EntraIdResourceItem = {
      ...user(),
      id: "sp-1",
      resourceType: "ServicePrincipal",
      assignedLicenses: ["WORKLOAD_IDENTITIES"],
      activityStatus: "Inactive",
      principalIdentifier: "app-1",
    };
    const rec = generateEntraIdRecommendations([sp, { ...sp, id: "sp-2", principalIdentifier: "app-2" }], [], true).find(
      (r) => r.category === "PURGE_WORKLOAD_LICENSE"
    );
    expect(rec).toBeDefined();
    expect(rec!.estimatedSavingsUSD).toBe(6); // 2 x $3
    // Debe advertir sobre integraciones estacionales o de DR.
    expect(rec!.params).toMatchObject({ count: 2 });
  });

  it("MFA_FRAUD_PREVENTION no reclama ahorro cuantificable", () => {
    const ext: EntraIdResourceItem = {
      ...user(),
      id: "ext-1",
      resourceType: "ExternalID_Tenant",
      assignedLicenses: [],
      monthlyCostUSD: 58.5,
      activityStatus: "Active",
      isWasteful: false,
    };
    const rec = generateEntraIdRecommendations([ext], [], true).find(
      (r) => r.category === "MFA_FRAUD_PREVENTION"
    );
    expect(rec).toBeDefined();
    expect(rec!.estimatedSavingsUSD).toBe(0);
    expect(rec!.params).toMatchObject({ name: "a@x.com" });
  });

  it("un directorio sano no genera recomendaciones", () => {
    expect(
      generateEntraIdRecommendations(
        [user({ activityStatus: "Active", isWasteful: false, potentialSavingsUSD: 0 })],
        [sku({ unassignedUnits: 0, inactiveAssignedUnits: 0, wastedMonthlyUSD: 0 })],
        true
      )
    ).toEqual([]);
  });
});

describe("Entra ID — payload demo y agregacion", () => {
  it("genera dataset sintetico con las tres reglas representadas", () => {
    const payload = getMockEntraIdPayload("demo-tenant-2222");
    expect(payload.source).toBe("mock");
    expect(payload.resources.length).toBeGreaterThan(8);
    expect(payload.remediations.some((r) => r.category === "RECLAIM_USER_LICENSE")).toBe(true);
    expect(payload.remediations.some((r) => r.category === "DOWNGRADE_DOMAIN_SERVICES")).toBe(true);
    expect(payload.remediations.some((r) => r.category === "PURGE_WORKLOAD_LICENSE")).toBe(true);
    expect(payload.summary.disabledWithLicenseCount).toBeGreaterThan(0);
  });

  it("separa el costo ARM del desperdicio de licencias, que no sale en Cost Management", () => {
    const s = getMockEntraIdPayload("demo-4444").summary;
    expect(s.totalArmCostUSD).toBeGreaterThan(0);
    expect(s.totalLicenseWasteUSD).toBeGreaterThan(0);
    // Son magnitudes distintas y no deben confundirse en un unico total.
    expect(s.totalLicenseWasteUSD).not.toBe(s.totalArmCostUSD);
    expect(s.totalLicenseWasteUSD).toBeLessThanOrEqual(s.totalLicenseSpendUSD + 0.01);
  });

  it("cuenta los invitados B2B por el marcador #EXT# del UPN", () => {
    const s = getMockEntraIdPayload("demo-2222").summary;
    expect(s.guestUsersCount).toBeGreaterThan(0);
  });

  it("escala por tier y es determinista", () => {
    const pro = getMockEntraIdPayload("demo-1111");
    const business = getMockEntraIdPayload("demo-2222");
    const enterprise = getMockEntraIdPayload("demo-4444");
    expect(business.resources.length).toBeGreaterThan(pro.resources.length);
    expect(enterprise.resources.length).toBeGreaterThan(business.resources.length);
    expect(getMockEntraIdPayload("demo-4444").summary.potentialSavingsUSD).toBe(
      enterprise.summary.potentialSavingsUSD
    );
  });

  it("el desglose de costos suma 100% y omite las categorias sin gasto", () => {
    const s = getMockEntraIdPayload("demo-4444").summary;
    const pct = s.breakdownByCostType.reduce((a, b) => a + b.percentage, 0);
    expect(pct).toBeGreaterThan(99);
    expect(pct).toBeLessThan(101);
    expect(s.breakdownByCostType.every((b) => b.costUSD > 0)).toBe(true);
  });

  it("summary vacio no divide por cero", () => {
    const s = calculateEntraIdSummary([], [], [], { signInActivityAvailable: false, guestUsersCount: 0 });
    expect(s.totalArmCostUSD).toBe(0);
    expect(s.totalLicenseWasteUSD).toBe(0);
    expect(s.breakdownByCostType).toEqual([]);
    expect(s.signInActivityAvailable).toBe(false);
  });

  it("un tenant real sin credenciales recibe estado vacio legitimo, nunca el mock", async () => {
    const result = await fetchLiveEntraIdData("real-nonexistent-tenant-999");
    expect(result.source).toBe("live");
    expect(result.resources).toEqual([]);
    expect(result.summary.totalArmCostUSD).toBe(0);
    expect(result.remediations).toEqual([]);
  });
});

describe("Entra ID — comandos de remediacion", () => {
  const base = {
    id: "r",
    targetId: "AAD_PREMIUM_P2",
    targetName: "Microsoft Entra ID P2",
    title: "t",
    description: "d",
    estimatedSavingsUSD: 18,
    confidence: "HIGH" as const,
    actionType: "X",
  };

  it("el reclamo de licencias consulta el skuId antes de desasignar", () => {
    const c = buildEntraIdRemediationCommand({
      ...base,
      category: "RECLAIM_USER_LICENSE",
      affectedPrincipals: ["a@x.com", "b@x.com"],
    });
    expect(c.cli.indexOf("subscribedSkus")).toBeLessThan(c.cli.indexOf("assignLicense"));
    expect(c.cli).toContain("a@x.com");
    expect(c.powershell).toContain("Set-MgUserLicense");
    // Debe revisar a quien se le quita antes de quitarlo.
    expect(c.powershell.indexOf("Get-MgUser")).toBeLessThan(c.powershell.indexOf("Set-MgUserLicense"));
  });

  it("el downgrade de Domain Services advierte el caso Premium", () => {
    const c = buildEntraIdRemediationCommand({
      ...base,
      targetId: "/subscriptions/s/resourceGroups/rg-dev/providers/Microsoft.AAD/domainServices/aadds",
      category: "DOWNGRADE_DOMAIN_SERVICES",
    });
    expect(c.cli).toContain("--sku Standard");
    expect(c.cli).toContain("recrear");
  });

  it("la purga de Workload ID verifica actividad antes de desasignar", () => {
    const c = buildEntraIdRemediationCommand({
      ...base,
      category: "PURGE_WORKLOAD_LICENSE",
      affectedPrincipals: ["app-1"],
    });
    expect(c.cli).toContain("servicePrincipalSignInActivities");
    expect(c.cli).toContain("app-1");
  });

  it("MFA apunta a la politica, no a un comando de borrado", () => {
    const c = buildEntraIdRemediationCommand({ ...base, category: "MFA_FRAUD_PREVENTION" });
    expect(c.cli).toContain("authenticationMethodsPolicy");
    expect(c.cli).not.toContain("delete");
  });

  it("escapa el UPN y el SKU interpolados", () => {
    const c = buildEntraIdRemediationCommand({
      ...base,
      targetId: 'SKU"; rm -rf ~; #',
      category: "RECLAIM_USER_LICENSE",
      affectedPrincipals: ['evil"; rm -rf ~; #@x.com'],
    });
    expect(c.cli).toContain('SKU\\"');
    expect(c.cli).toContain('evil\\"');
  });

  it("sin principales afectados el bloque no queda vacio ni roto", () => {
    const c = buildEntraIdRemediationCommand({ ...base, category: "RECLAIM_USER_LICENSE" });
    expect(c.cli).toContain("(ninguno)");
  });
});
