/**
 * Bootstrap de SuperAdmin (RBAC #9 / B-4 del Security Assessment 2026-07-15).
 *
 * El primer SuperAdmin del sistema no puede auto-otorgarse el rol vía la UI
 * normal (sería circular: se necesita ser SuperAdmin para poder crear un
 * SuperAdmin). Se resuelve con una auto-escalación server-side condicionada a
 * dos factores: pertenecer al tenant "master" de CSCloudSolutions Y que el
 * email cumpla el patrón esperado — usada en /api/admin/config/users (POST/PUT)
 * y /api/onboard.
 *
 * Antes ambos valores estaban hardcodeados inline en cada archivo (tenant ID
 * + prefijo de email `mchavez`), sin poder rotarlos/auditarlos sin tocar
 * código. Ahora viven acá, configurables por env var (con el valor actual
 * como default para no romper el comportamiento en producción si no se
 * setean explícitamente).
 */

export const SUPERADMIN_BOOTSTRAP_TENANT_ID =
    process.env.SUPERADMIN_BOOTSTRAP_TENANT_ID || "8b41364f-581a-4e43-b7cb-13138dac5517";

export const SUPERADMIN_BOOTSTRAP_EMAIL_PREFIX =
    (process.env.SUPERADMIN_BOOTSTRAP_EMAIL_PREFIX || "mchavez").toLowerCase();

export const CORPORATE_DOMAIN = "@cscloudsolutions.com.ar";

/**
 * True si el email, en el tenant master, cumple el patrón de
 * auto-escalación a SUPERADMIN (dominio corporativo + prefijo configurado).
 */
export function isSuperAdminBootstrapEmail(email: string, tenantId: string): boolean {
    const normalized = (email || "").toLowerCase();
    return (
        tenantId === SUPERADMIN_BOOTSTRAP_TENANT_ID &&
        normalized.endsWith(CORPORATE_DOMAIN) &&
        normalized.startsWith(SUPERADMIN_BOOTSTRAP_EMAIL_PREFIX)
    );
}
