import { describe, it, expect } from "vitest";
import { generateOnboardingScript } from "@/lib/onboardingScriptTemplate";

/** El generador valida formato UUID de tenant y suscripción. */
const TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const SUB = "ec03e8ce-ceee-4638-b303-64ae431d5b1e";
import {
    buildConnectionId,
    connectorStatusFromDb,
    connectorStatusToDb,
    REQUIRED_GRAPH_PERMISSION,
} from "@/types/copilotM365Integration.types";

describe("permiso de Graph para el conector de Copilot M365", () => {
    const enterprise = generateOnboardingScript(TENANT, SUB, "Enterprise", "es");

    it("Enterprise recibe ExternalConnection.ReadWrite.OwnedBy", () => {
        // Sin este permiso, /external/connections responde 403 y el conector no
        // se puede crear.
        expect(enterprise).toContain(REQUIRED_GRAPH_PERMISSION);
    });

    it("busca el app role por Value y nunca por un GUID hardcodeado", () => {
        // Mismo criterio que AuditLog.Read.All y Application.ReadWrite.OwnedBy:
        // el id del rol varía y hardcodearlo rompe en tenants distintos.
        expect(enterprise).toMatch(/\$ExtConnRole = \$GraphSp\.AppRole \| Where-Object \{ \$_\.Value -eq "ExternalConnection\.ReadWrite\.OwnedBy"/);
        expect(enterprise).not.toMatch(/appRoleId\s*=\s*"[0-9a-f]{8}-[0-9a-f]{4}-/);
    });

    it("asigna el rol al service principal", () => {
        expect(enterprise).toContain("bodyExtConn");
    });

    it("pide OwnedBy y no el .All, que alcanzaría conexiones de terceros", () => {
        expect(enterprise).not.toContain("ExternalConnection.ReadWrite.All");
    });

    it("los tiers sin la feature no reciben el permiso", () => {
        // La página está registrada como Enterprise en routeTiers; otorgarlo a
        // tiers inferiores sería sobre-aprovisionar (Directiva 1).
        for (const tier of ["Professional", "Business"]) {
            const script = generateOnboardingScript(TENANT, SUB, tier, "es");
            expect(script).not.toContain(REQUIRED_GRAPH_PERMISSION);
            expect(script).not.toContain("bodyExtConn");
        }
    });

    it("no rompe los permisos que ya se otorgaban", () => {
        for (const perm of ["Directory.Read.All", "Reports.Read.All", "User.Read.All", "Organization.Read.All", "AuditLog.Read.All"]) {
            expect(enterprise).toContain(perm);
        }
    });
});

describe("mapeo de estado del conector", () => {
    it("traduce el ENUM en minúscula de la tabla al contrato en mayúscula", () => {
        expect(connectorStatusFromDb("ready")).toBe("READY");
        expect(connectorStatusFromDb("provisioning")).toBe("SYNCING");
        expect(connectorStatusFromDb("error")).toBe("ERROR");
    });

    it("un valor ausente o desconocido es NOT_CONFIGURED, no READY", () => {
        // Fallar hacia "listo" mostraría un conector operativo inexistente.
        expect(connectorStatusFromDb(null)).toBe("NOT_CONFIGURED");
        expect(connectorStatusFromDb("")).toBe("NOT_CONFIGURED");
        expect(connectorStatusFromDb("cualquier_cosa")).toBe("NOT_CONFIGURED");
    });

    it("REVOKED se persiste como not_configured, que es su situación real", () => {
        // La columna no tiene 'revoked' y no se reescribe un ENUM en producción.
        expect(connectorStatusToDb("REVOKED")).toBe("not_configured");
        expect(connectorStatusToDb("READY")).toBe("ready");
    });
});

describe("id de conexión para Graph", () => {
    it("es alfanumérico y respeta el límite de 32 caracteres", () => {
        const id = buildConnectionId("81ebe027-e6af-4e09-bc73-58c9012c6408");
        expect(id).toMatch(/^[a-zA-Z0-9]+$/);
        expect(id.length).toBeGreaterThanOrEqual(3);
        expect(id.length).toBeLessThanOrEqual(32);
    });

    it("es determinista: el mismo tenant da el mismo id", () => {
        // El anterior lo generaba con Math.random(), así que cada provision
        // creaba una conexión nueva y huérfana en Graph.
        expect(buildConnectionId("t-abc")).toBe(buildConnectionId("t-abc"));
    });

    it("tenants distintos no colisionan", () => {
        expect(buildConnectionId("aaaa-1111")).not.toBe(buildConnectionId("bbbb-2222"));
    });
});
