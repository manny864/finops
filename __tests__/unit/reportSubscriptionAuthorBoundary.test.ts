// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { role, query, send } = vi.hoisted(() => ({ role: vi.fn(), query: vi.fn(), send: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query } }));
vi.mock("@/lib/requestAuth", async (original) => ({
    ...(await original<Record<string, unknown>>()), requireTenantRole: role,
}));
vi.mock("@/services/reportDispatch.service", () => ({ enviarSuscripcion: send }));
import { POST } from "@/app/api/reports/subscriptions/route";

beforeEach(() => { vi.resetAllMocks(); });

describe("human report subscriptions require a verified author", () => {
    it.each(["", "   "])("rejects unusable identity email %j before persistence or delivery", async (email) => {
        role.mockResolvedValue({ email });
        const response = await POST(new NextRequest("https://example.test/api/reports/subscriptions", {
            method: "POST", body: JSON.stringify({ tenantId: "tenant", reportType: "gasto-por-equipo",
                recipients: ["synthetic@example.test"], frequency: "daily", enviarAhora: true,
                createdBy: "forged@example.test" }),
        }));
        expect(response.status).toBe(401);
        expect(query).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });
});
