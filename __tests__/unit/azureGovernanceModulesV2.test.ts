import { describe, it, expect } from "vitest";

// ── Alta Disponibilidad ──
import {
  buildHaSummary,
  downtimeMinutesPerMonth,
  estimateRemediationCost,
  extractResourceGroup,
  extractSubscriptionId,
  getMockHaPayload,
  isRemediableViaApi,
  mapHaItem,
  slaForCategory,
  toIssueCategory,
  toResourceTypeDisplay,
  toSeverity,
  assembleLiveHa,
} from "@/services/azureHighAvailability.service";
import { MINUTES_PER_MONTH } from "@/types/azureHighAvailability.types";

// ── Credenciales de Entra ID ──
import {
  buildCredentialsSummary,
  calcDaysRemaining,
  deriveStatus,
  formatExpiryDate,
  getMockCredentialsPayload,
  mapCredential,
  parseChannels,
  parseRecipients,
  parseThresholds,
  serializeThresholds,
  toCredentialType,
  assembleLiveCredentials,
} from "@/services/azureCredentialsExpiry.service";

// ── Aprobaciones de Remediación ──
import {
  buildApprovalsSummary,
  canSnapshot,
  extractFromResourceId,
  getMockApprovalsPayload,
  isDestructive,
  mapHistoryRow,
  mapPendingRow,
  normalizeActionType,
  requiresReboot,
  statusFromDb,
  statusToDb,
  toResourceTypeDisplay as approvalTypeDisplay,
} from "@/services/azureRemediationApprovals.service";
import type { ApprovalHistoryItem } from "@/types/azureRemediationApprovals.types";

// ═════════════════════════════════════════════════════════════════════════════
describe("Alta Disponibilidad — normalización y SLA", () => {
  it("traduce los issueType del escaneo ARG a categorías del módulo", () => {
    expect(toIssueCategory("no_zone")).toBe("NO_AVAILABILITY_ZONE");
    expect(toIssueCategory("basic_sku")).toBe("BASIC_SKU_NO_SLA");
    expect(toIssueCategory("low_capacity")).toBe("SINGLE_INSTANCE_CAPACITY");
    // `single_replica` (storage LRS) es una falta de redundancia geográfica.
    expect(toIssueCategory("single_replica")).toBe("NO_GEO_REDUNDANCY");
  });

  it("una severidad desconocida cae en MEDIA, no en BAJA", () => {
    // Subestimarla la mandaría al final de la lista y nadie la miraría.
    expect(toSeverity("critical")).toBe("CRITICAL");
    expect(toSeverity("inventada")).toBe("MEDIUM");
    expect(toSeverity(undefined)).toBe("MEDIUM");
  });

  it("la SKU Basic no tiene SLA publicado: es 0, no 99.9", () => {
    expect(slaForCategory("BASIC_SKU_NO_SLA").current).toBe(0);
    expect(slaForCategory("NO_AVAILABILITY_ZONE")).toEqual({ current: 99.9, target: 99.99 });
    expect(slaForCategory("NO_AVAILABILITY_SET").target).toBe(99.95);
  });

  it("un backup no mejora el SLA de disponibilidad: mejora el RPO", () => {
    const sla = slaForCategory("NO_BACKUP");
    expect(sla.current).toBe(sla.target);
  });

  it("traduce el SLA a minutos de caída mensual", () => {
    expect(downtimeMinutesPerMonth(99.9)).toBeCloseTo(43.2, 1);
    expect(downtimeMinutesPerMonth(99.99)).toBeCloseTo(4.32, 2);
    expect(downtimeMinutesPerMonth(100)).toBe(0);
    // Sin SLA el peor caso es el mes entero.
    expect(downtimeMinutesPerMonth(0)).toBe(MINUTES_PER_MONTH);
  });

  it("sólo el upgrade de SKU y el backup se pueden aplicar por API", () => {
    expect(isRemediableViaApi("BASIC_SKU_NO_SLA")).toBe(true);
    expect(isRemediableViaApi("NO_BACKUP")).toBe(true);
    // Zonas y Availability Sets exigen recrear el recurso.
    expect(isRemediableViaApi("NO_AVAILABILITY_ZONE")).toBe(false);
    expect(isRemediableViaApi("NO_AVAILABILITY_SET")).toBe(false);
    expect(isRemediableViaApi("NO_GEO_REDUNDANCY")).toBe(false);
  });

  it("el costo proporcional usa el gasto del recurso y sin dato devuelve 0", () => {
    expect(estimateRemediationCost("BASIC_SKU_NO_SLA")).toBe(3.65);
    expect(estimateRemediationCost("SINGLE_INSTANCE_CAPACITY", 146)).toBe(146);
    // Sin gasto conocido no se inventa una cifra que iría a un comité de costos.
    expect(estimateRemediationCost("NO_GEO_REDUNDANCY", 0)).toBe(0);
  });

  it("extrae suscripción y grupo del ARM ID", () => {
    const id = "/subscriptions/abc-123/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-1";
    expect(extractSubscriptionId(id)).toBe("abc-123");
    expect(extractResourceGroup(id)).toBe("rg-prod");
    expect(extractResourceGroup("")).toBe("");
  });

  it("etiqueta los tipos de recurso", () => {
    expect(toResourceTypeDisplay("microsoft.web/serverfarms")).toBe("Serverfarms");
    expect(toResourceTypeDisplay("microsoft.network/publicipaddresses")).toBe("Public IPAddresses");
    expect(toResourceTypeDisplay("microsoft.raro/miTipoNuevo")).toBe("Mi Tipo Nuevo");
  });
});

describe("Alta Disponibilidad — resumen", () => {
  const payload = getMockHaPayload("demo-tenant-4444");

  it("las exenciones no cuentan en los KPIs pero siguen listadas", () => {
    // Si contaran, el tablero nunca podría bajar a cero.
    const s = payload.summary;
    const eximidas = s.recommendations.filter((r) => r.isExempted);
    expect(eximidas.length).toBeGreaterThan(0);
    const activas = s.recommendations.filter((r) => !r.isExempted);
    expect(s.totalRecommendationsCount).toBe(activas.length);
    expect(s.criticalCount + s.highCount + s.mediumCount + s.lowCount).toBe(activas.length);
  });

  it("ordena por severidad y manda las eximidas al final", () => {
    const recs = payload.summary.recommendations;
    const primeraEximida = recs.findIndex((r) => r.isExempted);
    if (primeraEximida >= 0) {
      expect(recs.slice(primeraEximida).every((r) => r.isExempted)).toBe(true);
    }
    expect(recs[0].severity).toBe("CRITICAL");
  });

  it("el id de recomendación combina recurso y categoría", () => {
    // Un mismo recurso puede tener dos brechas distintas y cada una se exime
    // por separado.
    const item = mapHaItem({
      resourceId: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm",
      resourceName: "vm",
      resourceType: "microsoft.compute/virtualmachines",
      issueType: "no_zone",
      severity: "critical",
    });
    expect(item.id).toContain("no_availability_zone");
    expect(item.isExempted).toBe(false);
  });

  it("aplica la exención cuando el id coincide", () => {
    const resourceId = "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm";
    const item = mapHaItem(
      { resourceId, resourceName: "vm", resourceType: "microsoft.compute/virtualmachines", issueType: "no_zone", severity: "critical" },
      { exemptions: new Map([[`${resourceId}::NO_AVAILABILITY_ZONE`.toLowerCase(), "Laboratorio"]]) }
    );
    expect(item.isExempted).toBe(true);
    expect(item.exemptionReason).toBe("Laboratorio");
  });

  it("un tenant sin brechas devuelve el vacío legítimo, nunca la demo", () => {
    const p = assembleLiveHa({ items: [], availableSubscriptions: [] });
    expect(p.source).toBe("live");
    expect(p.summary.totalRecommendationsCount).toBe(0);
    expect(p.summary.recommendations).toEqual([]);
    expect(buildHaSummary([]).totalEstimatedRemediationCostUSD).toBe(0);
  });

  it("escala por tier y es determinista", () => {
    const pro = getMockHaPayload("demo-1111");
    expect(payload.summary.recommendations.length).toBeGreaterThan(pro.summary.recommendations.length);
    expect(getMockHaPayload("demo-tenant-4444").summary.criticalCount).toBe(payload.summary.criticalCount);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("Credenciales Entra ID — estados y fechas", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");

  it("cuenta días completos hacia arriba", () => {
    // Algo que vence en dos horas es 1 día, no 0: mostrar 0 lo haría
    // indistinguible de lo que vence a la medianoche.
    expect(calcDaysRemaining("2026-08-22T14:00:00.000Z", now)).toBe(1);
    expect(calcDaysRemaining("2026-09-21T12:00:00.000Z", now)).toBe(30);
    expect(calcDaysRemaining("2026-08-08T12:00:00.000Z", now)).toBe(-14);
    expect(calcDaysRemaining("fecha-rota", now)).toBe(0);
  });

  it("clasifica el estado con el umbral de 30 días", () => {
    expect(deriveStatus(-1)).toBe("EXPIRED");
    expect(deriveStatus(0)).toBe("EXPIRING_SOON");
    expect(deriveStatus(30)).toBe("EXPIRING_SOON");
    expect(deriveStatus(31)).toBe("HEALTHY");
  });

  it("distingue secretos de certificados", () => {
    expect(toCredentialType("password")).toBe("Secret");
    expect(toCredentialType("certificate")).toBe("Certificate");
    expect(toCredentialType("keyCredentials")).toBe("Certificate");
    expect(toCredentialType(undefined)).toBe("Secret");
  });

  it("formatea la fecha en DD/MM/YYYY", () => {
    expect(formatExpiryDate("2026-07-05T00:00:00.000Z")).toBe("05/07/2026");
    expect(formatExpiryDate("no-es-fecha")).toBe("—");
  });

  it("recalcula los días en vez de confiar en el snapshot", () => {
    // `daysTillExpiry` se computó cuando se guardó la fila y puede estar viejo.
    const item = mapCredential(
      { appId: "app-1", credentialId: "k1", expiresAt: "2026-09-21T12:00:00.000Z", daysTillExpiry: 999, displayName: "sp-x" },
      now
    );
    expect(item.daysRemaining).toBe(30);
    expect(item.status).toBe("EXPIRING_SOON");
    expect(item.id).toBe("app-1::k1");
  });
});

describe("Credenciales Entra ID — reglas de alerta", () => {
  it("los umbrales se ordenan de mayor a menor y sin duplicados", () => {
    expect(parseThresholds("7,60,30,30")).toEqual([60, 30, 7]);
    expect(serializeThresholds([7, 60, 30])).toBe("60,30,7");
    // Sin umbrales válidos se cae al de 30 días.
    expect(parseThresholds("abc,-5,99999")).toEqual([30]);
  });

  it("una regla sin canal válido cae a EMAIL en vez de no avisar a nadie", () => {
    expect(parseChannels(["email", "TEAMS"])).toEqual(["EMAIL", "TEAMS"]);
    expect(parseChannels(["inventado"])).toEqual(["EMAIL"]);
    expect(parseChannels(null)).toEqual(["EMAIL"]);
    expect(parseChannels('["SLACK"]')).toEqual(["SLACK"]);
  });

  it("parsea destinatarios desde JSON o CSV", () => {
    expect(parseRecipients('["a@x.com","b@x.com"]')).toEqual(["a@x.com", "b@x.com"]);
    expect(parseRecipients("a@x.com, b@x.com")).toEqual(["a@x.com", "b@x.com"]);
    expect(parseRecipients([])).toEqual([]);
  });
});

describe("Credenciales Entra ID — resumen", () => {
  const payload = getMockCredentialsPayload("demo-tenant-4444", new Date("2026-08-22T12:00:00.000Z"));

  it("una app con varios secretos cuenta como una identidad", () => {
    const s = buildCredentialsSummary({
      credentials: [
        mapCredential({ appId: "app-1", credentialId: "k1", expiresAt: "2027-01-01T00:00:00Z", displayName: "x" }),
        mapCredential({ appId: "app-1", credentialId: "k2", expiresAt: "2027-06-01T00:00:00Z", displayName: "x" }),
      ],
      alertRules: [],
    });
    expect(s.totalTrackedCredentialsCount).toBe(2);
    expect(s.totalApplicationsCount).toBe(1);
  });

  it("ordena por días restantes: lo más urgente primero", () => {
    const dias = payload.summary.credentials.map((c) => c.daysRemaining);
    expect([...dias].sort((a, b) => a - b)).toEqual(dias);
  });

  it("el dataset demo cubre los tres estados", () => {
    expect(payload.summary.expiredCount).toBeGreaterThan(0);
    expect(payload.summary.expiringSoonCount).toBeGreaterThan(0);
    expect(payload.summary.healthyCount).toBeGreaterThan(0);
    expect(payload.source).toBe("mock");
  });

  it("las fechas demo son relativas a hoy y no envejecen", () => {
    const enero = getMockCredentialsPayload("demo-tenant-4444", new Date("2027-01-15T00:00:00.000Z"));
    // El reparto entre estados se mantiene sin importar cuándo se abra la demo.
    expect(enero.summary.healthyCount).toBe(payload.summary.healthyCount);
    expect(enero.summary.expiredCount).toBe(payload.summary.expiredCount);
  });

  it("un tenant sin credenciales devuelve el vacío legítimo", () => {
    const p = assembleLiveCredentials({ credentials: [], alertRules: [] });
    expect(p.source).toBe("live");
    expect(p.summary.totalTrackedCredentialsCount).toBe(0);
    expect(p.summary.totalApplicationsCount).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("Aprobaciones — normalización", () => {
  it("normaliza el actionType y sus alias", () => {
    expect(normalizeActionType("DELETE_RESOURCE")).toBe("DELETE_RESOURCE");
    expect(normalizeActionType("delete-resource")).toBe("DELETE_RESOURCE");
    expect(normalizeActionType("downsize")).toBe("RIGHTSIZE_VM");
    expect(normalizeActionType("move to cool")).toBe("CHANGE_TIER");
    expect(normalizeActionType("deallocate")).toBe("POWER_OFF");
  });

  it("traduce el estado entre el enum de MySQL y el dominio", () => {
    expect(statusFromDb("Approved")).toBe("APPROVED");
    expect(statusFromDb("Failed")).toBe("FAILED");
    expect(statusFromDb(null)).toBe("PENDING");
    expect(statusToDb("APPROVED")).toBe("Approved");
    expect(statusToDb("FAILED")).toBe("Failed");
  });

  it("clasifica destructivas y las que reinician", () => {
    expect(isDestructive("DELETE_RESOURCE")).toBe(true);
    expect(isDestructive("PURGE_BACKUP")).toBe(true);
    expect(isDestructive("CHANGE_TIER")).toBe(false);
    expect(requiresReboot("RIGHTSIZE_VM")).toBe(true);
    expect(requiresReboot("POWER_OFF")).toBe(true);
    expect(requiresReboot("CHANGE_TIER")).toBe(false);
  });

  it("sólo los discos admiten snapshot previo", () => {
    // Prometer un snapshot de una NIC daría una falsa sensación de red.
    expect(canSnapshot("DELETE_RESOURCE", "microsoft.compute/disks")).toBe(true);
    expect(canSnapshot("DELETE_RESOURCE", "microsoft.network/networkinterfaces")).toBe(false);
    expect(canSnapshot("CHANGE_TIER", "microsoft.compute/disks")).toBe(false);
  });

  it("deriva del ARM ID lo que la fila puede no tener", () => {
    const d = extractFromResourceId(
      "/subscriptions/sub-9/resourceGroups/rg-x/providers/Microsoft.Compute/disks/disk-1"
    );
    expect(d).toEqual({
      subscriptionId: "sub-9",
      resourceGroup: "rg-x",
      resourceType: "Microsoft.Compute/disks",
      resourceName: "disk-1",
    });
  });

  it("etiqueta el tipo de recurso", () => {
    expect(approvalTypeDisplay("microsoft.compute/disks")).toBe("Managed Disk");
    expect(approvalTypeDisplay("microsoft.raro/algoNuevo")).toBe("Algo Nuevo");
  });

  it("mapea una fila pendiente completando desde el ARM ID", () => {
    const item = mapPendingRow({
      id: 5,
      resource_id: "/subscriptions/s1/resourceGroups/rg-a/providers/Microsoft.Compute/disks/d1",
      resource_name: "d1",
      action_type: "DELETE_RESOURCE",
      estimated_savings: "78.40",
      requested_by: "advisor-bot@demo.local",
      requested_at: "2026-08-21T14:20:00.000Z",
    });
    expect(item.subscriptionId).toBe("s1");
    expect(item.resourceGroup).toBe("rg-a");
    expect(item.monthlySavingsUSD).toBe(78.4);
    expect(item.isDestructive).toBe(true);
    expect(item.canSnapshot).toBe(true);
  });

  it("lee el SKU destino del payload de la acción", () => {
    const item = mapPendingRow({
      id: 6,
      resource_id: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm",
      action_type: "RIGHTSIZE_VM",
      action_payload_json: JSON.stringify({ targetSku: "Standard_D4s_v5" }),
    });
    expect(item.targetConfiguration).toBe("Standard_D4s_v5");
    expect(item.requiresReboot).toBe(true);
  });

  it("un payload corrupto no rompe el mapeo", () => {
    const item = mapPendingRow({ id: 7, action_type: "CHANGE_TIER", action_payload_json: "{no es json" });
    expect(item.targetConfiguration).toBeUndefined();
    expect(item.actionType).toBe("CHANGE_TIER");
  });

  it("el historial expone el resultado de ARM", () => {
    const h = mapHistoryRow({
      id: 9,
      resource_name: "disk-x",
      action_type: "DELETE_RESOURCE",
      status: "Failed",
      resolved_by: "admin@x.com",
      resolved_at: "2026-08-16T13:22:00.000Z",
      arm_execution_result_json: JSON.stringify({ status: "Failed", detail: "409 lease activo" }),
      backup_snapshot_id: "/snapshots/pre-1",
    });
    expect(h.status).toBe("FAILED");
    expect(h.armExecutionStatus).toBe("Failed");
    expect(h.armExecutionDetail).toContain("409");
    expect(h.backupSnapshotId).toBe("/snapshots/pre-1");
  });
});

describe("Aprobaciones — resumen", () => {
  const payload = getMockApprovalsPayload("demo-tenant-4444");

  it("el ahorro liberado excluye lo que Azure rechazó", () => {
    // Sumar una aprobación fallida inflaría el número que se reporta al negocio.
    const history: ApprovalHistoryItem[] = [
      { id: "1", resourceName: "a", resourceType: "t", resourceTypeDisplay: "T", actionType: "DELETE_RESOURCE", monthlySavingsUSD: 100, status: "APPROVED", resolvedBy: "x", resolvedAt: "", armExecutionStatus: "Succeeded" },
      { id: "2", resourceName: "b", resourceType: "t", resourceTypeDisplay: "T", actionType: "DELETE_RESOURCE", monthlySavingsUSD: 50, status: "FAILED", resolvedBy: "x", resolvedAt: "", armExecutionStatus: "Failed" },
      { id: "3", resourceName: "c", resourceType: "t", resourceTypeDisplay: "T", actionType: "POWER_OFF", monthlySavingsUSD: 30, status: "REJECTED", resolvedBy: "x", resolvedAt: "" },
    ];
    const s = buildApprovalsSummary({ pendingRequests: [], history });
    expect(s.liberatedSavingsMonthlyUSD).toBe(100);
    expect(s.approvedCount).toBe(1);
    expect(s.failedCount).toBe(1);
    expect(s.rejectedCount).toBe(1);
  });

  it("suma el ahorro bloqueado en las pendientes", () => {
    const s = payload.summary;
    const esperado = Number(s.pendingRequests.reduce((a, p) => a + p.monthlySavingsUSD, 0).toFixed(2));
    expect(s.pendingSavingsMonthlyUSD).toBe(esperado);
    expect(s.pendingApprovalsCount).toBe(s.pendingRequests.length);
  });

  it("ordena las pendientes por ahorro y el historial por fecha", () => {
    const ahorros = payload.summary.pendingRequests.map((p) => p.monthlySavingsUSD);
    expect([...ahorros].sort((a, b) => b - a)).toEqual(ahorros);
    const fechas = payload.summary.history.map((h) => h.resolvedAt);
    expect([...fechas].sort((a, b) => b.localeCompare(a))).toEqual(fechas);
  });

  it("el dataset demo incluye una ejecución fallida con snapshot", () => {
    const fallida = payload.summary.history.find((h) => h.status === "FAILED");
    expect(fallida).toBeDefined();
    expect(fallida!.armExecutionDetail).toBeTruthy();
    expect(fallida!.backupSnapshotId).toBeTruthy();
  });

  it("un tenant sin peticiones devuelve el vacío legítimo", () => {
    const s = buildApprovalsSummary({ pendingRequests: [], history: [] });
    expect(s.pendingApprovalsCount).toBe(0);
    expect(s.liberatedSavingsMonthlyUSD).toBe(0);
    expect(s.pendingSavingsMonthlyUSD).toBe(0);
  });
});
