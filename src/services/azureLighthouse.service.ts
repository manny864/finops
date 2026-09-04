/**
 * Onboarding Lighthouse — capa de dominio.
 *
 * Normaliza dos fuentes distintas de delegaciones al mismo contrato:
 *  - Resource Graph (`Microsoft.ManagedServices/registrationAssignments`), que
 *    es la verdad: si está ahí, la delegación existe en Azure.
 *  - `TenantDelegations`, el registro propio de las plantillas emitidas, que
 *    sólo prueba que se generó una plantilla — no que el cliente la desplegó.
 *
 * Mantener el campo `origin` en el contrato es deliberado: mezclarlas sin
 * distinguir haría que un template descargado y nunca aplicado se vea como una
 * delegación activa.
 */

import {
    LIGHTHOUSE_ROLES,
    type LighthouseDelegationItem,
    type LighthouseDelegationStatus,
    type LighthouseRoleKey,
    type LighthouseSummaryMetrics,
} from "@/types/azureLighthouse.types";
import pool from "@/modules/storage/db";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { withArgLimit } from "@/lib/argConcurrency";
import { errorMessage } from "@/lib/apiErrors";
import { getLighthouseCredential, getManagingTenantId } from "@/lib/lighthouseAccess";

/**
 * KQL de las delegaciones activas. Resource Graph expone el
 * `registrationAssignment` con su definición expandida, que es donde viven el
 * tenant delegante, los roles autorizados y el estado de aprovisionamiento.
 */
export const LIGHTHOUSE_DELEGATIONS_KQL = `
ManagedServicesResources
| where type =~ 'microsoft.managedservices/registrationassignments'
| extend props = properties
| extend regDef = props.registrationDefinition.properties
| project
    assignmentId = id,
    subscriptionId,
    provisioningState = tostring(props.provisioningState),
    managedByTenantId = tostring(regDef.managedByTenantId),
    managedTenantName = tostring(regDef.managedByTenantName),
    definitionName = tostring(regDef.registrationDefinitionName),
    authorizations = regDef.authorizations
| order by subscriptionId asc
`.trim();

/**
 * Mapea el `provisioningState` de ARM al estado del contrato.
 *
 * `Succeeded` es lo único que significa delegación viva. Cualquier otro estado
 * (Creating, Failed, Canceled) se reporta como pendiente en vez de activo: dar
 * por activa una delegación que falló mostraría acceso que no existe.
 */
export function toDelegationStatus(provisioningState: unknown): LighthouseDelegationStatus {
    const s = String(provisioningState || "").toLowerCase();
    if (s === "succeeded") return "ACTIVE";
    if (s === "failed" || s === "canceled" || s === "cancelled") return "REJECTED";
    return "PENDING";
}

/** Mapea el estado de la tabla propia (`pending`, `active`, `rejected`). */
export function toDelegationStatusFromDb(raw: unknown): LighthouseDelegationStatus {
    const s = String(raw || "").toLowerCase();
    if (s === "active") return "ACTIVE";
    if (s === "rejected") return "REJECTED";
    return "PENDING";
}

/** GUID de rol integrado de Azure → nombre legible. */
const ROLE_GUID_TO_NAME: Record<string, string> = {
    "acdd72a7-3385-48ef-bd42-f606fba81ae7": "Reader",
    "72fafb9e-0641-4937-9268-a91bfd8191a3": "Cost Management Reader",
    "4a9ae827-6dc8-4573-8ac7-8239d42aa03f": "Tag Contributor",
    "b24988ac-6180-42a0-ab88-20f7382dd24c": "Contributor",
    "43d0d8ad-25c7-4714-9337-8ba259a9fe05": "Monitoring Reader",
};

/**
 * Nombres de los roles autorizados en una delegación.
 *
 * ARM entrega el `roleDefinitionId` como GUID; el nombre no viaja. Un GUID
 * desconocido se muestra abreviado en vez de descartarse: es un rol delegado
 * real y ocultarlo daría una lista de permisos incompleta, que es peor que una
 * etiqueta poco legible.
 */
export function roleNamesFromAuthorizations(authorizations: unknown): string[] {
    if (!Array.isArray(authorizations)) return [];
    const names = authorizations.map((a) => {
        const guid = String((a as { roleDefinitionId?: unknown })?.roleDefinitionId || "")
            .split("/")
            .pop()!
            .toLowerCase();
        return ROLE_GUID_TO_NAME[guid] || (guid ? `Rol ${guid.slice(0, 8)}…` : "");
    });
    return [...new Set(names.filter(Boolean))];
}

export interface RawArgDelegationRow {
    assignmentId?: unknown;
    subscriptionId?: unknown;
    provisioningState?: unknown;
    managedByTenantId?: unknown;
    managedTenantName?: unknown;
    definitionName?: unknown;
    authorizations?: unknown;
}

export function mapArgDelegation(row: RawArgDelegationRow, subscriptionNames: Map<string, string> = new Map()): LighthouseDelegationItem {
    const subscriptionId = String(row.subscriptionId || "");
    const managedTenantId = String(row.managedByTenantId || "");
    return {
        id: String(row.assignmentId || `${managedTenantId}/${subscriptionId}`),
        managedTenantId,
        managedTenantName: String(row.managedTenantName || row.definitionName || "").trim() || managedTenantId,
        subscriptionId,
        subscriptionName: subscriptionNames.get(subscriptionId) || subscriptionId,
        delegatedRoles: roleNamesFromAuthorizations(row.authorizations),
        status: toDelegationStatus(row.provisioningState),
        origin: "arg",
    };
}

export interface RawDbDelegationRow {
    id?: unknown;
    managed_tenant_id?: unknown;
    managed_subscription_id?: unknown;
    roles?: unknown;
    status?: unknown;
    delegated_at?: unknown;
}

export function mapDbDelegation(row: RawDbDelegationRow): LighthouseDelegationItem {
    let roles: string[] = [];
    if (typeof row.roles === "string") {
        try {
            const parsed = JSON.parse(row.roles);
            roles = Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
            roles = row.roles.split(",").map((s) => s.trim()).filter(Boolean);
        }
    } else if (Array.isArray(row.roles)) {
        roles = row.roles.map(String);
    }

    const at = row.delegated_at ? new Date(String(row.delegated_at)) : null;
    const subscriptionId = String(row.managed_subscription_id || "");
    return {
        id: String(row.id ?? ""),
        managedTenantId: String(row.managed_tenant_id || ""),
        managedTenantName: String(row.managed_tenant_id || ""),
        subscriptionId,
        subscriptionName: subscriptionId,
        delegatedRoles: roles,
        status: toDelegationStatusFromDb(row.status),
        approvedAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : undefined,
        origin: "db",
    };
}

/**
 * Combina ARG y registro propio sin duplicar.
 *
 * Una delegación presente en ARG gana sobre la fila de la base con el mismo
 * (tenant, suscripción): ARG dice lo que Azure tiene, la base dice lo que se
 * pidió. Cuando coinciden, la que vale es la de Azure.
 */
export function mergeDelegations(fromArg: LighthouseDelegationItem[], fromDb: LighthouseDelegationItem[]): LighthouseDelegationItem[] {
    const key = (d: LighthouseDelegationItem) => `${d.managedTenantId.toLowerCase()}::${d.subscriptionId.toLowerCase()}`;
    const seen = new Set(fromArg.map(key));
    return [...fromArg, ...fromDb.filter((d) => !seen.has(key(d)))];
}

export function buildLighthouseSummary(delegations: LighthouseDelegationItem[]): LighthouseSummaryMetrics {
    return {
        totalManagedTenantsCount: new Set(delegations.map((d) => d.managedTenantId).filter(Boolean)).size,
        totalDelegatedSubscriptionsCount: new Set(delegations.map((d) => d.subscriptionId).filter(Boolean)).size,
        activeDelegationsCount: delegations.filter((d) => d.status === "ACTIVE").length,
        delegatedRoleAssignmentsCount: delegations.reduce((acc, d) => acc + d.delegatedRoles.length, 0),
        delegations,
    };
}

/**
 * Porcentaje de delegaciones activas sobre el total. Sin delegaciones devuelve
 * 0, no 100: "todo sincronizado" con cero filas sería una afirmación vacía.
 */
export function syncPercentage(summary: LighthouseSummaryMetrics): number {
    const total = summary.delegations.length;
    return total === 0 ? 0 : Math.round((summary.activeDelegationsCount / total) * 100);
}

/** Nombres de rol de Azure a partir de las claves elegidas en el formulario. */
export function azureRoleNamesFor(keys: LighthouseRoleKey[]): string[] {
    return LIGHTHOUSE_ROLES.filter((r) => keys.includes(r.key)).map((r) => r.azureRoleName);
}

/**
 * URL de despliegue directo en el portal de Azure.
 *
 * El portal necesita la plantilla como URI públicamente accesible, así que este
 * enlace lleva al blade de despliegue personalizado donde se pega el JSON. No
 * se sube la plantilla a ninguna parte: contiene los principalId del MSP y no
 * tiene por qué quedar en un host público.
 */
export const AZURE_CUSTOM_DEPLOYMENT_URL =
    "https://portal.azure.com/#create/Microsoft.Template";

/**
 * Verifica contra Azure si la delegación de un tenant está viva, y deja el
 * resultado escrito.
 *
 * POR QUE NO ALCANZA CON `TenantDelegations`
 * Esa tabla registra las plantillas que EMITIMOS. Que exista una fila significa
 * "le dimos el JSON al cliente", no "el cliente lo desplegó": el status se
 * escribe como `pending` en el INSERT y nadie lo actualizaba nunca. La única
 * fuente de verdad es Resource Graph, consultado desde NUESTRO directorio, que
 * es donde la delegación se ve.
 *
 * Tampoco alcanza con verificar una vez. El cliente revoca la delegación desde
 * su portal cuando quiere, sin avisar, y una delegación revocada no da un error
 * distinguible: da 403, o directamente cero suscripciones.
 *
 * EFECTO SECUNDARIO DELIBERADO
 * Confirmada la delegación, el tenant pasa a `access_model = 'lighthouse'` y
 * desde ahí `getAzureCredential` autentica contra nuestro directorio. Es el
 * único lugar que enciende ese interruptor: encenderlo al emitir la plantilla
 * dejaría al tenant sin datos hasta que el cliente la desplegara.
 */
export async function verificarDelegacion(tenantId: string): Promise<{
    activa: boolean;
    suscripciones: string[];
    roles: string[];
    error?: string;
}> {
    const nuestroTenant = getManagingTenantId();
    if (!nuestroTenant) {
        return { activa: false, suscripciones: [], roles: [], error: "Falta AZURE_LIGHTHOUSE_TENANT_ID." };
    }

    // Las suscripciones que le emitimos a ESTE tenant. La consulta a Resource
    // Graph devuelve las delegaciones de todos los clientes --se hace desde
    // nuestro directorio--, y el row no trae el tenant delegante, así que la
    // atribución se hace por suscripción.
    const [filas]: any = await pool.query(
        `SELECT DISTINCT managed_subscription_id AS sub
           FROM TenantDelegations
          WHERE tenant_id = ? AND managed_subscription_id IS NOT NULL AND managed_subscription_id <> ''`,
        [tenantId],
    );
    const esperadas = new Set<string>((filas || []).map((f: any) => String(f.sub).toLowerCase()));
    if (esperadas.size === 0) {
        return { activa: false, suscripciones: [], roles: [], error: "No hay ninguna delegación emitida para este tenant." };
    }

    let activas: string[] = [];
    let roles: string[] = [];
    try {
        const credential = await getLighthouseCredential();
        const client = new ResourceGraphClient(credential);
        const res = await withArgLimit(
            () => client.resources({ query: LIGHTHOUSE_DELEGATIONS_KQL }),
            { label: "lighthouse-delegations" },
        );
        for (const row of ((res.data as RawArgDelegationRow[]) || [])) {
            const sub = String(row.subscriptionId || "").toLowerCase();
            if (!esperadas.has(sub)) continue;
            if (String(row.managedByTenantId || "").toLowerCase() !== nuestroTenant.toLowerCase()) continue;
            if (toDelegationStatus(row.provisioningState) !== "ACTIVE") continue;
            activas.push(sub);
            roles = [...new Set([...roles, ...roleNamesFromAuthorizations(row.authorizations)])];
        }
    } catch (e) {
        const error = errorMessage(e);
        await persistirVerificacion(tenantId, false, error);
        return { activa: false, suscripciones: [], roles: [], error };
    }

    const activa = activas.length > 0;
    await persistirVerificacion(
        tenantId,
        activa,
        activa ? null : "Resource Graph no encontró ninguna delegación activa para las suscripciones emitidas.",
    );
    return {
        activa,
        suscripciones: activas,
        roles,
        error: activa ? undefined : "El cliente todavía no desplegó la plantilla, o revocó la delegación.",
    };
}

async function persistirVerificacion(tenantId: string, activa: boolean, error: string | null): Promise<void> {
    try {
        await pool.query(
            `UPDATE TenantDelegations
                SET verified_at = NOW(), verification_error = ?, status = ?
              WHERE tenant_id = ?`,
            // Minúscula: es lo que escribe el INSERT de la ruta de onboarding
            // ('pending'). El tipo `LighthouseDelegationStatus` es mayúscula
            // pero eso es el contrato de la API, no lo que guarda la columna.
            [error, activa ? "active" : "pending", tenantId],
        );
        // Sólo se ENCIENDE acá. No se apaga solo: un fallo puntual de Resource
        // Graph devolvería al tenant al modelo viejo, cuyas credenciales
        // probablemente ya no existan, y el corte sería peor que el síntoma.
        if (activa) {
            await pool.query("UPDATE Tenants SET access_model = 'lighthouse' WHERE tenant_id = ?", [tenantId]);
        }
    } catch (e) {
        console.warn(`[lighthouse] no se pudo guardar la verificación de ${tenantId}:`, errorMessage(e));
    }
}
