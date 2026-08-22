/**
 * Contrato del submódulo "Usuarios y Permisos".
 *
 * Se apoya en la tabla `Users` que ya usa el RBAC de la plataforma
 * (`requireTenantAccess`, `requireTenantRole`, `hasSystemRole`), no en un
 * padrón paralelo. Los nombres acá son los del dominio; el mapeo a columnas
 * vive en `src/services/tenantUsers.service.ts`.
 *
 * Dos ejes ortogonales, que ya existían y NO se duplican:
 *  - `role` → qué acciones puede EJECUTAR (Owner/Admin/Contributor/Reader).
 *  - `allowedModules` → qué páginas puede VER. Se proyecta sobre
 *    `Users.permissions` (RoleTag de `src/lib/pageRoleTags.ts`), que es lo que
 *    efectivamente gatea el Sidebar y `RouteTierGate`. Un tercer eje sin gate
 *    real sería una casilla que no protege nada.
 */

export type TenantUserRole = "OWNER" | "ADMIN" | "CONTRIBUTOR" | "READER";

export type SaaSModuleKey =
    | "VISIBILITY"
    | "FINOPS_ANALYTICS"
    | "CLOUD_CLEANUP"
    | "GOVERNANCE"
    | "SECURITY"
    | "ADMINISTRATION";

export type AccountStatus = "ACTIVE" | "INVITED" | "DISABLED";

export interface TenantUserItem {
    id: string;
    tenantId: string;
    entraObjectId: string;
    email: string;
    displayName: string;
    role: TenantUserRole;
    allowedModules: SaaSModuleKey[];
    allowedSubscriptionIds?: string[];
    /** `null` = Entra ID todavía no respondió; distinto de "no tiene 2FA". */
    mfaEnabled: boolean;
    mfaKnown: boolean;
    accountStatus: AccountStatus;
    lastLoginAt?: string;
    invitedBy?: string;
    isSuperAdmin: boolean;
    createdAt: string;
}

export interface EntraUserSearchResult {
    id: string;
    userPrincipalName: string;
    displayName: string;
    mail?: string;
    jobTitle?: string;
    accountEnabled: boolean;
    /** Ya está en el tenant de la plataforma: la UI lo marca en vez de ofrecerlo. */
    alreadyProvisioned?: boolean;
}

export interface EntraGroupSearchResult {
    id: string;
    displayName: string;
    description?: string;
    memberCount?: number;
}

export interface TenantUsersSummaryMetrics {
    totalUsersCount: number;
    ownersCount: number;
    adminsCount: number;
    readersCount: number;
    /** Entero 0-100 sobre los usuarios cuyo estado de MFA se conoce. */
    mfaAdoptionPercentage: number;
    /** Usuarios sin dato de MFA: la UI lo aclara para no leer 0% como incumplimiento. */
    mfaUnknownCount: number;
    users: TenantUserItem[];
}

export interface TenantUsersPayload {
    summary: TenantUsersSummaryMetrics;
    /** Límite de usuarios del tier contratado. `null` = sin límite (Enterprise). */
    userLimit: number | null;
    isSuperAdmin: boolean;
    source: "live" | "mock";
    mock?: boolean;
    lastUpdated: string;
}

export interface AddUserPayload {
    email: string;
    entraObjectId: string;
    displayName: string;
    role: TenantUserRole;
    allowedModules?: SaaSModuleKey[];
}

export interface UpdateUserPermissionsPayload {
    userId: string;
    role: TenantUserRole;
    allowedModules: SaaSModuleKey[];
    allowedSubscriptionIds?: string[];
}

/** Presets del selector rápido de alcance del formulario de alta. */
export const MODULE_PRESETS: Record<string, SaaSModuleKey[]> = {
    FULL: ["VISIBILITY", "FINOPS_ANALYTICS", "CLOUD_CLEANUP", "GOVERNANCE", "SECURITY", "ADMINISTRATION"],
    FINOPS_ONLY: ["VISIBILITY", "FINOPS_ANALYTICS"],
    CLEANUP_GOVERNANCE: ["CLOUD_CLEANUP", "GOVERNANCE"],
};

export const ALL_MODULES: SaaSModuleKey[] = [
    "VISIBILITY",
    "FINOPS_ANALYTICS",
    "CLOUD_CLEANUP",
    "GOVERNANCE",
    "SECURITY",
    "ADMINISTRATION",
];
