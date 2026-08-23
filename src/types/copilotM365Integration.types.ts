/**
 * Contratos de la integración Copilot M365 (Graph Connector + Copilot Studio).
 *
 * `NOT_CONFIGURED` es un estado de primera clase: hasta que exista una conexión
 * real en Microsoft Graph, la UI muestra eso y su botón de creación. No se
 * simula una conexión lista ni se inventa un contador de registros.
 */

export type M365ConnectorStatus = 'READY' | 'SYNCING' | 'ERROR' | 'REVOKED' | 'NOT_CONFIGURED';

export type CopilotStudioAgentStatus = 'READY' | 'DISABLED' | 'CONFIGURING';

export interface TenantM365CopilotSettings {
    tenantId: string;
    /** ID real de la conexión en Graph. null mientras no exista. */
    connectionId: string | null;
    connectionName: string | null;
    connectorStatus: M365ConnectorStatus;
    agentStatus: CopilotStudioAgentStatus;
    /** null = nunca se indexó. Distinto de 0 (se indexó y no había nada). */
    totalIndexedRecordsCount: number | null;
    lastIndexedAtIso: string | null;
    formattedLastIndexedDate: string | null;
    lastIndexError: string | null;
    schemaVersion: string | null;
    mock?: boolean;
}

export interface ReindexResponse {
    success: boolean;
    itemsProcessed: number;
    durationMs: number;
    message: string;
    indexedAtIso: string;
}

export interface AgentQueryPayload {
    tenantId: string;
    question: string;
}

export interface AgentQueryResponse {
    answerMarkdown: string;
    dataSourcesUsed: string[];
    latencyMs: number;
    queriedAtIso: string;
}

export interface M365IndexLogEntry {
    id: string;
    triggerType: 'MANUAL' | 'SCHEDULED';
    itemsProcessedCount: number;
    durationMs: number;
    httpStatusCode: number | null;
    status: 'SUCCESS' | 'FAILED';
    errorMessage: string | null;
    createdAtIso: string;
}

/** El permiso de aplicación que Graph exige para /external/connections. */
export const REQUIRED_GRAPH_PERMISSION = 'ExternalConnection.ReadWrite.OwnedBy';

/** Versión del schema que se registra en Graph. */
export const M365_SCHEMA_VERSION = '1.0';

/**
 * El ENUM en base es minúscula desde 20260728-003
 * ('not_configured','provisioning','ready','error'); el contrato de la API es
 * mayúscula. Se traduce en el borde en vez de reescribir filas de producción.
 */
export function connectorStatusFromDb(raw: string | null | undefined): M365ConnectorStatus {
    switch ((raw || '').toLowerCase()) {
        case 'ready': return 'READY';
        case 'provisioning': return 'SYNCING';
        case 'error': return 'ERROR';
        case 'revoked': return 'REVOKED';
        default: return 'NOT_CONFIGURED';
    }
}

export function connectorStatusToDb(status: M365ConnectorStatus): string {
    switch (status) {
        case 'READY': return 'ready';
        case 'SYNCING': return 'provisioning';
        case 'ERROR': return 'error';
        // La columna no tiene 'revoked'; una conexión revocada vuelve a estar
        // sin configurar, que es exactamente su situación funcional.
        case 'REVOKED': return 'not_configured';
        default: return 'not_configured';
    }
}

/** Graph exige un id alfanumérico de 3 a 32 caracteres, sin guiones. */
export function buildConnectionId(tenantId: string): string {
    const slug = tenantId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    return `finops${slug}`.slice(0, 32);
}
