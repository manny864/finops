// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { query, generate, mail, tracker } = vi.hoisted(() => ({
    query: vi.fn(), generate: vi.fn(), mail: vi.fn(), tracker: vi.fn(),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query }, initializeDatabase: async () => {} }));
vi.mock("@/lib/emailHelper", () => ({ sendEmailStrict: mail }));
vi.mock("@/services/reportRenderers.service", () => ({ GENERADORES: { synthetic: generate } }));
vi.mock("@/lib/cronRunTracker", () => ({ recordCronRun: tracker }));
vi.mock("@/lib/cronJobSecret", () => ({ cronSecretForJob: () => "synthetic-cron-secret-long" }));
import { enviarSuscripcion } from "@/services/reportDispatch.service";
import { GET as cron } from "@/app/api/cron/report-subscriptions/route";

const sub = {
    id: 42, tenantId: "synthetic-tenant", reportType: "synthetic",
    scope: { perspectiveId: 7, grupo: "Allowed" }, recipients: ["one@example.test", "two@example.test"],
};
const report = { asunto: "Synthetic", html: "<p>Allowed</p>", csv: "Allowed,10\n", filas: 1 };
let current: boolean;
let author: string | null;
let disabled: boolean;
let scoped: boolean;
let failLookup: boolean;
beforeEach(() => {
    vi.resetAllMocks();
    current = true;
    author = "author@example.test";
    disabled = false;
    scoped = false;
    failLookup = false;
    generate.mockResolvedValue(report);
    mail.mockResolvedValue(undefined);
    query.mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT created_by FROM ReportSubscriptions")) {
            if (failLookup) throw new Error("Synthetic lookup unavailable");
            return [current ? [{ created_by: author }] : []];
        }
        if (sql.includes("FROM Users")) return [[{ account_status: disabled ? "DISABLED" : "ACTIVE" }]];
        if (sql.includes("FROM UserScopes")) return [scoped ? [{ perspective_id: 7, group_name: "Allowed" }] : []];
        if (sql.includes("FROM Tenants")) return [[{ company_name: "Synthetic" }]];
        return [[]];
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

function expectUnmarked() {
    expect(query.mock.calls.some(([sql]) => String(sql).includes("SET last_sent_at"))).toBe(false);
}

describe("scheduled and immediate reports revalidate their persisted authority", () => {
    it("checks tenant, active flag and exact scope/recipients before generation and each recipient", async () => {
        const result = await enviarSuscripcion(sub);
        expect(result.enviados).toBe(2);
        const lookups = query.mock.calls.filter(([sql]) => String(sql).includes("SELECT created_by"));
        expect(lookups).toHaveLength(3);
        for (const [sql, params] of lookups) {
            expect(sql).toContain("tenant_id = ? AND active = 1");
            expect(sql).toContain("scope_json <=> CAST(? AS JSON)");
            expect(sql).toContain("recipients_json = CAST(? AS JSON)");
            expect(params).toEqual([42, sub.tenantId, "synthetic", JSON.stringify(sub.scope), JSON.stringify(sub.recipients)]);
        }
        expect(query).toHaveBeenCalledWith(expect.stringContaining("SET last_sent_at"),
            [sub.id, sub.tenantId]);
    });
    it.each(["changed", "disabled", "scoped", "lookup"])("blocks %s before generation", async (reason) => {
        current = reason !== "changed";
        disabled = reason === "disabled";
        scoped = reason === "scoped";
        failLookup = reason === "lookup";
        await expect(enviarSuscripcion(sub)).rejects.toThrow();
        expect(generate).not.toHaveBeenCalled();
        expect(mail).not.toHaveBeenCalled();
        expectUnmarked();
    });
    it.each(["changed", "disabled", "scoped", "lookup"])("blocks %s changed during generation, including immediate send", async (reason) => {
        generate.mockImplementation(async () => {
            current = reason !== "changed";
            disabled = reason === "disabled";
            scoped = reason === "scoped";
            failLookup = reason === "lookup";
            return report;
        });
        await expect(enviarSuscripcion(sub, { marcarEnviado: false })).rejects.toThrow();
        expect(mail).not.toHaveBeenCalled();
        expectUnmarked();
    });
    it("stops remaining recipients after suspension during the first dispatch", async () => {
        mail.mockImplementationOnce(async () => { disabled = true; });
        await expect(enviarSuscripcion(sub)).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
        expect(mail).toHaveBeenCalledOnce();
        expectUnmarked();
    });
    it("preserves historical process subscriptions without a human author", async () => {
        author = null;
        await enviarSuscripcion(sub);
        expect(mail).toHaveBeenCalledTimes(2);
        expect(query.mock.calls.some(([sql]) => String(sql).includes("FROM Users"))).toBe(false);
    });
    it("preserves directory-based author access when no Users row exists", async () => {
        const normal = query.getMockImplementation()!;
        query.mockImplementation(async (sql: string, ...args: unknown[]) =>
            sql.includes("FROM Users") ? [[]] : normal(sql, ...args));
        await enviarSuscripcion(sub);
        expect(mail).toHaveBeenCalledTimes(2);
    });
    it("does not mark a zero-row report if authority changes during generation", async () => {
        generate.mockImplementation(async () => { current = false; return { ...report, filas: 0 }; });
        await expect(enviarSuscripcion(sub)).rejects.toMatchObject({ code: "REPORT_SUBSCRIPTION_CHANGED" });
        expectUnmarked();
    });
    it("propagates scope SQL failure rather than dispatching with tenant-wide access", async () => {
        const normal = query.getMockImplementation()!;
        query.mockImplementation(async (sql: string, ...args: unknown[]) => {
            if (sql.includes("FROM UserScopes")) throw new Error("Synthetic scope SQL unavailable");
            return normal(sql, ...args);
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await expect(enviarSuscripcion(sub)).rejects.toThrow("Synthetic scope SQL unavailable");
        expect(warn).toHaveBeenCalled();
        expect(mail).not.toHaveBeenCalled();
    });
    it("records cron warning and failure count instead of a green run when dispatch is denied", async () => {
        const normal = query.getMockImplementation()!;
        query.mockImplementation(async (sql: string, ...args: unknown[]) => {
            if (sql.includes("FROM ReportSubscriptions rs")) return [[{
                ...sub, frequency: "daily", dayOfWeek: null, dayOfMonth: null, lastSentAt: null,
                createdBy: author, estadoDelAutor: "ACTIVE", zona: "UTC",
            }]];
            return normal(sql, ...args);
        });
        current = false;
        const response = await cron(new NextRequest("https://example.test/api/cron/report-subscriptions", {
            headers: { authorization: "Bearer synthetic-cron-secret-long" },
        }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ fallidas: 1, enviadas: 0 });
        expect(tracker).toHaveBeenCalledWith(expect.objectContaining({ status: "warning" }));
        expect(console.error).toHaveBeenCalled();
        expect(mail).not.toHaveBeenCalled();
    });
});
