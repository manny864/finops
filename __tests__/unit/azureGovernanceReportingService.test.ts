import { describe, it, expect } from "vitest";
import {
  assembleLiveGovernanceReport,
  buildCsvRows,
  buildPillarInputs,
  buildRbacBreakdown,
  buildRegionBreakdown,
  buildResourceTypeBreakdown,
  buildScoreSubtitle,
  calcFinancialSecurityScore,
  calcPercentage,
  emptyGovernanceReport,
  getMockGovernanceReportPayload,
  isOrphanedPrincipal,
  isPrivilegedRole,
  normalizePrincipalType,
  toCsv,
  toResourceTypeLabel,
} from "@/services/azureGovernanceReporting.service";
import { PILLAR_WEIGHTS, type OrphanedAssignmentDetail } from "@/types/azureGovernanceReporting.types";

describe("Governance Reporting — normalización", () => {
  it("etiqueta los tipos conocidos y conserva el camelCase de los desconocidos", () => {
    expect(toResourceTypeLabel("microsoft.compute/virtualmachines")).toBe("Virtual Machines");
    expect(toResourceTypeLabel("microsoft.sql/servers/databases")).toBe("SQL Databases");
    expect(toResourceTypeLabel("microsoft.inventado/miRecursoRaro")).toBe("Mi Recurso Raro");
    expect(toResourceTypeLabel("")).toBe("Otros recursos");
  });

  it("un principalType vacío o Unknown es un SID huérfano, no un usuario", () => {
    // Mapearlo a User por conveniencia escondería justo lo que hay que detectar.
    expect(normalizePrincipalType("User")).toBe("User");
    expect(normalizePrincipalType("servicePrincipal")).toBe("ServicePrincipal");
    expect(normalizePrincipalType("Group")).toBe("Group");
    expect(normalizePrincipalType("")).toBe("Unknown");
    expect(normalizePrincipalType("Unknown")).toBe("Unknown");
    expect(isOrphanedPrincipal(null)).toBe(true);
    expect(isOrphanedPrincipal("User")).toBe(false);
  });

  it("identifica los roles privilegiados sin depender de mayúsculas", () => {
    expect(isPrivilegedRole("Owner")).toBe(true);
    expect(isPrivilegedRole("owner")).toBe(true);
    expect(isPrivilegedRole("User Access Administrator")).toBe(true);
    expect(isPrivilegedRole("Reader")).toBe(false);
    // "Cost Management Reader" no es privilegiado; "Billing Reader" sí.
    expect(isPrivilegedRole("Cost Management Reader")).toBe(false);
    expect(isPrivilegedRole("Billing Reader")).toBe(true);
  });

  it("el porcentaje no divide por cero", () => {
    expect(calcPercentage(0, 0)).toBe(0);
    expect(calcPercentage(1720, 2000)).toBe(86);
  });
});

describe("Governance Reporting — distribuciones", () => {
  const rows = [
    { type: "microsoft.compute/virtualmachines", count: 400 },
    { type: "microsoft.storage/storageaccounts", count: 300 },
    { type: "microsoft.network/networkinterfaces", count: 300 },
    { type: "microsoft.network/publicipaddresses", count: 200 },
    { type: "microsoft.sql/servers/databases", count: 150 },
    { type: "microsoft.keyvault/vaults", count: 400 },
    { type: "microsoft.web/sites", count: 250 },
  ];

  it("agrupa el resto en 'Otros' para que las barras cuadren con el total", () => {
    // Descartar la cola haría que la suma no llegue al total del encabezado y
    // el tablero se leería como si faltaran recursos.
    const total = rows.reduce((a, r) => a + r.count, 0);
    const dist = buildResourceTypeBreakdown(rows, total, 5);
    expect(dist).toHaveLength(6);
    expect(dist[dist.length - 1].typeDisplayName).toBe("Otros recursos");
    const suma = dist.reduce((a, d) => a + d.count, 0);
    expect(suma).toBe(total);
    const pct = dist.reduce((a, d) => a + d.percentage, 0);
    expect(pct).toBeGreaterThan(99);
    expect(pct).toBeLessThan(101);
  });

  it("ordena de mayor a menor y descarta los conteos en cero", () => {
    const dist = buildResourceTypeBreakdown([...rows, { type: "x/y", count: 0 }], 2000, 5);
    const counts = dist.slice(0, 5).map((d) => d.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(dist.some((d) => d.typeDisplayName === "Y")).toBe(false);
  });

  it("las regiones también agrupan la cola", () => {
    const regions = [
      { location: "eastus", count: 1100 },
      { location: "westeurope", count: 600 },
      { location: "brazilsouth", count: 300 },
    ];
    const dist = buildRegionBreakdown(regions, 2000, 2);
    expect(dist[dist.length - 1].regionDisplayName).toBe("Otras regiones");
    expect(dist.reduce((a, d) => a + d.count, 0)).toBe(2000);
  });

  it("los SIDs huérfanos no se cuentan en ningún bucket de tipo", () => {
    // Tienen principalType Unknown por definición: se reportan aparte.
    const asgs: OrphanedAssignmentDetail[] = [
      { assignmentId: "1", principalId: "a", principalType: "User", roleName: "Owner", scopeDisplayName: "S", isPrivileged: true, isOrphaned: false },
      { assignmentId: "2", principalId: "b", principalType: "Unknown", roleName: "Reader", scopeDisplayName: "S", isPrivileged: false, isOrphaned: true },
      { assignmentId: "3", principalId: "c", principalType: "Group", roleName: "Reader", scopeDisplayName: "S", isPrivileged: false, isOrphaned: false },
    ];
    const b = buildRbacBreakdown(asgs);
    expect(b.find((x) => x.principalType === "User")!.count).toBe(1);
    expect(b.find((x) => x.principalType === "User")!.privilegedRolesCount).toBe(1);
    expect(b.find((x) => x.principalType === "Group")!.count).toBe(1);
    expect(b.reduce((a, x) => a + x.count, 0)).toBe(2);
  });
});

describe("Governance Reporting — Score de Seguridad Financiera", () => {
  it("pondera los cuatro pilares con sus pesos nominales", () => {
    const { score, pillars } = calcFinancialSecurityScore({
      PolicyCompliance: { rawScore: 100, detail: "" },
      TagHygiene: { rawScore: 100, detail: "" },
      RbacHygiene: { rawScore: 100, detail: "" },
      ZombieControl: { rawScore: 100, detail: "" },
    });
    expect(score).toBe(100);
    for (const p of pillars) {
      expect(p.effectiveWeight).toBe(p.weight);
      expect(p.measurable).toBe(true);
    }
  });

  it("redistribuye el peso de los pilares no medibles en vez de puntuarlos 0 o 100", () => {
    // Un pilar sin datos en 0 castigaría al tenant por una falta de permisos;
    // en 100 haría subir el score justamente por no tener información.
    const { score, pillars } = calcFinancialSecurityScore({
      PolicyCompliance: { rawScore: null, detail: "sin permisos" },
      TagHygiene: { rawScore: 80, detail: "" },
      RbacHygiene: { rawScore: 80, detail: "" },
      ZombieControl: { rawScore: 80, detail: "" },
    });
    // Los tres medibles suman 60 de peso nominal y se reescalan a 100.
    expect(score).toBeCloseTo(80, 0);
    const policy = pillars.find((p) => p.pillar === "PolicyCompliance")!;
    expect(policy.measurable).toBe(false);
    expect(policy.rawScore).toBeNull();
    expect(policy.contribution).toBe(0);
    expect(policy.effectiveWeight).toBe(0);
    const tags = pillars.find((p) => p.pillar === "TagHygiene")!;
    expect(tags.effectiveWeight).toBeGreaterThan(PILLAR_WEIGHTS.TagHygiene);
  });

  it("sin ningún pilar medible el score es 0, no 100", () => {
    const { score } = calcFinancialSecurityScore({
      PolicyCompliance: { rawScore: null, detail: "" },
      TagHygiene: { rawScore: null, detail: "" },
      RbacHygiene: { rawScore: null, detail: "" },
      ZombieControl: { rawScore: null, detail: "" },
    });
    expect(score).toBe(0);
  });

  it("acota los pilares fuera de rango", () => {
    const { score } = calcFinancialSecurityScore({
      PolicyCompliance: { rawScore: 250, detail: "" },
      TagHygiene: { rawScore: -30, detail: "" },
      RbacHygiene: { rawScore: 100, detail: "" },
      ZombieControl: { rawScore: 100, detail: "" },
    });
    // 40 + 0 + 20 + 10 sobre 100 de peso.
    expect(score).toBe(70);
  });

  it("marca como no medible cada pilar sin datos de origen", () => {
    const inputs = buildPillarInputs({
      compliantResources: 0,
      nonCompliantResources: 0,
      policyDataAvailable: false,
      taggedResources: 0,
      totalResources: 0,
      totalRbacAssignments: 0,
      orphanedSids: 0,
      zombieResources: 0,
    });
    expect(inputs.PolicyCompliance.rawScore).toBeNull();
    expect(inputs.TagHygiene.rawScore).toBeNull();
    expect(inputs.RbacHygiene.rawScore).toBeNull();
    expect(inputs.ZombieControl.rawScore).toBeNull();
    expect(inputs.PolicyCompliance.detail).toContain("Policy Insights");
  });

  it("calcula los pilares medibles a partir de los conteos", () => {
    const inputs = buildPillarInputs({
      compliantResources: 1850,
      nonCompliantResources: 150,
      policyDataAvailable: true,
      taggedResources: 1620,
      totalResources: 2000,
      totalRbacAssignments: 600,
      orphanedSids: 24,
      zombieResources: 80,
    });
    expect(inputs.PolicyCompliance.rawScore).toBe(92.5);
    expect(inputs.TagHygiene.rawScore).toBe(81);
    expect(inputs.RbacHygiene.rawScore).toBe(96);
    expect(inputs.ZombieControl.rawScore).toBe(96);
  });

  it("más zombis que recursos no produce un pilar negativo", () => {
    const inputs = buildPillarInputs({
      compliantResources: 10, nonCompliantResources: 0, policyDataAvailable: true,
      taggedResources: 10, totalResources: 10, totalRbacAssignments: 1, orphanedSids: 0,
      zombieResources: 999,
    });
    expect(inputs.ZombieControl.rawScore).toBe(0);
  });
});

describe("Governance Reporting — subtítulo y exportables", () => {
  it("concuerda el singular y el plural con los conteos reales", () => {
    expect(
      buildScoreSubtitle({ auditedResourcesCount: 2000, activePolicyAssignmentsCount: 54, subscriptionsCount: 4 })
    ).toBe("Basado en 2.000 recursos auditados y 54 asignaciones de política activas en 4 suscripciones.");
    expect(
      buildScoreSubtitle({ auditedResourcesCount: 1, activePolicyAssignmentsCount: 1, subscriptionsCount: 1 })
    ).toBe("Basado en 1 recurso auditado y 1 asignación de política activa en 1 suscripción.");
  });

  it("el CSV escapa comillas y separadores sin romper columnas", () => {
    const csv = toCsv([
      ["a", 'dice "hola"'],
      ["b", "coma, adentro"],
    ]);
    expect(csv).toContain('"dice ""hola"""');
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv.split("\n")[1]).toBe('"b","coma, adentro"');
  });

  it("el dataset CSV cubre todas las secciones del reporte", () => {
    const rows = buildCsvRows(getMockGovernanceReportPayload("demo-tenant-4444"));
    const secciones = new Set(rows.slice(1).map((r) => r[0]));
    expect(secciones.has("Score")).toBe(true);
    expect(secciones.has("Azure Policy")).toBe(true);
    expect(secciones.has("Inventario por tipo")).toBe(true);
    expect(secciones.has("Inventario por región")).toBe(true);
    expect(secciones.has("RBAC")).toBe(true);
    expect(secciones.has("Recurso no conforme")).toBe(true);
  });
});

describe("Governance Reporting — dataset demo y estado vacío", () => {
  const payload = getMockGovernanceReportPayload("demo-tenant-4444");

  it("es determinista y escala por tier", () => {
    expect(payload.source).toBe("mock");
    expect(getMockGovernanceReportPayload("demo-tenant-4444").summary.auditedResourcesCount).toBe(
      payload.summary.auditedResourcesCount
    );
    const pro = getMockGovernanceReportPayload("demo-1111");
    expect(payload.summary.auditedResourcesCount).toBeGreaterThan(pro.summary.auditedResourcesCount);
    expect(payload.summary.subscriptionsCount).toBeGreaterThan(pro.summary.subscriptionsCount);
  });

  it("el score está en rango y los cuatro pilares son medibles en la demo", () => {
    expect(payload.summary.financialSecurityScorePercentage).toBeGreaterThan(0);
    expect(payload.summary.financialSecurityScorePercentage).toBeLessThanOrEqual(100);
    expect(payload.summary.pillars).toHaveLength(4);
    expect(payload.summary.pillars.every((p) => p.measurable)).toBe(true);
  });

  it("genera SIDs huérfanos y roles privilegiados para ejercitar la auditoría", () => {
    expect(payload.summary.orphanedSidsCount).toBeGreaterThan(0);
    expect(payload.summary.privilegedRolesCount).toBeGreaterThan(0);
    expect(payload.orphanedAssignments.length).toBeGreaterThan(0);
    expect(payload.orphanedAssignments.every((a) => a.isOrphaned || a.isPrivileged)).toBe(true);
  });

  it("un tenant sin datos devuelve el vacío legítimo, nunca la demo", () => {
    const p = emptyGovernanceReport();
    expect(p.source).toBe("live");
    expect(p.summary.financialSecurityScorePercentage).toBe(0);
    expect(p.summary.auditedResourcesCount).toBe(0);
    expect(p.summary.resourceTypeBreakdown).toEqual([]);
    expect(p.nonCompliantResources).toEqual([]);
    expect(p.summary.pillars.every((x) => !x.measurable)).toBe(true);
  });

  it("el ensamblado en vivo no pierde el conteo de suscripciones", () => {
    const p = assembleLiveGovernanceReport({
      score: {
        compliantResources: 90, nonCompliantResources: 10, policyDataAvailable: true,
        taggedResources: 80, totalResources: 100, totalRbacAssignments: 10, orphanedSids: 1, zombieResources: 5,
      },
      subscriptionsCount: 3,
      activePolicyAssignmentsCount: 12,
      nonCompliantPoliciesCount: 4,
      resourceTypeRows: [{ type: "microsoft.compute/virtualmachines", count: 100 }],
      regionRows: [{ location: "eastus", count: 100 }],
      rbacAssignments: [],
      nonCompliantResources: [],
    });
    expect(p.summary.subscriptionsCount).toBe(3);
    expect(p.summary.activePolicyAssignmentsCount).toBe(12);
    expect(p.summary.financialSecurityScorePercentage).toBeGreaterThan(0);
  });
});
