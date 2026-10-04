/**
 * Claves de caché que se ESCRIBEN en una ruta y se INVALIDAN desde otra. Viven
 * acá para que subir la versión en un lado no deje al otro borrando una clave
 * que ya nadie lee.
 *
 * Hoy las invalida, además de sus propias escrituras, el cambio de año fiscal
 * (`/api/admin/tenant-settings`): los dos tableros cortan acumulados por él.
 */

/**
 * GET /api/intelligence/cost-centers.
 * v3: suma `rolloverEnabled`/`rolloverCapUsd`. Un v2 cacheado no los trae y la
 * tabla, al editar, mandaría el arrastre como apagado.
 */
export function costCentersCacheKey(tenantId: string): string {
    return `cost-centers:v3:${tenantId}`;
}

/** El Whiteboard de un tenant; la clave completa suma idioma y rango. */
export function whiteboardCachePrefix(tenantId: string): string {
    return `whiteboard:v5:azure:${tenantId}`;
}
