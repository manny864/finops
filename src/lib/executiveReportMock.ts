export type MockExecutiveHistoryItem = {
    id: number;
    requested_by_email: string;
    scope_subscription_id: string;
    scope_subscription_name: string;
    locale: string;
    created_at: string;
    completed_at: string;
    emailed_to_requester_at: string | null;
};

const MOCK_BASE = "## Resumen Ejecutivo\n- **Costo mensual actual:** USD 12,450\n- **Proyección fin de mes:** USD 13,180 (**+5.9%**)\n- **Ahorro potencial identificado:** USD 2,140/mes\n\n## Hallazgos clave\n1. Rightsizing en VMs de baja utilización con impacto directo en compute.\n2. Recursos zombie de red y discos huérfanos con costo continuo evitable.\n3. Cobertura de compromisos por debajo del objetivo en cargas estables.\n\n## Recomendaciones priorizadas\n| Decisión | Impacto estimado | Esfuerzo | Dueño sugerido | Plazo |\n|---|---:|---|---|---|\n| Ejecutar rightsizing de top 10 VMs | USD 980/mes | Medio | Cloud Ops | 2 semanas |\n| Eliminar recursos zombie de red | USD 420/mes | Bajo | Plataforma | 1 semana |\n| Ajustar reservas/planes de ahorro | USD 740/mes | Medio | FinOps | 3 semanas |\n";

const buildMockReport = (scopeName: string): string =>
    `# Reporte Ejecutivo FinOps\n\n**Alcance:** ${scopeName}\n\n${MOCK_BASE}\n> Este reporte fue generado automáticamente en entorno demo para validar UX end-to-end.`;

const nowIso = new Date().toISOString();
const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const twoDaysAgoIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const fourDaysAgoIso = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();

const MOCK_HISTORY: MockExecutiveHistoryItem[] = [
    {
        id: 90003,
        requested_by_email: "demo@cscloudsolutions.com.ar",
        scope_subscription_id: "All",
        scope_subscription_name: "Tenant completo",
        locale: "es",
        created_at: nowIso,
        completed_at: nowIso,
        emailed_to_requester_at: nowIso,
    },
    {
        id: 90002,
        requested_by_email: "demo@cscloudsolutions.com.ar",
        scope_subscription_id: "mock-sub-1",
        scope_subscription_name: "Production",
        locale: "es",
        created_at: oneHourAgoIso,
        completed_at: oneHourAgoIso,
        emailed_to_requester_at: oneHourAgoIso,
    },
    {
        id: 90001,
        requested_by_email: "demo@cscloudsolutions.com.ar",
        scope_subscription_id: "mock-sub-2",
        scope_subscription_name: "Staging",
        locale: "es",
        created_at: twoDaysAgoIso,
        completed_at: twoDaysAgoIso,
        emailed_to_requester_at: fourDaysAgoIso,
    },
];

export function getMockExecutiveReportJob(params: {
    jobId: number;
    subscriptionId?: string;
    subscriptionName?: string;
}): {
    id: number;
    status: "completed";
    report: string;
    error: null;
    scopeSubscriptionId: string;
    scopeSubscriptionName: string;
    createdAt: string;
    startedAt: string;
    completedAt: string;
    emailedAt: string;
} {
    const scopeSubscriptionId = params.subscriptionId || "All";
    const scopeSubscriptionName = params.subscriptionName || "Tenant completo";
    return {
        id: params.jobId > 0 ? params.jobId : 90003,
        status: "completed",
        report: buildMockReport(scopeSubscriptionName),
        error: null,
        scopeSubscriptionId,
        scopeSubscriptionName,
        createdAt: nowIso,
        startedAt: nowIso,
        completedAt: nowIso,
        emailedAt: nowIso,
    };
}

export function getMockExecutiveReportHistory(page: number, pageSize: number): {
    total: number;
    items: MockExecutiveHistoryItem[];
} {
    const safePage = Math.max(1, page || 1);
    const safePageSize = [15, 30, 45, 60].includes(pageSize) ? pageSize : 15;
    const offset = (safePage - 1) * safePageSize;
    return {
        total: MOCK_HISTORY.length,
        items: MOCK_HISTORY.slice(offset, offset + safePageSize),
    };
}

export function getMockExecutiveReportById(id: number): {
    report: string;
    metadata: {
        id: number;
        requestedBy: string;
        scopeSubscriptionId: string;
        scopeSubscriptionName: string;
        locale: string;
        createdAt: string;
        completedAt: string;
        expiresAt: string;
    };
} | null {
    const row = MOCK_HISTORY.find((item) => item.id === id) || MOCK_HISTORY[0];
    if (!row) return null;
    const createdAtDate = new Date(row.created_at);
    const expiresAt = new Date(createdAtDate.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
    return {
        report: buildMockReport(row.scope_subscription_name),
        metadata: {
            id: row.id,
            requestedBy: row.requested_by_email,
            scopeSubscriptionId: row.scope_subscription_id,
            scopeSubscriptionName: row.scope_subscription_name,
            locale: row.locale,
            createdAt: row.created_at,
            completedAt: row.completed_at,
            expiresAt,
        },
    };
}
