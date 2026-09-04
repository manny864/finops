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
    // Sin filas registradas NO se aborta: el cliente pudo desplegar la plantilla
    // en suscripciones que nunca escribimos --el JSON es el mismo para todas--.
    // Resource Graph es la fuente de verdad; la tabla es solo lo que emitimos.

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
            const delegante = String(row.managedTenantId || "").toLowerCase();

            // Se cuentan TODAS las suscripciones que este cliente nos delego, no
            // solo las que quedaron anotadas en `TenantDelegations`.
            //
            // La plantilla no nombra la suscripcion --es un
            // `subscriptionDeploymentTemplate` con `guid(subscription().id)`--,
            // asi que el mismo JSON sirve para todas y el cliente lo despliega
            // una vez por suscripcion sin volver a pedirnos nada. Nuestra tabla
            // se entera de la primera y de ninguna mas.
            //
            // Matchear por tenant delegante cubre eso. El match por suscripcion
            // registrada queda de respaldo para las filas viejas, anteriores a
            // que el KQL proyectara `managedTenantId`.
            const esDeEsteCliente = delegante
                ? delegante === tenantId.toLowerCase()
                : esperadas.has(sub);
            if (!esDeEsteCliente) continue;
            if (String(row.managedByTenantId || "").toLowerCase() !== nuestroTenant.toLowerCase()) continue;
            if (toDelegationStatus(row.provisioningState) !== "ACTIVE") continue;
            activas.push(sub);
            roles = [...new Set([...roles, ...roleNamesFromAuthorizations(row.authorizations)])];
        }
    } catch (e) {
        const error = errorMessage(e);
        await persistirVerificacion(tenantId, false, error, null);
        return { activa: false, suscripciones: [], roles: [], error };
    }

    const activa = activas.length > 0;
    await persistirVerificacion(
        tenantId,
        activa,
        activa ? null : "Resource Graph no encontró ninguna delegación activa para las suscripciones emitidas.",
        activa ? roles : null,
    );
    return {
        activa,
        suscripciones: activas,
        roles,
        error: activa ? undefined : "El cliente todavía no desplegó la plantilla, o revocó la delegación.",
    };
}

/**
 * `roles` se sobrescribe con lo que Azure REPORTA, no con lo que pedimos.
 *
 * El INSERT de la ruta de onboarding guarda los roles que se tildaron en el
 * formulario: es una intencion. El cliente puede haber desplegado la plantilla
 * con menos --editando el JSON, o desplegando una version anterior-- y sin
 * pisarlo la columna miente en la direccion peligrosa: la UI habilita acciones
 * de escritura que Azure va a rechazar con 403 al ejecutarlas.
 *
 * Sólo se pisa cuando la delegacion esta ACTIVA. Si la verificacion falla no
 * sabemos nada nuevo sobre los roles, y borrarlos convertiria un fallo
 * transitorio de Resource Graph en una perdida de informacion.
 */
async function persistirVerificacion(
    tenantId: string,
    activa: boolean,
    error: string | null,
    rolesReales: string[] | null,
): Promise<void> {
    try {
        await pool.query(
            `UPDATE TenantDelegations
                SET verified_at = NOW(), verification_error = ?, status = ?` +
            (rolesReales ? `, roles = ${pool.escape(JSON.stringify(rolesReales))}` : ``) +
            ` WHERE tenant_id = ?`,
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
