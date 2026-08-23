// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
    hashMcpKey,
    generateSecureMcpToken,
    maskMcpKey,
    listMcpKeys,
    createMcpKey,
    revokeMcpKey,
    authenticateMcpToken,
} from "@/services/mcpApiKey.service";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery, getConnection: vi.fn() },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("mcpApiKey.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
    });

    it("hashMcpKey produces deterministic sha256 hex string", () => {
        const hash1 = hashMcpKey("mcp_live_test123");
        const hash2 = hashMcpKey("mcp_live_test123");
        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(64);
    });

    it("generateSecureMcpToken produces rawKey starting with mcp_live_", () => {
        const token = generateSecureMcpToken();
        expect(token.rawKey.startsWith("mcp_live_")).toBe(true);
        expect(token.prefix.startsWith("mcp_live_")).toBe(true);
        expect(token.hash).toBe(hashMcpKey(token.rawKey));
    });

    it("maskMcpKey masks token correctly", () => {
        const masked = maskMcpKey("mcp_live_4a1b", "mcp_live_4a1b9f8e7d6c5b4a3120");
        expect(masked).toContain("mcp_live_4a1b••••••••3120");
    });

    it("listMcpKeys returns synthetic keys for demo tenant", async () => {
        const keys = await listMcpKeys("demo-tenant-123");
        expect(keys.length).toBe(2);
        expect(keys[0].name).toBe("Claude Desktop Demo");
        expect(keys[1].name).toBe("Power BI Production Feed");
    });

    it("listMcpKeys queries database for real tenant", async () => {
        mocks.mockPoolQuery.mockResolvedValue([
            [
                {
                    id: 1,
                    tenant_id: "tenant-prod",
                    key_prefix: "mcp_live_9999",
                    label: "Prod Claude",
                    created_by_email: "admin@corp.com",
                    created_at: "2026-08-01T10:00:00Z",
                    last_used_at: null,
                    revoked_at: null,
                },
            ],
            [],
        ]);

        const keys = await listMcpKeys("tenant-prod");
        expect(keys.length).toBe(1);
        expect(keys[0].name).toBe("Prod Claude");
        expect(keys[0].isRevoked).toBe(false);
    });

    it("createMcpKey creates synthetic key for demo tenant without inserting into db", async () => {
        const result = await createMcpKey("demo-tenant-123", "Demo Key", "user@demo.com");
        expect(result.success).toBe(true);
        expect(result.rawKey.startsWith("mcp_live_")).toBe(true);
        expect(result.keyItem.name).toBe("Demo Key");
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    it("createMcpKey inserts into database for real tenant", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{ insertId: 42 }, []]);

        const result = await createMcpKey("tenant-prod", "Production Agent", "lead@corp.com");
        expect(result.success).toBe(true);
        expect(result.keyItem.id).toBe("42");
        expect(result.keyItem.name).toBe("Production Agent");
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO MCPApiKeys"),
            expect.arrayContaining(["tenant-prod", "Production Agent", "lead@corp.com"])
        );
    });

    it("revokeMcpKey marks revoked_at in database", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{ affectedRows: 1 }, []]);

        const ok = await revokeMcpKey("tenant-prod", 42);
        expect(ok).toBe(true);
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("UPDATE MCPApiKeys SET revoked_at = NOW()"),
            expect.arrayContaining([42, "tenant-prod"])
        );
    });

    it("authenticateMcpToken authenticates valid key and updates last_used_at", async () => {
        mocks.mockPoolQuery.mockImplementation((sql) => {
            if (sql.includes("SELECT id, tenant_id FROM MCPApiKeys")) {
                return Promise.resolve([[{ id: 10, tenant_id: "tenant-abc" }], []]);
            }
            if (sql.includes("UPDATE MCPApiKeys SET last_used_at")) {
                return Promise.resolve([{}, []]);
            }
            return Promise.resolve([[], []]);
        });

        const auth = await authenticateMcpToken("mcp_live_0123456789abcdef0123456789abcdef");
        expect(auth).toEqual({ tenantId: "tenant-abc", keyId: 10 });
    });
});
