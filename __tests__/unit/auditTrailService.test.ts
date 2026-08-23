// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
    getAuditTrailLogs,
    serializeAuditTrailCsv,
} from "@/services/auditTrail.service";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery, getConnection: vi.fn() },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("auditTrail.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
    });

    it("getAuditTrailLogs returns 8 rich synthetic mock logs for demo tenant", async () => {
        const result = await getAuditTrailLogs({
            tenantId: "demo-tenant-123",
            page: 1,
            pageSize: 15,
        });

        expect(result.totalCount).toBe(8);
        expect(result.items.length).toBe(8);
        expect(result.items[0].actionType).toBe("ROTATE_APP_SECRET");
        expect(result.items[1].actionType).toBe("START_VM");
        expect(result.items[2].actionType).toBe("DELETE_ZOMBIE");
        expect(result.items[3].actionType).toBe("WHAT_IF_SIMULATION");
        expect(result.items[4].actionType).toBe("AKS_CHARGEBACK_REPORT");
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    it("getAuditTrailLogs filters synthetic mock logs by actionType and userEmail", async () => {
        const filteredAction = await getAuditTrailLogs({
            tenantId: "demo-tenant-123",
            actionType: "ROTATE_APP_SECRET",
            page: 1,
            pageSize: 15,
        });
        expect(filteredAction.totalCount).toBe(1);
        expect(filteredAction.items[0].actionType).toBe("ROTATE_APP_SECRET");

        const filteredUser = await getAuditTrailLogs({
            tenantId: "demo-tenant-123",
            userEmail: "devops.bot",
            page: 1,
            pageSize: 15,
        });
        expect(filteredUser.totalCount).toBe(1);
        expect(filteredUser.items[0].userEmail).toBe("devops.bot@cscloudsolutions.com");
    });

    it("getAuditTrailLogs queries database for real tenant", async () => {
        mocks.mockPoolQuery.mockImplementation((sql) => {
            if (sql.includes("SELECT COUNT(*) as total FROM ActionLogs")) {
                return Promise.resolve([[{ total: 1 }], []]);
            }
            if (sql.includes("SELECT id, tenant_id, user_email, user_name, ip_address, user_agent, action_type")) {
                return Promise.resolve([
                    [
                        {
                            id: 1,
                            tenant_id: "tenant-live-abc",
                            user_email: "secops@company.com",
                            action_type: "ROTATE_APP_SECRET",
                            resource_name: "kv-prod",
                            status: "SUCCESS",
                            metadata_json: JSON.stringify({ key: "v1" }),
                            created_at: "2026-08-20T10:00:00Z",
                        },
                    ],
                    [],
                ]);
            }
            return Promise.resolve([[], []]);
        });

        const result = await getAuditTrailLogs({
            tenantId: "tenant-live-abc",
            page: 1,
            pageSize: 15,
        });

        expect(result.totalCount).toBe(1);
        expect(result.items.length).toBe(1);
        expect(result.items[0].actionType).toBe("ROTATE_APP_SECRET");
        expect(result.items[0].userEmail).toBe("secops@company.com");
    });

    it("serializeAuditTrailCsv serializes logs to valid CSV string", () => {
        const mockLogs = [
            {
                id: "1",
                tenantId: "t1",
                userEmail: "admin@test.com",
                userName: "Admin",
                actionType: "START_VM" as const,
                resourceTargetName: "vm-1",
                status: "SUCCESS" as const,
                createdAtIso: "2026-08-20T12:00:00Z",
                formattedCreatedAt: "20/08/2026 12:00:00",
            },
        ];

        const csv = serializeAuditTrailCsv(mockLogs);
        expect(csv).toContain("Fecha_UTC");
        expect(csv).toContain("START_VM");
        expect(csv).toContain("admin@test.com");
    });
});
