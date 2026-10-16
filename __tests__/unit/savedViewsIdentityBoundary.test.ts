// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { query, getConnection, access, role } = vi.hoisted(() => ({
    query: vi.fn(), getConnection: vi.fn(), access: vi.fn(), role: vi.fn(),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query, getConnection } }));
vi.mock("@/lib/requestAuth", async (original) => ({
    ...(await original<Record<string, unknown>>()), requireTenantAccess: access, requireTenantRole: role,
}));
import { GET, POST } from "@/app/api/intelligence/views/route";

beforeEach(() => {
    vi.resetAllMocks();
    access.mockResolvedValue({ email: "" });
});

describe("empty identity cannot become the shared-view owner", () => {
    it("rejects an empty-email read without consulting views", async () => {
        const response = await GET(new NextRequest("https://example.test/api/intelligence/views?tenantId=tenant"));
        expect(response.status).toBe(401);
        expect(query).not.toHaveBeenCalled();
    });
    it.each(["", "   "])("rejects personal writes for an unusable identity email %j before opening a transaction", async (email) => {
        access.mockResolvedValue({ email });
        const response = await POST(new NextRequest("https://example.test/api/intelligence/views", {
            method: "POST", body: JSON.stringify({ tenantId: "tenant", name: "shared-existing", shared: false, isDefault: true }),
        }));
        expect(response.status).toBe(401);
        expect(getConnection).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
        expect(role).not.toHaveBeenCalled();
    });
});
