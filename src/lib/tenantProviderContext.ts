/**
 * Proveedores activos de un tenant, para el request path.
 *
 * POR QUE EXISTE
 * --------------
 * Buena parte del panel nacio 100% Azure y llama en vivo a Azure Cost
 * Management / Resource Graph, con fallback a la base cuando Azure no responde.
 * Para un tenant AWS esas llamadas no pueden funcionar: no hay Service
 * Principal ni suscripciones. Sin este chequeo el usuario paga el timeout
 * completo de cada llamada antes de ver el fallback, y los logs se llenan de
 * "Azure unavailable" que no son incidentes sino la configuracion esperada.
 *
 * Con esto, una ruta puede preguntar "este tenant usa Azure?" y saltear el
 * camino live, cayendo directo al de base de datos — que el sync de AWS ya
 * alimenta, porque escribe en CostSnapshots igual que el de Azure.
 *
 * RBAC: no expone datos; solo lee la columna `provider` del propio tenant que
 * el caller ya autorizo con un guard de requestAuth. No es un guard en si mismo
 * y no debe usarse como tal.
 */

import pool from '@/modules/storage/db';
import type { RowDataPacket } from 'mysql2';
import { normalizeProviderSetting, type CloudProviderId, type TenantProviderSetting } from '@/lib/providerPolicy';

export interface TenantProviders {
    setting: TenantProviderSetting;
    azure: boolean;
    aws: boolean;
}

/**
 * Cache en memoria del proceso. El provider de un tenant cambia como mucho
 * cuando alguien toca el tier o hace un downgrade, no en el request path, asi
 * que un TTL corto evita una query por request sin volver rancio el dato.
 * Deliberadamente NO se usa Redis: es un dato diminuto y el costo de la red
 * seria mayor que el de la query.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: TenantProviders; expiresAt: number }>();

/** Tenant sin fila o con base caida: se asume Azure, que es el comportamiento historico. */
const FALLBACK: TenantProviders = { setting: 'azure', azure: true, aws: false };

function fromSetting(setting: TenantProviderSetting): TenantProviders {
    return {
        setting,
        azure: true,
        aws: false,
    };
}

export async function getTenantProviders(tenantId: string): Promise<TenantProviders> {
    const cached = cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    try {
        const [rows] = await pool.query<RowDataPacket[]>(
            'SELECT provider FROM Tenants WHERE tenant_id = ? LIMIT 1',
            [tenantId]
        );
        const row = rows[0];
        // Sin fila no se cachea: puede ser un tenant recien creado en otra
        // conexion, y fijar "azure" por un minuto lo dejaria mal clasificado.
        if (!row) return FALLBACK;

        const value = fromSetting(normalizeProviderSetting(row.provider));
        cache.set(tenantId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        return value;
    } catch {
        // Un fallo de base no debe cambiar el comportamiento del panel: se
        // degrada al historico (Azure) y se reintenta en el proximo request.
        return FALLBACK;
    }
}

/** Atajo para el patron mas comun: saltear el camino live de Azure. */
export async function tenantUsesAzure(tenantId: string): Promise<boolean> {
    return (await getTenantProviders(tenantId)).azure;
}

export async function tenantUsesAws(tenantId: string): Promise<boolean> {
    return (await getTenantProviders(tenantId)).aws;
}

export function providerIdsFor(providers: TenantProviders): CloudProviderId[] {
    const ids: CloudProviderId[] = [];
    if (providers.azure) ids.push('azure');
    return ids;
}

/**
 * Invalida el cache de un tenant. Debe llamarse cuando cambia `provider`
 * (cambio de tier, downgrade, alta de proveedor): si no, el panel seguiria
 * comportandose como el proveedor viejo hasta un minuto despues.
 */
export function invalidateTenantProviders(tenantId: string): void {
    cache.delete(tenantId);
}

/** Solo para tests: limpia todo el cache entre casos. */
export function __clearTenantProvidersCache(): void {
    cache.clear();
}
