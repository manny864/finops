import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "@/app/api/copilot-m365/config/route";
import * as copilotService from "@/services/copilotM365Integration.service";
import * as requestAuth from "@/lib/requestAuth";
import * as mockData from "@/lib/mockData";

vi.mock("@/services/copilotM365Integration.service", () => ({
    getSettings: vi.fn(),
    provisionConnection: vi.fn(),
    reindex: vi.fn(),
    revokeConnection: vi.fn(),
    getIndexLogs: vi.fn(),
    GraphPermissionError: class GraphPermissionError extends Error {
        constructor(msg: string) {
            super(msg);
            this.name = "GraphPermissionError";
        }
    },
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantTier: vi.fn(),
    requireTenantRole: vi.fn(),
    AuthError: class AuthError extends Error {
        status: number;
        constructor(msg: string, status = 403) {
            super(msg);
            this.status = status;
        }
    },
}));

vi.mock("@/modules/storage/db", () => ({
    default: {
        query: vi.fn().mockResolvedValue([[]]),
    },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("API Route: /api/copilot-m365/config", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("GET", () => {
        it("devuelve 400 si falta el parámetro tenantId", async () => {
            const req = new NextRequest("http://localhost/api/copilot-m365/config");
            const res = await GET(req);
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error).toBe("Falta tenantId");
        });

        it("para tenant demo/mock devuelve payload sintético sin invocar Graph ni DB", async () => {
            const req = new NextRequest("http://localhost/api/copilot-m365/config?tenantId=demo-tenant");
            const res = await GET(req);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.mock).toBe(true);
            expect(json.config.status).toBe("ready");
            expect(json.config.connectorId).toBe("conn-mock-001");
            expect(copilotService.getSettings).not.toHaveBeenCalled();
        });

        it("para tenant real valida tier Enterprise y devuelve la configuración real y bitácora", async () => {
            const tenantId = "81ebe027-e6af-4e09-bc73-58c9012c6408";
            (copilotService.getSettings as any).mockResolvedValue({
                tenantId,
                connectionId: "finops81ebe027e6af4e09bc7358",
                connectionName: "CSCloudSolutions FinOps",
                connectorStatus: "READY",
                agentStatus: "READY",
                totalIndexedRecordsCount: 4200,
                lastIndexedAtIso: "2026-08-23T01:00:00.000Z",
                formattedLastIndexedDate: "23/08/2026 01:00",
                lastIndexError: null,
                schemaVersion: "1.0",
            });
            (copilotService.getIndexLogs as any).mockResolvedValue([
                {
                    id: "1",
                    triggerType: "MANUAL",
                    itemsProcessedCount: 4200,
                    durationMs: 1850,
                    httpStatusCode: 200,
                    status: "SUCCESS",
                    errorMessage: null,
                    createdAtIso: "2026-08-23T01:00:00.000Z",
                },
            ]);

            const req = new NextRequest(`http://localhost/api/copilot-m365/config?tenantId=${tenantId}`);
            const res = await GET(req);
            expect(res.status).toBe(200);
            const json = await res.json();

            expect(requestAuth.requireTenantTier).toHaveBeenCalledWith(req, tenantId, "Enterprise");
            expect(requestAuth.requireTenantRole).toHaveBeenCalledWith(req, tenantId, ["Admin", "Owner", "FinOps Manager"]);
            expect(json.success).toBe(true);
            expect(json.config.connectorStatus).toBe("READY");
            expect(json.config.status).toBe("ready");
            expect(json.config.connectorId).toBe("finops81ebe027e6af4e09bc7358");
            expect(json.config.indexedRecords).toBe(4200);
            expect(json.logs).toHaveLength(1);
            expect(json.logs[0].itemsProcessedCount).toBe(4200);
        });
    });

    describe("POST", () => {
        const tenantId = "81ebe027-e6af-4e09-bc73-58c9012c6408";

        it("devuelve 400 ante una acción inválida", async () => {
            const req = new NextRequest(`http://localhost/api/copilot-m365/config?tenantId=${tenantId}`, {
                method: "POST",
                body: JSON.stringify({ action: "invalid_action" }),
            });
            const res = await POST(req);
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error).toContain("Acción inválida");
        });

        it("action 'provision' ejecuta provisionConnection y reindex inicial", async () => {
            (copilotService.provisionConnection as any).mockResolvedValue({
                tenantId,
                connectionId: "finops81ebe027e6af4e09bc7358",
                connectorStatus: "SYNCING",
                agentStatus: "CONFIGURING",
                totalIndexedRecordsCount: null,
            });
            (copilotService.reindex as any).mockResolvedValue({
                success: true,
                itemsProcessed: 500,
                durationMs: 1200,
                message: "500 registros indexados",
                indexedAtIso: new Date().toISOString(),
            });
            (copilotService.getSettings as any).mockResolvedValue({
                tenantId,
                connectionId: "finops81ebe027e6af4e09bc7358",
                connectorStatus: "READY",
                agentStatus: "READY",
                totalIndexedRecordsCount: 500,
                lastIndexedAtIso: "2026-08-23T01:00:00.000Z",
                formattedLastIndexedDate: "23/08/2026 01:00",
                schemaVersion: "1.0",
            });
            (copilotService.getIndexLogs as any).mockResolvedValue([]);

            const req = new NextRequest(`http://localhost/api/copilot-m365/config?tenantId=${tenantId}`, {
                method: "POST",
                body: JSON.stringify({ action: "provision", displayName: "Test FinOps" }),
            });
            const res = await POST(req);
            expect(res.status).toBe(200);
            const json = await res.json();

            expect(copilotService.provisionConnection).toHaveBeenCalledWith(tenantId, "Test FinOps");
            expect(copilotService.reindex).toHaveBeenCalledWith(tenantId, "MANUAL");
            expect(json.success).toBe(true);
            expect(json.config.connectorStatus).toBe("READY");
        });

        it("action 'reindex' ejecuta reindex y retorna conteo real", async () => {
            (copilotService.reindex as any).mockResolvedValue({
                success: true,
                itemsProcessed: 320,
                durationMs: 950,
                message: "320 registros indexados",
                indexedAtIso: "2026-08-23T01:10:00.000Z",
            });
            (copilotService.getSettings as any).mockResolvedValue({
                tenantId,
                connectionId: "finops81ebe027e6af4e09bc7358",
                connectorStatus: "READY",
                agentStatus: "READY",
                totalIndexedRecordsCount: 320,
                lastIndexedAtIso: "2026-08-23T01:10:00.000Z",
                formattedLastIndexedDate: "23/08/2026 01:10",
                schemaVersion: "1.0",
            });
            (copilotService.getIndexLogs as any).mockResolvedValue([]);

            const req = new NextRequest(`http://localhost/api/copilot-m365/config?tenantId=${tenantId}`, {
                method: "POST",
                body: JSON.stringify({ action: "reindex" }),
            });
            const res = await POST(req);
            expect(res.status).toBe(200);
            const json = await res.json();

            expect(copilotService.reindex).toHaveBeenCalledWith(tenantId, "MANUAL");
            expect(json.result.itemsProcessed).toBe(320);
            expect(json.config.indexedRecords).toBe(320);
        });

        it("action 'revoke' elimina la conexión en Graph y resetea el estado", async () => {
            (copilotService.revokeConnection as any).mockResolvedValue(undefined);
            (copilotService.getSettings as any).mockResolvedValue({
                tenantId,
                connectionId: null,
                connectorStatus: "NOT_CONFIGURED",
                agentStatus: "DISABLED",
                totalIndexedRecordsCount: null,
            });
            (copilotService.getIndexLogs as any).mockResolvedValue([]);

            const req = new NextRequest(`http://localhost/api/copilot-m365/config?tenantId=${tenantId}`, {
                method: "POST",
                body: JSON.stringify({ action: "revoke" }),
            });
            const res = await POST(req);
            expect(res.status).toBe(200);
            const json = await res.json();

            expect(copilotService.revokeConnection).toHaveBeenCalledWith(tenantId);
            expect(json.config.connectorStatus).toBe("NOT_CONFIGURED");
            expect(json.config.connectorId).toBeNull();
        });

        it("propaga 403 con código explicativo si Graph rechaza por falta de permisos de Entra ID", async () => {
            const PermError = (copilotService as any).GraphPermissionError;
            (copilotService.provisionConnection as any).mockRejectedValue(
                new PermError("Microsoft Graph rechazó la operación (403). Falta el permiso ExternalConnection.ReadWrite.OwnedBy.")
            );

            const req = new NextRequest(`http://localhost/api/copilot-m365/config?tenantId=${tenantId}`, {
                method: "POST",
                body: JSON.stringify({ action: "provision" }),
            });
            const res = await POST(req);
            expect(res.status).toBe(403);
            const json = await res.json();

            expect(json.code).toBe("GRAPH_PERMISSION_MISSING");
            expect(json.permissionRequired).toBe("ExternalConnection.ReadWrite.OwnedBy");
            expect(json.error).toContain("ExternalConnection.ReadWrite.OwnedBy");
        });
    });

    describe("DELETE", () => {
        const tenantId = "81ebe027-e6af-4e09-bc73-58c9012c6408";

        it("ejecuta revokeConnection sobre Graph y base de datos", async () => {
            (copilotService.revokeConnection as any).mockResolvedValue(undefined);

            const req = new NextRequest(`http://localhost/api/copilot-m365/config?tenantId=${tenantId}`, {
                method: "DELETE",
            });
            const res = await DELETE(req);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(copilotService.revokeConnection).toHaveBeenCalledWith(tenantId);
            expect(json.success).toBe(true);
        });
    });
});
