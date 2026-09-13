import type { MaturityScorePolicy } from './finopsMaturity.types';
/**
 * Contratos de la pestaña General de Configuración Global.
 *
 * Regla de exposición: el secreto ITSM (`itsm_api_key_encrypted`) NUNCA cruza al
 * cliente. La UI sólo recibe `isItsmConfigured` / `isWebhookConfigured`, que es
 * todo lo que necesita para renderizar el estado.
 */

export type ThemePreferenceType = 'LIGHT' | 'DARK' | 'SYSTEM';

export type ItsmSystemType = 'JIRA' | 'AZURE_DEVOPS' | 'SERVICENOW' | 'NONE';

export interface TenantBrandingConfig {
    customLogoUrl?: string;
    organizationName: string;
    hasCustomLogo: boolean;
}

export interface TenantIntegrationsConfig {
    proactiveAlertsWebhookUrl?: string;
    itsmSystem: ItsmSystemType;
    itsmBaseUrl?: string;
    itsmUserEmail?: string;
    itsmProjectKey?: string;
    /** Endpoint del feed FOCUS. El token va en el header, no en la URL. */
    powerBiExportUrl: string;
    isWebhookConfigured: boolean;
    isItsmConfigured: boolean;
}

export interface TenantGlobalConfig {
    tenantId: string;
    theme: ThemePreferenceType;
    branding: TenantBrandingConfig;
    integrations: TenantIntegrationsConfig;
    /**
     * Qué pesa al calcular el radar de madurez: la autoevaluación del equipo,
     * la telemetría de Azure, o el promedio (MEJ-08).
     */
    maturityScorePolicy: MaturityScorePolicy;
    /** true sólo en tenants demo — la UI muestra el banner ámbar. */
    mock?: boolean;
}

export interface SaveWebhookPayload {
    webhookUrl: string;
}

export interface SaveItsmPayload {
    system: ItsmSystemType;
    baseUrl: string;
    /** Omitido = conservar el secreto ya guardado. */
    apiKey?: string;
    userEmail?: string;
    projectKey?: string;
}

export interface PurgeTenantPayload {
    tenantId: string;
    confirmationName: string;
}

export interface ItsmTestResult {
    ok: boolean;
    /** Identidad que devolvió el sistema destino, para que el admin confirme cuál credencial quedó. */
    identity?: string;
    status?: number;
    error?: string;
}

export const THEME_PREFERENCES: ThemePreferenceType[] = ['LIGHT', 'DARK', 'SYSTEM'];

export const ITSM_SYSTEMS: ItsmSystemType[] = ['JIRA', 'AZURE_DEVOPS', 'SERVICENOW', 'NONE'];

export function isThemePreference(value: unknown): value is ThemePreferenceType {
    return typeof value === 'string' && (THEME_PREFERENCES as string[]).includes(value);
}

export function isItsmSystem(value: unknown): value is ItsmSystemType {
    return typeof value === 'string' && (ITSM_SYSTEMS as string[]).includes(value);
}

/** next-themes usa minúsculas; la DB guarda el ENUM en mayúsculas. */
export function themeToClient(theme: ThemePreferenceType): 'light' | 'dark' | 'system' {
    return theme.toLowerCase() as 'light' | 'dark' | 'system';
}

export function themeToDb(theme: string): ThemePreferenceType {
    const upper = theme.toUpperCase();
    return isThemePreference(upper) ? upper : 'SYSTEM';
}
