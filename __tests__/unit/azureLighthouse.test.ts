import { describe, it, expect } from "vitest";
import {
    azureRoleNamesFor,
    buildLighthouseSummary,
    mapArgDelegation,
    mapDbDelegation,
    mergeDelegations,
    roleNamesFromAuthorizations,
    syncPercentage,
    toDelegationStatus,
    toDelegationStatusFromDb,
} from "@/services/azureLighthouse.service";
import { isValidGuid, parseGuidList } from "@/services/clientOnboarding.service";

describe("Lighthouse — estado de la delegación", () => {
    it("sólo `Succeeded` cuenta como activa", () => {
        expect(toDelegationStatus("Succeeded")).toBe("ACTIVE");
        expect(toDelegationStatus("succeeded")).toBe("ACTIVE");
    });

    it("un aprovisionamiento fallido no se reporta como activo", () => {
        // Dar por activa una delegación que falló mostraría acceso inexistente.
        expect(toDelegationStatus("Failed")).toBe("REJECTED");
        expect(toDelegationStatus("Canceled")).toBe("REJECTED");
        expect(toDelegationStatus("Creating")).toBe("PENDING");
        expect(toDelegationStatus(undefined)).toBe("PENDING");
    });

    it("el estado de la tabla propia también falla a pendiente", () => {
        expect(toDelegationStatusFromDb("active")).toBe("ACTIVE");
        expect(toDelegationStatusFromDb("rejected")).toBe("REJECTED");
        expect(toDelegationStatusFromDb("pending")).toBe("PENDING");
        expect(toDelegationStatusFromDb("cualquier-cosa")).toBe("PENDING");
    });
});

describe("Lighthouse — roles de las autorizaciones", () => {
    it("traduce los GUID de roles integrados a nombres", () => {
        const names = roleNamesFromAuthorizations([
            { roleDefinitionId: "acdd72a7-3385-48ef-bd42-f606fba81ae7" },
            { roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/72fafb9e-0641-4937-9268-a91bfd8191a3" },
        ]);
        expect(names).toEqual(["Reader", "Cost Management Reader"]);
    });

    it("un GUID desconocido se muestra abreviado, no se descarta", () => {
        // Ocultarlo daría una lista de permisos incompleta, que es peor que una
        // etiqueta poco legible.
        const names = roleNamesFromAuthorizations([{ roleDefinitionId: "deadbeef-0000-1111-2222-333333333333" }]);
        expect(names).toHaveLength(1);
        expect(names[0]).toContain("deadbeef");
    });

    it("no repite el mismo rol y tolera entradas basura", () => {
        expect(
            roleNamesFromAuthorizations([
                { roleDefinitionId: "acdd72a7-3385-48ef-bd42-f606fba81ae7" },
                { roleDefinitionId: "acdd72a7-3385-48ef-bd42-f606fba81ae7" },
            ])
        ).toEqual(["Reader"]);
        expect(roleNamesFromAuthorizations(null)).toEqual([]);
        expect(roleNamesFromAuthorizations([{}])).toEqual([]);
    });

    it("azureRoleNamesFor traduce las claves del formulario", () => {
        expect(azureRoleNamesFor(["READER", "COST_READER"])).toEqual(["Reader", "Cost Management Reader"]);
        expect(azureRoleNamesFor([])).toEqual([]);
    });
});

describe("Lighthouse — normalización y merge", () => {
    const argRow = {
        assignmentId: "/subscriptions/sub-1/providers/Microsoft.ManagedServices/registrationAssignments/a1",
        subscriptionId: "sub-1",
        provisioningState: "Succeeded",
        managedByTenantId: "tenant-msp",
        managedTenantName: "Contoso",
        authorizations: [{ roleDefinitionId: "acdd72a7-3385-48ef-bd42-f606fba81ae7" }],
    };

    it("marca el origen para distinguir Azure del registro propio", () => {
        expect(mapArgDelegation(argRow).origin).toBe("arg");
        expect(mapDbDelegation({ id: 1, managed_tenant_id: "t", managed_subscription_id: "s" }).origin).toBe("db");
    });

    it("los roles de la base se leen de JSON o de una lista con comas", () => {
        expect(mapDbDelegation({ id: 1, roles: '["Reader","Contributor"]' }).delegatedRoles).toEqual(["Reader", "Contributor"]);
        expect(mapDbDelegation({ id: 1, roles: "Reader, Tag Contributor" }).delegatedRoles).toEqual(["Reader", "Tag Contributor"]);
        expect(mapDbDelegation({ id: 1, roles: ["Reader"] }).delegatedRoles).toEqual(["Reader"]);
        expect(mapDbDelegation({ id: 1 }).delegatedRoles).toEqual([]);
    });

    it("ARG gana sobre la base para el mismo par tenant/suscripción", () => {
        // Azure dice lo que hay; la base dice lo que se pidió.
        const fromArg = [mapArgDelegation(argRow)];
        const fromDb = [
            mapDbDelegation({ id: 9, managed_tenant_id: "tenant-msp", managed_subscription_id: "sub-1", status: "pending" }),
            mapDbDelegation({ id: 10, managed_tenant_id: "otro-tenant", managed_subscription_id: "sub-2", status: "pending" }),
        ];
        const merged = mergeDelegations(fromArg, fromDb);
        expect(merged).toHaveLength(2);
        expect(merged[0].origin).toBe("arg");
        expect(merged[1].managedTenantId).toBe("otro-tenant");
    });

    it("el merge no distingue mayúsculas en los GUID", () => {
        const fromArg = [mapArgDelegation({ ...argRow, managedByTenantId: "TENANT-MSP", subscriptionId: "SUB-1" })];
        const fromDb = [mapDbDelegation({ id: 9, managed_tenant_id: "tenant-msp", managed_subscription_id: "sub-1" })];
        expect(mergeDelegations(fromArg, fromDb)).toHaveLength(1);
    });
});

describe("Lighthouse — resumen", () => {
    const d = (over: Record<string, unknown>) =>
        mapDbDelegation({ id: 1, managed_tenant_id: "t1", managed_subscription_id: "s1", roles: ["Reader"], ...over });

    it("cuenta tenants y suscripciones sin repetir", () => {
        const s = buildLighthouseSummary([
            d({ managed_tenant_id: "t1", managed_subscription_id: "s1" }),
            d({ managed_tenant_id: "t1", managed_subscription_id: "s2" }),
            d({ managed_tenant_id: "t2", managed_subscription_id: "s1" }),
        ]);
        expect(s.totalManagedTenantsCount).toBe(2);
        expect(s.totalDelegatedSubscriptionsCount).toBe(2);
        expect(s.delegatedRoleAssignmentsCount).toBe(3);
    });

    it("sin delegaciones el porcentaje es 0, no 100", () => {
        // "Todo sincronizado" con cero filas sería una afirmación vacía.
        expect(syncPercentage(buildLighthouseSummary([]))).toBe(0);
    });

    it("el porcentaje cuenta sólo las activas", () => {
        const s = buildLighthouseSummary([d({ status: "active" }), d({ status: "pending" }), d({ status: "active" }), d({ status: "rejected" })]);
        expect(s.activeDelegationsCount).toBe(2);
        expect(syncPercentage(s)).toBe(50);
    });
});

describe("Onboarding — validación de GUID", () => {
    it("acepta un GUID bien formado y rechaza lo demás", () => {
        expect(isValidGuid("81ebe027-e6af-4e09-bc73-58c9012c6408")).toBe(true);
        expect(isValidGuid("81ebe027e6af4e09bc7358c9012c6408")).toBe(false);
        expect(isValidGuid("no-es-un-guid")).toBe(false);
        expect(isValidGuid("")).toBe(false);
    });

    it("parte listas separadas por comas, espacios o saltos y separa lo inválido", () => {
        const r = parseGuidList("81ebe027-e6af-4e09-bc73-58c9012c6408, basura\nec03e8ce-ceee-4638-b303-64ae431d5b1e");
        expect(r.valid).toHaveLength(2);
        expect(r.invalid).toEqual(["basura"]);
    });
});
