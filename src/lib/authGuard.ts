/**
 * Dominios corporativos de CSCloudSolutions.
 *
 * Fuente única de verdad: `requestAuth.ts` (server) importa de acá en vez de
 * mantener su propia copia. Antes había dos listas duplicadas y ambas incluían
 * `@cscloudsolutionsoutlook.onmicrosoft.com`, el tenant de Azure de la propia
 * empresa — cualquier cuenta de ese directorio quedaba tratada como personal
 * interno y veía los módulos de SuperAdmin. Sólo el dominio de mail corporativo
 * real habilita privilegios.
 */
export const CORPORATE_DOMAINS = ['@cscloudsolutions.com.ar'];

/**
 * True si el email pertenece a un dominio corporativo.
 *
 * OJO: pertenecer al dominio NO otorga privilegios de SuperAdmin — es sólo la
 * primera de dos condiciones. La segunda es `Users.system_role = 'SUPERADMIN'`,
 * que se valida server-side (`requireSuperAdmin`) y llega al cliente vía
 * `systemRole` del TenantProvider. Esta función se llamaba `isSuperAdmin` y ese
 * nombre fue exactamente la causa del bug: la UI la usaba como si fuera un
 * chequeo de rol y mostraba los módulos de SuperAdmin a todo el dominio.
 */
export function isCorporateEmail(userEmail: string | null | undefined): boolean {
    if (!userEmail) return false;
    const lower = userEmail.trim().toLowerCase();
    return CORPORATE_DOMAINS.some(d => lower.endsWith(d));
}
