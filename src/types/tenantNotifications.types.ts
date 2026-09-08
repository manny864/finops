export type NotificationEventType =
    | 'REPORT_READY'
    | 'ANOMALY_DETECTED'
    | 'CREDENTIAL_EXPIRING'
    | 'BUDGET_EXCEEDED'
    | 'SYSTEM_ALERT';

export interface TenantNotificationItem {
    id: string | number;
    tenantId: string;
    type: NotificationEventType;
    /**
     * Texto guardado, en castellano. Es el **fallback** desde el 2026-09-08: la
     * UI muestra `titleKey`/`messageKey` cuando la fila las trae. Las filas
     * previas sólo tienen esto y no hay con qué retraducirlas.
     */
    title: string;
    message: string;
    /** Claves i18n de la fila (`title_key`/`message_key`) y sus valores. */
    titleKey?: string | null;
    messageKey?: string | null;
    params?: Record<string, string | number> | string | null;
    actionUrl?: string;
    isRead: boolean;
    readAtIso?: string | null;
    createdAtIso: string;
    /**
     * "Hace 5 min" armado en el servidor, en castellano. Queda como respaldo:
     * la campanita formatea `createdAtIso` con el formatter de next-intl, que sí
     * conoce el locale del lector. El servidor no lo conoce y la respuesta se
     * cachea, así que armar la frase acá congela el idioma.
     */
    formattedTimeAgo: string;
    severity?: 'info' | 'warning' | 'critical';
}

export interface NotificationSummaryResponse {
    success: boolean;
    unreadCount: number;
    totalCount: number;
    notifications: TenantNotificationItem[];
}

export type NotificationChannelType = 'SLACK' | 'TEAMS' | 'EMAIL' | 'WEBHOOK';

export type NotificationSeverityFilter =
    | 'ALL'
    | 'MEDIUM_AND_ABOVE'
    | 'HIGH_AND_ABOVE'
    | 'CRITICAL_ONLY';

export type NotificationCategory =
    | 'ANOMALY'
    | 'BUDGET_OVERRUN'
    | 'ZOMBIE_DETECTION'
    | 'TTL_EXPIRY'
    | 'SECURITY_DEFENDER';

export interface NotificationChannelItem {
    id: string;
    tenantId: string;
    name: string;
    channelType: NotificationChannelType;
    targetEndpointMasked: string;
    severityFilter: NotificationSeverityFilter;
    severityFilterDisplay: string;
    eventCategories: NotificationCategory[];
    isEnabled: boolean;
    lastDeliveredAt?: string;
    lastDeliveryStatus?: 'SUCCESS' | 'FAILED';
    createdAt: string;
}

export interface NotificationSummaryMetrics {
    totalChannelsCount: number;
    enabledChannelsCount: number;
    dispatchedLast30DaysCount: number;
    criticalOnlyChannelsCount: number;
    isMasterEnabled: boolean;
    channels: NotificationChannelItem[];
    mock?: boolean;
}

export interface CreateChannelPayload {
    name: string;
    channelType: NotificationChannelType;
    targetEndpoint: string;
    severityFilter: NotificationSeverityFilter;
    eventCategories: NotificationCategory[];
    isEnabled?: boolean;
}

export interface TestChannelPayload {
    channelId?: string;
    channelType: NotificationChannelType;
    targetEndpoint: string;
}

export interface TestChannelResult {
    success: boolean;
    httpStatusCode?: number;
    latencyMs: number;
    responseSnippet?: string;
    message: string;
    testedAt: string;
}

export const NOTIFICATION_CHANNEL_TYPES: NotificationChannelType[] = ['SLACK', 'TEAMS', 'EMAIL', 'WEBHOOK'];

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
    'ANOMALY',
    'BUDGET_OVERRUN',
    'ZOMBIE_DETECTION',
    'TTL_EXPIRY',
    'SECURITY_DEFENDER',
];

export const SEVERITY_FILTERS: NotificationSeverityFilter[] = [
    'ALL',
    'MEDIUM_AND_ABOVE',
    'HIGH_AND_ABOVE',
    'CRITICAL_ONLY',
];

export function isChannelType(value: unknown): value is NotificationChannelType {
    return typeof value === 'string' && (NOTIFICATION_CHANNEL_TYPES as string[]).includes(value);
}

export function isSeverityFilter(value: unknown): value is NotificationSeverityFilter {
    return typeof value === 'string' && (SEVERITY_FILTERS as string[]).includes(value);
}

export function isNotificationCategory(value: unknown): value is NotificationCategory {
    return typeof value === 'string' && (NOTIFICATION_CATEGORIES as string[]).includes(value);
}

export function channelTypeToDb(type: NotificationChannelType): string {
    return type.toLowerCase();
}

export function channelTypeFromDb(raw: string | null | undefined): NotificationChannelType {
    const upper = (raw || 'webhook').toUpperCase();
    return isChannelType(upper) ? upper : 'WEBHOOK';
}

/**
 * `severity_filter` en base es la lista de severidades que el canal acepta
 * (`'info,warning,error'`), no un nivel mínimo. El dispatcher hace
 * `filter.split(',').includes(severity)`, así que el mapeo debe producir
 * exactamente esas listas o el canal dejaría de recibir.
 */
const SEVERITY_FILTER_TO_DB: Record<NotificationSeverityFilter, string> = {
    ALL: 'info,warning,error',
    MEDIUM_AND_ABOVE: 'info,warning,error',
    HIGH_AND_ABOVE: 'warning,error',
    CRITICAL_ONLY: 'error',
};

export function severityFilterToDb(filter: NotificationSeverityFilter): string {
    return SEVERITY_FILTER_TO_DB[filter] ?? SEVERITY_FILTER_TO_DB.ALL;
}

export function severityFilterFromDb(raw: string | null | undefined): NotificationSeverityFilter {
    const levels = (raw || 'info,warning,error')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

    if (levels.length === 1 && levels[0] === 'error') return 'CRITICAL_ONLY';
    if (!levels.includes('info')) return 'HIGH_AND_ABOVE';
    return 'ALL';
}

/**
 * Enmascara el destino para mostrarlo sin filtrarlo. Un webhook conserva host y
 * los últimos caracteres del path; una lista de correos conserva el dominio.
 */
export function maskTargetEndpoint(type: NotificationChannelType, rawConfig: unknown): string {
    const config = (rawConfig && typeof rawConfig === 'object' ? rawConfig : {}) as Record<string, unknown>;

    if (type === 'EMAIL') {
        const to = config.to ?? config.recipients ?? config.emails;
        const list = Array.isArray(to) ? to : typeof to === 'string' ? to.split(',') : [];
        const cleaned = list.map((e) => String(e).trim()).filter(Boolean);
        if (cleaned.length === 0) return '—';
        const first = cleaned[0];
        const at = first.indexOf('@');
        const masked = at > 0 ? `${first.slice(0, 1)}•••${first.slice(at)}` : first;
        return cleaned.length > 1 ? `${masked} +${cleaned.length - 1}` : masked;
    }

    const url = String(config.webhookUrl ?? config.url ?? '').trim();
    if (!url) return '—';
    try {
        const parsed = new URL(url);
        // El path de un webhook de Slack/Teams ES la credencial: se muestran
        // sólo los últimos 4 caracteres para poder distinguir dos canales.
        const tail = parsed.pathname.replace(/\/+$/, '').slice(-4);
        return `${parsed.host}/•••${tail}`;
    } catch {
        return '•••';
    }
}
