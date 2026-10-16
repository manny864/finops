// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { access, guard, aggregate, html, pdf } = vi.hoisted(() => ({
    access: vi.fn(), guard: vi.fn(), aggregate: vi.fn(), html: vi.fn(), pdf: vi.fn(),
}));
vi.mock("@/lib/requestAuth", async (original) => ({
    ...(await original<Record<string, unknown>>()), requireTenantAccess: access,
}));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirSuscripcionDelTenant: guard }));
vi.mock("@/modules/storage/db", () => ({ initializeDatabase: async () => {} }));
vi.mock("@/services/executiveReportGenerator.service", () => ({
    aggregateExecutiveTelemetry: aggregate, buildExecutiveReportHtmlDocument: html,
}));
vi.mock("@/services/pdfCompiler.service", () => ({ compileExecutiveReportPdfBuffer: pdf }));
import { AuthError } from "@/lib/requestAuth";
import { GET as readData } from "@/app/api/reports/executive/data/route";
import { POST as exportReport } from "@/app/api/reports/executive/export-pdf/route";

const marker = "synthetic-private-report-content";
const tenantId = "synthetic-response-tenant";
const paths = ["data", "html", "pdf"] as const;
type Path = typeof paths[number];
function invoke(path: Path, tenant = tenantId, scope = "SUBSCRIPTION") {
    const args = { tenantId: tenant, scope, scopeId: "synthetic-subscription", format: path };
    return path === "data"
        ? readData(new NextRequest(`https://example.test/api/reports/executive/data?${new URLSearchParams(args)}`))
        : exportReport(new NextRequest("https://example.test/api/reports/executive/export-pdf", {
            method: "POST", body: JSON.stringify(args),
        }));
}
beforeEach(() => {
    vi.resetAllMocks();
    access.mockResolvedValue({ email: "verified@example.test" });
    guard.mockResolvedValue(undefined);
    aggregate.mockResolvedValue({ organizationName: marker });
    html.mockReturnValue(`<html>${marker}</html>`);
    pdf.mockResolvedValue(Buffer.from(marker));
    vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe.each(paths)("executive %s response is authorized after generation", (path) => {
    it("returns the result only after the second tenant and subscription checks", async () => {
        const response = await invoke(path);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain(marker);
        expect(access).toHaveBeenCalledTimes(2);
        expect(guard).toHaveBeenCalledTimes(2);
        const output = path === "pdf" ? pdf : path === "html" ? html : aggregate;
        expect(access.mock.invocationCallOrder[1]).toBeGreaterThan(output.mock.invocationCallOrder[0]);
        expect(guard).toHaveBeenLastCalledWith(tenantId, "synthetic-subscription");
    });
    it.each([
        new AuthError("Cuenta deshabilitada.", 403, "ACCOUNT_DISABLED"),
        new AuthError("Alcance cambiado.", 403, "SCOPE_ROUTE_NOT_AWARE"),
        new AuthError("Token expirado.", 401),
    ])("does not return generated data after access revocation: %s", async (error) => {
        access.mockResolvedValueOnce({ email: "verified@example.test" }).mockRejectedValueOnce(error);
        const response = await invoke(path);
        expect(response.status).toBe(error.status);
        expect(await response.text()).not.toContain(marker);
    });
    it("does not return generated data when subscription ownership is revoked", async () => {
        guard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new AuthError("Foreign subscription", 404));
        const response = await invoke(path);
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain(marker);
    });
    it("reports a failed reauthorization lookup instead of returning generated data", async () => {
        access.mockResolvedValueOnce({ email: "verified@example.test" })
            .mockRejectedValueOnce(new Error("Synthetic lookup unavailable"));
        const response = await invoke(path);
        expect(response.status).toBe(500);
        expect(await response.text()).not.toContain(marker);
        expect(console.error).toHaveBeenCalled();
    });
    it("rechecks identity for TENANT_ALL without inventing a subscription check", async () => {
        expect((await invoke(path, tenantId, "TENANT_ALL")).status).toBe(200);
        expect(access).toHaveBeenCalledTimes(2);
        expect(guard).not.toHaveBeenCalled();
    });
    it("preserves public synthetic demo data without real tenant lookups", async () => {
        expect((await invoke(path, "demo-tenant-response")).status).toBe(200);
        expect(access).not.toHaveBeenCalled();
        expect(guard).not.toHaveBeenCalled();
    });
});
