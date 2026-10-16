// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StartReportJobPayload } from "@/types/executiveReportJob.types";
import { NextRequest } from "next/server";

const { query, guard, aggregate } = vi.hoisted(() => ({
    query: vi.fn(), guard: vi.fn(), aggregate: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query }, initializeDatabase: async () => {} }));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirSuscripcionDelTenant: guard }));
vi.mock("@/lib/requestAuth", async (original) => ({
    ...(await original<Record<string, unknown>>()),
    requireTenantAccess: vi.fn(async () => ({ email: "synthetic-requester@example.test" })),
}));
vi.mock("@/services/executiveReportGenerator.service", () => ({
    aggregateExecutiveReportData: aggregate, generateExecutiveAssessment: vi.fn(), dispatchExecutiveReportEmail: vi.fn(),
}));
import { startExecutiveReportJob, getExecutiveReportJobStatus } from "@/services/executiveReportJob.service";
import { POST as startJob } from "@/app/api/reports/executive/start-job/route";
import { AuthError } from "@/lib/requestAuth";

let nextId = 800;
const tenant = "synthetic-job-scope-tenant";
const payload = (extra: Partial<StartReportJobPayload> = {}): StartReportJobPayload => ({
    tenantId: tenant, scope: "SUBSCRIPTION", scopeId: "synthetic-owned-subscription", ...extra,
});
beforeEach(() => {
    vi.clearAllMocks();
    guard.mockReset().mockResolvedValue(undefined);
    query.mockReset().mockImplementation(async (sql: string) =>
        sql.includes("INSERT INTO ExecutiveReportJobs") ? [{ insertId: ++nextId }] : [[]]);
});

describe("executive job scope survives the asynchronous boundary", () => {
    it("normalizes TENANT_ALL to All even with a supplied subscription ID", async () => {
        await startExecutiveReportJob(payload({ scope: "TENANT_ALL", scopeId: "synthetic-foreign-subscription" }));
        await vi.waitFor(() => expect(aggregate).toHaveBeenCalledOnce());
        expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO ExecutiveReportJobs"),
            expect.arrayContaining([tenant, "All"]));
        expect(guard.mock.calls.every(([, id]) => id === "All")).toBe(true);
        expect(aggregate).toHaveBeenCalledWith(tenant, "TENANT_ALL", "All");
    });
    it("normalizes lowercase all before persisting and executing", async () => {
        await startExecutiveReportJob(payload({ scopeId: "all" }));
        await vi.waitFor(() => expect(aggregate).toHaveBeenCalledWith(tenant, "TENANT_ALL", "All"));
        expect(guard.mock.calls.every(([, id]) => id === "All")).toBe(true);
    });
    it("the real start handler cannot turn TENANT_ALL with a foreign ID into a subscription worker", async () => {
        const response = await startJob(new NextRequest("https://example.test/api/reports/executive/start-job", {
            method: "POST", body: JSON.stringify(payload({ scope: "TENANT_ALL", scopeId: "synthetic-foreign-subscription" })),
        }));
        expect(response.status).toBe(200);
        await vi.waitFor(() => expect(aggregate).toHaveBeenCalledWith(tenant, "TENANT_ALL", "All"));
        expect(guard.mock.calls.every(([, id]) => id === "All")).toBe(true);
        expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO ExecutiveReportJobs"),
            [tenant, "synthetic-requester@example.test", "All",
                "Tenant completo (todas las suscripciones)", "es"]);
    });
    it("the real start handler preserves a foreign subscription rejection before persistence", async () => {
        guard.mockRejectedValue(new AuthError("Synthetic foreign subscription", 404));
        const response = await startJob(new NextRequest("https://example.test/api/reports/executive/start-job", {
            method: "POST", body: JSON.stringify(payload()),
        }));
        expect(response.status).toBe(404);
        expect(query).not.toHaveBeenCalled();
        expect(aggregate).not.toHaveBeenCalled();
    });
    it("validates a subscription before INSERT and rechecks it before collection", async () => {
        await startExecutiveReportJob(payload());
        await vi.waitFor(() => expect(aggregate).toHaveBeenCalledOnce());
        expect(guard).toHaveBeenCalledTimes(2);
        expect(guard).toHaveBeenNthCalledWith(1, tenant, "synthetic-owned-subscription");
        expect(guard).toHaveBeenNthCalledWith(2, tenant, "synthetic-owned-subscription");
        expect(guard.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[0]);
        expect(guard.mock.invocationCallOrder[1]).toBeLessThan(aggregate.mock.invocationCallOrder[0]);
    });
    it("rejects an unauthorized scope before persistence or worker collection", async () => {
        const denied = new Error("Synthetic foreign subscription");
        guard.mockRejectedValue(denied);
        await expect(startExecutiveReportJob(payload())).rejects.toBe(denied);
        expect(query).not.toHaveBeenCalled();
        expect(aggregate).not.toHaveBeenCalled();
    });
    it("worker authorization failure marks the job failed without collecting data", async () => {
        guard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Synthetic revoked subscription"));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const job = await startExecutiveReportJob(payload());
            await vi.waitFor(async () => {
                expect((await getExecutiveReportJobStatus(job.jobId, tenant)).status).toBe("FAILED");
            });
            expect(aggregate).not.toHaveBeenCalled();
            expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'failed'"),
                ["Synthetic revoked subscription", Number(job.jobId), tenant]);
            expect(log).toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
    });
    it.each([null, 7, ""])("rejects invalid scopeId %j before any effects", async (scopeId) => {
        const value = { ...payload(), scopeId };
        // JSON callers can supply values outside the TypeScript contract.
        await expect(startExecutiveReportJob(value as StartReportJobPayload))
            .rejects.toMatchObject({ status: 400, code: "INVALID_REPORT_SCOPE" });
        expect(guard).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
    });
    it("rejects unknown runtime scope names before any effects", async () => {
        const value = { ...payload(), scope: "INVALID" };
        await expect(startExecutiveReportJob(value as StartReportJobPayload))
            .rejects.toMatchObject({ status: 400, code: "INVALID_REPORT_SCOPE" });
        expect(guard).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
    });
});
