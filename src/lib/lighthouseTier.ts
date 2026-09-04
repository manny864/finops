/**
 * Azure Lighthouse es una capacidad de Enterprise.
 *
 * POR QUE ACA Y NO EN `routeTiers`
 * `routeTiers` ya declaraba `/admin/onboarding/lighthouse` como Enterprise,
 * pero ese gate no se aplicaba nunca: el panel dejo de ser una pagina propia y
 * hoy vive como pestaña de `/admin/access`. `RouteTierGate` resuelve el tier por
 * `usePathname()`, que ahi devuelve `/admin/access`, y `AdminHubGate` filtra
 * pestañas por permisos y rol pero no por tier. O sea que la declaracion decia
 * Enterprise y la realidad era "cualquiera".
 *
 * El chequeo vive en una funcion compartida para que la UI y las rutas de API
 * usen el MISMO criterio. Un gate solo en la UI no es un gate: las rutas se
 * llaman con un fetch.
 */
import { hasAccess } from "@/lib/tierLogic";

export const LIGHTHOUSE_REQUIRED_TIER = "Enterprise";

export function tierPuedeUsarLighthouse(tier: string | null | undefined): boolean {
    return hasAccess(String(tier || ""), LIGHTHOUSE_REQUIRED_TIER);
}

/**
 * Codigos de error estables, para que el cliente los traduzca.
 *
 * Los mensajes de abajo son el RESPALDO: viajan igual en `error` para que nada
 * se rompa si el cliente no conoce el codigo, pero un superadmin en ingles veia
 * español en la UI y despues no encontraba ese texto en su manual. Mismo patron
 * que `ERR_NETWORK_ACCESS_DENIED` en `api/intelligence/network`.
 */
export const LIGHTHOUSE_ERRORS = {
    TIER: "ERR_LIGHTHOUSE_TIER",
    SIN_TENANT: "ERR_LIGHTHOUSE_NO_TENANT",
    SIN_PRINCIPAL: "ERR_LIGHTHOUSE_NO_PRINCIPAL",
    AUTO_DELEGACION: "ERR_LIGHTHOUSE_SELF_DELEGATION",
} as const;

/** Mensaje unico, para que la API y la UI digan lo mismo. */
export const LIGHTHOUSE_TIER_ERROR =
    "El onboarding por Azure Lighthouse está disponible sólo en el plan Enterprise. " +
    "En Professional y Business el alta se hace con el script de onboarding.";
