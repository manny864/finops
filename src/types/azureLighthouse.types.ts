/**
 * Contrato del submódulo "Onboarding Lighthouse".
 *
 * Azure Lighthouse permite gestionar el tenant de un cliente sin tener
 * credenciales suyas: el cliente despliega una plantilla ARM que delega roles
 * concretos al tenant del MSP. La plataforma lee esas delegaciones desde
 * Resource Graph y guarda las que emitió en `TenantDelegations`.
 */

export type LighthouseDelegationStatus = "ACTIVE" | "PENDING" | "REJECTED";

export interface LighthouseDelegationItem {
    id: string;
    managedTenantId: string;
    managedTenantName: string;
    subscriptionId: string;
    subscriptionName: string;
    delegatedRoles: string[];
    status: LighthouseDelegationStatus;
    approvedAt?: string;
    /**
     * `arg` = leído en vivo de Resource Graph (la delegación existe de verdad en
     * Azure). `db` = registro propio de una plantilla emitida, todavía sin
     * confirmar del lado del cliente. La distinción importa: una fila `db` no
     * prueba que el cliente haya desplegado nada.
     */
    origin: "arg" | "db";
}

export type LighthouseRoleKey = "READER" | "COST_READER" | "TAG_CONTRIBUTOR" | "CONTRIBUTOR";

export interface LighthouseTemplatePayload {
    clientTenantId: string;
    clientSubscriptionId: string;
    selectedRoles: LighthouseRoleKey[];
}

export interface LighthouseSummaryMetrics {
    totalManagedTenantsCount: number;
    totalDelegatedSubscriptionsCount: number;
    activeDelegationsCount: number;
    /** Total de asignaciones de rol delegadas, sumando todas las delegaciones. */
    delegatedRoleAssignmentsCount: number;
    delegations: LighthouseDelegationItem[];
}

export interface LighthousePayload {
    summary: LighthouseSummaryMetrics;
    source: "live" | "snapshot" | "mock";
    mock?: boolean;
    /** Presente cuando Resource Graph no respondió y se cayó al registro propio. */
    warning?: string;
    lastUpdated: string;
}

/** Roles delegables, con el nombre del rol integrado de Azure. */
export const LIGHTHOUSE_ROLES: { key: LighthouseRoleKey; azureRoleName: string }[] = [
    { key: "READER", azureRoleName: "Reader" },
    { key: "COST_READER", azureRoleName: "Cost Management Reader" },
    { key: "TAG_CONTRIBUTOR", azureRoleName: "Tag Contributor" },
    { key: "CONTRIBUTOR", azureRoleName: "Contributor" },
];
