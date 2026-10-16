// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ExecutiveReportData } from "@/types/executiveReport.types";

const { query, guard, aggregate, send, save, identity } = vi.hoisted(() => ({
    query: vi.fn(), guard: vi.fn(), aggregate: vi.fn(), send: vi.fn(), save: vi.fn(),
    identity: vi.fn(),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query }, initializeDatabase: async () => {} }));
vi.mock("@/lib/scopeDelTenant", () => ({ exigirSuscripcionDelTenant: guard }));
vi.mock("@/lib/requestAuth", async (original) => ({
    ...(await original<Record<string, unknown>>()), requireTenantAccess: identity,
}));
vi.mock("@/services/executiveReportGenerator.service", () => ({
    aggregateExecutiveReportData: aggregate, generateExecutiveAssessment: vi.fn(), dispatchExecutiveReportEmail: send,
}));
vi.mock("@/lib/executiveReportStorage", () => ({ saveExecutiveReportMarkdown: save }));
vi.mock("@/lib/notify", () => ({ createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications", () => ({ notifyTenant: vi.fn(async () => {}) }));

import { getExecutiveReportJobStatus, startExecutiveReportJob } from "@/services/executiveReportJob.service";
import { POST as startJob } from "@/app/api/reports/executive/start-job/route";

const tenant = "synthetic-requester-tenant";
const email = "verified@example.test";
const oid = "synthetic-verified-oid";
const payload = () => ({
    tenantId: tenant, scope: "SUBSCRIPTION" as const, scopeId: "synthetic-subscription",
    requestedByEmail: email, requestedByOid: oid, triggerAiAnalysis: false, sendEmailNotification: true,
});
const data: ExecutiveReportData = {
    reportId: "synthetic-report", generatedAtIso: "2026-10-17T00:00:00Z", tenantId: tenant,
    organizationName: "Synthetic", scope: "SUBSCRIPTION", scopeDisplayName: "Synthetic subscription",
    kpiMetrics: {
        mtdSpendUSD: 10, momVariationPercent: 0, projectedMonthEndUSD: 10,
        monthlySavingsIdentifiedUSD: 0, annualizedSavingsUSD: 0, criticalHighHaRisksCount: 0,
        co2ImpactKg: 0, taggingCoveragePercent: 100, commitmentsCoveragePercent: 0,
        rightsizingCandidatesCount: 0, rightsizingSavingsUSD: 0, activeAnomaliesCount: 0, budgetBurnPercent: 0,
    },
    historicalTrends: [], inefficiencyDistribution: [], haRisks: [], anomalies: [],
    rightsizingRecommendations: [], budgetsExecution: [], collectorStatus: [],
    resourceFamilies: { compute: null, databases: null, aiAndMachineLearning: null, networking: null, storage: null, others: [] },
};
let nextId = 900;
let disabled = false;
let scoped = false;
let permissionFailure = "";
beforeEach(() => {
    vi.clearAllMocks();
    disabled = false;
    scoped = false;
    permissionFailure = "";
    guard.mockReset().mockResolvedValue(undefined);
    aggregate.mockReset().mockResolvedValue(data);
    save.mockReset().mockResolvedValue("synthetic-stored.md");
    send.mockReset().mockResolvedValue(undefined);
    identity.mockReset().mockResolvedValue({ email, claims: { oid } });
    query.mockReset().mockImplementation(async (sql: string) => {
        if (sql.includes("INSERT INTO ExecutiveReportJobs")) return [{ insertId: ++nextId }];
        if (sql.includes("FROM Users WHERE")) {
            if (permissionFailure === "users") throw new Error("Synthetic identity lookup unavailable");
            return [disabled ? [{ found: 1 }] : []];
        }
        if (sql.includes("FROM UserScopes")) {
            if (permissionFailure === "scopes") throw new Error("Synthetic scope lookup unavailable");
            return [scoped ? [{ perspective_id: 42, group_name: null }] : []];
        }
        return [[]];
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

async function settled(jobId: string, status: "COMPLETED" | "FAILED") {
    await vi.waitFor(async () => {
        expect((await getExecutiveReportJobStatus(jobId, tenant)).status).toBe(status);
    });
}
function expectNoEmail() {
    expect(send).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => String(sql).includes("SET emailed_to_requester_at"))).toBe(false);
}

describe("executive worker reauthorizes the captured requester", () => {
    it.each(["", "   "])("rejects missing requester %j before persistence", async (requestedByEmail) => {
        await expect(startExecutiveReportJob({ ...payload(), requestedByEmail }))
            .rejects.toMatchObject({ status: 401, code: "IDENTITY_EMAIL_REQUIRED" });
        expect(query).not.toHaveBeenCalled();
        expect(aggregate).not.toHaveBeenCalled();
    });
    it("the HTTP handler does not substitute a body email for a verified identity without email", async () => {
        identity.mockResolvedValue({ email: "", claims: { oid } });
        const response = await startJob(new NextRequest("https://example.test/api/reports/executive/start-job", {
            method: "POST", body: JSON.stringify(payload()),
        }));
        expect(response.status).toBe(401);
        expect(query).not.toHaveBeenCalled();
        expectNoEmail();
    });
    it("the HTTP handler captures only verified email/OID and dispatches to that email", async () => {
        const response = await startJob(new NextRequest("https://example.test/api/reports/executive/start-job", {
            method: "POST", body: JSON.stringify({
                ...payload(), requestedByEmail: "forged@example.test", requestedByOid: "forged-oid",
            }),
        }));
        expect(response.status).toBe(200);
        const job = await response.json();
        await settled(job.jobId, "COMPLETED");
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: email }));
        expect(query).toHaveBeenCalledWith(expect.stringContaining("account_status = 'DISABLED'"), [tenant, email, oid]);
        expect(query).toHaveBeenCalledWith(expect.stringContaining("AND u.entra_oid = ?"), [tenant, email, oid]);
        expect(JSON.stringify(query.mock.calls)).not.toContain("forged");
        expect(guard).toHaveBeenCalledTimes(4); // HTTP, service, worker, email.
        expect(query).toHaveBeenCalledWith(expect.stringContaining("SET emailed_to_requester_at"),
            [Number(job.jobId), tenant]);
    });
    it.each(["disabled", "scoped", "users", "scopes"])("denies %s before worker collection", async (failure) => {
        disabled = failure === "disabled";
        scoped = failure === "scoped";
        permissionFailure = failure;
        const job = await startExecutiveReportJob(payload());
        await settled(job.jobId, "FAILED");
        expect(aggregate).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        expectNoEmail();
        expect(console.error).toHaveBeenCalled();
    });
    it.each(["disabled", "scoped", "users", "scopes"])("suppresses email after %s changes during generation", async (failure) => {
        aggregate.mockImplementation(async () => {
            disabled = failure === "disabled";
            scoped = failure === "scoped";
            permissionFailure = failure;
            return data;
        });
        const job = await startExecutiveReportJob(payload());
        await settled(job.jobId, "COMPLETED");
        expect(save).toHaveBeenCalledOnce();
        expectNoEmail();
        expect(console.error).toHaveBeenCalledWith("[runRealJobProcess] Email dispatch error:", expect.any(Error));
    });
    it("suppresses email when subscription ownership recheck fails after generation", async () => {
        guard.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("Synthetic subscription revoked"));
        const job = await startExecutiveReportJob(payload());
        await settled(job.jobId, "COMPLETED");
        expectNoEmail();
        expect(console.error).toHaveBeenCalledWith("[runRealJobProcess] Email dispatch error:", expect.any(Error));
    });
    it("preserves the explicit no-email option", async () => {
        const job = await startExecutiveReportJob({ ...payload(), sendEmailNotification: false });
        await settled(job.jobId, "COMPLETED");
        expect(guard).toHaveBeenCalledTimes(2);
        expectNoEmail();
    });
});
