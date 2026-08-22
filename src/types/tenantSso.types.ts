/**
 * Contrato del submódulo "SSO SAML" (WorkOS).
 *
 * La plataforma no habla SAML directamente: WorkOS es el broker. Acá se guarda
 * a qué organización y conexión de WorkOS corresponde el tenant, y el estado
 * operativo de esa conexión.
 */

export type IdpProvider = "OKTA" | "ENTRA_ID" | "AUTH0" | "ADFS" | "GENERIC_SAML";

export type SsoTestOutcome = "SUCCESS" | "FAILED" | "NOT_CONFIGURED";

/** Rol con el que entra un usuario nuevo por JIT. Nunca Admin ni Owner. */
export type JitDefaultRole = "READER" | "CONTRIBUTOR";

export interface TenantSsoConfig {
    domain: string;
    workosOrgId: string;
    workosConnectionId: string;
    isEnabled: boolean;
    jitProvisioningEnabled: boolean;
    isDomainVerified: boolean;
    idpProvider?: IdpProvider;
    defaultRoleForNewUsers: JitDefaultRole;
    lastTestResult?: SsoTestOutcome;
    lastTestDetail?: string;
    lastTestedAt?: string;
    updatedAt?: string;
}

export interface SsoTestResult {
    isSuccess: boolean;
    /** Estado que reporta WorkOS para la conexión: `active`, `draft`, … */
    connectionState?: string;
    idpName?: string;
    /**
     * Dominios que el IdP tiene asociados en WorkOS. Es lo que efectivamente
     * enruta a un usuario a este tenant al iniciar sesión.
     */
    verifiedDomains?: string[];
    /**
     * Atributos que la conexión declara mapear. WorkOS no expone un perfil de
     * muestra sin un login real, así que esto es la configuración, no una
     * respuesta SAML capturada.
     */
    mappedAttributes?: { email: string; name: string; groups: string[] };
    errorMessage?: string;
}

export interface TenantSsoPayload {
    config: TenantSsoConfig;
    /** `false` cuando la plataforma no tiene credenciales de WorkOS cargadas. */
    workosConfigured: boolean;
    source: "live" | "mock";
    mock?: boolean;
    lastUpdated: string;
}

export const IDP_PROVIDERS: IdpProvider[] = ["ENTRA_ID", "OKTA", "AUTH0", "ADFS", "GENERIC_SAML"];
