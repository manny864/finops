import type { PoolConnection } from "mysql2/promise";
import pool from "@/modules/storage/db";
import { createNotification } from "@/lib/notify";
import { sendEmailAsync } from "@/lib/emailHelper";
import {
    autoElectRetainedProvider,
    canIngestProvider,
    canReadProvider,
    computePurgeDate,
    getArchiveRetentionDays,
    isCloudProviderId,
    normalizeProviderSetting,
    otherProvider,
    reconcileProviderOnTierChange,
    safeTier,
    type CloudProviderId,
    type ProviderFootprint,
    type TenantProviderSetting,
} from "@/lib/providerPolicy";

/**
 * Ciclo de vida del proveedor de un tenant: que pasa con los datos del
 * proveedor que se pierde cuando un Enterprise con `provider = 'both'` baja de
 * tier (riesgo abierto #7 de docs/aws-multicloud-handoff.md).
 *
 * Resumen de la politica implementada aca — el detalle esta en
 * `migrations/20260725-005-provider-archive.sql` y en
 * `docs/provider-downgrade-policy.md`:
 *
 *   downgrade  ->  ARCHIVADO (datos intactos, ingesta cortada, export abierto)
 *                  ->  re-upgrade a Enterprise  =>  RESTORED, cero perdida
 *                  ->  vencida la gracia        =>  PURGED, con auditoria
 *
 * RBAC: este modulo NO valida identidad. Es logica de dominio invocada desde
 * webhooks ya autenticados por firma (Paddle/Marketplace), desde el cron
 * autenticado con CRON_SECRET y desde rutas que ya corrieron sus guards de
 * `requestAuth`. No exponerlo directo en un handler sin guard previo.
 */

export interface TenantProviderState {
    tenantId: string;
    tier: string;
    provider: TenantProviderSetting;
    archivedProvider: CloudProviderId | null;
    purgeAt: Date | null;
}

export interface OpenTransition {
    id: number;
    tenantId: string;
    retainedProvider: CloudProviderId;
    archivedProvider: CloudProviderId;
    archivedAt: Date;
    purgeAt: Date;
    notifiedT30At: Date | null;
    notifiedT7At: Date | null;
}

type Executor = Pick<PoolConnection, "query">;

function db(conn?: Executor): Executor {
    return conn ?? (pool as unknown as Executor);
}

/**
 * Predicado SQL para acotar filas de costo a un proveedor.
 *
 * OJO: no es una igualdad simple. `CostSnapshots.ProviderName` se agrego tarde
 * (`ADD COLUMN ProviderName VARCHAR(100) DEFAULT 'Azure'`) y las filas Azure
 * historicas quedaron con NULL o con 'Azure' indistintamente, mientras que el
 * mapper de AWS siempre escribe exactamente 'AWS'. Filtrar Azure por
 * `ProviderName = 'Azure'` dejaria filas sin purgar; filtrar AWS por
 * "distinto de Azure" borraria filas legacy. La unica lectura segura en ambas
 * direcciones es anclar en 'AWS', que si es un valor confiable.
 */
function providerPredicate(provider: CloudProviderId): string {
    return provider === "aws"
        ? "ProviderName = 'AWS'"
        : "(ProviderName IS NULL OR ProviderName <> 'AWS')";
}

export async function getTenantProviderState(
    tenantId: string,
    conn?: Executor
): Promise<TenantProviderState | null> {
    const [rows] = await db(conn).query(
        `SELECT tenant_id, tier, provider, provider_archived, provider_purge_at
           FROM Tenants WHERE tenant_id = ? LIMIT 1`,
        [tenantId]
    );
    const row = (rows as any[])[0];
    if (!row) return null;

    return {
        tenantId: row.tenant_id,
        tier: safeTier(row.tier),
        provider: normalizeProviderSetting(row.provider),
        archivedProvider: isCloudProviderId(row.provider_archived) ? row.provider_archived : null,
        purgeAt: row.provider_purge_at ? new Date(row.provider_purge_at) : null,
    };
}

/**
 * Gasto reciente y cuentas conectadas por proveedor. Es el insumo del
 * desempate automatico cuando el downgrade llega por webhook y nadie eligio.
 *
 * Ventana de 90 dias: suficiente para reflejar el uso real y corta para que un
 * proveedor abandonado hace meses no gane por el peso de su historia.
 *
 * Los montos se devuelven como STRING crudo de MySQL (columna DECIMAL) para no
 * pasar por `number` en ningun punto: `autoElectRetainedProvider` los mete
 * directo en Decimal (Regla Cero).
 */
export async function measureProviderFootprint(
    tenantId: string,
    conn?: Executor
): Promise<ProviderFootprint> {
    const exec = db(conn);

    const [spendRows] = await exec.query(
        `SELECT CASE WHEN ProviderName = 'AWS' THEN 'aws' ELSE 'azure' END AS provider,
                CAST(SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS CHAR) AS total
           FROM CostSnapshots
          WHERE tenant_id = ? AND date >= DATE_SUB(UTC_DATE(), INTERVAL 90 DAY)
          GROUP BY provider`,
        [tenantId]
    );

    const spend = { azure: "0", aws: "0" };
    for (const row of spendRows as Array<{ provider: string; total: string | null }>) {
        if (row.provider === "aws") spend.aws = row.total || "0";
        else spend.azure = row.total || "0";
    }

    const [awsRows] = await exec.query(
        `SELECT COUNT(*) AS c FROM AwsAccounts WHERE tenant_id = ?`,
        [tenantId]
    );
    // Azure no tiene tabla de cuentas: la unidad conectada es la suscripcion,
    // que solo se conoce por los datos ya ingeridos.
    const [azureRows] = await exec.query(
        `SELECT COUNT(DISTINCT subscription_id) AS c
           FROM CostSnapshots
          WHERE tenant_id = ? AND ${providerPredicate("azure")}`,
        [tenantId]
    );

    return {
        spend,
        connectedAccounts: {
            aws: Number((awsRows as any[])[0]?.c || 0),
            azure: Number((azureRows as any[])[0]?.c || 0),
        },
    };
}

async function logAction(
    conn: Executor,
    params: { tenantId: string; actionType: string; resourceId: string; status: string; details: unknown; actor?: string | null }
): Promise<void> {
    try {
        await conn.query(
            `INSERT INTO ActionLogs (tenant_id, user_email, action_type, resource_id, resource_type, status, details)
             VALUES (?, ?, ?, ?, 'tenant_provider', ?, ?)`,
            [
                params.tenantId,
                params.actor || "system",
                params.actionType,
                params.resourceId,
                params.status,
                JSON.stringify(params.details),
            ]
        );
    } catch (e) {
        // La auditoria no debe abortar la transicion, pero si tiene que gritar.
        console.error("[providerLifecycle] audit log failed:", (e as Error)?.message || e);
    }
}

async function findOpenTransition(tenantId: string, conn?: Executor): Promise<OpenTransition | null> {
    const [rows] = await db(conn).query(
        `SELECT id, tenant_id, retained_provider, archived_provider, archived_at, purge_at,
                notified_t30_at, notified_t7_at
           FROM TenantProviderTransitions
          WHERE tenant_id = ? AND status = 'GRACE'
          ORDER BY id DESC LIMIT 1`,
        [tenantId]
    );
    const row = (rows as any[])[0];
    if (!row) return null;
    return {
        id: row.id,
        tenantId: row.tenant_id,
        retainedProvider: row.retained_provider,
        archivedProvider: row.archived_provider,
        archivedAt: new Date(row.archived_at),
        purgeAt: new Date(row.purge_at),
        notifiedT30At: row.notified_t30_at ? new Date(row.notified_t30_at) : null,
        notifiedT7At: row.notified_t7_at ? new Date(row.notified_t7_at) : null,
    };
}

/**
 * Corta la ingesta del proveedor archivado. Deshabilita las cuentas AWS sin
 * borrar credenciales (el archivado es reversible; ver la migracion).
 */
async function suspendIngestion(
    conn: Executor,
    tenantId: string,
    archived: CloudProviderId,
    reason: string
): Promise<void> {
    if (archived !== "aws") return;
    await conn.query(
        `UPDATE AwsAccounts
            SET disabled_at = UTC_TIMESTAMP(), disabled_reason = ?, sync_status = 'ERROR',
                last_error_message = ?
          WHERE tenant_id = ? AND disabled_at IS NULL`,
        [reason, reason, tenantId]
    );
}

async function resumeIngestion(conn: Executor, tenantId: string, provider: CloudProviderId): Promise<void> {
    if (provider !== "aws") return;
    await conn.query(
        `UPDATE AwsAccounts
            SET disabled_at = NULL, disabled_reason = NULL, sync_status = 'NEVER', last_error_message = NULL
          WHERE tenant_id = ? AND disabled_at IS NOT NULL`,
        [tenantId]
    );
}

export interface TierChangeResult {
    action: "none" | "archived" | "restored";
    retainedProvider?: CloudProviderId;
    archivedProvider?: CloudProviderId;
    purgeAt?: Date;
}

/**
 * CHOKE POINT de cambio de tier. Todo lugar que escriba `Tenants.tier` debe
 * llamar a esto DESPUES del UPDATE (Paddle, Azure Marketplace, AWS
 * Marketplace, PATCH de superadmin). Antes de esto, bajar de tier no tenia
 * ningun side-effect y el modelo de proveedor quedaba incoherente.
 *
 * Idempotente: reprocesar el mismo webhook no abre una segunda transicion.
 */
export async function applyTierChange(params: {
    tenantId: string;
    previousTier: string;
    nextTier: string;
    actor?: string | null;
}): Promise<TierChangeResult> {
    const { tenantId, previousTier, nextTier } = params;
    const state = await getTenantProviderState(tenantId);
    if (!state) return { action: "none" };

    const open = await findOpenTransition(tenantId);
    const decision = reconcileProviderOnTierChange({
        previousTier: safeTier(previousTier),
        nextTier: safeTier(nextTier),
        currentProvider: state.provider,
        archivedProvider: state.archivedProvider ?? open?.archivedProvider ?? null,
    });

    if (decision.action === "none") return { action: "none" };

    if (decision.action === "restore") {
        await restoreArchivedProvider({ tenantId, actor: params.actor, reason: "tier_upgrade" });
        return { action: "restored", retainedProvider: decision.provider };
    }

    // Ya hay una transicion abierta: el webhook se esta reprocesando.
    if (open) {
        return {
            action: "archived",
            retainedProvider: open.retainedProvider,
            archivedProvider: open.archivedProvider,
            purgeAt: open.purgeAt,
        };
    }

    const footprint = await measureProviderFootprint(tenantId);
    const retained = autoElectRetainedProvider(footprint);
    const archived = otherProvider(retained);

    const archivedAt = new Date();
    const purgeAt = computePurgeDate(archivedAt, getArchiveRetentionDays());

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await connection.query(
            `UPDATE Tenants SET provider = ?, provider_archived = ?, provider_purge_at = ?
              WHERE tenant_id = ?`,
            [retained, archived, purgeAt, tenantId]
        );

        await connection.query(
            `INSERT INTO TenantProviderTransitions
                (tenant_id, from_tier, to_tier, from_provider, retained_provider, archived_provider,
                 election_source, status, archived_at, purge_at)
             VALUES (?, ?, ?, 'both', ?, ?, 'auto', 'GRACE', ?, ?)`,
            [tenantId, safeTier(previousTier), safeTier(nextTier), retained, archived, archivedAt, purgeAt]
        );

        await suspendIngestion(connection, tenantId, archived, "provider_archived_after_downgrade");

        await logAction(connection, {
            tenantId,
            actionType: "PROVIDER_ARCHIVED",
            resourceId: archived,
            status: "SUCCESS",
            actor: params.actor,
            details: {
                previousTier: safeTier(previousTier),
                nextTier: safeTier(nextTier),
                retained,
                archived,
                purgeAt: purgeAt.toISOString(),
                electionSource: "auto",
                footprint,
            },
        });

        await connection.commit();
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }

    await notifyArchived(tenantId, archived, retained, purgeAt);

    return { action: "archived", retainedProvider: retained, archivedProvider: archived, purgeAt };
}

/**
 * Corrige la eleccion automatica durante la ventana de gracia: invierte cual
 * proveedor se retiene y cual queda archivado, sin perder datos de ninguno
 * (nada se borro todavia) y sin reiniciar el reloj de la purga — la fecha
 * limite la fija el downgrade, no la eleccion.
 */
export async function electRetainedProvider(params: {
    tenantId: string;
    retained: CloudProviderId;
    source: "user" | "superadmin";
    actor?: string | null;
}): Promise<{ changed: boolean; retained: CloudProviderId; archived: CloudProviderId; purgeAt: Date }> {
    const open = await findOpenTransition(params.tenantId);
    if (!open) {
        throw new Error("No hay una transición de proveedor abierta para este tenant.");
    }

    const archived = otherProvider(params.retained);
    if (open.retainedProvider === params.retained) {
        return { changed: false, retained: params.retained, archived, purgeAt: open.purgeAt };
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await connection.query(
            `UPDATE Tenants SET provider = ?, provider_archived = ? WHERE tenant_id = ?`,
            [params.retained, archived, params.tenantId]
        );
        await connection.query(
            `UPDATE TenantProviderTransitions
                SET retained_provider = ?, archived_provider = ?, election_source = ?
              WHERE id = ? AND status = 'GRACE'`,
            [params.retained, archived, params.source, open.id]
        );

        // El que pasa a retenido vuelve a sincronizar; el que pasa a archivado se corta.
        await resumeIngestion(connection, params.tenantId, params.retained);
        await suspendIngestion(connection, params.tenantId, archived, "provider_archived_after_downgrade");

        await logAction(connection, {
            tenantId: params.tenantId,
            actionType: "PROVIDER_ELECTION_CHANGED",
            resourceId: params.retained,
            status: "SUCCESS",
            actor: params.actor,
            details: {
                previousRetained: open.retainedProvider,
                retained: params.retained,
                archived,
                purgeAt: open.purgeAt.toISOString(),
                source: params.source,
            },
        });

        await connection.commit();
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }

    return { changed: true, retained: params.retained, archived, purgeAt: open.purgeAt };
}

/**
 * Deshace el archivado sin perdida. Se dispara solo al volver a un tier con
 * derecho a los dos proveedores, siempre que la purga no haya corrido.
 */
export async function restoreArchivedProvider(params: {
    tenantId: string;
    actor?: string | null;
    reason: string;
}): Promise<boolean> {
    const open = await findOpenTransition(params.tenantId);
    if (!open) return false;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await connection.query(
            `UPDATE Tenants SET provider = 'both', provider_archived = NULL, provider_purge_at = NULL
              WHERE tenant_id = ?`,
            [params.tenantId]
        );
        await connection.query(
            `UPDATE TenantProviderTransitions
                SET status = 'RESTORED', resolved_at = UTC_TIMESTAMP()
              WHERE id = ? AND status = 'GRACE'`,
            [open.id]
        );

        await resumeIngestion(connection, params.tenantId, open.archivedProvider);

        await logAction(connection, {
            tenantId: params.tenantId,
            actionType: "PROVIDER_RESTORED",
            resourceId: open.archivedProvider,
            status: "SUCCESS",
            actor: params.actor,
            details: { reason: params.reason, restored: open.archivedProvider, wouldHavePurgedAt: open.purgeAt.toISOString() },
        });

        await connection.commit();
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }

    await createNotification({
        tenantId: params.tenantId,
        title: "Proveedor restaurado",
        message: `Se restauró el acceso y la sincronización de ${open.archivedProvider.toUpperCase()}. No se perdió ningún dato histórico.`,
        href: "/admin/cloud-accounts",
        severity: "info",
        source: "provider-lifecycle",
    });

    return true;
}

/** Filas borradas por tabla, para la evidencia de auditoria. */
export interface PurgeCounts {
    FocusLineItems: number;
    CostSnapshots: number;
    AwsAccounts: number;
}

/**
 * Purga definitiva de los datos del proveedor archivado, vencida la gracia.
 *
 * Se borra en lotes acotados y en transacciones cortas por tabla: un DELETE
 * plano sobre FocusLineItems puede ser de millones de filas (grain
 * recurso/hora) y bloquear la tabla el tiempo suficiente para tumbar el sync
 * de todos los demas tenants.
 */
export async function purgeArchivedProvider(
    transition: OpenTransition,
    options?: { batchSize?: number; maxBatches?: number }
): Promise<PurgeCounts> {
    const batchSize = options?.batchSize ?? 5000;
    const maxBatches = options?.maxBatches ?? 400;
    const archived = transition.archivedProvider;
    const counts: PurgeCounts = { FocusLineItems: 0, CostSnapshots: 0, AwsAccounts: 0 };

    for (const table of ["FocusLineItems", "CostSnapshots"] as const) {
        for (let i = 0; i < maxBatches; i++) {
            const [res] = await pool.query(
                `DELETE FROM ${table}
                  WHERE tenant_id = ? AND ${providerPredicate(archived)}
                  LIMIT ?`,
                [transition.tenantId, batchSize]
            );
            const affected = (res as any)?.affectedRows || 0;
            counts[table] += affected;
            if (affected < batchSize) break;
        }
    }

    if (archived === "aws") {
        // Recien aca se destruyen las credenciales: el role_arn y el
        // external_id cifrado se sostuvieron toda la gracia para que una
        // restauracion no exigiera re-onboarding.
        const [res] = await pool.query(`DELETE FROM AwsAccounts WHERE tenant_id = ?`, [transition.tenantId]);
        counts.AwsAccounts = (res as any)?.affectedRows || 0;
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query(
            `UPDATE TenantProviderTransitions
                SET status = 'PURGED', resolved_at = UTC_TIMESTAMP(), purged_rows = ?
              WHERE id = ? AND status = 'GRACE'`,
            [JSON.stringify(counts), transition.id]
        );
        await connection.query(
            `UPDATE Tenants SET provider_archived = NULL, provider_purge_at = NULL WHERE tenant_id = ?`,
            [transition.tenantId]
        );
        await logAction(connection, {
            tenantId: transition.tenantId,
            actionType: "PROVIDER_DATA_PURGED",
            resourceId: archived,
            status: "SUCCESS",
            details: {
                archived,
                retained: transition.retainedProvider,
                archivedAt: transition.archivedAt.toISOString(),
                purgeAt: transition.purgeAt.toISOString(),
                counts,
            },
        });
        await connection.commit();
    } catch (e) {
        await connection.rollback();
        throw e;
    } finally {
        connection.release();
    }

    return counts;
}

export async function listTransitionsDueForPurge(now: Date, limit = 25): Promise<OpenTransition[]> {
    const [rows] = await pool.query(
        `SELECT id, tenant_id, retained_provider, archived_provider, archived_at, purge_at,
                notified_t30_at, notified_t7_at
           FROM TenantProviderTransitions
          WHERE status = 'GRACE' AND purge_at <= ?
          ORDER BY purge_at ASC LIMIT ?`,
        [now, limit]
    );
    return (rows as any[]).map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        retainedProvider: row.retained_provider,
        archivedProvider: row.archived_provider,
        archivedAt: new Date(row.archived_at),
        purgeAt: new Date(row.purge_at),
        notifiedT30At: row.notified_t30_at ? new Date(row.notified_t30_at) : null,
        notifiedT7At: row.notified_t7_at ? new Date(row.notified_t7_at) : null,
    }));
}

export async function listTransitionsInGrace(limit = 200): Promise<OpenTransition[]> {
    const [rows] = await pool.query(
        `SELECT id, tenant_id, retained_provider, archived_provider, archived_at, purge_at,
                notified_t30_at, notified_t7_at
           FROM TenantProviderTransitions
          WHERE status = 'GRACE'
          ORDER BY purge_at ASC LIMIT ?`,
        [limit]
    );
    return (rows as any[]).map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        retainedProvider: row.retained_provider,
        archivedProvider: row.archived_provider,
        archivedAt: new Date(row.archived_at),
        purgeAt: new Date(row.purge_at),
        notifiedT30At: row.notified_t30_at ? new Date(row.notified_t30_at) : null,
        notifiedT7At: row.notified_t7_at ? new Date(row.notified_t7_at) : null,
    }));
}

export async function markReminderSent(transitionId: number, milestone: number): Promise<void> {
    const column = milestone === 30 ? "notified_t30_at" : "notified_t7_at";
    await pool.query(
        `UPDATE TenantProviderTransitions SET ${column} = UTC_TIMESTAMP() WHERE id = ?`,
        [transitionId]
    );
}

async function tenantAdminEmails(tenantId: string): Promise<string[]> {
    const [rows] = await pool.query(
        `SELECT email FROM Users WHERE tenant_id = ? AND role IN ('Admin','Owner','ADMIN','OWNER') AND email IS NOT NULL`,
        [tenantId]
    );
    return (rows as Array<{ email: string }>).map((r) => r.email).filter(Boolean);
}

async function notifyArchived(
    tenantId: string,
    archived: CloudProviderId,
    retained: CloudProviderId,
    purgeAt: Date
): Promise<void> {
    const label = archived.toUpperCase();
    const deadline = purgeAt.toISOString().slice(0, 10);

    await createNotification({
        tenantId,
        title: `Datos de ${label} en modo archivado`,
        message:
            `Tu plan ya no incluye dos proveedores, así que se conservó ${retained.toUpperCase()} como proveedor activo. ` +
            `Los datos históricos de ${label} siguen disponibles para exportar hasta el ${deadline}; después se eliminan. ` +
            `Si volvés a Enterprise antes de esa fecha se restauran automáticamente.`,
        href: "/admin/cloud-accounts",
        severity: "warning",
        source: "provider-lifecycle",
    });

    const emails = await tenantAdminEmails(tenantId);
    for (const email of emails) {
        sendEmailAsync(
            `Acción requerida: tus datos de ${label} se archivaron`,
            getProviderArchivedEmailHtml({ archived: label, retained: retained.toUpperCase(), deadline }),
            email
        );
    }
}

export async function notifyPurgeReminder(
    transition: OpenTransition,
    daysLeft: number
): Promise<void> {
    const label = transition.archivedProvider.toUpperCase();
    const deadline = transition.purgeAt.toISOString().slice(0, 10);

    await createNotification({
        tenantId: transition.tenantId,
        title: `Quedan ${daysLeft} días para exportar tus datos de ${label}`,
        message: `El ${deadline} se eliminan definitivamente los datos históricos de ${label}. Exportalos o volvé a Enterprise para conservarlos.`,
        href: "/admin/cloud-accounts",
        severity: daysLeft <= 7 ? "critical" : "warning",
        source: "provider-lifecycle",
    });

    const emails = await tenantAdminEmails(transition.tenantId);
    for (const email of emails) {
        sendEmailAsync(
            `Quedan ${daysLeft} días para exportar tus datos de ${label}`,
            getProviderPurgeReminderEmailHtml({ archived: label, deadline, daysLeft }),
            email
        );
    }
}

function emailShell(inner: string): string {
    return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;color:#0E1A2B">
        <h2 style="color:#0E1A2B">CSCloudSolutions FinOps</h2>${inner}
        <p style="font-size:12px;color:#64748b;margin-top:24px">CSCloudSolutions</p>
    </div>`;
}

export function getProviderArchivedEmailHtml(params: {
    archived: string;
    retained: string;
    deadline: string;
}): string {
    return emailShell(`
        <p>Tu plan actual incluye un solo proveedor de nube, así que mantuvimos <strong>${params.retained}</strong> como proveedor activo.</p>
        <p>Los datos de <strong>${params.archived}</strong> <strong>no se borraron</strong>. Quedaron en modo archivado:
           podés consultarlos y exportarlos en formato FOCUS hasta el <strong>${params.deadline}</strong>.
           La sincronización de ${params.archived} está detenida.</p>
        <p>Pasada esa fecha se eliminan de forma definitiva. Si volvés al plan Enterprise antes,
           se restauran automáticamente sin pérdida.</p>
        <p>¿Elegimos mal el proveedor a conservar? Podés invertir la elección desde Cuentas Cloud
           mientras dure la ventana.</p>`);
}

export function getProviderPurgeReminderEmailHtml(params: {
    archived: string;
    deadline: string;
    daysLeft: number;
}): string {
    return emailShell(`
        <p>Quedan <strong>${params.daysLeft} días</strong> para descargar tus datos históricos de
           <strong>${params.archived}</strong>.</p>
        <p>El <strong>${params.deadline}</strong> se eliminan de forma definitiva y no se pueden recuperar.</p>
        <p>Podés exportarlos en formato FOCUS desde la plataforma, o volver al plan Enterprise para conservarlos.</p>`);
}

export { canIngestProvider, canReadProvider };

/**
 * Error de negocio: el tenant no puede ingerir datos de este proveedor porque
 * su plan no lo incluye o porque el proveedor quedó archivado tras un
 * downgrade. Se distingue de `AuthError` a propósito: no es un problema de
 * identidad ni de permisos del usuario, es un estado del tenant, y el mensaje
 * tiene que ser accionable (cómo recuperarlo) en vez de un 403 seco.
 */
export class ProviderDisabledError extends Error {
    readonly status = 409;
    constructor(
        message: string,
        readonly provider: CloudProviderId,
        readonly purgeAt: Date | null
    ) {
        super(message);
        this.name = "ProviderDisabledError";
    }
}

/**
 * Guard de ingesta por proveedor. Llamar en toda ruta que dé de alta cuentas o
 * dispare un sync, DESPUÉS del guard de identidad de `requestAuth`
 * correspondiente — este no valida quién es el caller, solo qué puede hacer el
 * tenant con este proveedor.
 */
export async function assertProviderIngestable(
    tenantId: string,
    provider: CloudProviderId
): Promise<void> {
    const state = await getTenantProviderState(tenantId);
    if (!state) throw new ProviderDisabledError("Tenant no encontrado.", provider, null);

    if (canIngestProvider(state.provider, state.archivedProvider, provider)) return;

    if (state.archivedProvider === provider) {
        const deadline = state.purgeAt ? state.purgeAt.toISOString().slice(0, 10) : null;
        throw new ProviderDisabledError(
            `La sincronización de ${provider.toUpperCase()} está detenida porque tu plan actual incluye un solo proveedor. ` +
                `Tus datos históricos siguen disponibles para exportar` +
                (deadline ? ` hasta el ${deadline}` : "") +
                `. Volvé al plan Enterprise para reactivarla sin pérdida de datos.`,
            provider,
            state.purgeAt
        );
    }

    throw new ProviderDisabledError(
        `Tu tenant está configurado para ${state.provider.toUpperCase()}. ` +
            `Agregar ${provider.toUpperCase()} requiere el plan Enterprise.`,
        provider,
        null
    );
}
