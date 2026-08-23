/**
 * copilotM365Integration.service — Microsoft Graph External Connections real.
 *
 * Reemplaza la implementación anterior, que era una fachada: generaba el
 * connectionId con Math.random(), escribía indexed_records = 12500 fijo y
 * "reindexar" sólo movía una fecha. Un tenant real veía 12.500 registros
 * indexados que nunca existieron.
 *
 * Acá cada operación pega contra Graph de verdad:
 *   PUT    /external/connections/{id}              crear conexión
 *   PATCH  /external/connections/{id}/schema       registrar schema
 *   PUT    /external/connections/{id}/items/{key}  indexar un item
 *   DELETE /external/connections/{id}              revocar
 *
 * Requiere el permiso de aplicación `ExternalConnection.ReadWrite.OwnedBy`. Si
 * el Service Principal no lo tiene, Graph responde 403 y eso se propaga como
 * tal: es información accionable para el admin, no algo que haya que esconder
 * detrás de un éxito simulado.
 *
 * RBAC: no valida identidad; las rutas resuelven el guard antes de llamar.
 */
import pool from '@/modules/storage/db';
import { getAzureCredential } from '@/lib/azure';
import { errorMessage } from '@/lib/apiErrors';
import Decimal from 'decimal.js';
import {
    buildConnectionId,
    connectorStatusFromDb,
    connectorStatusToDb,
    M365_SCHEMA_VERSION,
    REQUIRED_GRAPH_PERMISSION,
    type M365ConnectorStatus,
    type ReindexResponse,
    type TenantM365CopilotSettings,
} from '@/types/copilotM365Integration.types';

const GRAPH = 'https://graph.microsoft.com/v1.0';
/** Graph acepta como máximo este lote por conexión antes de throttlear. */
const MAX_ITEMS_PER_RUN = 500;

export class GraphPermissionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GraphPermissionError';
    }
}

async function graphToken(tenantId: string): Promise<string> {
    const credential = await getAzureCredential(tenantId);
    const tok = await credential.getToken('https://graph.microsoft.com/.default');
    if (!tok?.token) throw new Error('No se pudo autenticar con Microsoft Graph');
    return tok.token;
}

async function graphFetch(
    token: string,
    method: string,
    path: string,
    body?: unknown
): Promise<{ ok: boolean; status: number; json: any; text: string }> {
    const res = await fetch(`${GRAPH}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text().catch(() => '');
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* respuesta sin cuerpo JSON */ }

    // 403 casi siempre es el permiso faltante; se distingue para que la UI
    // pueda decir qué consentir en vez de "error genérico".
    if (res.status === 403) {
        throw new GraphPermissionError(
            `Microsoft Graph rechazó la operación (403). Falta el permiso de aplicación ${REQUIRED_GRAPH_PERMISSION} ` +
            `en el Service Principal, o no fue consentido por un administrador del tenant. ` +
            (json?.error?.message ? `Detalle: ${json.error.message}` : '')
        );
    }
    return { ok: res.ok, status: res.status, json, text };
}

/** Schema FOCUS que se registra en Graph para que Copilot pueda razonar sobre los costos. */
const CONNECTION_SCHEMA = {
    baseType: 'microsoft.graph.externalItem',
    properties: [
        { name: 'title', type: 'String', isSearchable: true, isRetrievable: true, labels: ['title'] },
        { name: 'description', type: 'String', isSearchable: true, isRetrievable: true },
        { name: 'costUSD', type: 'Double', isRetrievable: true, isQueryable: true },
        { name: 'serviceName', type: 'String', isSearchable: true, isRetrievable: true, isQueryable: true },
        { name: 'subscriptionId', type: 'String', isRetrievable: true, isQueryable: true },
        { name: 'recordDate', type: 'DateTime', isRetrievable: true, isQueryable: true },
        { name: 'recordKind', type: 'String', isRetrievable: true, isQueryable: true },
        { name: 'url', type: 'String', isRetrievable: true, labels: ['url'] },
    ],
};

// ─── Estado local ────────────────────────────────────────────────────────────

export async function getSettings(tenantId: string): Promise<TenantM365CopilotSettings> {
    const [rows] = await pool.query<any[]>(
        'SELECT * FROM M365CopilotConfig WHERE tenant_id = ? LIMIT 1',
        [tenantId]
    );
    const row = rows?.[0];
    const extra = (() => {
        if (!row?.config) return {};
        try { return typeof row.config === 'string' ? JSON.parse(row.config) : row.config; } catch { return {}; }
    })();

    const lastIndexed = row?.last_index_at ? new Date(row.last_index_at) : null;

    return {
        tenantId,
        connectionId: row?.connector_id || null,
        connectionName: extra.connectionName ?? null,
        connectorStatus: connectorStatusFromDb(row?.connector_status),
        agentStatus: extra.agentStatus ?? 'CONFIGURING',
        // null si nunca se indexó: distinto de 0 registros indexados.
        totalIndexedRecordsCount: row?.last_index_at ? Number(row?.indexed_records ?? 0) : null,
        lastIndexedAtIso: lastIndexed ? lastIndexed.toISOString() : null,
        formattedLastIndexedDate: lastIndexed
            ? lastIndexed.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : null,
        lastIndexError: extra.lastIndexError ?? null,
        schemaVersion: extra.schemaVersion ?? null,
    };
}

async function persist(
    tenantId: string,
    fields: { connectionId?: string | null; status?: M365ConnectorStatus; indexedRecords?: number; touchIndexedAt?: boolean },
    extra?: Record<string, unknown>
): Promise<void> {
    const current = await getSettings(tenantId);
    const mergedExtra = {
        connectionName: current.connectionName,
        agentStatus: current.agentStatus,
        lastIndexError: current.lastIndexError,
        schemaVersion: current.schemaVersion,
        ...(extra || {}),
    };

    await pool.query(
        `INSERT INTO M365CopilotConfig
            (tenant_id, connector_id, connector_status, indexed_records, last_index_at, config)
         VALUES (?, ?, ?, ?, ${fields.touchIndexedAt ? 'UTC_TIMESTAMP()' : 'NULL'}, ?)
         ON DUPLICATE KEY UPDATE
            connector_id = VALUES(connector_id),
            connector_status = VALUES(connector_status),
            indexed_records = VALUES(indexed_records),
            ${fields.touchIndexedAt ? 'last_index_at = UTC_TIMESTAMP(),' : ''}
            config = VALUES(config)`,
        [
            tenantId,
            fields.connectionId !== undefined ? fields.connectionId : current.connectionId,
            connectorStatusToDb(fields.status ?? current.connectorStatus),
            fields.indexedRecords ?? current.totalIndexedRecordsCount ?? 0,
            JSON.stringify(mergedExtra),
        ]
    );
}

async function logIndexRun(
    tenantId: string,
    entry: { triggerType: 'MANUAL' | 'SCHEDULED'; items: number; durationMs: number; httpStatus: number | null; status: 'SUCCESS' | 'FAILED'; error?: string | null }
): Promise<void> {
    try {
        await pool.query(
            `INSERT INTO M365IndexLogs
                (tenant_id, trigger_type, items_processed_count, duration_ms, http_status_code, status, error_message)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [tenantId, entry.triggerType, entry.items, entry.durationMs, entry.httpStatus, entry.status, entry.error ?? null]
        );
    } catch (err) {
        // Perder una línea de bitácora no puede tumbar la indexación.
        console.warn('[copilotM365] no se pudo registrar la corrida de indexación:', errorMessage(err));
    }
}

// ─── Operaciones contra Graph ────────────────────────────────────────────────

/** Crea la conexión externa y registra el schema. Idempotente. */
export async function provisionConnection(tenantId: string, displayName?: string): Promise<TenantM365CopilotSettings> {
    const token = await graphToken(tenantId);
    const connectionId = buildConnectionId(tenantId);
    const name = displayName || 'CSCloudSolutions FinOps';

    const created = await graphFetch(token, 'PATCH', `/external/connections/${connectionId}`, {
        id: connectionId,
        name,
        description: 'Telemetría FinOps de Azure (costos, presupuestos, anomalías) indexada para Microsoft Search y Copilot.',
    });

    // 404 = todavía no existe; se crea con POST sobre la colección.
    if (!created.ok && created.status === 404) {
        const post = await graphFetch(token, 'POST', '/external/connections', {
            id: connectionId,
            name,
            description: 'Telemetría FinOps de Azure indexada para Microsoft Search y Copilot.',
        });
        if (!post.ok) {
            await persist(tenantId, { status: 'ERROR' }, { lastIndexError: `No se pudo crear la conexión (${post.status}): ${post.json?.error?.message || post.text}` });
            throw new Error(`Microsoft Graph rechazó la creación de la conexión (${post.status}): ${post.json?.error?.message || post.text}`);
        }
    } else if (!created.ok && created.status !== 409) {
        await persist(tenantId, { status: 'ERROR' }, { lastIndexError: `${created.status}: ${created.json?.error?.message || created.text}` });
        throw new Error(`Microsoft Graph rechazó la conexión (${created.status}): ${created.json?.error?.message || created.text}`);
    }

    // El registro del schema es asíncrono en Graph; un 202 es éxito.
    const schema = await graphFetch(token, 'PATCH', `/external/connections/${connectionId}/schema`, CONNECTION_SCHEMA);
    if (!schema.ok && schema.status !== 202 && schema.status !== 409) {
        await persist(tenantId, { connectionId, status: 'ERROR' }, { lastIndexError: `Schema (${schema.status}): ${schema.json?.error?.message || schema.text}` });
        throw new Error(`Microsoft Graph rechazó el schema (${schema.status}): ${schema.json?.error?.message || schema.text}`);
    }

    await persist(
        tenantId,
        { connectionId, status: 'SYNCING' },
        { connectionName: name, schemaVersion: M365_SCHEMA_VERSION, lastIndexError: null, agentStatus: 'CONFIGURING' }
    );
    return getSettings(tenantId);
}

/** Filas reales del tenant que se publican a Graph. */
async function collectItems(tenantId: string): Promise<Array<Record<string, any>>> {
    const [costRows] = await pool.query<any[]>(
        `SELECT DATE(COALESCE(ChargePeriodStart, date)) AS d,
                COALESCE(service_name,'(sin servicio)') AS service,
                COALESCE(subscription_id,'') AS sub,
                SUM(COALESCE(BilledCost, cost_usd, 0)) AS cost
         FROM CostSnapshots
         WHERE tenant_id = ?
           AND COALESCE(ChargePeriodStart, date) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         GROUP BY d, service, sub
         ORDER BY d DESC
         LIMIT ?`,
        [tenantId, MAX_ITEMS_PER_RUN]
    );

    return (costRows || []).map((r) => {
        const date = new Date(r.d);
        const cost = new Decimal(r.cost || 0).toDecimalPlaces(2).toNumber();
        const day = date.toISOString().slice(0, 10);
        return {
            key: `cost-${day}-${String(r.sub).slice(0, 8)}-${String(r.service).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`,
            title: `${r.service} — ${day}`,
            description: `Costo de ${r.service} el ${day}: USD ${cost.toFixed(2)}.`,
            costUSD: cost,
            serviceName: String(r.service),
            subscriptionId: String(r.sub),
            recordDate: date.toISOString(),
            recordKind: 'costSnapshot',
        };
    });
}

/** Indexa la telemetría del tenant en Graph. Devuelve el conteo REAL publicado. */
export async function reindex(tenantId: string, triggerType: 'MANUAL' | 'SCHEDULED' = 'MANUAL'): Promise<ReindexResponse> {
    const startedAt = Date.now();
    const settings = await getSettings(tenantId);
    if (!settings.connectionId) {
        throw new Error('No hay una conexión de Graph creada para este tenant. Creá el conector antes de indexar.');
    }

    const token = await graphToken(tenantId);
    const items = await collectItems(tenantId);
    let processed = 0;
    let lastStatus: number | null = null;

    for (const item of items) {
        const { key, ...properties } = item;
        const res = await graphFetch(token, 'PUT', `/external/connections/${settings.connectionId}/items/${key}`, {
            acl: [{ accessType: 'grant', type: 'everyone', value: 'everyone' }],
            properties,
            content: { value: properties.description, type: 'text' },
        });
        lastStatus = res.status;
        if (res.ok || res.status === 200 || res.status === 204) processed++;
    }

    const durationMs = Date.now() - startedAt;

    // El contador que se guarda es el de items efectivamente aceptados por
    // Graph, no una constante ni el total local.
    await persist(
        tenantId,
        { status: processed > 0 ? 'READY' : 'ERROR', indexedRecords: processed, touchIndexedAt: true },
        {
            lastIndexError: processed === 0 && items.length > 0
                ? 'Graph no aceptó ningún item en esta corrida.'
                : null,
            agentStatus: processed > 0 ? 'READY' : 'CONFIGURING',
        }
    );

    await logIndexRun(tenantId, {
        triggerType, items: processed, durationMs, httpStatus: lastStatus,
        status: processed > 0 || items.length === 0 ? 'SUCCESS' : 'FAILED',
    });

    return {
        success: processed > 0 || items.length === 0,
        itemsProcessed: processed,
        durationMs,
        indexedAtIso: new Date().toISOString(),
        message: items.length === 0
            ? 'No hay telemetría de costos de los últimos 90 días para indexar.'
            : `${processed} de ${items.length} registros publicados en Microsoft Graph.`,
    };
}

/** Elimina la conexión en Graph y limpia el estado local. */
export async function revokeConnection(tenantId: string): Promise<void> {
    const settings = await getSettings(tenantId);
    if (!settings.connectionId) {
        await persist(tenantId, { connectionId: null, status: 'NOT_CONFIGURED', indexedRecords: 0 });
        return;
    }

    const token = await graphToken(tenantId);
    const res = await graphFetch(token, 'DELETE', `/external/connections/${settings.connectionId}`);
    // 404 = ya no existe del lado de Graph; el objetivo igual se cumple.
    if (!res.ok && res.status !== 404) {
        throw new Error(`Microsoft Graph rechazó la eliminación (${res.status}): ${res.json?.error?.message || res.text}`);
    }

    await persist(
        tenantId,
        { connectionId: null, status: 'NOT_CONFIGURED', indexedRecords: 0 },
        { connectionName: null, lastIndexError: null, schemaVersion: null, agentStatus: 'DISABLED' }
    );
}

export async function getIndexLogs(tenantId: string, limit = 10) {
    try {
        const [rows] = await pool.query<any[]>(
            `SELECT id, trigger_type, items_processed_count, duration_ms, http_status_code, status, error_message, created_at
             FROM M365IndexLogs WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`,
            [tenantId, limit]
        );
        return (rows || []).map((r) => ({
            id: String(r.id),
            triggerType: r.trigger_type,
            itemsProcessedCount: Number(r.items_processed_count || 0),
            durationMs: Number(r.duration_ms || 0),
            httpStatusCode: r.http_status_code == null ? null : Number(r.http_status_code),
            status: r.status,
            errorMessage: r.error_message || null,
            createdAtIso: r.created_at ? new Date(r.created_at).toISOString() : '',
        }));
    } catch (err: any) {
        if (err?.code === 'ER_NO_SUCH_TABLE') return [];
        throw err;
    }
}
