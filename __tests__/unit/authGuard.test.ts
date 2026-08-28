// @vitest-environment node
import { describe, it, expect } from "vitest";
import { CORPORATE_DOMAINS, isCorporateEmail } from "@/lib/authGuard";
import { isSuperAdminBootstrapEmail, SUPERADMIN_BOOTSTRAP_TENANT_ID } from "@/lib/superAdminBootstrap";

describe("authGuard — dominio corporativo", () => {
    it("acepta sólo @cscloudsolutions.com.ar", () => {
        expect(CORPORATE_DOMAINS).toEqual(["@cscloudsolutions.com.ar"]);
    });

    it("reconoce el dominio corporativo real", () => {
        expect(isCorporateEmail("mchavez@cscloudsolutions.com.ar")).toBe(true);
        expect(isCorporateEmail("MCHAVEZ@CSCloudSolutions.com.ar")).toBe(true);
        expect(isCorporateEmail("  osanchez@cscloudsolutions.com.ar  ")).toBe(true);
    });

    // El bug reportado: el tenant de Azure de la propia empresa estaba en la
    // lista, así que cualquier cuenta de ese directorio quedaba tratada como
    // personal interno con acceso a los módulos de SuperAdmin.
    it("rechaza el tenant .onmicrosoft.com de la empresa", () => {
        expect(isCorporateEmail("mchavez@cscloudsolutionsoutlook.onmicrosoft.com")).toBe(false);
    });

    it("rechaza dominios ajenos y vacíos", () => {
        expect(isCorporateEmail("alguien@gmail.com")).toBe(false);
        expect(isCorporateEmail("mchavez@casacolombres.onmicrosoft.com")).toBe(false);
        expect(isCorporateEmail("")).toBe(false);
        expect(isCorporateEmail(null)).toBe(false);
        expect(isCorporateEmail(undefined)).toBe(false);
    });

    // Un sufijo no basta: el dominio tiene que cerrar la dirección. Sin el "@"
    // en la lista, "algo@notcscloudsolutions.com.ar" pasaría.
    it("no se deja engañar por un dominio que termina igual", () => {
        expect(isCorporateEmail("algo@notcscloudsolutions.com.ar")).toBe(false);
        expect(isCorporateEmail("algo@cscloudsolutions.com.ar.evil.com")).toBe(false);
    });
});

describe("superAdminBootstrap — única escalación sin fila en Users", () => {
    it("sólo el email de bootstrap en el tenant master", () => {
        expect(isSuperAdminBootstrapEmail("mchavez@cscloudsolutions.com.ar", SUPERADMIN_BOOTSTRAP_TENANT_ID)).toBe(
            true
        );
    });

    it("no escala a otras cuentas del dominio corporativo", () => {
        // Éstas son Reader/Colaborador reales: antes se auto-escalaban a
        // SUPERADMIN con sólo abrir la app.
        for (const email of [
            "ciso@cscloudsolutions.com.ar",
            "finops@cscloudsolutions.com.ar",
            "pmo@cscloudsolutions.com.ar",
            "cloudadmin@cscloudsolutions.com.ar",
        ]) {
            expect(isSuperAdminBootstrapEmail(email, SUPERADMIN_BOOTSTRAP_TENANT_ID)).toBe(false);
        }
    });

    it("no escala fuera del tenant master ni con dominio no corporativo", () => {
        expect(isSuperAdminBootstrapEmail("mchavez@cscloudsolutions.com.ar", "otro-tenant")).toBe(false);
        expect(
            isSuperAdminBootstrapEmail("mchavez@cscloudsolutionsoutlook.onmicrosoft.com", SUPERADMIN_BOOTSTRAP_TENANT_ID)
        ).toBe(false);
    });
});

/**
 * Réplica de la cadena de decisión completa que decide si el módulo
 * "Gestión de Tenants" aparece en el menú:
 *
 *   requireSuperAdmin      = isCorporateEmail(email) && Users.system_role === 'SUPERADMIN'
 *   /api/tenants isSA      = requireSuperAdmin || isSuperAdminBootstrapEmail(email, tenant)
 *   TenantProvider         = systemRole 'SUPERADMIN' sólo si la API lo dice
 *   Sidebar                = muestra los módulos si systemRole === 'SUPERADMIN'
 *
 * `system_role` se mockea con los valores reales de la base porque el resto de
 * la cadena es lógica pura; lo que se fija acá es que ningún eslabón vuelva a
 * derivar privilegios del dominio del email por sí solo.
 */
describe("Gestión de Tenants — quién ve el módulo", () => {
    const SYSTEM_ROLE: Record<string, string> = {
        "mchavez@cscloudsolutions.com.ar": "SUPERADMIN",
        "osanchez@cscloudsolutions.com.ar": "SUPERADMIN",
        "nvaldez@cscloudsolutions.com.ar": "SUPERADMIN",
        "mchavez@cscloudsolutionsoutlook.onmicrosoft.com": "USER",
        "ciso@cscloudsolutions.com.ar": "USER",
        "finops@cscloudsolutions.com.ar": "USER",
        "pmo@cscloudsolutions.com.ar": "USER",
        "cloudadmin@cscloudsolutions.com.ar": "USER",
    };

    const seesTenantManagement = (email: string, tenantId = SUPERADMIN_BOOTSTRAP_TENANT_ID): boolean => {
        const strict = isCorporateEmail(email) && SYSTEM_ROLE[email] === "SUPERADMIN";
        return strict || isSuperAdminBootstrapEmail(email, tenantId);
    };

    it("lo ven los SUPERADMIN del dominio corporativo", () => {
        expect(seesTenantManagement("mchavez@cscloudsolutions.com.ar")).toBe(true);
        expect(seesTenantManagement("osanchez@cscloudsolutions.com.ar")).toBe(true);
        expect(seesTenantManagement("nvaldez@cscloudsolutions.com.ar")).toBe(true);
    });

    // El caso reportado.
    it("NO lo ve la cuenta .onmicrosoft.com", () => {
        expect(seesTenantManagement("mchavez@cscloudsolutionsoutlook.onmicrosoft.com")).toBe(false);
    });

    // Éstas son Reader/Colaborador del dominio corporativo: el gate viejo era
    // sólo por dominio, así que también veían los módulos de SuperAdmin.
    it("NO lo ven las cuentas corporativas sin el rol", () => {
        for (const prefix of ["ciso@", "finops@", "pmo@", "cloudadmin@"]) {
            expect(seesTenantManagement(`${prefix}cscloudsolutions.com.ar`)).toBe(false);
        }
    });

    it("el rol real vale desde cualquier tenant; el dominio solo, desde ninguno", () => {
        expect(seesTenantManagement("mchavez@cscloudsolutions.com.ar", "otro-tenant")).toBe(true);
        expect(seesTenantManagement("ciso@cscloudsolutions.com.ar", "otro-tenant")).toBe(false);
    });
});
