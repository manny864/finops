/**
 * Acceso a suscripciones delegadas por Azure Lighthouse.
 *
 * LOS DOS MODELOS
 * Hasta ahora habia uno solo y estaba implicito en el codigo: un app
 * registration en el directorio del CLIENTE, con su client id/secret guardados
 * por tenant. De ahi que `getAzureCredential` arme siempre
 * `ClientSecretCredential(tenantDelCliente, ...)`.
 *
 * Lighthouse invierte eso. El service principal vive en NUESTRO directorio, el
 * token se emite contra NUESTRO tenant, y ARM lo resuelve hacia las
 * suscripciones que el cliente delego. Autenticar contra el tenant del cliente
 * --lo que hacia -- no falla con un mensaje claro: falla porque nuestro SP no
 * existe en ese directorio.
 *
 * Ese era el agujero: el onboarding por Lighthouse emitia la plantilla,
 * registraba la delegacion, mostraba la suscripcion en la lista, y despues
 * consultaba con la credencial del modelo viejo.
 *
 * QUE NO DA LIGHTHOUSE
 * Solo plano de CONTROL. No hay acceso al plano de datos del cliente: ni
 * secretos de su Key Vault, ni blobs de su storage. Y los management groups del
 * cliente no son visibles --la delegacion es por suscripcion--, asi que todo lo
 * que consulte por scope de MG tiene que ir por suscripcion.
 */

import { ClientSecretCredential } from "@azure/identity";
import pool from "@/modules/storage/db";
import { getSecret, isKeyVaultEnabled } from "@/lib/secrets/keyvault";
import { errorMessage } from "@/lib/apiErrors";

export type AccessModel = "app_registration" | "lighthouse";

/** Nuestro directorio: el que recibe el acceso delegado. */
export function getManagingTenantId(): string | null {
    return process.env.AZURE_LIGHTHOUSE_TENANT_ID || process.env.AZURE_TENANT_ID || null;
}

/**
 * Modelo de acceso de un tenant. Ante cualquier duda, el de siempre.
 *
 * Un tenant mal marcado como `lighthouse` se queda sin datos --su credencial
 * propia no se consulta--, asi que el default en el error es el modelo que ya
 * funcionaba.
 */
export async function getAccessModel(tenantId: string): Promise<AccessModel> {
    try {
        const [rows]: any = await pool.query(
            "SELECT access_model FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId],
        );
        const modelo: AccessModel = rows?.[0]?.access_model === "lighthouse" ? "lighthouse" : "app_registration";
        if (modelo === "lighthouse") tenantsLighthouse.add(tenantId);
        else tenantsLighthouse.delete(tenantId);
        return modelo;
    } catch (e: any) {
        // Sin la columna (migracion no aplicada todavia) nada es Lighthouse.
        if (e?.code !== "ER_BAD_FIELD_ERROR") {
            console.warn(`[lighthouse] no se pudo leer access_model de ${tenantId}:`, errorMessage(e));
        }
        return "app_registration";
    }
}

/**
 * Los tenants Lighthouse vistos en este proceso.
 *
 * Existe para poder responder SIN consultar la base desde codigo sincrono
 * --concretamente `isMgScopeKnownUnusable`, que los cuatro servicios de billing
 * llaman antes de decidir el scope--. Se llena solo: cada consulta de costo pasa
 * primero por `getAzureCredential`, que resuelve el modelo.
 *
 * Que arranque vacio no rompe nada: un tenant Lighthouse todavia no visto
 * probaria el scope de management group, fallaria con ManagementGroupNotFound
 * --su MG no nos fue delegado, Lighthouse delega por suscripcion-- y caeria en
 * el fallback por suscripcion, que es a donde queriamos llegar. Esto solo le
 * ahorra el intento.
 */
const tenantsLighthouse = new Set<string>();

export function esTenantLighthouseConocido(tenantId: string): boolean {
    return tenantsLighthouse.has(tenantId);
}

/** Para los tests. */
export function olvidarTenantsLighthouse(): void {
    tenantsLighthouse.clear();
}

/**
 * Credencial de NUESTRO service principal, cacheada.
 *
 * Se cachea porque es una sola para todos los tenants delegados y
 * `getAzureCredential` se llama 226 veces desde 159 archivos: construir un
 * `ClientSecretCredential` por llamada multiplica las emisiones de token sin
 * ninguna necesidad. El objeto de `@azure/identity` ya cachea el token adentro,
 * pero solo si es el MISMO objeto.
 *
 * El secreto sale de Key Vault y solo cae al entorno si Key Vault no esta
 * configurado: abre las suscripciones de TODOS los clientes delegados, que es
 * bastante mas que la credencial por tenant del modelo viejo.
 */
let credencialCache: { cred: ClientSecretCredential; expira: number } | null = null;
const CACHE_MS = 30 * 60 * 1000;

export async function getLighthouseCredential(): Promise<ClientSecretCredential> {
    if (credencialCache && Date.now() < credencialCache.expira) return credencialCache.cred;

    const tenantId = getManagingTenantId();
    const clientId = process.env.AZURE_LIGHTHOUSE_CLIENT_ID;
    let clientSecret = process.env.AZURE_LIGHTHOUSE_CLIENT_SECRET || null;

    if (isKeyVaultEnabled()) {
        clientSecret = (await getSecret("infra-lighthouse-client-secret")) || clientSecret;
    }

    if (!tenantId || !clientId || !clientSecret) {
        const faltan = [
            !tenantId && "AZURE_LIGHTHOUSE_TENANT_ID",
            !clientId && "AZURE_LIGHTHOUSE_CLIENT_ID",
            !clientSecret && "el secreto (infra-lighthouse-client-secret en Key Vault)",
        ].filter(Boolean).join(", ");
        throw new Error(
            `Acceso por Azure Lighthouse sin configurar: falta ${faltan}. ` +
            `Es la credencial de nuestro service principal, la que ARM resuelve hacia las suscripciones delegadas.`,
        );
    }

    const cred = new ClientSecretCredential(tenantId, clientId, clientSecret);
    credencialCache = { cred, expira: Date.now() + CACHE_MS };
    return cred;
}

/** Para los tests y para cuando rota el secreto. */
export function clearLighthouseCredentialCache(): void {
    credencialCache = null;
}

/**
 * Roles de Azure que habilitan ESCRITURA sobre recursos.
 *
 * Los tres primeros son los que el generador de plantillas ofrece; el cuarto es
 * el rol personalizado que asigna el script de onboarding. `Reader` y
 * `Cost Management Reader` NO estan y es el punto: una delegacion de solo
 * lectura habilita todos los tableros y ninguna accion.
 */
const ROLES_DE_ESCRITURA = ["Contributor", "Tag Contributor", "Owner", "CSCloudSolutions FinOps Remediation"];

/**
 * Si el tenant puede EJECUTAR acciones sobre Azure, no solo leerlo.
 *
 * Con `app_registration` la respuesta es siempre si: el script de onboarding
 * asigna el rol de remediacion, y si el cliente lo quito el fallo es el 403 de
 * Azure, que es lo que habia antes y no cambia.
 *
 * Con `lighthouse` la respuesta depende de lo que el cliente delego, y hay que
 * mirarlo: la delegacion puede ser de solo lectura. Sin este chequeo, apagar una
 * VM devolvia un 403 crudo de ARM recien al ejecutarse, sin decir que el
 * problema era el alcance de la delegacion y no un permiso de la plataforma.
 *
 * Se lee de `TenantDelegations.roles`, que despues de verificar contiene lo que
 * Azure REPORTA --no lo que se pidio en el formulario--. Sin verificacion previa
 * la columna trae la intencion, asi que devuelve `true` y el 403 sigue siendo el
 * que manda: es preferible a bloquear una accion que el cliente si delego.
 */
export async function tenantPuedeEscribirEnAzure(tenantId: string): Promise<{ puede: boolean; roles: string[] }> {
    if ((await getAccessModel(tenantId)) !== "lighthouse") return { puede: true, roles: [] };
    try {
        const [rows]: any = await pool.query(
            `SELECT roles FROM TenantDelegations
              WHERE tenant_id = ? AND verified_at IS NOT NULL AND status = 'active'`,
            [tenantId],
        );
        if (!rows?.length) return { puede: true, roles: [] };
        const roles = new Set<string>();
        for (const r of rows) {
            try {
                for (const rol of JSON.parse(String(r.roles || "[]"))) roles.add(String(rol));
            } catch { /* fila con roles ilegibles: no bloquea */ }
        }
        const lista = Array.from(roles);
        return { puede: lista.some((r) => ROLES_DE_ESCRITURA.includes(r)), roles: lista };
    } catch (e) {
        console.warn(`[lighthouse] no se pudo leer los roles delegados de ${tenantId}:`, errorMessage(e));
        return { puede: true, roles: [] };
    }
}
