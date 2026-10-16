// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

const { access, guard, query, aggregate, compile, send } = vi.hoisted(() => ({
    access: vi.fn(), guard: vi.fn(), query: vi.fn(), aggregate: vi.fn(), compile: vi.fn(), send: vi.fn(),
}));
vi.mock("@/lib/requestAuth", async (original) => ({
    ...(await original<Record<string, unknown>>()), requireTenantAccess: access,
}));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirSuscripcionDelTenant: guard }));
vi.mock("@/modules/storage/db", () => ({ default: { query }, initializeDatabase: async () => {} }));
vi.mock("@/services/executiveReportGenerator.service", () => ({
    aggregateExecutiveTelemetry: aggregate, dispatchExecutiveReportEmail: send,
}));
vi.mock("@/services/pdfCompiler.service", () => ({ compileExecutiveReportPdfBuffer: compile }));
import { POST } from "@/app/api/reports/executive/send-email/route";
import { AuthError } from "@/lib/requestAuth";

const tenantId = "synthetic-manual-mail-tenant";
const request = (scope = "SUBSCRIPTION", tenant = tenantId) => new NextRequest(
    "https://example.test/api/reports/executive/send-email", {
        method: "POST", body: JSON.stringify({
            tenantId: tenant, scope, scopeId: "synthetic-subscription", recipientEmail: "approved@example.test",
        }),
    });
beforeEach(() => {
    vi.resetAllMocks();
    access.mockResolvedValue({ email: "author@example.test" });
    guard.mockResolvedValue(undefined);
    query.mockResolvedValue([[{ company_name: "Synthetic company" }]]);
    aggregate.mockResolvedValue({ scopeDisplayName: "Synthetic", kpiMetrics: {} });
    compile.mockResolvedValue(Buffer.from("synthetic-pdf"));
    send.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe("manual executive email reauthorizes after PDF compilation", () => {
    it("checks identity and subscription again before dispatch, using actual tenant column", async () => {
        expect((await POST(request())).status).toBe(200);
        expect(access).toHaveBeenCalledTimes(2);
        expect(guard).toHaveBeenCalledTimes(2);
        expect(access.mock.invocationCallOrder[1]).toBeGreaterThan(compile.mock.invocationCallOrder[0]);
        expect(guard.mock.invocationCallOrder[1]).toBeLessThan(send.mock.invocationCallOrder[0]);
        expect(query).toHaveBeenCalledWith("SELECT company_name FROM Tenants WHERE tenant_id = ? LIMIT 1", [tenantId]);
        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            tenantName: "Synthetic company", recipientEmail: "approved@example.test",
        }));
    });
    it.each([
        new AuthError("Cuenta deshabilitada.", 403, "ACCOUNT_DISABLED"),
        new AuthError("Alcance cambiado.", 403, "SCOPE_ROUTE_NOT_AWARE"),
        new AuthError("Token expirado.", 401),
    ])("prevents dispatch when authenticated access changes during compilation: %s", async (error) => {
        compile.mockImplementation(async () => {
            access.mockRejectedValue(error);
            return Buffer.from("synthetic-pdf");
        });
        expect((await POST(request())).status).toBe(error.status);
        expect(send).not.toHaveBeenCalled();
    });
    it("prevents dispatch on subscription revocation after compilation", async () => {
        guard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new AuthError("Foreign", 404));
        expect((await POST(request())).status).toBe(404);
        expect(send).not.toHaveBeenCalled();
    });
    it("reports a reauthorization lookup error without sending", async () => {
        access.mockResolvedValueOnce({ email: "author@example.test" })
            .mockRejectedValueOnce(new Error("Synthetic SQL lookup unavailable"));
        expect((await POST(request())).status).toBe(500);
        expect(send).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalled();
    });
    it("rechecks TENANT_ALL identity without inventing a subscription selection", async () => {
        expect((await POST(request("TENANT_ALL"))).status).toBe(200);
        expect(access).toHaveBeenCalledTimes(2);
        expect(guard).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledOnce();
    });
    it("preserves the synthetic demo path without real tenant authorization or SQL", async () => {
        expect((await POST(request("TENANT_ALL", "demo-tenant-manual-mail"))).status).toBe(200);
        expect(access).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
    });
});
