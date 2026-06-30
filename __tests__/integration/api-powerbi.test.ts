// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getTemplatesList } from "@/app/api/templates/powerbi/route";
import { GET as getTemplateDetail } from "@/app/api/templates/powerbi/[id]/route";
import { GET as getPowerBiFeed } from "@/app/api/exports/powerbi-feed/route";

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

describe("GET /api/templates/powerbi", () => {
    it("returns 200 with count=4 and 4 templates", async () => {
        const req = makeReq("http://localhost:3000/api/templates/powerbi");
        const res = await getTemplatesList();
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.count).toBe(4);
        expect(Array.isArray(data.templates)).toBe(true);
        expect(data.templates.length).toBe(4);
    });

    it("each template has required fields", async () => {
        const req = makeReq("http://localhost:3000/api/templates/powerbi");
        const res = await getTemplatesList();
        const data = await res.json();

        expect(data.templates[0]).toHaveProperty("id");
        expect(data.templates[0]).toHaveProperty("name");
        expect(data.templates[0]).toHaveProperty("description");
        expect(data.templates[0]).toHaveProperty("category");
        expect(data.templates[0]).toHaveProperty("downloadUrl");
    });
});

describe("GET /api/templates/powerbi/[id]", () => {
    it("returns 200 with template and usage for valid id", async () => {
        const req = makeReq("http://localhost:3000/api/templates/powerbi/cost-overview");
        const params = Promise.resolve({ id: "cost-overview" });

        const res = await getTemplateDetail(req, { params });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.template).toBeDefined();
        expect(data.template.id).toBe("cost-overview");
        expect(data.usage).toBeDefined();
        expect(data.usage.step1).toBeDefined();
        expect(data.usage.downloadPq).toBeDefined();
    });

    it("returns template with powerQueryM", async () => {
        const req = makeReq("http://localhost:3000/api/templates/powerbi/cost-overview");
        const params = Promise.resolve({ id: "cost-overview" });

        const res = await getTemplateDetail(req, { params });
        const data = await res.json();

        expect(data.template).toHaveProperty("powerQueryM");
        expect(typeof data.template.powerQueryM).toBe("string");
        expect(data.template.powerQueryM.length).toBeGreaterThan(0);
    });

    it("returns pq format as plain text when format=pq", async () => {
        const req = makeReq("http://localhost:3000/api/templates/powerbi/cost-overview?format=pq");
        const params = Promise.resolve({ id: "cost-overview" });

        const res = await getTemplateDetail(req, { params });

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
        expect(res.headers.get("Content-Disposition")).toContain("cost-overview.pq");

        const text = await res.text();
        expect(typeof text).toBe("string");
        expect(text.length).toBeGreaterThan(0);
    });

    it("returns 404 for nonexistent template", async () => {
        const req = makeReq("http://localhost:3000/api/templates/powerbi/nonexistent");
        const params = Promise.resolve({ id: "nonexistent" });

        const res = await getTemplateDetail(req, { params });
        const data = await res.json();

        expect(res.status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.error).toContain("no encontrado");
    });

    it("defaults to json format when format param not provided", async () => {
        const req = makeReq("http://localhost:3000/api/templates/powerbi/cost-overview");
        const params = Promise.resolve({ id: "cost-overview" });

        const res = await getTemplateDetail(req, { params });

        expect(res.headers.get("Content-Type")).toContain("application/json");
    });
});

describe("GET /api/exports/powerbi-feed", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
    });

    it("returns 401 without Authorization header", async () => {
        const req = makeReq("http://localhost:3000/api/exports/powerbi-feed");
        const res = await getPowerBiFeed(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error).toContain("Unauthorized");
    });

    it("returns 401 with malformed bearer token", async () => {
        const req = makeReq("http://localhost:3000/api/exports/powerbi-feed", {
            headers: { "Authorization": "Bearer notmcp" },
        });

        const res = await getPowerBiFeed(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.success).toBe(false);
    });

    it("returns 401 if key not found in database", async () => {
        mocks.mockPoolQuery.mockResolvedValue([[], []]);

        const validKey = "mcp_test1234567890";
        const req = makeReq("http://localhost:3000/api/exports/powerbi-feed", {
            headers: { "Authorization": `Bearer ${validKey}` },
        });

        const res = await getPowerBiFeed(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.success).toBe(false);
        expect(data.error).toContain("Unauthorized");
    });

    it("returns 200 with costs data for valid key with type=costs", async () => {
        mocks.mockPoolQuery.mockResolvedValue([[{ tenant_id: "tenant-x" }], []]);

        const validKey = "mcp_test1234567890";
        const req = makeReq("http://localhost:3000/api/exports/powerbi-feed?type=costs&days=30", {
            headers: { "Authorization": `Bearer ${validKey}` },
        });

        const res = await getPowerBiFeed(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.type).toBe("costs");
        expect(data.days).toBe(30);
        expect(Array.isArray(data.data)).toBe(true);
    });

    it("returns 200 with budgets data for type=budgets", async () => {
        mocks.mockPoolQuery.mockImplementation((sql, params) => {
            if (sql.includes("SELECT tenant_id FROM MCPApiKeys")) {
                return Promise.resolve([[{ tenant_id: "tenant-x" }], []]);
            }
            if (sql.includes("FROM Budgets")) {
                return Promise.resolve([[], []]);
            }
            return Promise.resolve([[], []]);
        });

        const validKey = "mcp_test1234567890";
        const req = makeReq("http://localhost:3000/api/exports/powerbi-feed?type=budgets", {
            headers: { "Authorization": `Bearer ${validKey}` },
        });

        const res = await getPowerBiFeed(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.type).toBe("budgets");
        expect(Array.isArray(data.data)).toBe(true);
    });

    it("returns 200 with zombies data for type=zombies", async () => {
        mocks.mockPoolQuery.mockImplementation((sql, params) => {
            if (sql.includes("SELECT tenant_id FROM MCPApiKeys")) {
                return Promise.resolve([[{ tenant_id: "tenant-x" }], []]);
            }
            if (sql.includes("FROM zombies")) {
                return Promise.resolve([[], []]);
            }
            return Promise.resolve([[], []]);
        });

        const validKey = "mcp_test1234567890";
        const req = makeReq("http://localhost:3000/api/exports/powerbi-feed?type=zombies", {
            headers: { "Authorization": `Bearer ${validKey}` },
        });

        const res = await getPowerBiFeed(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.type).toBe("zombies");
        expect(Array.isArray(data.data)).toBe(true);
    });

    it("returns 200 with sustainability data for type=sustainability", async () => {
        mocks.mockPoolQuery.mockResolvedValue([[{ tenant_id: "tenant-x" }], []]);

        const validKey = "mcp_test1234567890";
        const req = makeReq("http://localhost:3000/api/exports/powerbi-feed?type=sustainability", {
            headers: { "Authorization": `Bearer ${validKey}` },
        });

        const res = await getPowerBiFeed(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.type).toBe("sustainability");
        expect(Array.isArray(data.byRegion)).toBe(true);
    });

    it("returns 400 for unsupported type", async () => {
        mocks.mockPoolQuery.mockResolvedValue([[{ tenant_id: "tenant-x" }], []]);

        const validKey = "mcp_test1234567890";
        const req = makeReq("http://localhost:3000/api/exports/powerbi-feed?type=invalid", {
            headers: { "Authorization": `Bearer ${validKey}` },
        });

        const res = await getPowerBiFeed(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("no soportado");
    });
});
