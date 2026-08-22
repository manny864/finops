import { describe, it, expect } from "vitest";
import {
    buildEntraUserSearchUrl,
    buildTenantUsersSummary,
    mapTenantUser,
    mfaMapFromRegistrationDetails,
    modulesToRoleTags,
    parseModules,
    parseScope,
    roleTagsToModules,
    roleToDb,
    scopeLabel,
    shortOid,
    toAccountStatus,
    toRole,
} from "@/services/tenantUsers.service";
import { ALL_MODULES } from "@/types/tenantUsers.types";

describe("Usuarios — roles", () => {
    it("acepta las dos ortografías de Contributor que hay en la base", () => {
        expect(toRole("Colaborador")).toBe("CONTRIBUTOR");
        expect(toRole("Contributor")).toBe("CONTRIBUTOR");
        expect(toRole("Owner")).toBe("OWNER");
        expect(toRole("reader")).toBe("READER");
    });

    it("falla cerrado a READER: un rol ilegible nunca da privilegios", () => {
        expect(toRole("SuperUsuarioTotal")).toBe("READER");
        expect(toRole(null)).toBe("READER");
        expect(toRole("")).toBe("READER");
    });

    it("escribe 'Colaborador', que es lo que ofrece el select de la UI", () => {
        // Escribir "Contributor" crearía filas que el dropdown no puede mostrar.
        expect(roleToDb("CONTRIBUTOR")).toBe("Colaborador");
        expect(roleToDb("OWNER")).toBe("Owner");
        expect(roleToDb("READER")).toBe("Reader");
    });

    it("el estado de cuenta cae en ACTIVE ante un valor desconocido", () => {
        expect(toAccountStatus("INVITED")).toBe("INVITED");
        expect(toAccountStatus("disabled")).toBe("DISABLED");
        expect(toAccountStatus("zzz")).toBe("ACTIVE");
        expect(toAccountStatus(undefined)).toBe("ACTIVE");
    });
});

describe("Usuarios — puente módulos ↔ RoleTag (lo que realmente gatea)", () => {
    it("cada módulo se traduce a los tags que filtran el Sidebar", () => {
        expect(modulesToRoleTags(["VISIBILITY"])).toEqual(["FinOps"]);
        expect(modulesToRoleTags(["CLOUD_CLEANUP"])).toEqual(["CloudAdmin"]);
        expect(modulesToRoleTags(["SECURITY"])).toEqual(["Security"]);
        expect(modulesToRoleTags(["GOVERNANCE"]).sort()).toEqual(["CloudAdmin", "Security"]);
    });

    it("ADMINISTRATION no otorga ningún tag: 'Platform' no es asignable", () => {
        // Si marcarlo diera 'Platform', un Reader se autoconcedería la
        // administración del SaaS desde el drawer.
        expect(modulesToRoleTags(["ADMINISTRATION"])).toEqual([]);
    });

    it("no duplica tags cuando dos módulos comparten uno", () => {
        expect(modulesToRoleTags(["VISIBILITY", "FINOPS_ANALYTICS"]).sort()).toEqual(["FinOps", "ProductOwner"]);
    });

    it("reconstruye módulos desde los permisos ya guardados", () => {
        expect(roleTagsToModules(["FinOps"])).toEqual(["VISIBILITY", "FINOPS_ANALYTICS"]);
        expect(roleTagsToModules(["Security"])).toEqual(["GOVERNANCE", "SECURITY"]);
        expect(roleTagsToModules([])).toEqual([]);
    });

    it("descarta claves de módulo desconocidas en vez de propagarlas", () => {
        expect(parseModules(["VISIBILITY", "TODO_EL_SAAS", 42])).toEqual(["VISIBILITY"]);
        expect(parseModules('["SECURITY"]')).toEqual(["SECURITY"]);
        expect(parseModules("no-es-json")).toEqual([]);
        expect(parseModules(null)).toEqual([]);
    });

    it("parseScope tolera JSON string, array y basura", () => {
        expect(parseScope('["sub-1","sub-2"]')).toEqual(["sub-1", "sub-2"]);
        expect(parseScope(["sub-1", "", null])).toEqual(["sub-1"]);
        expect(parseScope("{roto")).toEqual([]);
    });
});

describe("Usuarios — normalización de filas", () => {
    const row = {
        id: 7,
        tenant_id: "tenant-a",
        entra_oid: "11111111-2222-3333-4444-555555555555",
        email: "ana@contoso.com",
        display_name: "Ana Torres",
        role: "Colaborador",
        system_role: "USER",
        permissions: '["FinOps"]',
        account_status: "ACTIVE",
    };

    it("la selección explícita de módulos manda sobre la derivada", () => {
        const u = mapTenantUser({ ...row, allowed_modules: '["SECURITY"]' });
        expect(u.allowedModules).toEqual(["SECURITY"]);
    });

    it("sin allowed_modules deriva los módulos de los permisos vigentes", () => {
        // Un usuario anterior a la migración: mostrar todo apagado mentiría sobre
        // lo que ve de verdad.
        const u = mapTenantUser(row);
        expect(u.allowedModules).toEqual(["VISIBILITY", "FINOPS_ANALYTICS"]);
    });

    it("lee entra_mfa_registered, no el mfa_enabled del 2FA propio de la plataforma", () => {
        expect(mapTenantUser({ ...row, entra_mfa_registered: 1 })).toMatchObject({ mfaEnabled: true, mfaKnown: true });
        expect(mapTenantUser({ ...row, entra_mfa_registered: 0 })).toMatchObject({ mfaEnabled: false, mfaKnown: true });
        expect(mapTenantUser({ ...row, entra_mfa_registered: null })).toMatchObject({ mfaEnabled: false, mfaKnown: false });
        expect(mapTenantUser(row).mfaKnown).toBe(false);
        // `mfa_enabled` es el TOTP de la plataforma (src/lib/mfa.ts) y tiene
        // default 0 para todas las filas: si el mapeo lo leyera, cada usuario
        // aparecería como "Pendiente" en vez de "Sin dato".
        expect(mapTenantUser({ ...row, mfa_enabled: 1 } as never).mfaKnown).toBe(false);
    });

    it("marca al SuperAdmin desde system_role", () => {
        expect(mapTenantUser({ ...row, system_role: "SUPERADMIN" }).isSuperAdmin).toBe(true);
        expect(mapTenantUser(row).isSuperAdmin).toBe(false);
    });

    it("un display_name vacío cae al email", () => {
        expect(mapTenantUser({ ...row, display_name: "  " }).displayName).toBe("ana@contoso.com");
    });
});

describe("Usuarios — resumen", () => {
    const u = (over: Record<string, unknown>) =>
        mapTenantUser({ id: 1, tenant_id: "t", email: "a@b.c", role: "Reader", ...over });

    it("cuenta por rol", () => {
        const s = buildTenantUsersSummary([
            u({ role: "Owner" }),
            u({ role: "Admin" }),
            u({ role: "Admin" }),
            u({ role: "Reader" }),
            u({ role: "Colaborador" }),
        ]);
        expect(s.ownersCount).toBe(1);
        expect(s.adminsCount).toBe(2);
        expect(s.readersCount).toBe(1);
        expect(s.totalUsersCount).toBe(5);
    });

    it("el % de 2FA se calcula sólo sobre los usuarios con dato conocido", () => {
        // 1 de 2 conocidos = 50%. El tercero, sin dato, no arrastra el número a 33%.
        const s = buildTenantUsersSummary([u({ entra_mfa_registered: 1 }), u({ entra_mfa_registered: 0 }), u({ entra_mfa_registered: null })]);
        expect(s.mfaAdoptionPercentage).toBe(50);
        expect(s.mfaUnknownCount).toBe(1);
    });

    it("sin ningún dato de 2FA devuelve 0% y lo declara desconocido, no incumplimiento", () => {
        const s = buildTenantUsersSummary([u({}), u({})]);
        expect(s.mfaAdoptionPercentage).toBe(0);
        expect(s.mfaUnknownCount).toBe(2);
    });
});

describe("Usuarios — presentación y Graph", () => {
    it("scopeLabel distingue acceso total, parcial y sin módulos", () => {
        expect(scopeLabel(ALL_MODULES).key).toBe("full");
        expect(scopeLabel([]).key).toBe("none");
        expect(scopeLabel(["VISIBILITY", "SECURITY"])).toEqual({ key: "partial", count: 2 });
    });

    it("shortOid abrevia el GUID y deja los cortos intactos", () => {
        expect(shortOid("11111111-2222-3333-4444-555555555555")).toBe("11111111…5555");
        expect(shortOid("corto")).toBe("corto");
    });

    it("la URL de $search escapa las comillas que romperían el filtro", () => {
        const url = buildEntraUserSearchUrl('ana" OR "admin');
        expect(url).not.toContain("%22ana%22");
        expect(url).toContain("$search=");
        expect(decodeURIComponent(url)).toContain('"displayName:ana OR admin"');
    });

    it("acota $top al rango que acepta Graph", () => {
        expect(buildEntraUserSearchUrl("ana", 999)).toContain("$top=25");
        expect(buildEntraUserSearchUrl("ana", 0)).toContain("$top=1");
    });

    it("el mapa de MFA acepta registrado o capaz, y descarta filas sin id", () => {
        const map = mfaMapFromRegistrationDetails([
            { id: "u1", isMfaRegistered: true },
            { id: "u2", isMfaRegistered: false, isMfaCapable: true },
            { id: "u3", isMfaRegistered: false },
            { isMfaRegistered: true },
        ]);
        expect(map.get("u1")).toBe(true);
        expect(map.get("u2")).toBe(true);
        expect(map.get("u3")).toBe(false);
        expect(map.size).toBe(3);
    });
});
