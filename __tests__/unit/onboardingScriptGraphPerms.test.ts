import { describe, it, expect } from "vitest";
import { generateOnboardingScript } from "@/lib/onboardingScriptTemplate";

/**
 * El script de onboarding es lo único que otorga permisos de Graph al Service
 * Principal del tenant. Si `Application.ReadWrite.OwnedBy` se cae de la
 * generación, la rotación de secretos falla con 403 y el síntoma aparece meses
 * después, cuando alguien intenta rotar una credencial por vencer.
 */

const TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const SUBS = "ec03e8ce-ceee-4638-b303-64ae431d5b1e";

describe("Script de onboarding — permiso de rotación de secretos por tier", () => {
    it("Business y Enterprise piden Application.ReadWrite.OwnedBy", () => {
        for (const tier of ["Business", "Enterprise"]) {
            const script = generateOnboardingScript(TENANT, SUBS, tier);
            expect(script).toContain('$_.Value -eq "Application.ReadWrite.OwnedBy"');
            expect(script).toContain("$bodyAppRw");
            // El permiso tiene que quedar en la condición: si el lookup falla, el
            // script avisa en vez de asignar los otros y dejar este silenciosamente
            // sin otorgar.
            expect(script).toContain("-and $AppRwRole");
            expect(script).toContain("Application.ReadWrite.OwnedBy");
        }
    });

    it("Professional no lo pide: la rotación es una feature de tier Business", () => {
        const script = generateOnboardingScript(TENANT, SUBS, "Professional");
        expect(script).not.toContain("Application.ReadWrite.OwnedBy");
        expect(script).not.toContain("$bodyAppRw");
        // Y no arrastra la condición huérfana.
        expect(script).not.toContain("-and $AppRwRole");
    });

    it("nunca hardcodea el GUID del app role: lo busca por Value", () => {
        const script = generateOnboardingScript(TENANT, SUBS, "Enterprise");
        // El único GUID de Graph que puede aparecer es el App ID del recurso.
        expect(script).toContain("appId eq '00000003-0000-0000-c000-000000000000'");
        expect(script).toContain("$AppRwRole = $GraphSp.AppRole | Where-Object");
    });

    it("Business+ imprime la nota de ownership, que es el paso que el script no puede hacer", () => {
        const script = generateOnboardingScript(TENANT, SUBS, "Business");
        // `OwnedBy` sólo alcanza a las apps que el SP posee: sin este aviso el
        // permiso queda otorgado y la rotación sigue dando 403.
        expect(script).toContain("Add owners");
        expect(script).toContain("OWNER");
        expect(generateOnboardingScript(TENANT, SUBS, "Professional")).not.toContain("Add owners");
    });

    it("los permisos de sólo lectura siguen intactos en todos los tiers", () => {
        for (const tier of ["Professional", "Business", "Enterprise"]) {
            const script = generateOnboardingScript(TENANT, SUBS, tier);
            for (const perm of ["Directory.Read.All", "Reports.Read.All", "User.Read.All", "Organization.Read.All"]) {
                expect(script).toContain(perm);
            }
        }
        // AuditLog.Read.All sigue siendo sólo Enterprise.
        expect(generateOnboardingScript(TENANT, SUBS, "Enterprise")).toContain("AuditLog.Read.All");
        expect(generateOnboardingScript(TENANT, SUBS, "Business")).not.toContain("AuditLog.Read.All");
    });

    it("la etiqueta de permisos que se muestra en consola lista lo que realmente se asigna", () => {
        const ent = generateOnboardingScript(TENANT, SUBS, "Enterprise");
        expect(ent).toContain("Directory.Read.All, Reports.Read.All, User.Read.All, Organization.Read.All, AuditLog.Read.All, Application.ReadWrite.OwnedBy");
        const biz = generateOnboardingScript(TENANT, SUBS, "Business");
        expect(biz).toContain("Directory.Read.All, Reports.Read.All, User.Read.All, Organization.Read.All, Application.ReadWrite.OwnedBy");
    });

    it("los tres idiomas generan el bloque del permiso", () => {
        for (const locale of ["es", "en", "pt-BR"]) {
            const script = generateOnboardingScript(TENANT, SUBS, "Business", locale);
            expect(script).toContain("Application.ReadWrite.OwnedBy");
            expect(script).toContain("Add owners");
        }
    });
});
