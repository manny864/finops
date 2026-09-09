/**
 * Microsoft Entra ID — Gobernanza de Identidades y FinOps
 *
 * RBAC minimo:
 *   - Microsoft Graph (permisos de aplicacion): `Directory.Read.All` para
 *     usuarios y service principals, `Organization.Read.All` para
 *     `subscribedSkus`, y `AuditLog.Read.All` para `signInActivity`.
 *     `signInActivity` ademas exige una licencia Entra ID P1 en el tenant; si no
 *     esta, el servicio lo declara como capacidad no disponible en vez de
 *     asumir que todos los usuarios estan activos.
 *   - Azure: `Reader` sobre las suscripciones, para `Microsoft.AAD/domainServices`.
 *
 * Entra ID mezcla dos modelos de facturacion que Azure nunca muestra juntos:
 *  - Recursos ARM medidos (Domain Services, External ID): aparecen en Cost
 *    Management.
 *  - Licencias por usuario (P1/P2/Governance/Workload ID): NO aparecen en Cost
 *    Management. Su desperdicio solo se ve cruzando `subscribedSkus` contra la
 *    actividad de logon, y suele ser el numero mas grande y mas invisible.
 */

import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { withArgLimit } from "@/lib/argConcurrency";
import { errorMessage } from "@/lib/apiErrors";
import { graphGetAll, graphToken } from "@/modules/collectors/azure/m365UsersService";
import { resolveSkuName, resolveSkuPrice } from "@/lib/m365SkuCatalog";
import {
  AUDITED_ENTRA_SKUS,
  EDS_SKU_MONTHLY_USD,
  ENTRA_COST_COLORS,
  ENTRA_LICENSE_USD,
  INACTIVE_USER_DAYS,
  type EntraActivityStatus,
  type EntraIdPayload,
  type EntraIdRemediationAction,
  type EntraIdResourceItem,
  type EntraIdSummaryMetrics,
  type EntraLicenseSkuSummary,
} from "@/types/azureEntraId.types";

// ─────────────────────────────────────────────────────────────────────────────
// Normalizacion y clasificacion
// ─────────────────────────────────────────────────────────────────────────────

/** Dias desde una fecha ISO; `null` si no hay fecha o es invalida. */
export function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

/**
 * Estado de actividad de una identidad.
 *
 * `Disabled` gana sobre todo lo demas: una cuenta deshabilitada con licencia es
 * desperdicio puro, sin importar cuando fue su ultimo logon. `Unknown` se
 * reserva para cuando Graph no expone `signInActivity` — asumir "activo" ahi
 * ocultaria la fuga, y asumir "inactivo" produciria recomendaciones de revocar
 * licencias a gente que si trabaja.
 */
export function deriveActivityStatus(
  accountEnabled: boolean,
  inactiveDays: number | null,
  signInActivityAvailable: boolean
): EntraActivityStatus {
  if (!accountEnabled) return "Disabled";
  if (!signInActivityAvailable) return "Unknown";
  if (inactiveDays === null) return "Inactive"; // nunca inicio sesion
  return inactiveDays > INACTIVE_USER_DAYS ? "Inactive" : "Active";
}

/** Normaliza el SKU de Entra Domain Services a los tres niveles facturables. */
export function normalizeEdsSku(raw: unknown): "Standard" | "Enterprise" | "Premium" {
  const v = typeof raw === "string" ? raw.toLowerCase() : "";
  if (v === "premium") return "Premium";
  if (v === "enterprise") return "Enterprise";
  return "Standard";
}

/** Heuristica de entorno por nombre de RG y suscripcion. */
export function isDevOrTestScope(resourceGroup: string, subscriptionName: string): boolean {
  const haystack = `${resourceGroup} ${subscriptionName}`.toLowerCase();
  return /\b(dev|desarrollo|test|testing|qa|stg|stage|staging|sandbox|poc|lab|preprod|pre-prod|nonprod|non-prod)\b/.test(
    haystack
  );
}

/** Precio mensual de una licencia, con el catalogo compartido como fuente. */
export function licenseUnitPrice(skuPartNumber: string): number {
  return ENTRA_LICENSE_USD[skuPartNumber] ?? resolveSkuPrice(skuPartNumber);
}

/** `true` si el SKU es uno de los planes de Entra que este modulo audita. */
export function isAuditedEntraSku(skuPartNumber: string): boolean {
  return (AUDITED_ENTRA_SKUS as readonly string[]).includes(skuPartNumber);
}

// ─────────────────────────────────────────────────────────────────────────────
// Costo
// ─────────────────────────────────────────────────────────────────────────────

export function calcDomainServicesCost(sku: "Standard" | "Enterprise" | "Premium"): number {
  return EDS_SKU_MONTHLY_USD[sku] ?? EDS_SKU_MONTHLY_USD.Standard;
}

/**
 * Desperdicio de un SKU: las unidades compradas y sin asignar se pagan igual, y
 * las asignadas a cuentas inactivas o deshabilitadas tambien.
 */
export function calcSkuWaste(
  unassignedUnits: number,
  inactiveAssignedUnits: number,
  unitPriceUSD: number
): number {
  return Number((Math.max(0, unassignedUnits + inactiveAssignedUnits) * unitPriceUSD).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregacion
// ─────────────────────────────────────────────────────────────────────────────

export function calculateEntraIdSummary(
  resources: EntraIdResourceItem[],
  licenseSkus: EntraLicenseSkuSummary[],
  remediations: EntraIdRemediationAction[],
  opts: { signInActivityAvailable: boolean; guestUsersCount: number }
): EntraIdSummaryMetrics {
  const users = resources.filter((r) => r.resourceType === "UserLicense");
  const sps = resources.filter((r) => r.resourceType === "ServicePrincipal");
  const eds = resources.filter((r) => r.resourceType === "DomainServices");
  const ext = resources.filter((r) => r.resourceType === "ExternalID_Tenant");

  const edsCost = eds.reduce((a, r) => a + r.monthlyCostUSD, 0);
  const extCost = ext.reduce((a, r) => a + r.monthlyCostUSD, 0);
  const spCost = sps.reduce((a, r) => a + r.monthlyCostUSD, 0);
  const totalArmCostUSD = edsCost + extCost;

  const totalLicenseWasteUSD = licenseSkus.reduce((a, s) => a + s.wastedMonthlyUSD, 0);
  // El gasto se calcula sobre las unidades COMPRADAS (`prepaidUnits`), no sobre
  // las asignadas: Microsoft factura el acuerdo de licenciamiento completo,
  // esten repartidas o no. Contarlo sobre las consumidas subestimaba la factura
  // y permitia que el desperdicio superara al gasto, que es imposible.
  const totalLicenseSpendUSD = licenseSkus.reduce((a, s) => a + s.prepaidUnits * s.unitPriceUSD, 0);
  const assignedLicenseCost = Math.max(0, totalLicenseSpendUSD - totalLicenseWasteUSD);

  const rows: Array<[string, number]> = [
    ["Entra Domain Services", edsCost],
    ["Workload Identities", spCost],
    ["External ID (MAU)", extCost],
    ["Licencias asignadas", assignedLicenseCost],
    ["Licencias desperdiciadas", totalLicenseWasteUSD],
  ];
  const grandTotal = rows.reduce((a, [, c]) => a + c, 0);

  return {
    totalArmCostUSD: Number(totalArmCostUSD.toFixed(2)),
    totalLicenseWasteUSD: Number(totalLicenseWasteUSD.toFixed(2)),
    totalLicenseSpendUSD: Number(totalLicenseSpendUSD.toFixed(2)),
    totalUsersCount: users.length,
    guestUsersCount: opts.guestUsersCount,
    inactiveUsersCount: users.filter((u) => u.activityStatus === "Inactive").length,
    disabledWithLicenseCount: users.filter(
      (u) => u.activityStatus === "Disabled" && u.assignedLicenses.length > 0
    ).length,
    servicePrincipalsCount: sps.length,
    inactiveServicePrincipalsCount: sps.filter((s) => s.activityStatus === "Inactive").length,
    domainServicesCount: eds.length,
    workloadIdentitiesCount: sps.filter((s) => s.assignedLicenses.includes("WORKLOAD_IDENTITIES")).length,
    potentialSavingsUSD: Number(remediations.reduce((a, r) => a + r.estimatedSavingsUSD, 0).toFixed(2)),
    breakdownByCostType: rows
      .filter(([, cost]) => cost > 0)
      .map(([typeName, costUSD]) => ({
        typeName,
        costUSD: Number(costUSD.toFixed(2)),
        percentage: grandTotal > 0 ? Number(((costUSD / grandTotal) * 100).toFixed(1)) : 0,
        color: ENTRA_COST_COLORS[typeName],
      }))
      .sort((a, b) => b.costUSD - a.costUSD),
    licenseSkus,
    signInActivityAvailable: opts.signInActivityAvailable,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor de recomendaciones
// ─────────────────────────────────────────────────────────────────────────────

export function generateEntraIdRecommendations(
  resources: EntraIdResourceItem[],
  licenseSkus: EntraLicenseSkuSummary[],
  signInActivityAvailable: boolean
): EntraIdRemediationAction[] {
  const out: EntraIdRemediationAction[] = [];

  // Regla 1 — licencias en cuentas inactivas o deshabilitadas, agrupadas por SKU
  // para que la accion sea una sola por plan y no una por usuario.
  if (signInActivityAvailable) {
    const wastefulUsers = resources.filter(
      (r) =>
        r.resourceType === "UserLicense" &&
        (r.activityStatus === "Inactive" || r.activityStatus === "Disabled") &&
        r.assignedLicenses.length > 0
    );

    const bySku = new Map<string, EntraIdResourceItem[]>();
    for (const u of wastefulUsers) {
      for (const sku of u.assignedLicenses) {
        if (!isAuditedEntraSku(sku)) continue;
        bySku.set(sku, [...(bySku.get(sku) || []), u]);
      }
    }

    for (const [sku, affected] of bySku) {
      const price = licenseUnitPrice(sku);
      const disabled = affected.filter((u) => u.activityStatus === "Disabled").length;
      out.push({
        id: `reclaim-${sku}`,
        targetId: sku,
        targetName: resolveSkuName(sku),
        // El inciso sobre las deshabilitadas es una frase, no un dato: va como
        // `select` de ICU sobre `disabled` en vez de armarse aca.
        params: {
          count: affected.length,
          sku: resolveSkuName(sku),
          disabled,
          days: INACTIVE_USER_DAYS,
          price,
        },
        category: "RECLAIM_USER_LICENSE",
        estimatedSavingsUSD: Number((affected.length * price).toFixed(2)),
        confidence: disabled > 0 ? "HIGH" : "MEDIUM",
        actionType: "REMOVE_LICENSE_ASSIGNMENT",
        affectedPrincipals: affected.map((u) => u.principalIdentifier || u.displayName),
      });
    }
  }

  // Licencias compradas y nunca asignadas: se pagan igual y no requieren
  // analisis de actividad.
  for (const sku of licenseSkus) {
    if (sku.unassignedUnits > 0 && isAuditedEntraSku(sku.skuPartNumber)) {
      out.push({
        id: `unassigned-${sku.skuPartNumber}`,
        targetId: sku.skuPartNumber,
        targetName: sku.displayName,
        params: {
          count: sku.unassignedUnits,
          sku: sku.displayName,
          prepaid: sku.prepaidUnits,
          consumed: sku.consumedUnits,
        },
        category: "ADJUST_PREPAID_UNITS",
        estimatedSavingsUSD: Number((sku.unassignedUnits * sku.unitPriceUSD).toFixed(2)),
        confidence: "HIGH",
        actionType: "ADJUST_PREPAID_UNITS",
      });
    }
  }

  // Regla 2 — Domain Services sobredimensionado en entorno no productivo.
  for (const eds of resources.filter((r) => r.resourceType === "DomainServices")) {
    if (eds.isWasteful && eds.skuTier !== "Standard") {
      const saving = calcDomainServicesCost(eds.skuTier as "Enterprise" | "Premium") - EDS_SKU_MONTHLY_USD.Standard;
      out.push({
        id: `eds-${eds.id}`,
        targetId: eds.id,
        targetName: eds.name,
        params: {
          name: eds.name,
          tier: eds.skuTier,
          currentCost: calcDomainServicesCost(eds.skuTier as "Enterprise" | "Premium"),
          standardCost: EDS_SKU_MONTHLY_USD.Standard,
        },
        category: "DOWNGRADE_DOMAIN_SERVICES",
        estimatedSavingsUSD: Number(Math.max(0, saving).toFixed(2)),
        confidence: "MEDIUM",
        actionType: "SET_EDS_SKU_STANDARD",
      });
    }
  }

  // Regla 3 — Service Principals con Workload ID Premium y sin actividad.
  const idleSps = resources.filter(
    (r) =>
      r.resourceType === "ServicePrincipal" &&
      r.activityStatus === "Inactive" &&
      r.assignedLicenses.includes("WORKLOAD_IDENTITIES")
  );
  if (idleSps.length > 0) {
    out.push({
      id: "purge-workload-ids",
      targetId: "WORKLOAD_IDENTITIES",
      targetName: "Microsoft Entra Workload ID",
      params: { count: idleSps.length, price: ENTRA_LICENSE_USD.WORKLOAD_IDENTITIES },
      category: "PURGE_WORKLOAD_LICENSE",
      estimatedSavingsUSD: Number((idleSps.length * ENTRA_LICENSE_USD.WORKLOAD_IDENTITIES).toFixed(2)),
      confidence: "MEDIUM",
      actionType: "REMOVE_WORKLOAD_LICENSE",
      affectedPrincipals: idleSps.map((s) => s.principalIdentifier || s.displayName),
    });
  }

  // External ID: prevencion de fraude por SMS. No es un ahorro cuantificable
  // sin datos de fraude, asi que va con cero.
  for (const ext of resources.filter((r) => r.resourceType === "ExternalID_Tenant")) {
    if (ext.monthlyCostUSD > 0) {
      out.push({
        id: `mfa-${ext.id}`,
        targetId: ext.id,
        targetName: ext.name,
        params: { name: ext.name },
        category: "MFA_FRAUD_PREVENTION",
        estimatedSavingsUSD: 0,
        confidence: "MEDIUM",
        actionType: "REVIEW_MFA_FLOWS",
      });
    }
  }

  return out.sort((a, b) => b.estimatedSavingsUSD - a.estimatedSavingsUSD);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset sintetico por tier (solo tenants demo — AGENTS.md #13)
// ─────────────────────────────────────────────────────────────────────────────

function userResource(
  displayName: string,
  upn: string,
  licenses: string[],
  inactiveDays: number | null,
  accountEnabled = true
): EntraIdResourceItem {
  const status = deriveActivityStatus(accountEnabled, inactiveDays, true);
  const cost = licenses.reduce((a, s) => a + licenseUnitPrice(s), 0);
  const wasteful = status === "Inactive" || status === "Disabled";
  return {
    id: `user-${upn}`,
    name: upn,
    displayName,
    resourceType: "UserLicense",
    principalIdentifier: upn,
    location: "Global",
    subscriptionId: "tenant",
    subscriptionName: "Tenant Scope",
    skuTier: licenses.map((s) => resolveSkuName(s)).join(" + ") || "Free",
    assignedLicenses: licenses,
    lastSignInDate:
      inactiveDays === null ? undefined : new Date(Date.now() - inactiveDays * 86400000).toISOString(),
    inactiveDays,
    isAccountEnabled: accountEnabled,
    activityStatus: status,
    monthlyCostUSD: Number(cost.toFixed(2)),
    potentialSavingsUSD: wasteful ? Number(cost.toFixed(2)) : 0,
    isWasteful: wasteful,
    wasteReason: !accountEnabled
      ? { key: "waste_DISABLED_WITH_LICENSE" as const }
      : status === "Inactive"
        ? inactiveDays === null
          ? { key: "waste_NEVER_SIGNED_IN" as const }
          : { key: "waste_NO_LOGON_DAYS" as const, params: { days: inactiveDays } }
        : undefined,
  };
}

function spResource(
  displayName: string,
  appId: string,
  licenses: string[],
  inactiveDays: number | null
): EntraIdResourceItem {
  const status = deriveActivityStatus(true, inactiveDays, true);
  const cost = licenses.reduce((a, s) => a + licenseUnitPrice(s), 0);
  const wasteful = status === "Inactive" && licenses.length > 0;
  return {
    id: `sp-${appId}`,
    name: appId,
    displayName,
    resourceType: "ServicePrincipal",
    principalIdentifier: appId,
    location: "Global",
    subscriptionId: "tenant",
    subscriptionName: "Tenant Scope",
    skuTier: licenses.length > 0 ? "Workload ID Premium" : "Free",
    assignedLicenses: licenses,
    lastSignInDate:
      inactiveDays === null ? undefined : new Date(Date.now() - inactiveDays * 86400000).toISOString(),
    inactiveDays,
    isAccountEnabled: true,
    activityStatus: status,
    monthlyCostUSD: Number(cost.toFixed(2)),
    potentialSavingsUSD: wasteful ? Number(cost.toFixed(2)) : 0,
    isWasteful: wasteful,
    wasteReason: wasteful ? { key: "waste_NO_AUTH_DAYS", params: { days: inactiveDays ?? 0 } } : undefined,
  };
}

export function getMockEntraIdPayload(tenantId: string): EntraIdPayload {
  const isEnterprise = tenantId.includes("4444");
  const isBusiness = tenantId.includes("2222") || isEnterprise;

  const resources: EntraIdResourceItem[] = [
    // Domain Services: Enterprise en un RG de desarrollo (Regla 2).
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000002/resourceGroups/rg-dev-identity/providers/Microsoft.AAD/domainServices/aaddscontoso-dev",
      name: "aaddscontoso-dev",
      displayName: "aaddscontoso-dev",
      resourceType: "DomainServices",
      location: "eastus",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      subscriptionName: "Desarrollo y QA",
      skuTier: "Enterprise",
      assignedLicenses: [],
      isAccountEnabled: true,
      activityStatus: "Active",
      monthlyCostUSD: calcDomainServicesCost("Enterprise"),
      potentialSavingsUSD: calcDomainServicesCost("Enterprise") - EDS_SKU_MONTHLY_USD.Standard,
      isWasteful: true,
      wasteReason: { key: "waste_NONPROD_SKU", params: { sku: "Enterprise" } },
    },
    // Usuarios activos, con licencia justificada.
    userResource("Ana Herrera", "ana.herrera@contoso.com", ["AAD_PREMIUM_P2"], 1),
    userResource("Bruno Diaz", "bruno.diaz@contoso.com", ["AAD_PREMIUM"], 3),
    userResource("Carla Nunez", "carla.nunez@contoso.com", ["AAD_PREMIUM"], 12),
    // Regla 1: inactivos con licencia.
    userResource("Diego Ramos", "diego.ramos@contoso.com", ["AAD_PREMIUM_P2"], 187),
    userResource("Elena Sosa", "elena.sosa@contoso.com", ["AAD_PREMIUM"], 214),
    // Cuenta deshabilitada que sigue reteniendo licencia: desperdicio puro.
    userResource("Fernando Gil (baja)", "fernando.gil@contoso.com", ["AAD_PREMIUM_P2"], 340, false),
    // Service principals.
    spResource("sp-ci-pipeline", "11111111-aaaa-bbbb-cccc-000000000001", ["WORKLOAD_IDENTITIES"], 2),
    spResource("sp-legacy-sync", "11111111-aaaa-bbbb-cccc-000000000002", ["WORKLOAD_IDENTITIES"], 268),
  ];

  if (isBusiness) {
    resources.push(
      userResource("Gabriela Paz", "gabriela.paz@contoso.com", ["ENTRA_ID_GOVERNANCE"], 5),
      userResource("Hugo Vera", "hugo.vera@contoso.com", ["ENTRA_ID_GOVERNANCE"], 156),
      // Invitado B2B que nunca inicio sesion.
      userResource("Consultor Externo", "consultor_ext#EXT#@contoso.com", ["AAD_PREMIUM"], null),
      spResource("sp-backup-job", "11111111-aaaa-bbbb-cccc-000000000003", ["WORKLOAD_IDENTITIES"], 401)
    );
  }

  if (isEnterprise) {
    resources.push(
      {
        id: "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-prod-identity/providers/Microsoft.AAD/domainServices/aaddscontoso-prod",
        name: "aaddscontoso-prod",
        displayName: "aaddscontoso-prod",
        resourceType: "DomainServices",
        location: "westeurope",
        subscriptionId: "00000000-0000-0000-0000-000000000001",
        subscriptionName: "Produccion CSCloudSolutions",
        skuTier: "Enterprise",
        assignedLicenses: [],
        isAccountEnabled: true,
        activityStatus: "Active",
        monthlyCostUSD: calcDomainServicesCost("Enterprise"),
        potentialSavingsUSD: 0,
        // En produccion, Enterprise puede estar justificado por los trusts.
        isWasteful: false,
      },
      {
        id: "external-id-ciam-prod",
        name: "ciam-contoso-prod",
        displayName: "External ID — Portal de Clientes",
        resourceType: "ExternalID_Tenant",
        location: "Global",
        subscriptionId: "00000000-0000-0000-0000-000000000001",
        subscriptionName: "Produccion CSCloudSolutions",
        skuTier: "External ID P1",
        assignedLicenses: [],
        isAccountEnabled: true,
        activityStatus: "Active",
        // 68.000 MAU: 18.000 facturables sobre los 50.000 gratuitos.
        monthlyCostUSD: Number((18_000 * 0.00325).toFixed(2)),
        potentialSavingsUSD: 0,
        isWasteful: false,
      },
      userResource("Ignacio Roldan", "ignacio.roldan@contoso.com", ["AAD_PREMIUM_P2", "ENTRA_ID_GOVERNANCE"], 298),
      userResource("Julia Marino", "julia.marino@contoso.com", ["AAD_PREMIUM_P2"], 8)
    );
  }

  // SKUs comprados: se declaran mas unidades de las asignadas para reflejar el
  // caso real de licencias pagas y nunca repartidas.
  const buildSku = (skuPartNumber: string, prepaid: number): EntraLicenseSkuSummary => {
    const assigned = resources.filter((r) => r.assignedLicenses.includes(skuPartNumber));
    const inactiveAssigned = assigned.filter(
      (r) => r.activityStatus === "Inactive" || r.activityStatus === "Disabled"
    ).length;
    const unitPriceUSD = licenseUnitPrice(skuPartNumber);
    const unassigned = Math.max(0, prepaid - assigned.length);
    return {
      skuPartNumber,
      displayName: resolveSkuName(skuPartNumber),
      prepaidUnits: prepaid,
      consumedUnits: assigned.length,
      unassignedUnits: unassigned,
      inactiveAssignedUnits: inactiveAssigned,
      unitPriceUSD,
      wastedMonthlyUSD: calcSkuWaste(unassigned, inactiveAssigned, unitPriceUSD),
    };
  };

  const licenseSkus: EntraLicenseSkuSummary[] = [
    buildSku("AAD_PREMIUM", isEnterprise ? 12 : isBusiness ? 8 : 5),
    buildSku("AAD_PREMIUM_P2", isEnterprise ? 10 : isBusiness ? 6 : 4),
    buildSku("WORKLOAD_IDENTITIES", isEnterprise ? 6 : isBusiness ? 4 : 3),
  ];
  if (isBusiness) licenseSkus.push(buildSku("ENTRA_ID_GOVERNANCE", isEnterprise ? 5 : 3));

  const remediations = generateEntraIdRecommendations(resources, licenseSkus, true);
  const summary = calculateEntraIdSummary(resources, licenseSkus, remediations, {
    signInActivityAvailable: true,
    guestUsersCount: resources.filter((r) => r.principalIdentifier?.includes("#EXT#")).length,
  });

  return {
    summary,
    resources,
    remediations,
    source: "mock",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions: Array.from(new Set(resources.map((r) => r.subscriptionName))),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Descubrimiento vivo
// ─────────────────────────────────────────────────────────────────────────────

function emptyPayload(availableSubscriptions: string[] = [], unavailable: string[] = []): EntraIdPayload {
  return {
    summary: calculateEntraIdSummary([], [], [], { signInActivityAvailable: false, guestUsersCount: 0 }),
    resources: [],
    remediations: [],
    source: "live",
    lastUpdated: new Date().toISOString(),
    availableSubscriptions,
    unavailableCapabilities: unavailable,
  };
}

interface GraphUserRow {
  id?: string;
  displayName?: string;
  userPrincipalName?: string;
  accountEnabled?: boolean;
  userType?: string;
  assignedLicenses?: Array<{ skuId?: string }>;
  signInActivity?: { lastSignInDateTime?: string | null };
}

interface GraphSpRow {
  id?: string;
  appId?: string;
  displayName?: string;
  accountEnabled?: boolean;
  servicePrincipalType?: string;
  signInActivity?: { lastSignInDateTime?: string | null };
}

/**
 * Inventario vivo: `subscribedSkus` + `/users` + `/servicePrincipals` de Graph,
 * mas `Microsoft.AAD/domainServices` de Resource Graph.
 *
 * Devuelve estado vacio legitimo ante falta de credenciales o de datos; nunca
 * cae al dataset mock (Directiva 24.1). Cada bloque va en su propio try/catch y
 * las capacidades no disponibles se declaran, para que la UI degrade con gracia
 * en vez de mostrar ceros indistinguibles de "todo bien".
 */
export async function fetchLiveEntraIdData(tenantId: string): Promise<EntraIdPayload> {
  const unavailable: string[] = [];
  try {
    const credential = await getAzureCredential(tenantId);
    if (!credential) return emptyPayload();

    const subMap = await getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>());
    const availableSubscriptions = Array.from(subMap.values());

    let token: string;
    try {
      token = await graphToken(tenantId);
    } catch (error) {
      console.warn("[azureEntraId.service] Graph no disponible:", errorMessage(error));
      return emptyPayload(availableSubscriptions, ["MicrosoftGraph"]);
    }

    // 1. SKUs comprados. Mapea skuId (GUID) -> skuPartNumber.
    const skuIdToPart = new Map<string, string>();
    let rawSkus: Array<Record<string, unknown>> = [];
    try {
      rawSkus = (await graphGetAll(token, "https://graph.microsoft.com/v1.0/subscribedSkus")) as Array<
        Record<string, unknown>
      >;
      for (const s of rawSkus) {
        const skuId = String(s.skuId || "");
        const part = String(s.skuPartNumber || "");
        if (skuId && part) skuIdToPart.set(skuId.toLowerCase(), part);
      }
    } catch (error) {
      console.warn("[azureEntraId.service] subscribedSkus:", errorMessage(error));
      unavailable.push("subscribedSkus");
    }

    // 2. Usuarios. `signInActivity` exige AuditLog.Read.All + licencia P1: si
    // falla, se reintenta sin ese campo y se declara la capacidad ausente.
    let signInActivityAvailable = true;
    let rawUsers: GraphUserRow[] = [];
    const baseSelect = "id,displayName,userPrincipalName,accountEnabled,userType,assignedLicenses";
    try {
      rawUsers = (await graphGetAll(
        token,
        `https://graph.microsoft.com/v1.0/users?$select=${baseSelect},signInActivity&$top=999`
      )) as GraphUserRow[];
    } catch {
      signInActivityAvailable = false;
      unavailable.push("signInActivity");
      try {
        rawUsers = (await graphGetAll(
          token,
          `https://graph.microsoft.com/v1.0/users?$select=${baseSelect}&$top=999`
        )) as GraphUserRow[];
      } catch (error) {
        console.warn("[azureEntraId.service] /users:", errorMessage(error));
        unavailable.push("users");
      }
    }

    // 3. Service principals.
    let rawSps: GraphSpRow[] = [];
    try {
      rawSps = (await graphGetAll(
        token,
        "https://graph.microsoft.com/v1.0/servicePrincipals?$select=id,appId,displayName,accountEnabled,servicePrincipalType&$top=999"
      )) as GraphSpRow[];
    } catch (error) {
      console.warn("[azureEntraId.service] /servicePrincipals:", errorMessage(error));
      unavailable.push("servicePrincipals");
    }

    // 4. Entra Domain Services via Resource Graph.
    const resources: EntraIdResourceItem[] = [];
    try {
      const client = await getResourceGraphClient(tenantId);
      const edsQuery = `
        resources
        | where type =~ 'microsoft.aad/domainservices'
        | project id, name, location, resourceGroup, subscriptionId, properties
      `;
      const edsRes = await withArgLimit(async () => client.resources({ query: edsQuery }));
      for (const row of (edsRes.data || []) as Array<Record<string, unknown>>) {
        const props = (row.properties || {}) as Record<string, unknown>;
        const sku = normalizeEdsSku(props.sku);
        const resourceGroup = String(row.resourceGroup || "");
        const subscriptionId = String(row.subscriptionId || "");
        const subscriptionName = subMap.get(subscriptionId) || subscriptionId;
        const devOrTest = isDevOrTestScope(resourceGroup, subscriptionName);
        const cost = calcDomainServicesCost(sku);
        const wasteful = devOrTest && sku !== "Standard";
        resources.push({
          id: String(row.id || ""),
          name: String(row.name || ""),
          displayName: String(row.name || ""),
          resourceType: "DomainServices",
          location: String(row.location || ""),
          subscriptionId,
          subscriptionName,
          skuTier: sku,
          assignedLicenses: [],
          isAccountEnabled: true,
          activityStatus: "Active",
          monthlyCostUSD: cost,
          potentialSavingsUSD: wasteful ? cost - EDS_SKU_MONTHLY_USD.Standard : 0,
          isWasteful: wasteful,
          wasteReason: wasteful ? { key: "waste_NONPROD_SKU", params: { sku } } : undefined,
        });
      }
    } catch (error) {
      console.warn("[azureEntraId.service] domainServices:", errorMessage(error));
      unavailable.push("domainServices");
    }

    // 5. Usuarios -> recursos. Solo se listan los que tienen alguna licencia de
    // Entra auditada: el resto no es materia FinOps de este modulo.
    let guestUsersCount = 0;
    for (const u of rawUsers) {
      const upn = String(u.userPrincipalName || "");
      if (String(u.userType || "").toLowerCase() === "guest") guestUsersCount++;

      const licenses = (u.assignedLicenses || [])
        .map((l) => skuIdToPart.get(String(l.skuId || "").toLowerCase()) || "")
        .filter((p) => p && isAuditedEntraSku(p));
      if (licenses.length === 0) continue;

      const inactiveDays = daysSince(u.signInActivity?.lastSignInDateTime);
      const accountEnabled = u.accountEnabled !== false;
      const status = deriveActivityStatus(accountEnabled, inactiveDays, signInActivityAvailable);
      const cost = licenses.reduce((a, s) => a + licenseUnitPrice(s), 0);
      const wasteful = status === "Inactive" || status === "Disabled";

      resources.push({
        id: `user-${u.id || upn}`,
        name: upn,
        displayName: String(u.displayName || upn),
        resourceType: "UserLicense",
        principalIdentifier: upn,
        location: "Global",
        subscriptionId: "tenant",
        subscriptionName: "Tenant Scope",
        skuTier: licenses.map((s) => resolveSkuName(s)).join(" + "),
        assignedLicenses: licenses,
        lastSignInDate: u.signInActivity?.lastSignInDateTime || undefined,
        inactiveDays,
        isAccountEnabled: accountEnabled,
        activityStatus: status,
        monthlyCostUSD: Number(cost.toFixed(2)),
        potentialSavingsUSD: wasteful ? Number(cost.toFixed(2)) : 0,
        isWasteful: wasteful,
        wasteReason: !accountEnabled
          ? { key: "waste_DISABLED_WITH_LICENSE" as const }
          : status === "Inactive"
            ? inactiveDays === null
              ? { key: "waste_NEVER_SIGNED_IN" as const }
              : { key: "waste_NO_LOGON_DAYS" as const, params: { days: inactiveDays } }
            : undefined,
      });
    }

    // 6. Service principals. Sin `signInActivity` en el endpoint estandar, la
    // actividad queda como Unknown en vez de asumir inactividad y recomendar
    // desasignar licencias de integraciones que si funcionan.
    for (const sp of rawSps) {
      const inactiveDays = daysSince(sp.signInActivity?.lastSignInDateTime);
      const hasSignIn = sp.signInActivity?.lastSignInDateTime != null;
      const status: EntraActivityStatus = hasSignIn
        ? deriveActivityStatus(sp.accountEnabled !== false, inactiveDays, true)
        : "Unknown";
      resources.push({
        id: `sp-${sp.id || sp.appId}`,
        name: String(sp.appId || sp.id || ""),
        displayName: String(sp.displayName || sp.appId || ""),
        resourceType: "ServicePrincipal",
        principalIdentifier: String(sp.appId || ""),
        location: "Global",
        subscriptionId: "tenant",
        subscriptionName: "Tenant Scope",
        skuTier: String(sp.servicePrincipalType || "Application"),
        // Graph no expone que SPs consumen Workload ID Premium: se declara
        // vacio en vez de inferirlo.
        assignedLicenses: [],
        lastSignInDate: sp.signInActivity?.lastSignInDateTime || undefined,
        inactiveDays,
        isAccountEnabled: sp.accountEnabled !== false,
        activityStatus: status,
        monthlyCostUSD: 0,
        potentialSavingsUSD: 0,
        isWasteful: false,
      });
    }

    // 7. Resumen de SKUs comprados vs asignados.
    const licenseSkus: EntraLicenseSkuSummary[] = rawSkus
      .map((s) => {
        const skuPartNumber = String(s.skuPartNumber || "");
        if (!isAuditedEntraSku(skuPartNumber)) return null;
        const prepaid = Number(((s.prepaidUnits || {}) as Record<string, unknown>).enabled) || 0;
        const consumed = Number(s.consumedUnits) || 0;
        const inactiveAssigned = resources.filter(
          (r) =>
            r.assignedLicenses.includes(skuPartNumber) &&
            (r.activityStatus === "Inactive" || r.activityStatus === "Disabled")
        ).length;
        const unitPriceUSD = licenseUnitPrice(skuPartNumber);
        const unassigned = Math.max(0, prepaid - consumed);
        return {
          skuPartNumber,
          displayName: resolveSkuName(skuPartNumber),
          prepaidUnits: prepaid,
          consumedUnits: consumed,
          unassignedUnits: unassigned,
          inactiveAssignedUnits: inactiveAssigned,
          unitPriceUSD,
          wastedMonthlyUSD: calcSkuWaste(unassigned, inactiveAssigned, unitPriceUSD),
        } satisfies EntraLicenseSkuSummary;
      })
      .filter((x): x is EntraLicenseSkuSummary => x !== null);

    if (resources.length === 0 && licenseSkus.length === 0) {
      return emptyPayload(availableSubscriptions, unavailable);
    }

    const remediations = generateEntraIdRecommendations(resources, licenseSkus, signInActivityAvailable);
    const summary = calculateEntraIdSummary(resources, licenseSkus, remediations, {
      signInActivityAvailable,
      guestUsersCount,
    });

    return {
      summary,
      resources,
      remediations,
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions,
      unavailableCapabilities: unavailable,
    };
  } catch (error) {
    console.error("[azureEntraId.service] fetchLiveEntraIdData:", errorMessage(error));
    return emptyPayload([], unavailable);
  }
}
