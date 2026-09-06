import { describe, it, expect } from "vitest";
import {
  assembleLiveAutoBlock,
  buildAutoBlockSummary,
  buildCategoryCompliance,
  buildInitiativeCompliance,
  buildNonCompliantResources,
  calcCompliancePercentage,
  countByAssignment,
  deriveInitiativeStatus,
  deriveScopeName,
  deriveScopeType,
  getMockAutoBlockPayload,
  isRemediable,
  mapAssignment,
  normalizeEffect,
  toCategoryDisplayName,
  type RawPolicyState,
} from "@/services/azureAutoBlockPolicies.service";

describe("Auto-Block — normalización", () => {
  it("normaliza los efectos y sus alias", () => {
    expect(normalizeEffect("Deny")).toBe("Deny");
    expect(normalizeEffect("deny")).toBe("Deny");
    expect(normalizeEffect("deployIfNotExists")).toBe("DeployIfNotExists");
    expect(normalizeEffect("append")).toBe("Modify");
    expect(normalizeEffect("auditIfNotExists")).toBe("Audit");
  });

  it("un efecto desconocido cae en Audit, no en Deny", () => {
    // Mostrar Deny haría creer que la política está bloqueando algo cuando en
    // realidad no se sabe qué hace.
    expect(normalizeEffect("efectoInventado")).toBe("Audit");
    expect(normalizeEffect(undefined)).toBe("Audit");
  });

  it("deriva el tipo de scope del ARM ID", () => {
    expect(deriveScopeType("/providers/Microsoft.Management/managementGroups/root")).toBe("ManagementGroup");
    expect(deriveScopeType("/subscriptions/abc/resourceGroups/rg-1")).toBe("ResourceGroup");
    expect(deriveScopeType("/subscriptions/abc")).toBe("Subscription");
  });

  it("resuelve el nombre de la suscripción cuando lo tiene", () => {
    const names = new Map([["ec03e8ce-ceee-4638-b303-64ae431d5b1e", "CSCS-LandingZone"]]);
    expect(deriveScopeName("/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e", names)).toBe("CSCS-LandingZone");
    // Sin nombre resuelto muestra el GUID, no una cadena vacía.
    expect(deriveScopeName("/subscriptions/otro-guid", names)).toBe("otro-guid");
    expect(deriveScopeName("/providers/Microsoft.Management/managementGroups/operaciones")).toBe("operaciones");
    expect(deriveScopeName("")).toBe("—");
  });

  it("agrupa por el segundo segmento del tipo, no por proveedor", () => {
    // Agrupar por microsoft.compute mezclaría VMs, discos y snapshots.
    expect(toCategoryDisplayName("microsoft.compute/virtualmachines")).toBe("Virtual Machines");
    expect(toCategoryDisplayName("microsoft.compute/disks")).toBe("Managed Disks");
    expect(toCategoryDisplayName("microsoft.network/publicipaddresses")).toBe("Public IP Addresses");
    expect(toCategoryDisplayName("microsoft.inventado/algoRaro")).toBe("Algo Raro");
    expect(toCategoryDisplayName("")).toBe("Otros");
  });

  it("el porcentaje no divide por cero", () => {
    expect(calcCompliancePercentage(0, 0)).toBe(0);
    expect(calcCompliancePercentage(3, 4)).toBe(75);
    expect(calcCompliancePercentage(23, 30)).toBe(76.7);
  });

  it("clasifica la salud de una iniciativa por umbrales", () => {
    expect(deriveInitiativeStatus(91.2)).toBe("HEALTHY");
    expect(deriveInitiativeStatus(80)).toBe("HEALTHY");
    expect(deriveInitiativeStatus(75)).toBe("NEEDS_ATTENTION");
    expect(deriveInitiativeStatus(64.2)).toBe("CRITICAL");
  });

  it("sólo Modify y DeployIfNotExists son remediables", () => {
    expect(isRemediable("Modify")).toBe(true);
    expect(isRemediable("DeployIfNotExists")).toBe(true);
    // Deny bloquea altas nuevas pero no revierte lo desplegado; Audit no toca nada.
    expect(isRemediable("Deny")).toBe(false);
    expect(isRemediable("Audit")).toBe(false);
    expect(isRemediable("Disabled")).toBe(false);
  });
});

describe("Auto-Block — agregación de estados", () => {
  const states: RawPolicyState[] = [
    { resourceId: "/r/1", resourceType: "microsoft.compute/virtualmachines", complianceState: "Compliant", policyAssignmentId: "/a/1", policySetDefinitionId: "/i/1", policySetDefinitionName: "Init A", policyDefinitionId: "/d/1" },
    { resourceId: "/r/2", resourceType: "microsoft.compute/virtualmachines", complianceState: "NonCompliant", policyAssignmentId: "/a/1", policySetDefinitionId: "/i/1", policySetDefinitionName: "Init A", policyDefinitionId: "/d/2", policyDefinitionAction: "Modify" },
    { resourceId: "/r/3", resourceType: "microsoft.storage/storageaccounts", complianceState: "Compliant", policyAssignmentId: "/a/2", policySetDefinitionId: "/i/2", policySetDefinitionName: "Init B", policyDefinitionId: "/d/3" },
    // Exento y desconocido: no son ni conformes ni infracciones.
    { resourceId: "/r/4", resourceType: "microsoft.storage/storageaccounts", complianceState: "Exempt", policyAssignmentId: "/a/2" },
    { resourceId: "/r/5", resourceType: "microsoft.storage/storageaccounts", complianceState: "Unknown", policyAssignmentId: "/a/2" },
  ];

  it("los recursos exentos o sin evaluar no cuentan como infracciones", () => {
    // Contarlos como no conformes inventaría infracciones que Azure no reporta.
    const s = buildAutoBlockSummary({ states, assignments: [] });
    expect(s.totalCompliantCount).toBe(2);
    expect(s.totalNonCompliantCount).toBe(1);
    expect(s.overallCompliancePercentage).toBeCloseTo(66.7, 1);
  });

  it("agrupa el cumplimiento por categoría de recurso", () => {
    const cats = buildCategoryCompliance(states);
    const vms = cats.find((c) => c.categoryDisplayName === "Virtual Machines")!;
    expect(vms.totalResources).toBe(2);
    expect(vms.compliantResources).toBe(1);
    expect(vms.compliancePercentage).toBe(50);
    const st = cats.find((c) => c.categoryDisplayName === "Storage Accounts")!;
    expect(st.totalResources).toBe(1);
  });

  it("las políticas sueltas no crean una iniciativa fantasma", () => {
    const sueltas: RawPolicyState[] = [
      { resourceId: "/r/9", resourceType: "microsoft.compute/virtualmachines", complianceState: "NonCompliant", policyAssignmentId: "/a/9" },
    ];
    expect(buildInitiativeCompliance(sueltas)).toEqual([]);
    // Pero sí cuentan en el resumen global.
    expect(buildAutoBlockSummary({ states: sueltas, assignments: [] }).totalNonCompliantCount).toBe(1);
  });

  it("ordena las iniciativas de peor a mejor cumplimiento", () => {
    const inis = buildInitiativeCompliance(states);
    expect(inis).toHaveLength(2);
    expect(inis[0].compliancePercentage).toBeLessThanOrEqual(inis[1].compliancePercentage);
    expect(inis[0].totalPoliciesCount).toBeGreaterThan(0);
  });

  it("cuenta conformes y no conformes por asignación", () => {
    const counts = countByAssignment(states);
    expect(counts.get("/a/1")).toEqual({ compliant: 1, nonCompliant: 1 });
    expect(counts.get("/a/2")).toEqual({ compliant: 1, nonCompliant: 0 });
  });

  it("el detalle sólo lista NonCompliant y explica el motivo según el efecto", () => {
    const detail = buildNonCompliantResources(states);
    expect(detail).toHaveLength(1);
    expect(detail[0].policyEffect).toBe("Modify");
    expect(detail[0].reasonKey).toBe("reasonModify");
  });

  it("acota el detalle para no devolver un payload ilimitado", () => {
    const muchos: RawPolicyState[] = Array.from({ length: 50 }, (_, i) => ({
      resourceId: `/r/${i}`, resourceType: "microsoft.compute/virtualmachines", complianceState: "NonCompliant",
    }));
    expect(buildNonCompliantResources(muchos, new Map(), 10)).toHaveLength(10);
  });
});

describe("Auto-Block — asignaciones", () => {
  it("mapea la asignación con su efecto, scope y conteos", () => {
    const item = mapAssignment(
      {
        id: "/providers/Microsoft.Management/managementGroups/root/providers/Microsoft.Authorization/policyAssignments/deny-vm",
        name: "deny-vm",
        properties: {
          displayName: "Restringir tamaños de VM",
          description: "Bloquea familias fuera de la lista",
          scope: "/providers/Microsoft.Management/managementGroups/root",
          policyDefinitionId: "/providers/Microsoft.Authorization/policyDefinitions/abc",
          parameters: { effect: { value: "Deny" } },
        },
      },
      new Map([
        [
          "/providers/microsoft.management/managementgroups/root/providers/microsoft.authorization/policyassignments/deny-vm",
          { compliant: 41, nonCompliant: 7 },
        ],
      ])
    );
    expect(item.effect).toBe("Deny");
    expect(item.scopeType).toBe("ManagementGroup");
    expect(item.scopeDisplayName).toBe("root");
    expect(item.nonCompliantResourcesCount).toBe(7);
    expect(item.isEnforced).toBe(true);
  });

  it("DoNotEnforce marca la asignación como no aplicada", () => {
    const item = mapAssignment({
      id: "/subscriptions/abc/providers/Microsoft.Authorization/policyAssignments/x",
      name: "x",
      properties: { scope: "/subscriptions/abc", enforcementMode: "DoNotEnforce" },
    }, new Map());
    expect(item.isEnforced).toBe(false);
    // Ausencia de enforcementMode equivale a Default, que sí aplica.
    const def = mapAssignment({ id: "/subscriptions/abc/providers/Microsoft.Authorization/policyAssignments/y", name: "y", properties: { scope: "/subscriptions/abc" } }, new Map());
    expect(def.isEnforced).toBe(true);
  });

  it("una asignación sin conteos no inventa infracciones", () => {
    const item = mapAssignment({ id: "/subscriptions/abc/providers/Microsoft.Authorization/policyAssignments/z", name: "z" }, new Map());
    expect(item.nonCompliantResourcesCount).toBe(0);
    expect(item.compliantResourcesCount).toBe(0);
  });

  it("ordena la tabla por cantidad de infracciones", () => {
    const s = getMockAutoBlockPayload("demo-tenant-4444").summary;
    const counts = s.activeAssignments.map((a) => a.nonCompliantResourcesCount);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});

describe("Auto-Block — dataset demo y estado vacío", () => {
  const payload = getMockAutoBlockPayload("demo-tenant-4444");

  it("es determinista y escala por tier", () => {
    expect(payload.source).toBe("mock");
    expect(getMockAutoBlockPayload("demo-tenant-4444").summary.overallCompliancePercentage).toBe(
      payload.summary.overallCompliancePercentage
    );
    const pro = getMockAutoBlockPayload("demo-1111");
    expect(payload.summary.activeAssignmentsCount).toBeGreaterThan(pro.summary.activeAssignmentsCount);
  });

  it("los agregados cierran con los estados generados", () => {
    const s = payload.summary;
    const totalDeAsignaciones = s.activeAssignments.reduce(
      (a, x) => a + x.compliantResourcesCount + x.nonCompliantResourcesCount,
      0
    );
    expect(s.totalCompliantCount + s.totalNonCompliantCount).toBe(totalDeAsignaciones);
    expect(s.overallCompliancePercentage).toBeGreaterThan(0);
    expect(s.overallCompliancePercentage).toBeLessThanOrEqual(100);
  });

  it("incluye efectos remediables y no remediables para ejercitar ambos caminos", () => {
    const efectos = new Set(payload.summary.activeAssignments.map((a) => a.effect));
    expect(efectos.has("Deny")).toBe(true);
    expect([...efectos].some((e) => isRemediable(e))).toBe(true);
  });

  it("expone plantillas con IDs de definiciones built-in reales", () => {
    expect(payload.definitionTemplates.length).toBeGreaterThan(3);
    for (const t of payload.definitionTemplates) {
      expect(t.definitionId).toMatch(/^\/providers\/Microsoft\.Authorization\/policyDefinitions\/[0-9a-f-]{36}$/);
    }
  });

  it("un tenant sin políticas muestra 0 evaluaciones, no un porcentaje estimado", () => {
    // La implementación anterior devolvía ~75% aunque no hubiera una sola
    // política asignada, porque estimaba con Math.floor(total * 0.25).
    const p = assembleLiveAutoBlock({ states: [], assignments: [], availableScopes: [] });
    expect(p.source).toBe("live");
    expect(p.summary.overallCompliancePercentage).toBe(0);
    expect(p.summary.totalCompliantCount).toBe(0);
    expect(p.summary.totalNonCompliantCount).toBe(0);
    expect(p.summary.categoryCompliance).toEqual([]);
    expect(p.summary.initiatives).toEqual([]);
    expect(p.nonCompliantResources).toEqual([]);
  });
});
