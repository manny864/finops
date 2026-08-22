import { describe, it, expect } from "vitest";
import {
    buildOnboardingSummary,
    deriveOnboardingStatus,
    mapClientEnvironment,
    normalizeVerification,
    parseSubscriptionIds,
} from "@/services/clientOnboarding.service";

const NOW = new Date("2026-08-22T12:00:00.000Z");

describe("Onboarding — suscripciones", () => {
    it("acepta JSON array, array real y lista con comas", () => {
        expect(parseSubscriptionIds('["sub-1","sub-2"]')).toEqual(["sub-1", "sub-2"]);
        expect(parseSubscriptionIds(["sub-1", "sub-2"])).toEqual(["sub-1", "sub-2"]);
        expect(parseSubscriptionIds("sub-1, sub-2")).toEqual(["sub-1", "sub-2"]);
        expect(parseSubscriptionIds(null)).toEqual([]);
        expect(parseSubscriptionIds("")).toEqual([]);
    });

    it("extrae el id de objetos de suscripción", () => {
        expect(parseSubscriptionIds([{ subscriptionId: "sub-1" }, { id: "sub-2" }])).toEqual(["sub-1", "sub-2"]);
    });

    it("un JSON roto cae al split por comas en vez de perder todo", () => {
        expect(parseSubscriptionIds('["sub-1", "sub-2"')).toEqual(['["sub-1"', '"sub-2"']);
    });
});

describe("Onboarding — estado del entorno", () => {
    it("un secreto vencido gana sobre 'faltan permisos'", () => {
        // Con la credencial muerta no se pueden ni consultar los roles: reportar
        // permisos faltantes mandaría a revisar RBAC cuando el problema es otro.
        expect(
            deriveOnboardingStatus({
                hasCredentials: true,
                secretExpiresAt: "2026-08-01T00:00:00.000Z",
                subscriptionCount: 0,
                now: NOW,
            })
        ).toBe("EXPIRED_CREDENTIAL");
    });

    it("conectado sin suscripciones es un problema de permisos", () => {
        expect(deriveOnboardingStatus({ hasCredentials: true, subscriptionCount: 0, now: NOW })).toBe("PERMISSIONS_MISSING");
    });

    it("sin credenciales no está conectado", () => {
        expect(deriveOnboardingStatus({ hasCredentials: false, subscriptionCount: 3, now: NOW })).toBe("NOT_CONNECTED");
    });

    it("con credencial vigente y suscripciones está sano", () => {
        expect(
            deriveOnboardingStatus({
                hasCredentials: true,
                secretExpiresAt: "2027-01-01T00:00:00.000Z",
                subscriptionCount: 2,
                now: NOW,
            })
        ).toBe("CONNECTED_HEALTHY");
    });

    it("un nombre vacío cae al GUID del tenant", () => {
        const e = mapClientEnvironment({ tenant_id: "t-1", company_name: "   ", subscriptions: ["s1"] }, NOW);
        expect(e.clientOrganizationName).toBe("t-1");
    });
});

describe("Onboarding — resumen", () => {
    const env = (over: Record<string, unknown>) =>
        mapClientEnvironment({ tenant_id: "t", subscriptions: ["s1"], has_credentials: true, ...over }, NOW);

    it("cuenta suscripciones sin repetir entre tenants", () => {
        const s = buildOnboardingSummary([
            env({ tenant_id: "t1", subscriptions: ["s1", "s2"] }),
            env({ tenant_id: "t2", subscriptions: ["s2", "s3"] }),
        ]);
        expect(s.connectedTenantsCount).toBe(2);
        expect(s.monitoredSubscriptionsCount).toBe(3);
    });

    it("el porcentaje sano no incluye credenciales vencidas", () => {
        const s = buildOnboardingSummary([
            env({ tenant_id: "t1" }),
            env({ tenant_id: "t2", client_secret_expires_at: "2026-08-01T00:00:00.000Z" }),
        ]);
        expect(s.healthyPercentage).toBe(50);
    });

    it("sin entornos devuelve 0%, no NaN ni 100%", () => {
        expect(buildOnboardingSummary([]).healthyPercentage).toBe(0);
    });
});

describe("Onboarding — verificación de roles", () => {
    it("separa lo otorgado de lo faltante por suscripción", () => {
        const r = normalizeVerification(
            [
                {
                    subscriptionId: "sub-1",
                    displayName: "Producción",
                    assignedRoles: ["Reader"],
                    missingRoles: ["Cost Management Reader"],
                    status: "PARTIAL",
                },
            ],
            NOW
        );
        expect(r.grantedRoles).toHaveLength(1);
        expect(r.missingRoles).toHaveLength(1);
        expect(r.missingRoles[0].scope).toBe("/subscriptions/sub-1");
        expect(r.missingRoles[0].subscriptionName).toBe("Producción");
        expect(r.isAllValid).toBe(false);
    });

    it("una suscripción inalcanzable no se cuenta como 'sin roles'", () => {
        // No saber es distinto de saber que falta: mezclarlos haría que un
        // problema de red se lea como un problema de RBAC.
        const r = normalizeVerification([{ subscriptionId: "sub-x", status: "ERROR" }], NOW);
        expect(r.missingRoles).toHaveLength(0);
        expect(r.unreachableSubscriptions).toEqual(["sub-x"]);
        // Y tampoco permite afirmar que todo está bien.
        expect(r.isAllValid).toBe(false);
    });

    it("el custom role se reporta como faltante con la cuenta de acciones", () => {
        const r = normalizeVerification(
            [
                {
                    subscriptionId: "sub-1",
                    assignedRoles: ["Reader"],
                    missingRoles: [],
                    customRoleRequired: true,
                    hasCustomRole: false,
                    missingActions: ["Microsoft.Compute/virtualMachines/start/action", "Microsoft.Compute/virtualMachines/deallocate/action"],
                    status: "PARTIAL",
                },
            ],
            NOW
        );
        expect(r.missingRoles).toHaveLength(1);
        expect(r.missingRoles[0].roleName).toContain("2 acciones");
    });

    it("un custom role cubierto por otro nombre no se reporta faltante", () => {
        // Se verifica por acciones, no por nombre: dos tenants pueden tener el
        // mismo permiso bajo roles con nombres distintos.
        const r = normalizeVerification(
            [{ subscriptionId: "sub-1", assignedRoles: ["Reader"], missingRoles: [], customRoleRequired: true, hasCustomRole: true, status: "OK" }],
            NOW
        );
        expect(r.missingRoles).toHaveLength(0);
        expect(r.isAllValid).toBe(true);
    });

    it("todo asignado y nada inalcanzable da válido", () => {
        const r = normalizeVerification([{ subscriptionId: "sub-1", assignedRoles: ["Reader"], missingRoles: [], status: "OK" }], NOW);
        expect(r.isAllValid).toBe(true);
        expect(r.verifiedAt).toBe(NOW.toISOString());
    });
});
