/**
 * SSO SAML — capa de dominio.
 *
 * Normaliza las filas de `TenantSSO` al contrato de `types/tenantSso.types.ts`
 * y valida las entradas del formulario antes de que lleguen a la base.
 *
 * Funciones puras: el SQL y las llamadas a WorkOS viven en las rutas.
 */

import {
    IDP_PROVIDERS,
    type IdpProvider,
    type JitDefaultRole,
    type SsoTestOutcome,
    type TenantSsoConfig,
} from "@/types/tenantSso.types";

// ─────────────────────────────────────────────────────────────────────────────
// Validación de entradas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dominio corporativo: al menos una etiqueta más un TLD de 2+ letras, sin
 * esquema ni path. Se valida acá y en la ruta — el cliente es UX, el servidor
 * es el que decide.
 */
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export function isValidDomain(value: unknown): boolean {
    const s = String(value || "").trim().toLowerCase();
    if (!s || s.includes("/") || s.includes("@") || s.includes(" ")) return false;
    return DOMAIN_RE.test(s);
}

export function normalizeDomain(value: unknown): string {
    return String(value || "")
        .trim()
        .toLowerCase()
        // Tolera que alguien pegue la URL completa en vez del dominio.
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "");
}

/** Los IDs de WorkOS tienen prefijo fijo; validarlo atrapa el copiado cruzado. */
export function isValidWorkosOrgId(value: unknown): boolean {
    return /^org_[A-Za-z0-9]{6,}$/.test(String(value || "").trim());
}

export function isValidWorkosConnectionId(value: unknown): boolean {
    return /^conn_[A-Za-z0-9]{6,}$/.test(String(value || "").trim());
}

export function toIdpProvider(raw: unknown): IdpProvider | undefined {
    const s = String(raw || "").toUpperCase();
    return IDP_PROVIDERS.includes(s as IdpProvider) ? (s as IdpProvider) : undefined;
}

/**
 * Rol JIT: fail-closed a READER. Un valor desconocido nunca puede resolver en
 * ADMIN — habilitar JIT le daría administración del tenant a todo el directorio
 * del cliente.
 */
export function toJitRole(raw: unknown): JitDefaultRole {
    return String(raw || "").toUpperCase() === "CONTRIBUTOR" ? "CONTRIBUTOR" : "READER";
}

export function jitRoleToDb(role: JitDefaultRole): string {
    return role === "CONTRIBUTOR" ? "Colaborador" : "Reader";
}

/**
 * Mapea el `connectionType` de WorkOS al proveedor del dominio.
 *
 * WorkOS usa nombres como `AzureSAML`, `OktaSAML`, `AdfsSAML`. Lo que no
 * reconoce cae en `GENERIC_SAML`, que es correcto: es SAML igual, sólo que sin
 * una marca conocida.
 */
export function idpFromWorkosConnectionType(connectionType: unknown): IdpProvider {
    const s = String(connectionType || "").toLowerCase();
    if (s.includes("azure") || s.includes("entra")) return "ENTRA_ID";
    if (s.includes("okta")) return "OKTA";
    if (s.includes("auth0")) return "AUTH0";
    if (s.includes("adfs")) return "ADFS";
    return "GENERIC_SAML";
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalización de la fila
// ─────────────────────────────────────────────────────────────────────────────

export interface RawSsoRow {
    domain?: unknown;
    workos_org_id?: unknown;
    workos_connection_id?: unknown;
    enabled?: unknown;
    jit_provisioning_enabled?: unknown;
    is_domain_verified?: unknown;
    idp_provider?: unknown;
    default_role_for_new_users?: unknown;
    last_test_result?: unknown;
    last_test_detail?: unknown;
    last_tested_at?: unknown;
    updated_at?: unknown;
}

function iso(value: unknown): string | undefined {
    if (!value) return undefined;
    if (value instanceof Date) return value.toISOString();
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toOutcome(raw: unknown): SsoTestOutcome | undefined {
    const s = String(raw || "").toUpperCase();
    return s === "SUCCESS" || s === "FAILED" || s === "NOT_CONFIGURED" ? (s as SsoTestOutcome) : undefined;
}

export function mapSsoConfig(row: RawSsoRow | null | undefined): TenantSsoConfig {
    const r = row || {};
    return {
        domain: String(r.domain || ""),
        workosOrgId: String(r.workos_org_id || ""),
        workosConnectionId: String(r.workos_connection_id || ""),
        isEnabled: Boolean(Number(r.enabled || 0)),
        jitProvisioningEnabled: Boolean(Number(r.jit_provisioning_enabled || 0)),
        isDomainVerified: Boolean(Number(r.is_domain_verified || 0)),
        idpProvider: toIdpProvider(r.idp_provider),
        defaultRoleForNewUsers: toJitRole(r.default_role_for_new_users),
        lastTestResult: toOutcome(r.last_test_result),
        lastTestDetail: r.last_test_detail ? String(r.last_test_detail) : undefined,
        lastTestedAt: iso(r.last_tested_at),
        updatedAt: iso(r.updated_at),
    };
}

/**
 * ¿La configuración está completa y utilizable?
 *
 * Que `enabled` esté en 1 no alcanza: sin org, sin connection o sin dominio, el
 * login por SSO no puede enrutar a nadie. La UI muestra "Configurado" sólo
 * cuando las tres piezas están.
 */
export function isSsoOperational(config: TenantSsoConfig): boolean {
    return (
        config.isEnabled &&
        isValidDomain(config.domain) &&
        isValidWorkosOrgId(config.workosOrgId) &&
        isValidWorkosConnectionId(config.workosConnectionId)
    );
}

/** Etiqueta de estado para el KPI: refleja la razón, no sólo el booleano. */
export function ssoStatusKey(config: TenantSsoConfig, workosConfigured: boolean): "operational" | "incomplete" | "disabled" | "platform_missing" {
    if (!workosConfigured) return "platform_missing";
    if (!config.isEnabled) return "disabled";
    return isSsoOperational(config) ? "operational" : "incomplete";
}
