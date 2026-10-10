// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), identity: vi.fn(), initialize: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: mocks.query }, initializeDatabase: mocks.initialize }));
vi.mock("@/lib/requestAuth", async (importOriginal) => ({
    ...await importOriginal<typeof import("@/lib/requestAuth")>(),
    requireRequestIdentity: mocks.identity,
}));

import { GET } from "@/app/api/tenants/route";

beforeEach(() => vi.clearAllMocks());

it("rejects an email-less identity before any tenant query", async () => {
    mocks.identity.mockResolvedValue({ email: "", tenantId: "tenant-1", claims: { tid: "tenant-1" } });
    const response = await GET(new NextRequest("https://example.com/api/tenants"));
    expect(response.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
});