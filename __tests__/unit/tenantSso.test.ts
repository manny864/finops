import { describe, it, expect } from "vitest";
import {
    idpFromWorkosConnectionType,
    isSsoOperational,
    isValidDomain,
    isValidWorkosConnectionId,
    isValidWorkosOrgId,
    jitRoleToDb,
    mapSsoConfig,
    normalizeDomain,
    ssoStatusKey,
    toIdpProvider,
    toJitRole,
} from "@/services/tenantSso.service";

describe("SSO — validación de entradas", () => {
    it("acepta dominios reales y rechaza lo que no es un dominio", () => {
        expect(isValidDomain("acme.com")).toBe(true);
        expect(isValidDomain("sub.acme.co.uk")).toBe(true);
        expect(isValidDomain("acme")).toBe(false);
        expect(isValidDomain("acme.c")).toBe(false);
        expect(isValidDomain("")).toBe(false);
    });

    it("rechaza una URL o un email donde va el dominio", () => {
        // Pegar la URL completa es el error típico; se normaliza, no se acepta crudo.
        expect(isValidDomain("https://acme.com")).toBe(false);
        expect(isValidDomain("acme.com/login")).toBe(false);
        expect(isValidDomain("ana@acme.com")).toBe(false);
    });

    it("normaliza la URL pegada al dominio solo", () => {
        expect(normalizeDomain("https://acme.com/sso/login")).toBe("acme.com");
        expect(normalizeDomain("  ACME.COM  ")).toBe("acme.com");
        expect(isValidDomain(normalizeDomain("https://acme.com/x"))).toBe(true);
    });

    it("exige los prefijos de WorkOS: atrapa el copiado cruzado de IDs", () => {
        expect(isValidWorkosOrgId("org_01H8XYZABC")).toBe(true);
        expect(isValidWorkosOrgId("conn_01H8XYZABC")).toBe(false);
        expect(isValidWorkosConnectionId("conn_01H8XYZABC")).toBe(true);
        expect(isValidWorkosConnectionId("org_01H8XYZABC")).toBe(false);
        expect(isValidWorkosOrgId("org_")).toBe(false);
    });
});

describe("SSO — rol JIT", () => {
    it("falla cerrado a READER: habilitar JIT nunca puede regalar administración", () => {
        expect(toJitRole("CONTRIBUTOR")).toBe("CONTRIBUTOR");
        expect(toJitRole("contributor")).toBe("CONTRIBUTOR");
        expect(toJitRole("ADMIN")).toBe("READER");
        expect(toJitRole("OWNER")).toBe("READER");
        expect(toJitRole(undefined)).toBe("READER");
    });

    it("escribe la ortografía que usa la base", () => {
        expect(jitRoleToDb("CONTRIBUTOR")).toBe("Colaborador");
        expect(jitRoleToDb("READER")).toBe("Reader");
    });
});

describe("SSO — detección del IdP desde WorkOS", () => {
    it("mapea los connectionType conocidos", () => {
        expect(idpFromWorkosConnectionType("AzureSAML")).toBe("ENTRA_ID");
        expect(idpFromWorkosConnectionType("OktaSAML")).toBe("OKTA");
        expect(idpFromWorkosConnectionType("Auth0SAML")).toBe("AUTH0");
        expect(idpFromWorkosConnectionType("AdfsSAML")).toBe("ADFS");
    });

    it("lo desconocido cae en SAML genérico, que sigue siendo correcto", () => {
        expect(idpFromWorkosConnectionType("PingFederateSAML")).toBe("GENERIC_SAML");
        expect(idpFromWorkosConnectionType("")).toBe("GENERIC_SAML");
        expect(idpFromWorkosConnectionType(null)).toBe("GENERIC_SAML");
    });

    it("toIdpProvider descarta valores fuera del enum", () => {
        expect(toIdpProvider("okta")).toBe("OKTA");
        expect(toIdpProvider("PING")).toBeUndefined();
    });
});

describe("SSO — estado de la configuración", () => {
    const full = {
        domain: "acme.com",
        workos_org_id: "org_01H8XYZABC",
        workos_connection_id: "conn_01H8XYZABC",
        enabled: 1,
    };

    it("operativo sólo con las tres piezas y habilitado", () => {
        expect(isSsoOperational(mapSsoConfig(full))).toBe(true);
        expect(isSsoOperational(mapSsoConfig({ ...full, workos_connection_id: null }))).toBe(false);
        expect(isSsoOperational(mapSsoConfig({ ...full, domain: null }))).toBe(false);
        // Habilitado pero incompleto no es operativo: nadie podría entrar.
        expect(isSsoOperational(mapSsoConfig({ ...full, workos_org_id: "no-es-un-org-id" }))).toBe(false);
    });

    it("el estado del KPI explica la razón, no sólo el booleano", () => {
        expect(ssoStatusKey(mapSsoConfig(full), true)).toBe("operational");
        expect(ssoStatusKey(mapSsoConfig({ ...full, enabled: 0 }), true)).toBe("disabled");
        expect(ssoStatusKey(mapSsoConfig({ ...full, domain: null }), true)).toBe("incomplete");
        // Sin credenciales de WorkOS en la plataforma nada puede funcionar, y eso
        // no es culpa de la configuración del tenant.
        expect(ssoStatusKey(mapSsoConfig(full), false)).toBe("platform_missing");
    });

    it("una fila inexistente devuelve una config vacía usable, no null", () => {
        const c = mapSsoConfig(null);
        expect(c.domain).toBe("");
        expect(c.isEnabled).toBe(false);
        expect(c.defaultRoleForNewUsers).toBe("READER");
        expect(c.jitProvisioningEnabled).toBe(false);
    });

    it("lee los flags numéricos de MySQL como booleanos", () => {
        const c = mapSsoConfig({ ...full, jit_provisioning_enabled: 1, is_domain_verified: 1, last_test_result: "SUCCESS" });
        expect(c.jitProvisioningEnabled).toBe(true);
        expect(c.isDomainVerified).toBe(true);
        expect(c.lastTestResult).toBe("SUCCESS");
    });
});
