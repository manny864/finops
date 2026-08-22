/**
 * Contrato del submódulo "Onboarding de Clientes".
 *
 * El "directorio de entornos conectados" **no** es una tabla nueva: es la lista
 * de `Tenants` que ya existe (con su tier, sus suscripciones y su estado de
 * credenciales), proyectada a este contrato. Crear una `ClientEnvironments`
 * paralela obligaría a mantener dos padrones del mismo hecho — qué clientes
 * están conectados — y cualquier deriva entre ellos mostraría un inventario
 * falso.
 */

export type OnboardingStatus = "CONNECTED_HEALTHY" | "PERMISSIONS_MISSING" | "EXPIRED_CREDENTIAL" | "NOT_CONNECTED";

export interface ClientEnvironmentItem {
    id: string;
    clientTenantIdGuid: string;
    clientOrganizationName: string;
    subscriptionIds: string[];
    onboardingStatus: OnboardingStatus;
    tier: string;
    connectedAt: string;
    lastScannedAt?: string;
}

export interface RoleVerificationDetail {
    subscriptionId: string;
    subscriptionName?: string;
    roleName: string;
    isGranted: boolean;
    scope: string;
}

export interface VerificationResult {
    isAllValid: boolean;
    /** Roles requeridos que faltan, por suscripción. Vacío = todo asignado. */
    missingRoles: RoleVerificationDetail[];
    grantedRoles: RoleVerificationDetail[];
    verifiedAt: string;
    /** Suscripciones que no se pudieron consultar (SP sin acceso, sub deshabilitada). */
    unreachableSubscriptions: string[];
}

export interface ClientOnboardingSummaryMetrics {
    connectedTenantsCount: number;
    monitoredSubscriptionsCount: number;
    /** Porcentaje de entornos en estado saludable. 0 si no hay ninguno. */
    healthyPercentage: number;
    environments: ClientEnvironmentItem[];
}

/**
 * Versión de la plantilla del script. Se muestra en el KPI para que quede claro
 * qué generación de permisos está corriendo un cliente: un tenant onboardeado
 * con una plantilla vieja puede no tener los roles que una feature nueva pide.
 */
export const SCRIPT_TEMPLATE_VERSION = "v2.5 Least-Privilege";
