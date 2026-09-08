/**
 * Resolución del texto de una notificación en el cliente.
 *
 * Vive acá y no en un hook porque hay **dos** consumidores de la misma fila y
 * antes sólo uno traducía: `useBrowserNotifications` (push del navegador +
 * Centro de Acciones) y `NotificationBellDropdown` (la campanita del header).
 */

/** Fila cruda de `Notifications` tal como la devuelve `/api/notifications`. */
export type NotificacionCruda = {
    id: number;
    title: string;
    message: string;
    title_key: string | null;
    message_key: string | null;
    /** JSON de MySQL: puede llegar como objeto o como string segun el driver. */
    params_json: Record<string, string | number> | string | null;
    href: string | null;
    severity: string;
};

/**
 * Texto de una notificacion: la clave i18n si la fila la trae, el texto guardado
 * si no.
 *
 * Las filas de Notifications son **permanentes**, y las anteriores al
 * 2026-09-08 solo tienen la frase en castellano — no hay nada con lo que
 * retraducirlas. Por eso el fallback no es una degradacion temporal como en los
 * payloads cacheados: es el comportamiento definitivo para esas filas.
 *
 * El try/catch cubre dos cosas reales: que falte la clave en el catalogo, y que
 * `params_json` no traiga un parametro que el mensaje pide (una fila vieja con
 * clave nueva, si alguien alguna vez migra a medias). En los dos casos vale mas
 * mostrar el texto guardado que un `FORMATTING_ERROR`, que en un render tumba el
 * arbol entero.
 */
export function textoDeNotificacion(
    clave: string | null | undefined,
    params: Record<string, string | number> | string | null | undefined,
    respaldo: string,
    t: (key: string, values?: Record<string, string | number>) => string,
): string {
    if (!clave) return respaldo;
    try {
        const valores = typeof params === "string" ? JSON.parse(params) : params;
        return t(clave, valores ?? {});
    } catch {
        return respaldo;
    }
}
