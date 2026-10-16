// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { query, aggregate } = vi.hoisted(() => ({
    query: vi.fn(),
    aggregate: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock("@/modules/storage/db", () => ({
    default: { query }, initializeDatabase: async () => {},
}));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirSuscripcionDelTenant: vi.fn(async () => {}) }));
vi.mock("@/services/executiveReportGenerator.service", () => ({
    aggregateExecutiveReportData: aggregate,
    generateExecutiveAssessment: vi.fn(),
    dispatchExecutiveReportEmail: vi.fn(),
}));
import { getExecutiveReportJobStatus, startExecutiveReportJob } from "@/services/executiveReportJob.service";
import { GET as pollJob } from "@/app/api/reports/executive/job-status/route";

const owner = "synthetic-cache-owner";
let jobId: string;
beforeAll(async () => {
    query.mockImplementation(async (sql: string) =>
        sql.includes("INSERT INTO ExecutiveReportJobs") ? [{ insertId: 731 }] : [[]]);
    const result = await startExecutiveReportJob({
        tenantId: owner, scope: "SUBSCRIPTION", scopeId: "synthetic-private-subscription",
        scopeName: "synthetic-private-scope", requestedByEmail: "synthetic-owner@example.test",
    });
    jobId = result.jobId;
});

describe("executive job memory cache is tenant scoped", () => {
    it("serves the owning tenant without a status SQL lookup", async () => {
        query.mockClear();
        const result = await getExecutiveReportJobStatus(jobId, owner);
        expect(result.success).toBe(true);
        expect(result.scopeSubscriptionId).toBe("synthetic-private-subscription");
        expect(query).not.toHaveBeenCalled();
    });
    it("cannot serve a cached real job to another real tenant", async () => {
        query.mockClear();
        const result = await getExecutiveReportJobStatus(jobId, "synthetic-cache-other");
        expect(result.success).toBe(false);
        expect(result.scopeSubscriptionId).toBeUndefined();
        expect(result.scopeSubscriptionName).toBeUndefined();
        expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE id = ? AND tenant_id = ?"),
            [731, "synthetic-cache-other"]);
    });
    it("a public demo lookup cannot reveal metadata from a real cached job", async () => {
        query.mockClear();
        const result = await getExecutiveReportJobStatus(jobId, "demo-tenant-async");
        expect(result.scopeSubscriptionId).toBeUndefined();
        expect(result.scopeSubscriptionName).toBeUndefined();
        expect(result.reportData).toBeUndefined();
        expect(result.reportMarkdown).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain("synthetic-private");
        expect(query).not.toHaveBeenCalled();
    });
    it("the real public demo handler cannot reveal a cached real job", async () => {
        const response = await pollJob(new NextRequest(
            `https://example.test/api/reports/executive/job-status?tenantId=demo-tenant-async&jobId=${jobId}`));
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.scopeSubscriptionId).toBeUndefined();
        expect(result.scopeSubscriptionName).toBeUndefined();
        expect(result.reportMarkdown).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain("synthetic-private");
    });
    it("the real tenant handler still requires authentication before cache lookup", async () => {
        const response = await pollJob(new NextRequest(
            `https://example.test/api/reports/executive/job-status?tenantId=${owner}&jobId=${jobId}`));
        expect(response.status).toBe(401);
        expect(await response.json()).not.toHaveProperty("scopeSubscriptionId");
    });
    it("a foreign cache entry does not hide a tenant-filtered persisted result", async () => {
        query.mockResolvedValueOnce([[{ id: 731, status: "completed", report_markdown: "own persisted report",
            scope_subscription_id: "own-persisted-subscription", scope_subscription_name: "own persisted scope",
            created_at: "2026-10-16", completed_at: "2026-10-16" }]]);
        const result = await getExecutiveReportJobStatus(jobId, "synthetic-cache-other");
        expect(result.success).toBe(true);
        expect(result.scopeSubscriptionId).toBe("own-persisted-subscription");
        expect(result.reportMarkdown).toBe("own persisted report");
    });
});
