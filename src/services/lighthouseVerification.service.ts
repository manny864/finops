/**
 * Verificación de delegaciones de Azure Lighthouse. SOLO SERVIDOR.
 *
 * Vive aparte de `azureLighthouse.service.ts` a proposito. Ese modulo lo importa
 * `LighthousePanel`, que es un componente CLIENTE --usa `azureRoleNamesFor` y
 * `syncPercentage`--, asi que todo lo que entre ahi termina en el bundle del
 * navegador. Al meterle `pool` --que arrastra `migrations.ts`, que importa
 * `fs`-- el build de produccion se rompio con "Module not found: Can't resolve
 * 'fs'".
 *
 * `tsc --noEmit` no lo ve: para TypeScript el import es perfectamente valido. El
 * limite servidor/cliente lo impone el bundler, y aparece recien al construir.
 */

import pool from "@/modules/storage/db";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { withArgLimit } from "@/lib/argConcurrency";
import { errorMessage } from "@/lib/apiErrors";
import { getLighthouseCredential, getManagingTenantId } from "@/lib/lighthouseAccess";
import {
    LIGHTHOUSE_DELEGATIONS_KQL,
    roleNamesFromAuthorizations,
    toDelegationStatus,
    type RawArgDelegationRow,
} from "@/services/azureLighthouse.service";

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
