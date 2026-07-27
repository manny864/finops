import { Decimal } from "decimal.js";
import { hasAccess, normalizeTier } from "@/lib/tierLogic";

/**
 * Politica de proveedor por tenant y que pasa con los datos cuando un tenant
 * Enterprise con los dos proveedores baja de plan.
 *
 * Este archivo es logica PURA a proposito: no toca la base ni el request. Toda
 * la decision ("¿hay que archivar algo?", "¿cual se retiene?", "¿cuando se
 * purga?") es testeable sin MySQL. Los efectos viven en
 * `src/services/providerLifecycleService.ts`.
 *
 * RBAC: no aplica, no hay I/O.
 */

export type CloudProviderId = "azure" | "aws";
export type TenantProviderSetting = CloudProviderId | "both";

/** Tier minimo que puede tener los dos proveedores a la vez (handoff §3). */
export const MULTI_PROVIDER_TIER = "Enterprise";
export const DEFAULT_ARCHIVE_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 730;
export const PURGE_REMINDER_DAYS = [30, 7] as const;

/**
 * Flag global para ocultar AWS en la interfaz de usuario.
 * Cuando es false, la plataforma opera exclusivamente en modo Azure FinOps.
 * Todo el código backend de AWS se preserva para reactivación futura.
 */
export const ENABLE_AWS_UI = false;

export function tierAllowsMultiProvider(tier: string | null | undefined): boolean {
    if (!ENABLE_AWS_UI) return false;
    return hasAccess(tier || "", MULTI_PROVIDER_TIER);
}

export function isCloudProviderId(value: unknown): value is CloudProviderId {
    return value === "azure" || (ENABLE_AWS_UI && value === "aws");
}

export function normalizeProviderSetting(value: unknown): TenantProviderSetting {
    if (!ENABLE_AWS_UI) return "azure";
    if (value === "aws" || value === "both") return value;
    // Fail-safe hacia 'azure': es el default de la columna y el estado de todos
    // los tenants preexistentes. Un valor corrupto no debe habilitar AWS.
    return "azure";
}

export function otherProvider(provider: CloudProviderId): CloudProviderId {
    return provider === "aws" ? "azure" : "aws";
}

/**
 * Ventana de gracia efectiva. Se clampea en vez de rechazar: esto lo consume un
 * cron y un webhook, y una env mal escrita no puede hacer que el sistema
 * purgue mañana ni que retenga para siempre.
 */
export function getArchiveRetentionDays(
    raw: string | number | undefined | null = process.env.PROVIDER_ARCHIVE_RETENTION_DAYS
): number {
    const parsed = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ARCHIVE_RETENTION_DAYS;
    return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.trunc(parsed)));
}

export function computePurgeDate(archivedAt: Date, retentionDays: number): Date {
    const purge = new Date(archivedAt.getTime());
    purge.setUTCDate(purge.getUTCDate() + retentionDays);
    return purge;
}

export function daysUntil(purgeAt: Date, now: Date): number {
    const MS_PER_DAY = 86_400_000;
    return Math.ceil((purgeAt.getTime() - now.getTime()) / MS_PER_DAY);
}

/**
 * Proximo recordatorio que corresponde mandar, o null si no toca ninguno.
 * `alreadySent` son los milestones ya notificados (persistidos en
 * TenantProviderTransitions.notified_tNN_at) para que el cron diario sea
 * idempotente.
 */
export function pendingReminderMilestone(
    purgeAt: Date,
    now: Date,
    alreadySent: readonly number[]
): number | null {
    const remaining = daysUntil(purgeAt, now);
    for (const milestone of PURGE_REMINDER_DAYS) {
        if (remaining <= milestone && !alreadySent.includes(milestone)) return milestone;
    }
    return null;
}

export interface ProviderSpend {
    azure: string | number;
    aws: string | number;
}

export interface ProviderFootprint {
    /** Gasto acumulado reciente por proveedor, como string decimal exacto. */
    spend: ProviderSpend;
    /** Cuentas/suscripciones conectadas por proveedor. */
    connectedAccounts: { azure: number; aws: number };
}

/**
 * Elige que proveedor RETIENE el tenant cuando pierde el derecho a tener los
 * dos y nadie eligio explicitamente.
 *
 * El downgrade llega por webhook: no hay UI abierta ni nadie a quien
 * preguntarle en ese instante. Hace falta un default determinista, y tiene que
 * ser el que menos duela: el proveedor donde el cliente gasta mas es donde el
 * producto le sirve mas.
 *
 * Regla Cero: la comparacion de gasto usa Decimal, nunca float. Dos cuentas
 * con gastos que difieren en centavos no pueden resolverse por error de coma
 * flotante cuando el resultado es "cual de estos dos datasets se borra".
 *
 * Desempates, en orden:
 *   1. mayor gasto reciente
 *   2. mas cuentas conectadas (mas trabajo de onboarding invertido)
 *   3. 'azure' — es el default historico de la columna y el de todos los
 *      tenants preexistentes.
 *
 * La eleccion automatica NO es definitiva: el tenant puede corregirla durante
 * toda la ventana de gracia (ver electRetainedProvider en el servicio).
 */
export function autoElectRetainedProvider(footprint: ProviderFootprint): CloudProviderId {
    const azureSpend = new Decimal(footprint.spend.azure || 0);
    const awsSpend = new Decimal(footprint.spend.aws || 0);

    if (!azureSpend.equals(awsSpend)) {
        return azureSpend.greaterThan(awsSpend) ? "azure" : "aws";
    }

    if (footprint.connectedAccounts.azure !== footprint.connectedAccounts.aws) {
        return footprint.connectedAccounts.azure > footprint.connectedAccounts.aws ? "azure" : "aws";
    }

    return "azure";
}

export interface TierChangeInput {
    previousTier: string;
    nextTier: string;
    currentProvider: TenantProviderSetting;
    /** Proveedor hoy archivado en gracia, si hay una transicion abierta. */
    archivedProvider: CloudProviderId | null;
}

export type ProviderReconciliation =
    | { action: "none" }
    /** Perdio el derecho a 'both': hay que archivar uno. */
    | { action: "archive" }
    /** Volvio a Enterprise con una transicion en gracia: se restaura sin perdida. */
    | { action: "restore"; provider: CloudProviderId };

/**
 * Unica fuente de verdad de "¿este cambio de tier toca el modelo de
 * proveedor?". La consumen los 4 lugares que actualizan `Tenants.tier`
 * (Paddle, Azure Marketplace, AWS Marketplace, PATCH de superadmin) via
 * `applyTierChange`, para que ninguno pueda olvidarse del side-effect.
 */
export function reconcileProviderOnTierChange(input: TierChangeInput): ProviderReconciliation {
    const nextAllowsBoth = tierAllowsMultiProvider(input.nextTier);

    if (nextAllowsBoth) {
        // Vuelve a Enterprise antes de la purga => restauracion total. Este es
        // el caso que justifica toda la ventana de gracia.
        if (input.archivedProvider) {
            return { action: "restore", provider: input.archivedProvider };
        }
        return { action: "none" };
    }

    // Baja (o se queda) por debajo de Enterprise teniendo los dos: hay que
    // archivar uno. Se evalua sobre el estado actual y no sobre previousTier
    // para que sea idempotente: si el webhook se reprocesa, `provider` ya no
    // es 'both' y devuelve 'none'.
    if (input.currentProvider === "both") {
        return { action: "archive" };
    }

    return { action: "none" };
}

/**
 * ¿Puede el tenant INGESTAR datos de este proveedor?
 * Un proveedor archivado es de solo lectura: no sincroniza ni acepta cuentas
 * nuevas. Es el corte que hace que el downgrade tenga efecto economico real.
 */
export function canIngestProvider(
    setting: TenantProviderSetting,
    archived: CloudProviderId | null,
    provider: CloudProviderId
): boolean {
    if (archived === provider) return false;
    return setting === "both" || setting === provider;
}

/**
 * ¿Puede el tenant LEER/EXPORTAR datos de este proveedor?
 * Durante la gracia el proveedor archivado sigue siendo legible aunque ya no
 * sea ingestable: sin esto, bajar de plan equivaldria a secuestrarle los datos
 * al cliente y romperia la portabilidad (GDPR art. 20). Despues de la purga no
 * queda nada que leer, asi que el permiso deja de importar.
 */
export function canReadProvider(
    setting: TenantProviderSetting,
    archived: CloudProviderId | null,
    provider: CloudProviderId
): boolean {
    if (archived === provider) return true;
    return setting === "both" || setting === provider;
}

/** Tier normalizado o 'Essential' — helper para logs/persistencia. */
export function safeTier(tier: string | null | undefined): string {
    return normalizeTier(tier || "") || "Essential";
}
