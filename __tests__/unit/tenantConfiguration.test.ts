import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock del pool ANTES de importar el servicio.
vi.mock("@/modules/storage/db", () => {
    const query = vi.fn();
    return { default: { query } };
});

import pool from "@/modules/storage/db";
import {
    getItsmCredentials,
    getTenantConfiguration,
    saveItsmConfiguration,
} from "@/services/tenantConfiguration.service";
import { themeToDb, themeToClient } from "@/types/tenantConfiguration.types";
import { assertPublicHttpsUrl } from "@/lib/webhookSecurity";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

// Clave de 32 bytes para secretCrypto (AES-256-GCM).
process.env.MFA_ENCRYPTION_KEY = "a".repeat(64);

beforeEach(() => {
    query.mockReset();
});

describe("SSRF guard de integraciones ITSM", () => {
    // La URL base la elige un admin del tenant pero el request lo hace nuestro
    // servidor con las credenciales guardadas: sin este guard, apuntarla al
    // metadata endpoint convertiría "probar conexión" en una exfiltración.
    it("rechaza el metadata endpoint de Azure por IP literal", async () => {
        await expect(assertPublicHttpsUrl("https://169.254.169.254/metadata/instance")).rejects.toThrow(
            /raw IP literal/i
        );
    });

    it("rechaza IPs privadas literales", async () => {
        await expect(assertPublicHttpsUrl("https://10.0.0.5/rest/api/3/myself")).rejects.toThrow(/raw IP literal/i);
        await expect(assertPublicHttpsUrl("https://192.168.1.10")).rejects.toThrow(/raw IP literal/i);
    });

    it("rechaza HTTP en claro", async () => {
        await expect(assertPublicHttpsUrl("http://empresa.atlassian.net")).rejects.toThrow(/HTTPS/i);
    });

    it("rechaza URLs malformadas", async () => {
        await expect(assertPublicHttpsUrl("no-es-una-url")).rejects.toThrow(/malformed/i);
    });

    it("usa la etiqueta recibida en el mensaje de error", async () => {
        await expect(assertPublicHttpsUrl("http://x.com", "La URL base de ITSM")).rejects.toThrow(
            /La URL base de ITSM/
        );
    });
});

describe("saveItsmConfiguration", () => {
    it("conserva el secreto guardado cuando apiKey viene vacío", async () => {
        query.mockResolvedValue([{}]);
        await saveItsmConfiguration("t1", {
            system: "JIRA",
            baseUrl: "https://empresa.atlassian.net",
            userEmail: "finops@empresa.com",
            projectKey: "FIN",
            // sin apiKey: el usuario editó sólo la URL
        });

        const [sql, values] = query.mock.calls[0];
        // La columna del secreto no debe aparecer en el UPDATE: incluirla con un
        // valor vacío borraría la credencial en un submit que no la tocó.
        expect(sql).not.toContain("itsm_api_key_encrypted");
        expect(values).not.toContain("");
    });

    it("cifra el secreto cuando se envía uno nuevo", async () => {
        query.mockResolvedValue([{}]);
        await saveItsmConfiguration("t1", {
            system: "JIRA",
            baseUrl: "https://empresa.atlassian.net",
            apiKey: "token-en-claro",
        });

        const [sql, values] = query.mock.calls[0];
        expect(sql).toContain("itsm_api_key_encrypted");
        const stored = (values as string[]).find((v) => typeof v === "string" && v.startsWith("enc:v1:"));
        expect(stored).toBeDefined();
        // Nunca se persiste el texto plano.
        expect(values).not.toContain("token-en-claro");
    });

    it("limpia todos los campos al elegir NONE", async () => {
        query.mockResolvedValue([{}]);
        await saveItsmConfiguration("t1", { system: "NONE", baseUrl: "" });

        const [sql] = query.mock.calls[0];
        expect(sql).toContain("itsm_api_key_encrypted = NULL");
        expect(sql).toContain("itsm_system = 'NONE'");
    });

    it("cae a NONE ante un sistema inválido en vez de persistirlo", async () => {
        query.mockResolvedValue([{}]);
        await saveItsmConfiguration("t1", { system: "DROP TABLE" as never, baseUrl: "" });
        const [sql] = query.mock.calls[0];
        expect(sql).toContain("itsm_system = 'NONE'");
    });
});

describe("getTenantConfiguration", () => {
    it("nunca expone el secreto ITSM, sólo si está configurado", async () => {
        query.mockResolvedValue([
            [
                {
                    company_name: "Contoso",
                    logo_stored_name: "logo.png",
                    webhook_url: "https://hooks.slack.com/services/X",
                    theme_preference: "DARK",
                    itsm_system: "JIRA",
                    itsm_base_url: "https://contoso.atlassian.net",
                    itsm_user_email: "finops@contoso.com",
                    itsm_api_key_encrypted: "enc:v1:deadbeef",
                    itsm_project_key: "FIN",
                },
            ],
        ]);

        const config = await getTenantConfiguration("t1", "https://app.example.com");
        const serialized = JSON.stringify(config);

        expect(serialized).not.toContain("enc:v1:");
        expect(config?.integrations.isItsmConfigured).toBe(true);
        expect(config?.integrations.isWebhookConfigured).toBe(true);
        expect(config?.theme).toBe("DARK");
        expect(config?.branding.hasCustomLogo).toBe(true);
    });

    it("cae al esquema previo si la migración 20260822-005 no corrió", async () => {
        const missingColumn = Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" });
        query.mockRejectedValueOnce(missingColumn).mockResolvedValueOnce([
            [{ company_name: "Contoso", logo_stored_name: null, webhook_url: null }],
        ]);

        const config = await getTenantConfiguration("t1", "https://app.example.com");

        expect(config?.theme).toBe("SYSTEM");
        expect(config?.integrations.itsmSystem).toBe("NONE");
        expect(config?.integrations.isItsmConfigured).toBe(false);
    });

    it("propaga errores que NO son de esquema en vez de degradar en silencio", async () => {
        const timeout = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
        query.mockRejectedValueOnce(timeout);

        await expect(getTenantConfiguration("t1", "https://app.example.com")).rejects.toThrow("timeout");
    });

    it("devuelve null si el tenant no existe", async () => {
        query.mockResolvedValue([[]]);
        expect(await getTenantConfiguration("nope", "https://app.example.com")).toBeNull();
    });
});

describe("getItsmCredentials", () => {
    it("descifra el token para uso server-side", async () => {
        const { encryptSecret } = await import("@/lib/secretCrypto");
        query.mockResolvedValue([
            [
                {
                    itsm_system: "JIRA",
                    itsm_base_url: "https://contoso.atlassian.net",
                    itsm_user_email: "finops@contoso.com",
                    itsm_api_key_encrypted: encryptSecret("token-real"),
                    itsm_project_key: "FIN",
                },
            ],
        ]);

        const creds = await getItsmCredentials("t1");
        expect(creds?.apiKey).toBe("token-real");
    });

    it("devuelve null cuando no hay integración", async () => {
        query.mockResolvedValue([[{ itsm_system: "NONE" }]]);
        expect(await getItsmCredentials("t1")).toBeNull();
    });
});

describe("normalización de tema", () => {
    it("mapea entre el ENUM de la DB y next-themes", () => {
        expect(themeToDb("dark")).toBe("DARK");
        expect(themeToClient("SYSTEM")).toBe("system");
    });

    it("falla cerrado a SYSTEM ante un valor desconocido", () => {
        expect(themeToDb("neon")).toBe("SYSTEM");
    });
});
