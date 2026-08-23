// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
    hashPublicApiKey,
    generatePublicApiKeyToken,
    maskPublicApiKey,
    listPublicApiKeys,
    createPublicApiKey,
    revokePublicApiKey,
    authenticatePublicApiKeyToken,
} from "@/services/publicApiKey.service";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery, getConnection: vi.fn() },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("publicApiKey.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
    });

    it("hashPublicApiKey produces deterministic sha256 hex string", () => {
        const hash1 = hashPublicApiKey("pak_live_1234567890abcdef");
        const hash2 = hashPublicApiKey("pak_live_1234567890abcdef");
        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(64);
    });

    it("generatePublicApiKeyToken produces rawKey starting with pak_live_", () => {
        const token = generatePublicApiKeyToken();
        expect(token.rawKey.startsWith("pak_live_")).toBe(true);
        expect(token.prefix.startsWith("pak_live_")).toBe(true);
        expect(token.hash).toBe(hashPublicApiKey(token.rawKey));
    });

    it("maskPublicApiKey masks token properly", () => {
        const masked = maskPublicApiKey("pak_live_7e8f", "pak_live_7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b");
        expect(masked).toBe("pak_live_7e8f••••••••1a2b");
    });

    it("listPublicApiKeys returns 2 synthetic keys for demo tenant", async () => {
        const keys = await listPublicApiKeys("demo-tenant-123");
        expect(keys.length).toBe(2);
        expect(keys[0].name).toBe("Production FinOps Pipeline");
        expect(keys[1].name).toBe("CI/CD Cost Gate");
        expect(keys[0].rateLimitPerMinute).toBe(120);
        expect(keys[0].scopes).toContain("read:cost");
    });

    it("listPublicApiKeys queries database for real tenant", async () => {
        mocks.mockPoolQuery.mockResolvedValue([
            [
                {
                    id: 5,
                    tenant_id: "tenant-live",
                    name: "Live Webhook Key",
                    key_prefix: "pak_live_8888",
                    scopes: JSON.stringify(["read:cost", "write:metrics"]),
                    rate_limit_per_min: 100,
                    enabled: 1,
                    last_used_at: null,
                    created_by: "eng@company.com",
                    created_at: "2026-08-10T12:00:00Z",
                },
            ],
            [],
        ]);

        const keys = await listPublicApiKeys("tenant-live");
        expect(keys.length).toBe(1);
        expect(keys[0].name).toBe("Live Webhook Key");
        expect(keys[0].scopes).toEqual(["read:cost", "write:metrics"]);
        expect(keys[0].isRevoked).toBe(false);
    });

    it("createPublicApiKey generates synthetic key for demo tenant without inserting into db", async () => {
        const result = await createPublicApiKey(
            {
                tenantId: "demo-tenant-123",
                name: "Demo Pipeline Key",
                rateLimitPerMinute: 80,
                scopes: ["read:cost", "read:resources"],
            },
            "user@demo.com"
        );

        expect(result.success).toBe(true);
        expect(result.rawKey.startsWith("pak_live_")).toBe(true);
        expect(result.keyItem.name).toBe("Demo Pipeline Key");
        expect(result.keyItem.rateLimitPerMinute).toBe(80);
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    it("createPublicApiKey inserts into database for real tenant", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{ insertId: 99 }, []]);

        const result = await createPublicApiKey(
            {
                tenantId: "tenant-live",
                name: "Production Gateway",
                rateLimitPerMinute: 200,
                scopes: ["read:cost", "read:budgets", "read:recommendations"],
            },
            "admin@company.com"
        );

        expect(result.success).toBe(true);
        expect(result.keyItem.id).toBe("99");
        expect(result.keyItem.name).toBe("Production Gateway");
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO PublicApiKeys"),
            expect.arrayContaining(["tenant-live", "Production Gateway", 200])
        );
    });

    it("revokePublicApiKey disables key in database", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{ affectedRows: 1 }, []]);

        const ok = await revokePublicApiKey("tenant-live", 99);
        expect(ok).toBe(true);
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("UPDATE PublicApiKeys SET enabled = FALSE WHERE id = ? AND tenant_id = ?"),
            [99, "tenant-live"]
        );
    });

    it("authenticatePublicApiKeyToken verifies valid token and updates last_used_at", async () => {
        mocks.mockPoolQuery.mockImplementation((sql) => {
            if (sql.includes("SELECT id, tenant_id, name, scopes, rate_limit_per_min FROM PublicApiKeys")) {
                return Promise.resolve([
                    [
                        {
                            id: 7,
                            tenant_id: "tenant-live",
                            name: "Live Ingestion",
                            scopes: JSON.stringify(["read:cost", "write:metrics"]),
                            rate_limit_per_min: 150,
                        },
                    ],
                    [],
                ]);
            }
            if (sql.includes("UPDATE PublicApiKeys SET last_used_at")) {
                return Promise.resolve([{}, []]);
            }
            return Promise.resolve([[], []]);
        });

        const auth = await authenticatePublicApiKeyToken("pak_live_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
        expect(auth).toEqual({
            tenantId: "tenant-live",
            keyId: 7,
            name: "Live Ingestion",
            scopes: ["read:cost", "write:metrics"],
            rateLimitPerMin: 150,
        });
    });
});
