/**
 * Usuarios y Permisos — capa de dominio.
 *
 * Traduce filas de `Users` al contrato de `types/tenantUsers.types.ts` y hace de
 * puente entre los módulos del SaaS (`SaaSModuleKey`, lo que ve el
 * administrador en el drawer) y los `RoleTag` de `src/lib/pageRoleTags.ts`, que
 * son los que realmente gatean el Sidebar y `RouteTierGate`.
 *
 * El puente es el punto importante del archivo: si el drawer guardara sólo
 * `allowed_modules` y nadie leyera esa columna en el gate, cada casilla sería
 * una promesa de seguridad que no se cumple. Por eso toda escritura de módulos
 * también escribe `permissions`.
 *
 * RBAC: acá no se consulta nada ni se valida identidad. Las rutas hacen eso.
 */

import { parsePermissions, type RoleTag } from "@/lib/pageRoleTags";
import {
    ALL_MODULES,
    type AccountStatus,
    type SaaSModuleKey,
    type TenantUserItem,
    type TenantUserRole,
    type TenantUsersSummaryMetrics,
} from "@/types/tenantUsers.types";

// ─────────────────────────────────────────────────────────────────────────────
// Roles: dominio ↔ `Users.role`
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_FROM_DB: Record<string, TenantUserRole> = {
    owner: "OWNER",
    admin: "ADMIN",
    contributor: "CONTRIBUTOR",
    colaborador: "CONTRIBUTOR",
    reader: "READER",
    viewer: "READER",
};

/**
 * `CONTRIBUTOR` se escribe como "Colaborador" porque eso es lo que hay en la
 * base y lo que ofrece el `<select>` de la UI desde el día uno. Escribir
 * "Contributor" crearía una segunda ortografía del mismo rol: las filas nuevas
 * no matchearían ninguna opción del dropdown y se verían en blanco.
 */
const ROLE_TO_DB: Record<TenantUserRole, string> = {
    OWNER: "Owner",
    ADMIN: "Admin",
    CONTRIBUTOR: "Colaborador",
    READER: "Reader",
};

/**
 * Fail-closed a READER: un rol ilegible en base da el mínimo privilegio, nunca
 * Admin. Es la diferencia entre degradar a un usuario y regalarle permisos.
 */
export function toRole(raw: unknown): TenantUserRole {
    return ROLE_FROM_DB[String(raw || "").trim().toLowerCase()] || "READER";
}

export function roleToDb(role: TenantUserRole): string {
    return ROLE_TO_DB[role] || "Reader";
}

export function toAccountStatus(raw: unknown): AccountStatus {
    const s = String(raw || "").trim().toUpperCase();
    return s === "INVITED" || s === "DISABLED" ? s : "ACTIVE";
}

// ─────────────────────────────────────────────────────────────────────────────
// Puente módulos ↔ RoleTag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Qué `RoleTag` habilita cada módulo. `ADMINISTRATION` no aporta tag: 'Platform'
 * no es asignable (ver ASSIGNABLE_PERMISSIONS) y es implícito para Admin/Owner,
 * así que marcarlo no puede otorgar administración del SaaS a un Reader.
 */
const MODULE_TO_TAGS: Record<SaaSModuleKey, RoleTag[]> = {
    VISIBILITY: ["FinOps"],
    FINOPS_ANALYTICS: ["FinOps", "ProductOwner"],
    CLOUD_CLEANUP: ["CloudAdmin"],
    GOVERNANCE: ["CloudAdmin", "Security"],
    SECURITY: ["Security"],
    ADMINISTRATION: [],
};

/** Módulos que cada tag habilita, para reconstruir la selección desde `permissions`. */
const TAG_TO_MODULES: Record<string, SaaSModuleKey[]> = {
    FinOps: ["VISIBILITY", "FINOPS_ANALYTICS"],
    ProductOwner: ["FINOPS_ANALYTICS"],
    CloudAdmin: ["CLOUD_CLEANUP", "GOVERNANCE"],
    Security: ["GOVERNANCE", "SECURITY"],
};

/** Módulos → RoleTag, para escribir `Users.permissions` desde el drawer. */
export function modulesToRoleTags(modules: SaaSModuleKey[]): RoleTag[] {
    const tags = new Set<RoleTag>();
    for (const m of modules) for (const tag of MODULE_TO_TAGS[m] || []) tags.add(tag);
    return [...tags];
}

/**
 * RoleTag → módulos. Se usa sólo cuando `allowed_modules` está en NULL (usuario
 * anterior a la migración): reconstruye una selección razonable a partir de los
 * permisos reales, en vez de mostrar todo apagado y mentir sobre lo que ve.
 */
export function roleTagsToModules(tags: RoleTag[]): SaaSModuleKey[] {
    const mods = new Set<SaaSModuleKey>();
    for (const tag of tags) for (const m of TAG_TO_MODULES[tag] || []) mods.add(m);
    return ALL_MODULES.filter((m) => mods.has(m));
}

/** Normaliza el JSON de `allowed_modules` descartando claves desconocidas. */
export function parseModules(raw: unknown): SaaSModuleKey[] {
    let arr: unknown = raw;
    if (typeof raw === "string") {
        try {
            arr = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(arr)) return [];
    const valid = new Set<string>(ALL_MODULES);
    return arr.filter((m): m is SaaSModuleKey => typeof m === "string" && valid.has(m));
}

/** Normaliza `Users.scope` (JSON) a una lista de subscription IDs. */
export function parseScope(raw: unknown): string[] {
    let arr: unknown = raw;
    if (typeof raw === "string") {
        try {
            arr = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(arr)) return [];
    return arr.filter((s): s is string => typeof s === "string" && s.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalización de filas
// ─────────────────────────────────────────────────────────────────────────────

export interface RawUserRow {
    id?: unknown;
    tenant_id?: unknown;
    entra_oid?: unknown;
    email?: unknown;
    display_name?: unknown;
    role?: unknown;
    system_role?: unknown;
    permissions?: unknown;
    allowed_modules?: unknown;
    scope?: unknown;
    account_status?: unknown;
    entra_mfa_registered?: unknown;
    last_login_at?: unknown;
    invited_by?: unknown;
    created_at?: unknown;
}

function iso(value: unknown): string | undefined {
    if (!value) return undefined;
    if (value instanceof Date) return value.toISOString();
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function mapTenantUser(row: RawUserRow): TenantUserItem {
    const explicit = parseModules(row.allowed_modules);
    const tags = parsePermissions(row.permissions);
    const email = String(row.email || "");
    return {
        id: String(row.id ?? ""),
        tenantId: String(row.tenant_id || ""),
        entraObjectId: String(row.entra_oid || ""),
        email,
        displayName: String(row.display_name || "").trim() || email,
        role: toRole(row.role),
        // La selección explícita manda; si no existe se deriva de los permisos
        // que sí están gateando hoy.
        allowedModules: explicit.length > 0 ? explicit : roleTagsToModules(tags),
        allowedSubscriptionIds: parseScope(row.scope),
        // `entra_mfa_registered`, no `mfa_enabled`: esa última es el 2FA propio
        // de la plataforma (src/lib/mfa.ts) y mide otra cosa.
        mfaEnabled: row.entra_mfa_registered === 1 || row.entra_mfa_registered === true,
        // Distingue "no tiene 2FA" de "Entra ID no contestó": sin esto un tenant
        // sin permisos de Graph mostraría 0% de adopción como si fuera un
        // incumplimiento real.
        mfaKnown: row.entra_mfa_registered !== null && row.entra_mfa_registered !== undefined,
        accountStatus: toAccountStatus(row.account_status),
        lastLoginAt: iso(row.last_login_at),
        invitedBy: row.invited_by ? String(row.invited_by) : undefined,
        isSuperAdmin: String(row.system_role || "").toUpperCase() === "SUPERADMIN",
        createdAt: iso(row.created_at) || "",
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumen
// ─────────────────────────────────────────────────────────────────────────────

export function buildTenantUsersSummary(users: TenantUserItem[]): TenantUsersSummaryMetrics {
    const known = users.filter((u) => u.mfaKnown);
    return {
        totalUsersCount: users.length,
        ownersCount: users.filter((u) => u.role === "OWNER").length,
        adminsCount: users.filter((u) => u.role === "ADMIN").length,
        readersCount: users.filter((u) => u.role === "READER").length,
        // El porcentaje se calcula sobre los usuarios con dato conocido: incluir
        // los desconocidos en el denominador convertiría una falta de permisos de
        // Graph en un supuesto incumplimiento de 2FA.
        mfaAdoptionPercentage: known.length === 0 ? 0 : Math.round((known.filter((u) => u.mfaEnabled).length / known.length) * 100),
        mfaUnknownCount: users.length - known.length,
        users,
    };
}

/** Etiqueta del badge de alcance: "Acceso total", "N módulos" o "Sin acceso". */
export function scopeLabel(modules: SaaSModuleKey[]): { key: "full" | "none" | "partial"; count: number } {
    if (modules.length >= ALL_MODULES.length) return { key: "full", count: modules.length };
    if (modules.length === 0) return { key: "none", count: 0 };
    return { key: "partial", count: modules.length };
}

/** GUID abreviado para la celda de OID: `1234abcd…9f0e`. */
export function shortOid(oid: string): string {
    if (oid.length <= 13) return oid;
    return `${oid.slice(0, 8)}…${oid.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Microsoft Graph
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `$search` de Graph exige el header `ConsistencyLevel: eventual` y comillas
 * dobles en cada término. Un `"` sin escapar en la consulta rompe la sintaxis
 * del filtro, así que se elimina antes de interpolar.
 */
export function buildEntraUserSearchUrl(query: string, top = 10): string {
    const safe = query.replace(/["\\]/g, "").trim().slice(0, 120);
    const search = encodeURIComponent(`"displayName:${safe}" OR "mail:${safe}" OR "userPrincipalName:${safe}"`);
    return (
        `https://graph.microsoft.com/v1.0/users?$search=${search}` +
        `&$top=${Math.min(Math.max(top, 1), 25)}` +
        `&$select=id,displayName,userPrincipalName,mail,jobTitle,accountEnabled`
    );
}

/** Extrae de los detalles de registro de MFA un mapa OID → registrado. */
export function mfaMapFromRegistrationDetails(details: Array<Record<string, unknown>>): Map<string, boolean> {
    const map = new Map<string, boolean>();
    for (const d of details) {
        const id = String(d.id || "");
        if (!id) continue;
        map.set(id, Boolean(d.isMfaRegistered) || Boolean(d.isMfaCapable));
    }
    return map;
}
