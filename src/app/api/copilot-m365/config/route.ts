import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { initializeDatabase } from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from '@/lib/apiErrors';
import {
    getSettings,
    provisionConnection,
    reindex,
    revokeConnection,
    getIndexLogs,
    GraphPermissionError,
} from "@/services/copilotM365Integration.service";
import {
    connectorStatusToDb,
    REQUIRED_GRAPH_PERMISSION,
} from "@/types/copilotM365Integration.types";

const STATUS_TO_LEGACY: Record<string, string> = {
    READY: 'ready',
    SYNCING: 'provisioning',
    ERROR: 'error',
    REVOKED: 'not_configured',
    NOT_CONFIGURED: 'not_configured',
};

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // Mock tenant branch
        if (isMockTenant(tenantId)) {
            return NextResponse.json({
                success: true,
                mock: true,
                config: {
                    tenantId,
                    status: "ready",
                    connectorStatus: "READY",
                    agentStatus: "READY",
                    connectorId: "conn-mock-001",
                    connectionName: "CSCloudSolutions FinOps",
                    copilotStudioAgentId: "agent-finops-mock",
                    indexedRecords: 18450,
                    totalIndexedRecordsCount: 18450,
                    lastIndexAt: "2026-06-27T14:30:00Z",
                    formattedLastIndexedDate: "27/06/2026 14:30",
                    lastIndexError: null,
                    schemaVersion: "1.0",
                    config: {
                        namespaceFilter: ["costs", "budgets", "anomalies"],
                        refreshHours: 24,
                    },
                },
                logs: [
                    {
                        id: "mock-1",
                        triggerType: "SCHEDULED",
                        itemsProcessedCount: 350,
                        durationMs: 1420,
                        httpStatusCode: 200,
                        status: "SUCCESS",
                        errorMessage: null,
                        createdAtIso: "2026-06-27T14:30:00Z",
                    },
                ],
            });
        }

        try {
            await requireTenantTier(request, tenantId, 'Enterprise');
            await requireTenantRole(request, tenantId, ['Admin', 'Owner', 'FinOps Manager']);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        await initializeDatabase();
        const settings = await getSettings(tenantId);
        const logs = await getIndexLogs(tenantId, 10);
        const legacyStatus = STATUS_TO_LEGACY[settings.connectorStatus] || 'not_configured';

        return NextResponse.json({
            success: true,
            config: {
                tenantId: settings.tenantId,
                status: legacyStatus,
                connectorStatus: settings.connectorStatus,
                agentStatus: settings.agentStatus,
                connectorId: settings.connectionId,
                connectionName: settings.connectionName,
                copilotStudioAgentId: settings.connectionId ? `agent-${settings.connectionId}` : null,
                indexedRecords: settings.totalIndexedRecordsCount ?? 0,
                totalIndexedRecordsCount: settings.totalIndexedRecordsCount,
                lastIndexAt: settings.lastIndexedAtIso,
                formattedLastIndexedDate: settings.formattedLastIndexedDate,
                lastIndexError: settings.lastIndexError,
                schemaVersion: settings.schemaVersion,
            },
            logs,
        });
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("M365 Copilot Config GET error:", error);
        return NextResponse.json({
            success: true,
            config: { status: "not_configured", indexedRecords: 0, lastIndexAt: null },
            warning: errorMessage(error) || "No se pudo cargar configuración persistida",
        });
    }
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const body = await request.json();
        const action: "provision" | "reindex" | "revoke" = body?.action;
        const displayName: string | undefined = body?.displayName;

        if (!["provision", "reindex", "revoke"].includes(action)) {
            return NextResponse.json({ error: "Acción inválida. Use: provision | reindex | revoke" }, { status: 400 });
        }

        // Mock tenant branch
        if (isMockTenant(tenantId)) {
            const mockNextState: Record<string, any> = {
                provision: {
                    status: "ready",
                    connectorStatus: "READY",
                    agentStatus: "READY",
                    connectorId: "conn-mock-001",
                    indexedRecords: 18450,
                    totalIndexedRecordsCount: 18450,
                    lastIndexAt: new Date().toISOString(),
                    formattedLastIndexedDate: new Date().toLocaleString(),
                    schemaVersion: "1.0",
                },
                reindex: {
                    status: "ready",
                    connectorStatus: "READY",
                    agentStatus: "READY",
                    connectorId: "conn-mock-001",
                    indexedRecords: 18450 + Math.floor(Math.random() * 500),
                    totalIndexedRecordsCount: 18450 + Math.floor(Math.random() * 500),
                    lastIndexAt: new Date().toISOString(),
                    formattedLastIndexedDate: new Date().toLocaleString(),
                    schemaVersion: "1.0",
                },
                revoke: {
                    status: "not_configured",
                    connectorStatus: "NOT_CONFIGURED",
                    agentStatus: "DISABLED",
                    connectorId: null,
                    indexedRecords: 0,
                    totalIndexedRecordsCount: null,
                    lastIndexAt: null,
                    formattedLastIndexedDate: null,
                    schemaVersion: null,
                },
            };
            return NextResponse.json({
                success: true,
                mock: true,
                action,
                config: { tenantId, ...mockNextState[action] },
                logs: [],
            });
        }

        try {
            await requireTenantTier(request, tenantId, 'Enterprise');
            await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        await initializeDatabase();

        if (action === "provision") {
            await provisionConnection(tenantId, displayName);
            try {
                await reindex(tenantId, "MANUAL");
            } catch (reindexErr) {
                console.warn("[copilot-m365/config] initial reindex warning:", errorMessage(reindexErr));
            }
            const updated = await getSettings(tenantId);
            const logs = await getIndexLogs(tenantId, 10);
            return NextResponse.json({
                success: true,
                action,
                config: {
                    tenantId: updated.tenantId,
                    status: STATUS_TO_LEGACY[updated.connectorStatus] || 'not_configured',
                    connectorStatus: updated.connectorStatus,
                    agentStatus: updated.agentStatus,
                    connectorId: updated.connectionId,
                    connectionName: updated.connectionName,
                    copilotStudioAgentId: updated.connectionId ? `agent-${updated.connectionId}` : null,
                    indexedRecords: updated.totalIndexedRecordsCount ?? 0,
                    totalIndexedRecordsCount: updated.totalIndexedRecordsCount,
                    lastIndexAt: updated.lastIndexedAtIso,
                    formattedLastIndexedDate: updated.formattedLastIndexedDate,
                    lastIndexError: updated.lastIndexError,
                    schemaVersion: updated.schemaVersion,
                },
                logs,
            });
        }

        if (action === "reindex") {
            const result = await reindex(tenantId, "MANUAL");
            const updated = await getSettings(tenantId);
            const logs = await getIndexLogs(tenantId, 10);
            return NextResponse.json({
                success: result.success,
                action,
                result,
                config: {
                    tenantId: updated.tenantId,
                    status: STATUS_TO_LEGACY[updated.connectorStatus] || 'not_configured',
                    connectorStatus: updated.connectorStatus,
                    agentStatus: updated.agentStatus,
                    connectorId: updated.connectionId,
                    connectionName: updated.connectionName,
                    copilotStudioAgentId: updated.connectionId ? `agent-${updated.connectionId}` : null,
                    indexedRecords: updated.totalIndexedRecordsCount ?? 0,
                    totalIndexedRecordsCount: updated.totalIndexedRecordsCount,
                    lastIndexAt: updated.lastIndexedAtIso,
                    formattedLastIndexedDate: updated.formattedLastIndexedDate,
                    lastIndexError: updated.lastIndexError,
                    schemaVersion: updated.schemaVersion,
                },
                logs,
            });
        }

        // revoke
        await revokeConnection(tenantId);
        const updated = await getSettings(tenantId);
        const logs = await getIndexLogs(tenantId, 10);
        return NextResponse.json({
            success: true,
            action,
            config: {
                tenantId: updated.tenantId,
                status: "not_configured",
                connectorStatus: "NOT_CONFIGURED",
                agentStatus: "DISABLED",
                connectorId: null,
                connectionName: null,
                copilotStudioAgentId: null,
                indexedRecords: 0,
                totalIndexedRecordsCount: null,
                lastIndexAt: null,
                formattedLastIndexedDate: null,
                lastIndexError: null,
                schemaVersion: null,
            },
            logs,
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        if (error instanceof GraphPermissionError) {
            return NextResponse.json({
                error: error.message,
                code: 'GRAPH_PERMISSION_MISSING',
                permissionRequired: REQUIRED_GRAPH_PERMISSION,
            }, { status: 403 });
        }
        console.error("M365 Copilot Config POST error:", error);
        return NextResponse.json({ error: errorMessage(error) || "Internal server error" }, { status: 500 });
    }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, message: "Configuración mock eliminada." });
        }

        try {
            await requireTenantTier(request, tenantId, 'Enterprise');
            await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        await initializeDatabase();
        await revokeConnection(tenantId);
        return NextResponse.json({ success: true, message: "Conexión revocada y eliminada." });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        if (error instanceof GraphPermissionError) {
            return NextResponse.json({
                error: error.message,
                code: 'GRAPH_PERMISSION_MISSING',
                permissionRequired: REQUIRED_GRAPH_PERMISSION,
            }, { status: 403 });
        }
        console.error("M365 Copilot Config DELETE error:", error);
        return NextResponse.json({ error: errorMessage(error) || "Internal server error" }, { status: 500 });
    }
}
