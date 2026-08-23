// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/mcp/route";
import crypto from "crypto";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery, getConnection: vi.fn() },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

function makeReq(url: string, init?: RequestInit) {
    return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

function hashKey(plain: string): string {
    return crypto.createHash("sha256").update(plain).digest("hex");
}

describe("GET /api/mcp", () => {
    it("returns 200 with name and tools array", async () => {
        const req = makeReq("http://localhost:3000/api/mcp");
        const res = await GET(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.name).toBe("finops-saas-mcp");
        expect(Array.isArray(data.tools)).toBe(true);
        expect(data.tools.length).toBeGreaterThanOrEqual(5);
    });

    it("returns tools with name and description", async () => {
        const req = makeReq("http://localhost:3000/api/mcp");
        const res = await GET(req);
        const data = await res.json();

        expect(data.tools[0]).toHaveProperty("name");
        expect(data.tools[0]).toHaveProperty("description");
    });
});

describe("POST /api/mcp", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
    });

    it("returns 401 without Authorization header", async () => {
        const req = makeReq("http://localhost:3000/api/mcp", {
            method: "POST",
            body: JSON.stringify({ method: "tools/list" }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error.message).toContain("Unauthorized");
    });

    it("returns 401 with malformed bearer token", async () => {
        const req = makeReq("http://localhost:3000/api/mcp", {
            method: "POST",
            body: JSON.stringify({ method: "tools/list" }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer notmcp",
            },
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error.message).toContain("Unauthorized");
    });

    it("returns 401 if key not found in database", async () => {
        mocks.mockPoolQuery.mockResolvedValue([[], []]);

        const validKey = "mcp_test1234567890";
        const req = makeReq("http://localhost:3000/api/mcp", {
            method: "POST",
            body: JSON.stringify({ method: "tools/list" }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${validKey}`,
            },
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error.code).toBe(-32001);
    });

    it("returns 200 with tools array for tools/list with valid key", async () => {
        mocks.mockPoolQuery.mockImplementation((sql, params) => {
            if (sql.includes("SELECT id, tenant_id FROM MCPApiKeys")) {
                return Promise.resolve([[{ id: 1, tenant_id: "tenant-x" }], []]);
            }
            if (sql.includes("UPDATE MCPApiKeys SET last_used_at")) {
                return Promise.resolve([{}, []]);
            }
            return Promise.resolve([[], []]);
        });

        const validKey = "mcp_test1234567890";
        const req = makeReq("http://localhost:3000/api/mcp", {
            method: "POST",
            body: JSON.stringify({ method: "tools/list", id: 1 }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${validKey}`,
            },
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.result.tools).toBeDefined();
        expect(Array.isArray(data.result.tools)).toBe(true);
        expect(data.result.tools.length).toBeGreaterThanOrEqual(5);
    });

    it("returns initialize response for initialize method", async () => {
        mocks.mockPoolQuery.mockImplementation((sql, params) => {
            if (sql.includes("SELECT id, tenant_id FROM MCPApiKeys")) {
                return Promise.resolve([[{ id: 1, tenant_id: "tenant-x" }], []]);
            }
            if (sql.includes("UPDATE MCPApiKeys SET last_used_at")) {
                return Promise.resolve([{}, []]);
            }
            return Promise.resolve([[], []]);
        });

        const validKey = "mcp_test1234567890";
        const req = makeReq("http://localhost:3000/api/mcp", {
            method: "POST",
            body: JSON.stringify({ method: "initialize", id: 1 }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${validKey}`,
            },
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.result.serverInfo.name).toBe("finops-saas-mcp");
    });

    it("calls get_cost_summary tool and returns JSON payload", async () => {
        mocks.mockPoolQuery.mockImplementation((sql, params) => {
            if (sql.includes("SELECT id, tenant_id FROM MCPApiKeys")) {
                return Promise.resolve([[{ id: 1, tenant_id: "tenant-x" }], []]);
            }
            if (sql.includes("UPDATE MCPApiKeys SET last_used_at")) {
                return Promise.resolve([{}, []]);
            }
            if (sql.includes("SELECT sync_date as date, total_cost_usd as cost FROM cost_snapshots")) {
                return Promise.resolve([
                    [
                        { date: "2026-06-01", cost: 100 },
                        { date: "2026-06-02", cost: 120 },
                    ],
                    [],
                ]);
            }
            return Promise.resolve([[], []]);
        });

        const validKey = "mcp_test1234567890";
        const req = makeReq("http://localhost:3000/api/mcp", {
            method: "POST",
            body: JSON.stringify({
                method: "tools/call",
                params: { name: "get_cost_summary", arguments: { days: 30 } },
                id: 1,
            }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${validKey}`,
            },
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.result.isError).toBe(false);
        const parsed = JSON.parse(data.result.content[0].text);
        expect(parsed.totalCostUSD).toBe(220);
        expect(parsed.avgDailyUSD).toBe(110);
    });

    it("returns error for unknown tool", async () => {
        mocks.mockPoolQuery.mockImplementation((sql, params) => {
            if (sql.includes("SELECT id, tenant_id FROM MCPApiKeys")) {
                return Promise.resolve([[{ id: 1, tenant_id: "tenant-x" }], []]);
            }
            if (sql.includes("UPDATE MCPApiKeys SET last_used_at")) {
                return Promise.resolve([{}, []]);
            }
            return Promise.resolve([[], []]);
        });

        const validKey = "mcp_test1234567890";
        const req = makeReq("http://localhost:3000/api/mcp", {
            method: "POST",
            body: JSON.stringify({
                method: "tools/call",
                params: { name: "non_existent_tool" },
                id: 1,
            }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${validKey}`,
            },
        });

        const res = await POST(req);
        const data = await res.json();

        expect(data.error.code).toBe(-32601);
        expect(data.error.message).toContain("Tool not found");
    });
});
