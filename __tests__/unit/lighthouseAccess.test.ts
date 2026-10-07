// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClientSecretCredential } from "@azure/identity";
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
    AudienciaNoDelegadaError,
    respuestaAudienciaNoDelegada,
} from "@/lib/lighthouseAccess";
import { getAzureCredential } from "@/lib/azure";

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

/**
 * Los dos tenants de una delegación no son intercambiables.
 *
 * La consulta a Resource Graph se hace desde NUESTRO directorio, así que
 * `regDef.managedByTenantId` es el nuestro y el `tenantId` de la fila es el del
 * cliente. `mapArgDelegation` usaba el primero para la columna "Tenant
 * gestionado", así que la tabla mostraba a CSCloudSolutions como cliente de sí
 * misma. Se vio en cuanto entró la primera delegación real (2026-09-04).
 */
describe("tenant gestionado vs administrador", () => {
    const svc = sinComentarios("src/services/azureLighthouse.service.ts");

    it("el KQL proyecta los dos, por separado", () => {
        expect(svc).toContain("managedTenantId = tostring(tenantId)");
        expect(svc).toContain("managedByTenantId = tostring(regDef.managedByTenantId)");
    });

    it("la columna de tenant gestionado usa el delegante, no el administrador", () => {
        const m = svc.match(/const managedTenantId = String\(([^)]+)\)/);
        expect(m, "no encontré la asignación de managedTenantId").not.toBeNull();
        expect(m![1], "vuelve a leer el tenant administrador como si fuera el cliente")
            .toMatch(/row\.managedTenantId/);
    });

    it("no se muestra el nombre de NUESTRA definición como nombre del cliente", () => {
        // `definitionName` es "CSCloudSolutions FinOps Delegation": ponerlo en la
        // columna del cliente es peor que mostrar el GUID.
        expect(svc).not.toMatch(/managedTenantName:[^\n]*definitionName/);
    });
});

/**
 * La credencial de Lighthouse es de NUESTRO directorio. Un token de Microsoft
 * Graph sacado de ella no lee el directorio del cliente: lee el nuestro, y las
 * pantallas de identidad se lo mostrarían al cliente como propio.
 */
describe("audiencias de la credencial lighthouse", () => {
    const GRAPH = "https://graph.microsoft.com/.default";

    beforeEach(() => {
        process.env.AZURE_LIGHTHOUSE_TENANT_ID = "00000000-0000-0000-0000-00000000000a";
        process.env.AZURE_LIGHTHOUSE_CLIENT_ID = "00000000-0000-0000-0000-00000000000b";
        process.env.AZURE_LIGHTHOUSE_CLIENT_SECRET = "secreto";
    });
    afterEach(() => vi.restoreAllMocks());

    it("un tenant lighthouse no saca tokens de Graph ni de otro plano de datos", async () => {
        queryMock.mockResolvedValue([[{ access_model: "lighthouse" }]]);
        const emitir = vi.spyOn(ClientSecretCredential.prototype, "getToken");
        const cred = await getAzureCredential("cliente-lighthouse");

        await expect(cred.getToken(GRAPH)).rejects.toBeInstanceOf(AudienciaNoDelegadaError);
        await expect(cred.getToken(["https://management.azure.com/.default", GRAPH])).rejects.toThrow(/Lighthouse/);
        await expect(cred.getToken("https://cognitiveservices.azure.com/.default")).rejects.toBeInstanceOf(AudienciaNoDelegadaError);
        expect(emitir, "el rechazo tiene que ser antes de pedirle el token a Entra").not.toHaveBeenCalled();
    });

    it("ARM y Log Analytics, que Lighthouse sí delega, siguen pasando", async () => {
        const emitir = vi
            .spyOn(ClientSecretCredential.prototype, "getToken")
            .mockResolvedValue({ token: "t", expiresOnTimestamp: Date.now() + 3_600_000 });
        const cred = await getLighthouseCredential();

        await cred.getToken("https://management.azure.com/.default");
        await cred.getToken(["https://api.loganalytics.io/.default"]);
        expect(emitir).toHaveBeenCalledTimes(2);
    });

    it("las rutas lo devuelven como 409 con el motivo, no como 500 genérico", async () => {
        const res = respuestaAudienciaNoDelegada(new AudienciaNoDelegadaError(GRAPH));
        expect(res?.status).toBe(409);
        const body = await res!.json();
        expect(body.errorCode).toBe("ERR_LIGHTHOUSE_NOT_DELEGATED");
        expect(body.error).toMatch(/^No disponible con Azure Lighthouse/);
        expect(respuestaAudienciaNoDelegada(new Error("otra cosa"))).toBeNull();
    });

    it("el aviso traducido nombra a Lighthouse en los tres idiomas", () => {
        // `useAvisoLighthouse` traduce el código; `ErrorBlock` de M365UsersBoard
        // reconoce el aviso por la palabra y así no lo confunde con un permiso
        // de Graph faltante. Sin ella, la pantalla volvería a pedir consentimiento.
        for (const loc of ["es", "en", "pt-BR"]) {
            const m = JSON.parse(readFileSync(join(RAIZ, "messages", `${loc}.json`), "utf8"));
            expect(m.Lighthouse.errores.ERR_LIGHTHOUSE_NOT_DELEGATED, loc).toMatch(/Azure Lighthouse/);
        }
    });
});
