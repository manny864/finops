// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock }, initializeDatabase: vi.fn() }));
vi.mock("@/lib/secrets/keyvault", () => ({ getSecret: vi.fn(async () => null), isKeyVaultEnabled: () => false }));

import {
    getAccessModel,
    esTenantLighthouseConocido,
    olvidarTenantsLighthouse,
    getLighthouseCredential,
    clearLighthouseCredentialCache,
} from "@/lib/lighthouseAccess";

const RAIZ = join(__dirname, "..", "..");
const sinComentarios = (ruta: string) =>
    readFileSync(join(RAIZ, ruta), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "");

beforeEach(() => {
    queryMock.mockReset();
    olvidarTenantsLighthouse();
    clearLighthouseCredentialCache();
    delete process.env.AZURE_LIGHTHOUSE_CLIENT_ID;
    delete process.env.AZURE_LIGHTHOUSE_CLIENT_SECRET;
    delete process.env.AZURE_LIGHTHOUSE_TENANT_ID;
});

/**
 * Azure Lighthouse invierte la autoridad del token: el service principal vive en
 * NUESTRO directorio, no en el del cliente. Autenticar contra el del cliente no
 * falla con un mensaje claro --falla porque nuestro SP no existe ahí--, y era
 * exactamente lo que pasaba: la plantilla se emitía, la delegación se
 * registraba, la suscripción aparecía en la lista, y después se consultaba con
 * la credencial del modelo viejo.
 */
describe("modelo de acceso por tenant", () => {
    it("ante un error de base cae al modelo que ya funcionaba", async () => {
        // Un tenant mal marcado como lighthouse se queda sin datos: su
        // credencial propia deja de consultarse.
        queryMock.mockRejectedValue(Object.assign(new Error("db caida"), { code: "ER_LOCK_WAIT_TIMEOUT" }));
        expect(await getAccessModel("t1")).toBe("app_registration");
    });

    it("sin la columna todavía migrada, nada es lighthouse", async () => {
        queryMock.mockRejectedValue(Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" }));
        expect(await getAccessModel("t1")).toBe("app_registration");
    });

    it("recuerda los tenants lighthouse para consulta síncrona", async () => {
        // `isMgScopeKnownUnusable` es síncrona y la llaman los cuatro servicios
        // de billing; sin este registro habría que pegarle a la base desde ahí.
        queryMock.mockResolvedValue([[{ access_model: "lighthouse" }]]);
        expect(esTenantLighthouseConocido("t1")).toBe(false);
        await getAccessModel("t1");
        expect(esTenantLighthouseConocido("t1")).toBe(true);
    });

    it("un tenant que vuelve a app_registration deja de estar marcado", async () => {
        queryMock.mockResolvedValue([[{ access_model: "lighthouse" }]]);
        await getAccessModel("t1");
        queryMock.mockResolvedValue([[{ access_model: "app_registration" }]]);
        await getAccessModel("t1");
        expect(esTenantLighthouseConocido("t1")).toBe(false);
    });

    it("sin credencial configurada el error dice QUÉ falta", async () => {
        await expect(getLighthouseCredential()).rejects.toThrow(/AZURE_LIGHTHOUSE_CLIENT_ID/);
    });
});

describe("cableado del modelo lighthouse", () => {
    it("getAzureCredential se ramifica ANTES de buscar credenciales del cliente", () => {
        // Al revés no serviría: un tenant lighthouse no tiene credenciales
        // propias guardadas y el lookup fallaría antes de llegar a la rama.
        const azure = sinComentarios("src/lib/azure.ts");
        const fn = azure.slice(azure.indexOf("export async function getAzureCredential("));
        const rama = fn.indexOf('=== "lighthouse"');
        const lookup = fn.indexOf("getTenantCredentials(");
        expect(rama).toBeGreaterThan(-1);
        expect(rama, "la rama de lighthouse tiene que ir antes del lookup del modelo viejo").toBeLessThan(lookup);
    });

    it("el scope de management group se descarta para tenants lighthouse", () => {
        // La delegación es por suscripción: el MG del cliente no nos fue
        // delegado y no existe para nosotros. Sin esto, cada tenant lighthouse
        // paga una consulta fallida antes de cada fallback.
        const helpers = sinComentarios("src/modules/collectors/azure/billing/billingHelpers.ts");
        const fn = helpers.slice(helpers.indexOf("export function isMgScopeKnownUnusable("));
        expect(fn.slice(0, 400)).toContain("esTenantLighthouseConocido");
    });

    it("access_model sólo se enciende al verificar contra Azure", () => {
        // Encenderlo al emitir la plantilla dejaría al tenant sin datos hasta
        // que el cliente la desplegara.
        const svc = sinComentarios("src/services/lighthouseVerification.service.ts");
        expect(svc).toMatch(/UPDATE Tenants SET access_model = 'lighthouse'/);
        const onboard = sinComentarios("src/app/api/onboard/lighthouse/route.ts");
        expect(onboard, "la ruta que emite la plantilla no puede encender el modelo").not.toContain("access_model");
    });

    it("no se apaga solo ante un fallo de verificación", () => {
        // Un fallo puntual de Resource Graph devolvería al tenant al modelo
        // viejo, cuyas credenciales probablemente ya no existan.
        const svc = sinComentarios("src/services/lighthouseVerification.service.ts");
        expect(svc).not.toMatch(/access_model = 'app_registration'/);
    });
});
