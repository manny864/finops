/**
 * Onboarding de Clientes — capa de dominio.
 *
 * Proyecta la lista de `Tenants` al contrato del directorio de entornos y
 * normaliza el reporte de `/api/admin/check-sp-roles` a algo que la UI pueda
 * mostrar como checklist.
 *
 * Funciones puras: el SQL vive en `/api/admin/tenants` y la consulta a Azure en
 * `/api/admin/check-sp-roles`, que ya existían. Acá no se duplica ninguno.
 */

import {
    type ClientEnvironmentItem,
    type ClientOnboardingSummaryMetrics,
    type OnboardingStatus,
    type RoleVerificationDetail,
    type VerificationResult,
} from "@/types/clientOnboarding.types";

// ─────────────────────────────────────────────────────────────────────────────
// Directorio de entornos
// ─────────────────────────────────────────────────────────────────────────────

/** Fila cruda del listado de tenants tal como la devuelve `/api/admin/tenants`. */
export interface RawTenantRow {
    tenant_id?: unknown;
    tenantId?: unknown;
    company_name?: unknown;
    name?: unknown;
    tier?: unknown;
    subscription_ids?: unknown;
    subscriptions?: unknown;
    client_secret_expires_at?: unknown;
    has_credentials?: unknown;
    created_at?: unknown;
    last_sync_at?: unknown;
}

function iso(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    const d = new Date(String(value || ""));
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** Acepta JSON array, array real, o una lista separada por comas. */
export function parseSubscriptionIds(raw: unknown): string[] {
    let arr: unknown = raw;
    if (typeof raw === "string") {
        const s = raw.trim();
        if (!s) return [];
        if (s.startsWith("[")) {
            try {
                arr = JSON.parse(s);
            } catch {
                arr = s.split(",");
            }
        } else {
            arr = s.split(",");
        }
    }
    if (!Array.isArray(arr)) return [];
    return arr
        .map((x) => (typeof x === "string" ? x : (x as { id?: string; subscriptionId?: string })?.id || (x as { subscriptionId?: string })?.subscriptionId || ""))
        .map((s) => String(s).trim())
        .filter(Boolean);
}

/**
 * Estado del entorno.
 *
 * El orden de las condiciones importa: un secreto vencido gana sobre "faltan
 * permisos", porque con la credencial muerta no se puede ni consultar los roles.
 * Reportar "permisos faltantes" en ese caso mandaría a alguien a revisar RBAC
 * cuando el problema es la credencial.
 */
export function deriveOnboardingStatus(input: {
    hasCredentials: boolean;
    secretExpiresAt?: unknown;
    subscriptionCount: number;
    now?: Date;
}): OnboardingStatus {
    if (!input.hasCredentials) return "NOT_CONNECTED";
    if (input.secretExpiresAt) {
        const exp = new Date(String(input.secretExpiresAt));
        if (!Number.isNaN(exp.getTime()) && exp <= (input.now || new Date())) return "EXPIRED_CREDENTIAL";
    }
    // Conectado pero sin suscripciones asignadas: la credencial existe y no
    // alcanza a nada, que es un problema de permisos, no de conexión.
    if (input.subscriptionCount === 0) return "PERMISSIONS_MISSING";
    return "CONNECTED_HEALTHY";
}

export function mapClientEnvironment(row: RawTenantRow, now: Date = new Date()): ClientEnvironmentItem {
    const tenantId = String(row.tenant_id || row.tenantId || "");
    const subs = parseSubscriptionIds(row.subscription_ids ?? row.subscriptions);
    return {
        id: tenantId,
        clientTenantIdGuid: tenantId,
        clientOrganizationName: String(row.company_name || row.name || "").trim() || tenantId,
        subscriptionIds: subs,
        onboardingStatus: deriveOnboardingStatus({
            hasCredentials: Boolean(row.has_credentials ?? true),
            secretExpiresAt: row.client_secret_expires_at,
            subscriptionCount: subs.length,
            now,
        }),
        tier: String(row.tier || "Professional"),
        connectedAt: iso(row.created_at),
        lastScannedAt: row.last_sync_at ? iso(row.last_sync_at) : undefined,
    };
}

export function buildOnboardingSummary(environments: ClientEnvironmentItem[]): ClientOnboardingSummaryMetrics {
    const healthy = environments.filter((e) => e.onboardingStatus === "CONNECTED_HEALTHY").length;
    return {
        connectedTenantsCount: environments.length,
        // Las suscripciones se cuentan sin repetir: un mismo subscription ID
        // delegado a dos tenants es una sola suscripción monitoreada.
        monitoredSubscriptionsCount: new Set(environments.flatMap((e) => e.subscriptionIds)).size,
        healthyPercentage: environments.length === 0 ? 0 : Math.round((healthy / environments.length) * 100),
        environments,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificación de roles
// ─────────────────────────────────────────────────────────────────────────────

/** Reporte por suscripción tal como lo emite `/api/admin/check-sp-roles`. */
export interface RawSubReport {
    subscriptionId?: unknown;
    displayName?: unknown;
    assignedRoles?: unknown;
    missingRoles?: unknown;
    missingActions?: unknown;
    customRoleRequired?: unknown;
    hasCustomRole?: unknown;
    customRoleName?: unknown;
    status?: unknown;
}

/**
 * Convierte el reporte en dos listas planas de roles por suscripción, que es lo
 * que la UI dibuja como checklist.
 *
 * Las suscripciones con `status: 'ERROR'` se separan en `unreachableSubscriptions`
 * en lugar de contarse como "sin roles": no saber es distinto de saber que falta,
 * y mezclarlos haría que un problema de red se lea como un problema de RBAC.
 */
export function normalizeVerification(reports: RawSubReport[], now: Date = new Date()): VerificationResult {
    const granted: RoleVerificationDetail[] = [];
    const missing: RoleVerificationDetail[] = [];
    const unreachable: string[] = [];

    for (const r of reports) {
        const subscriptionId = String(r.subscriptionId || "");
        const subscriptionName = r.displayName ? String(r.displayName) : undefined;
        const scope = `/subscriptions/${subscriptionId}`;

        if (String(r.status || "").toUpperCase() === "ERROR") {
            unreachable.push(subscriptionId);
            continue;
        }

        for (const role of Array.isArray(r.assignedRoles) ? r.assignedRoles : []) {
            granted.push({ subscriptionId, subscriptionName, roleName: String(role), isGranted: true, scope });
        }
        for (const role of Array.isArray(r.missingRoles) ? r.missingRoles : []) {
            missing.push({ subscriptionId, subscriptionName, roleName: String(role), isGranted: false, scope });
        }
        // El custom role se verifica por acciones, no por nombre: dos tenants
        // pueden tener el mismo permiso bajo roles con nombres distintos.
        if (r.customRoleRequired && !r.hasCustomRole) {
            const actions = Array.isArray(r.missingActions) ? r.missingActions.map(String) : [];
            missing.push({
                subscriptionId,
                subscriptionName,
                roleName: actions.length > 0 ? `Custom Role (${actions.length} acciones faltantes)` : "Custom Role",
                isGranted: false,
                scope,
            });
        }
    }

    return {
        // Una suscripción inalcanzable impide afirmar que todo está bien.
        isAllValid: missing.length === 0 && unreachable.length === 0,
        missingRoles: missing,
        grantedRoles: granted,
        unreachableSubscriptions: unreachable,
        verifiedAt: now.toISOString(),
    };
}

/** Valida un GUID de tenant o suscripción antes de mandarlo a Azure. */
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isValidGuid(value: unknown): boolean {
    return GUID_RE.test(String(value || "").trim());
}

/** Parte una lista de GUIDs separados por comas, saltos o espacios. */
export function parseGuidList(value: unknown): { valid: string[]; invalid: string[] } {
    const parts = String(value || "")
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    return {
        valid: parts.filter(isValidGuid),
        invalid: parts.filter((p) => !isValidGuid(p)),
    };
}
