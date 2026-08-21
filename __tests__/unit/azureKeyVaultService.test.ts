import { describe, it, expect } from "vitest";
import {
  normalizeSku,
  deriveAuthModel,
  isDevOrTestScope,
  deriveAccessMethod,
  calcTransactionCost,
  calcHsmKeyCost,
  calcManagedHsmPoolCost,
  hasPollingPattern,
  hasUnjustifiedManagedHsm,
  hasHygieneIssue,
  deriveFindings,
  distributeHitsByObjectType,
  assembleVault,
  calculateKeyVaultSummary,
  generateKeyVaultRecommendations,
  getMockKeyVaultPayload,
  fetchLiveKeyVaultData,
} from "@/services/azureKeyVault.service";
import { buildKeyVaultRemediationCommand } from "@/lib/aiRemediations";
import type { KeyVaultConsumer } from "@/types/azureKeyVault.types";

const baseVault = (over: Partial<Parameters<typeof assembleVault>[0]> = {}) =>
  assembleVault({
    id: "/subscriptions/s/resourceGroups/rg-prod/providers/Microsoft.KeyVault/vaults/kv",
    name: "kv",
    location: "eastus",
    resourceGroup: "rg-prod",
    subscriptionId: "s",
    subscriptionName: "Produccion",
    skuName: "Standard",
    rbacEnabled: true,
    softDeleteEnabled: true,
    purgeProtectionEnabled: true,
    publicNetworkAccess: "Disabled",
    privateEndpointsCount: 1,
    secretsCount: 10,
    keysCount: 2,
    hsmKeysCount: 0,
    certificatesCount: 3,
    expiredObjectsCount: 0,
    hitsByObjectType: { Secrets: 1000, Keys: 200, Certificates: 50 },
    throttledHits429: 0,
    serverErrors5xx: 0,
    avgLatencyMs: 30,
    daysSinceLastTransaction: 0,
    linkedConsumers: [],
    ...over,
  });

describe("Key Vault — normalizacion", () => {
  it("distingue Managed HSM por tipo de recurso, no por SKU", () => {
    // El SKU de un Managed HSM es una familia (Custom_B32), no "premium".
    expect(normalizeSku("microsoft.keyvault/managedhsms", "Custom_B32")).toBe("Managed_HSM");
    expect(normalizeSku("microsoft.keyvault/managedhsms", undefined)).toBe("Managed_HSM");
    expect(normalizeSku("microsoft.keyvault/vaults", "premium")).toBe("Premium");
    expect(normalizeSku("microsoft.keyvault/vaults", "Premium")).toBe("Premium");
    expect(normalizeSku("microsoft.keyvault/vaults", "standard")).toBe("Standard");
    expect(normalizeSku("microsoft.keyvault/vaults", undefined)).toBe("Standard");
  });

  it("ausencia de enableRbacAuthorization equivale a Access Policies", () => {
    expect(deriveAuthModel(true)).toBe("AzureRBAC");
    expect(deriveAuthModel(false)).toBe("AccessPolicies");
    expect(deriveAuthModel(undefined)).toBe("AccessPolicies");
    // Un string "true" no es true: no debe contarse como RBAC activo.
    expect(deriveAuthModel("true")).toBe("AccessPolicies");
  });

  it("detecta scopes no productivos sin falsos positivos por subcadena", () => {
    expect(isDevOrTestScope("rg-dev-crypto", "Prod")).toBe(true);
    expect(isDevOrTestScope("rg-x", "Desarrollo y QA")).toBe(true);
    expect(isDevOrTestScope("rg-prod-app", "Produccion CSCloudSolutions")).toBe(false);
    expect(isDevOrTestScope("rg-device-mgmt", "Produccion")).toBe(false);
  });

  it("deduce el metodo de acceso por tipo de recurso", () => {
    expect(deriveAccessMethod("Microsoft.Web/sites")).toContain("@Microsoft.KeyVault");
    expect(deriveAccessMethod("Microsoft.ContainerService/managedClusters")).toContain("CSI");
    expect(deriveAccessMethod("Microsoft.Compute/diskEncryptionSets")).toContain("Disk Encryption Set");
    expect(deriveAccessMethod("Microsoft.Sql/servers")).toContain("CMK");
    // Tipo desconocido: se declara generico en vez de inventar un mecanismo.
    expect(deriveAccessMethod("Microsoft.Foo/bar")).toBe("Managed Identity autorizada");
  });
});

describe("Key Vault — modelo de costo", () => {
  it("cobra transacciones a $0.03 cada 10.000", () => {
    expect(calcTransactionCost(10_000)).toBe(0.03);
    expect(calcTransactionCost(1_000_000)).toBe(3);
    expect(calcTransactionCost(0)).toBe(0);
    expect(calcTransactionCost(-5)).toBe(0);
  });

  it("las claves HSM solo facturan en Premium", () => {
    expect(calcHsmKeyCost("Premium", 6)).toBe(6);
    // En Standard no existen claves protegidas por HSM.
    expect(calcHsmKeyCost("Standard", 6)).toBe(0);
    // En Managed HSM el cargo esta en el pool, no por clave.
    expect(calcHsmKeyCost("Managed_HSM", 6)).toBe(0);
    expect(calcHsmKeyCost("Premium", 0)).toBe(0);
  });

  it("el pool de Managed HSM factura por existir, no por uso", () => {
    expect(calcManagedHsmPoolCost("Managed_HSM")).toBeCloseTo(2336, 0);
    expect(calcManagedHsmPoolCost("Managed_HSM", 100)).toBe(320);
    expect(calcManagedHsmPoolCost("Premium")).toBe(0);
    expect(calcManagedHsmPoolCost("Standard")).toBe(0);
  });

  it("una boveda con un pool HSM y cero trafico igual cuesta ~2.300 USD", () => {
    const v = baseVault({
      skuName: "Managed_HSM",
      hitsByObjectType: { Secrets: 0, Keys: 0, Certificates: 0 },
      daysSinceLastTransaction: null,
    });
    expect(v.totalApiHitsMTD).toBe(0);
    expect(v.transactionCostUSD).toBe(0);
    expect(v.monthlyCostUSD).toBeGreaterThan(2000);
  });
});

describe("Key Vault — reparto de operaciones por tipo de objeto", () => {
  it("reparte proporcionalmente y la suma cuadra exactamente con el total", () => {
    const d = distributeHitsByObjectType(1000, 5, 3, 2);
    expect(d.Secrets + d.Keys + d.Certificates).toBe(1000);
    expect(d.Secrets).toBeGreaterThan(d.Keys);
    expect(d.Keys).toBeGreaterThan(d.Certificates);
  });

  it("sin objetos o sin hits devuelve ceros en vez de forzar un reparto", () => {
    expect(distributeHitsByObjectType(1000, 0, 0, 0)).toEqual({ Secrets: 0, Keys: 0, Certificates: 0 });
    expect(distributeHitsByObjectType(0, 5, 5, 5)).toEqual({ Secrets: 0, Keys: 0, Certificates: 0 });
  });

  it("no produce negativos cuando el redondeo se pasa", () => {
    const d = distributeHitsByObjectType(3, 1, 1, 1);
    expect(d.Certificates).toBeGreaterThanOrEqual(0);
    expect(d.Secrets + d.Keys + d.Certificates).toBe(3);
  });
});

describe("Key Vault — motor de deteccion", () => {
  it("Regla 1: patron de polling por encima del millon de operaciones", () => {
    expect(hasPollingPattern(1_000_001)).toBe(true);
    expect(hasPollingPattern(1_000_000)).toBe(false);
    expect(hasPollingPattern(500)).toBe(false);
  });

  it("Regla 2: Managed HSM solo es fuga en scope no productivo", () => {
    expect(hasUnjustifiedManagedHsm("Managed_HSM", true)).toBe(true);
    // En produccion un pool dedicado puede estar justificado por compliance.
    expect(hasUnjustifiedManagedHsm("Managed_HSM", false)).toBe(false);
    expect(hasUnjustifiedManagedHsm("Premium", true)).toBe(false);
  });

  it("Regla 3: sin transacciones (null) es el caso mas huerfano", () => {
    expect(hasHygieneIssue(null, 0)).toBe(true);
    expect(hasHygieneIssue(71, 0)).toBe(true);
    expect(hasHygieneIssue(2, 3)).toBe(true);
    expect(hasHygieneIssue(2, 0)).toBe(false);
    // Justo en el umbral todavia no dispara.
    expect(hasHygieneIssue(45, 0)).toBe(false);
  });

  it("acumula todos los motivos en un unico texto legible", () => {
    const f = deriveFindings({
      sku: "Managed_HSM",
      isDevOrTest: true,
      totalApiHitsMTD: 2_000_000,
      throttledHits429: 500,
      daysSinceLastTransaction: 60,
      expiredObjectsCount: 2,
      authModel: "AccessPolicies",
    });
    expect(f.hasFindings).toBe(true);
    expect(f.findingReason).toContain("Managed HSM");
    expect(f.findingReason).toContain("bucle");
    expect(f.findingReason).toContain("429");
    expect(f.findingReason).toContain("vencido");
    expect(f.findingReason).toContain("Access Policies");

    const clean = deriveFindings({
      sku: "Standard",
      isDevOrTest: false,
      totalApiHitsMTD: 1000,
      throttledHits429: 0,
      daysSinceLastTransaction: 1,
      expiredObjectsCount: 0,
      authModel: "AzureRBAC",
    });
    expect(clean.hasFindings).toBe(false);
    expect(clean.findingReason).toBeUndefined();
  });
});

describe("Key Vault — recomendaciones", () => {
  it("el downgrade de Managed HSM descuenta el equivalente en Premium", () => {
    const v = baseVault({
      id: "/subscriptions/s/resourceGroups/rg-dev/providers/Microsoft.KeyVault/managedHSMs/hsm",
      name: "hsm",
      resourceGroup: "rg-dev-crypto",
      skuName: "Managed_HSM",
      keysCount: 3,
      hsmKeysCount: 3,
    });
    const rec = generateKeyVaultRecommendations([v]).find((r) => r.category === "DOWNGRADE_MANAGED_HSM");
    expect(rec).toBeDefined();
    // ~2336 del pool menos 3 claves Premium ($1 c/u).
    expect(rec!.estimatedSavingsUSD).toBeCloseTo(2336 - 3, 0);
    expect(rec!.confidence).toBe("HIGH");
  });

  it("la mitigacion de polling reporta el ahorro real, que es chico, y explica el 429", () => {
    const v = baseVault({
      hitsByObjectType: { Secrets: 2_000_000, Keys: 0, Certificates: 0 },
      throttledHits429: 1_842,
    });
    const rec = generateKeyVaultRecommendations([v]).find((r) => r.category === "POLLING_CACHE_OPTIMIZATION");
    expect(rec).toBeDefined();
    // 90% de 2M ops evitadas = 1.8M -> $5.40. No se infla.
    expect(rec!.estimatedSavingsUSD).toBeCloseTo(5.4, 1);
    expect(rec!.description).toContain("429");
    expect(rec!.description).toContain("disponibilidad");
  });

  it("sin 429 el texto advierte igual, sin afirmar un throttling que no ocurrio", () => {
    const v = baseVault({ hitsByObjectType: { Secrets: 1_500_000, Keys: 0, Certificates: 0 } });
    const rec = generateKeyVaultRecommendations([v]).find((r) => r.category === "POLLING_CACHE_OPTIMIZATION");
    expect(rec!.description).toContain("Todavia sin 429");
  });

  it("la migracion a RBAC no reclama ahorro y advierte el orden de la operacion", () => {
    const v = baseVault({ rbacEnabled: false });
    const rec = generateKeyVaultRecommendations([v]).find((r) => r.category === "ENABLE_RBAC");
    expect(rec).toBeDefined();
    expect(rec!.estimatedSavingsUSD).toBe(0);
    expect(rec!.description).toContain("ANTES");
  });

  it("la higiene menciona purge protection segun corresponda", () => {
    const conProteccion = baseVault({ daysSinceLastTransaction: null, purgeProtectionEnabled: true });
    const sinProteccion = baseVault({ daysSinceLastTransaction: null, purgeProtectionEnabled: false });
    const a = generateKeyVaultRecommendations([conProteccion]).find((r) => r.category === "PURGE_EXPIRED_OBJECTS");
    const b = generateKeyVaultRecommendations([sinProteccion]).find((r) => r.category === "PURGE_EXPIRED_OBJECTS");
    expect(a!.description).toContain("purge protection activa");
    expect(b!.description).toContain("soft delete");
  });

  it("una boveda sana no genera ninguna recomendacion", () => {
    expect(generateKeyVaultRecommendations([baseVault()])).toEqual([]);
  });
});

describe("Key Vault — payload demo y agregacion", () => {
  it("genera dataset sintetico con las tres reglas representadas", () => {
    const payload = getMockKeyVaultPayload("demo-tenant-2222");
    expect(payload.source).toBe("mock");
    expect(payload.vaults.length).toBeGreaterThan(3);
    expect(payload.remediations.some((r) => r.category === "POLLING_CACHE_OPTIMIZATION")).toBe(true);
    expect(payload.remediations.some((r) => r.category === "DOWNGRADE_MANAGED_HSM")).toBe(true);
    expect(payload.remediations.some((r) => r.category === "PURGE_EXPIRED_OBJECTS")).toBe(true);
    expect(payload.remediations.some((r) => r.category === "ENABLE_RBAC")).toBe(true);
    expect(payload.apiTrend?.length).toBe(30);
  });

  it("el pool de Managed HSM domina el costo total, como en la realidad", () => {
    const payload = getMockKeyVaultPayload("demo-2222");
    const hsm = payload.vaults.find((v) => v.skuName === "Managed_HSM");
    expect(hsm).toBeDefined();
    expect(hsm!.managedHsmPoolCostUSD).toBeGreaterThan(payload.summary.totalMonthlyCostUSD * 0.8);
  });

  it("escala por tier y es determinista", () => {
    const pro = getMockKeyVaultPayload("demo-1111");
    const business = getMockKeyVaultPayload("demo-2222");
    const enterprise = getMockKeyVaultPayload("demo-4444");
    expect(business.vaults.length).toBeGreaterThan(pro.vaults.length);
    expect(enterprise.vaults.length).toBeGreaterThan(business.vaults.length);
    expect(getMockKeyVaultPayload("demo-4444").summary.totalMonthlyCostUSD).toBe(
      enterprise.summary.totalMonthlyCostUSD
    );
    expect(getMockKeyVaultPayload("demo-4444").apiTrend?.map((p) => p.apiHits)).toEqual(
      enterprise.apiTrend?.map((p) => p.apiHits)
    );
  });

  it("el desglose por tipo de objeto suma 100% y omite los tipos sin operaciones", () => {
    const s = getMockKeyVaultPayload("demo-4444").summary;
    const pct = s.breakdownByObjectType.reduce((a, b) => a + b.percentage, 0);
    expect(pct).toBeGreaterThan(99);
    expect(pct).toBeLessThan(101);
    expect(s.breakdownByObjectType.every((b) => b.operationsCount > 0)).toBe(true);
  });

  it("cuenta las bovedas sin Azure RBAC para la postura de seguridad", () => {
    const s = getMockKeyVaultPayload("demo-4444").summary;
    expect(s.accessPolicyVaultsCount).toBeGreaterThan(0);
    expect(s.accessPolicyVaultsCount).toBeLessThanOrEqual(s.totalVaultsCount);
  });

  it("summary vacio no divide por cero", () => {
    const s = calculateKeyVaultSummary([], []);
    expect(s.totalMonthlyCostUSD).toBe(0);
    expect(s.projectedMonthEndCostUSD).toBe(0);
    expect(s.totalApiTransactionsMTD).toBe(0);
    expect(s.breakdownByObjectType).toEqual([]);
  });

  it("un tenant real sin credenciales recibe estado vacio legitimo, nunca el mock", async () => {
    const result = await fetchLiveKeyVaultData("real-nonexistent-tenant-999");
    expect(result.source).toBe("live");
    expect(result.vaults).toEqual([]);
    expect(result.summary.totalMonthlyCostUSD).toBe(0);
    expect(result.remediations).toEqual([]);
  });

  it("los consumidores del dataset demo declaran su metodo de acceso", () => {
    const payload = getMockKeyVaultPayload("demo-4444");
    const consumers: KeyVaultConsumer[] = payload.vaults.flatMap((v) => v.linkedConsumers);
    expect(consumers.length).toBeGreaterThan(0);
    expect(consumers.every((c) => c.accessMethod.length > 0)).toBe(true);
  });
});

describe("Key Vault — comandos de remediacion", () => {
  const base = {
    id: "r",
    vaultId: "/subscriptions/s/resourceGroups/rg-prod/providers/Microsoft.KeyVault/vaults/kv-prod",
    vaultName: "kv-prod",
    title: "t",
    description: "d",
    estimatedSavingsUSD: 10,
    confidence: "HIGH" as const,
    actionType: "X",
  };

  it("el downgrade de HSM exige el security domain antes de borrar", () => {
    const c = buildKeyVaultRemediationCommand({ ...base, category: "DOWNGRADE_MANAGED_HSM" });
    // Sin security domain las claves son irrecuperables: debe ir primero.
    expect(c.cli).toContain("security-domain download");
    expect(c.cli.indexOf("security-domain download")).toBeLessThan(c.cli.indexOf("keyvault delete"));
    expect(c.cli).toContain("irreversible");
    expect(c.powershell).toContain("Export-AzKeyVaultSecurityDomain");
  });

  it("la mitigacion de polling ofrece la salida sin tocar codigo", () => {
    const c = buildKeyVaultRemediationCommand({ ...base, category: "POLLING_CACHE_OPTIMIZATION" });
    expect(c.cli).toContain("@Microsoft.KeyVault");
    expect(c.cli).toContain("ServiceApiHit");
  });

  it("la purga propone deshabilitar antes que borrar", () => {
    const c = buildKeyVaultRemediationCommand({ ...base, category: "PURGE_EXPIRED_OBJECTS" });
    expect(c.cli).toContain("--enabled false");
    expect(c.cli).toContain("enablePurgeProtection");
  });

  it("la migracion a RBAC asigna roles ANTES de activar la bandera", () => {
    const c = buildKeyVaultRemediationCommand({ ...base, category: "ENABLE_RBAC" });
    // Invertir el orden deja aplicaciones sin acceso de golpe.
    expect(c.cli.indexOf("role assignment create")).toBeLessThan(
      c.cli.indexOf("--enable-rbac-authorization true")
    );
  });

  it("escapa el nombre de la boveda", () => {
    const c = buildKeyVaultRemediationCommand({
      ...base,
      vaultName: 'kv"; rm -rf ~; #',
      category: "ENABLE_RBAC",
    });
    expect(c.cli).toContain('kv\\"');
    expect(c.cli).not.toMatch(/--name "kv"; rm/);
  });
});
