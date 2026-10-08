// @vitest-environment node
/**
 * Fase 4 de IA (gasto externo): las rutas. La demo responde sin guard; leer
 * pide plan Business y escribir además Admin u Owner; los motivos del
 * servicio salen como `{ error, reason }` con su status; y el cron
 * `external-spend-poll` exige CRON_SECRET.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => {
    class AuthError extends Error {
        status: number;
        constructor(message: string, status = 401) {
            super(message);
            this.status = status;
        }
    }
    return {
        AuthError,
        tier: vi.fn(),
        role: vi.fn(),
        svc: {
            getOverview: vi.fn(), uploadDocument: vi.fn(), getDocumentDetail: vi.fn(), updateDocument: vi.fn(),
            approveDocument: vi.fn(), rejectDocument: vi.fn(), getDocumentFile: vi.fn(), createCommitment: vi.fn(),
            deleteCommitment: vi.fn(), processPendingDocuments: vi.fn(), purgeExpiredFiles: vi.fn(),
        },
        alerts: vi.fn(),
        cronRun: vi.fn(),
    };
});
vi.mock("@/lib/requestAuth", () => ({ requireTenantTier: m.tier, requireTenantRole: m.role, AuthError: m.AuthError }));
vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() }, initializeDatabase: vi.fn(), insertPlatformAiUsage: vi.fn() }));
vi.mock("@/services/externalSpend.service", async (importActual) => ({
    ...(await importActual<typeof import("@/services/externalSpend.service")>()),
    ...m.svc,
}));
vi.mock("@/services/commitmentRenewalAlerts.service", () => ({ sendCommitmentRenewalAlerts: m.alerts }));
vi.mock("@/lib/cronRunTracker", () => ({ recordCronRun: m.cronRun }));

import { ExternalSpendError } from "@/services/externalSpend.service";
import { EXTERNAL_SPEND_MAX_BYTES } from "@/types/externalSpend.types";
import { GET as listGET, POST as uploadPOST } from "@/app/api/intelligence/external-spend/route";
import { GET as docGET, PATCH as docPATCH, POST as docPOST } from "@/app/api/intelligence/external-spend/[id]/route";
import { GET as fileGET } from "@/app/api/intelligence/external-spend/[id]/file/route";
import { POST as commitmentPOST } from "@/app/api/intelligence/external-spend/commitments/route";
import { DELETE as commitmentDELETE } from "@/app/api/intelligence/external-spend/commitments/[id]/route";
import { GET as cronGET, POST as cronPOST } from "@/app/api/cron/external-spend-poll/route";

const URL_BASE = "http://localhost/api/intelligence/external-spend";
const get = (path: string) => new NextRequest(`${URL_BASE}${path}`);
const json = (path: string, method: string, body: unknown) =>
    new NextRequest(`${URL_BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function upload(fields: { tenantId?: string; type?: string; file?: File }) {
    const form = new FormData();
    if (fields.tenantId) form.set("tenantId", fields.tenantId);
    if (fields.type) form.set("type", fields.type);
    if (fields.file) form.set("file", fields.file);
    return new NextRequest(URL_BASE, { method: "POST", body: form });
}
const pdf = (size = 16) => new File([Buffer.concat([Buffer.from("%PDF"), Buffer.alloc(size - 4)])], "f.pdf", { type: "application/pdf" });

beforeEach(() => {
    vi.clearAllMocks();
    m.tier.mockResolvedValue(undefined);
    m.role.mockResolvedValue({ email: "ana@x.com", tenantId: "t1" });
    m.svc.getDocumentDetail.mockResolvedValue({ id: 5, status: "needs_review", lines: [] });
});

describe("GET /api/intelligence/external-spend", () => {
    it("la demo responde con datos de muestra sin pasar por el guard", async () => {
        const res = await listGET(get("?tenantId=demo-tenant"));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.documents.length).toBeGreaterThan(0);
        expect(body.commitments.length).toBeGreaterThan(0);
        expect(m.tier).not.toHaveBeenCalled();
        expect(m.svc.getOverview).not.toHaveBeenCalled();
    });

    it("un tenant real pide plan Business", async () => {
        m.svc.getOverview.mockResolvedValue({ documents: [] });
        const req = get("?tenantId=t1");
        expect((await listGET(req)).status).toBe(200);
        expect(m.tier).toHaveBeenCalledWith(req, "t1", "Business");
        expect(m.svc.getOverview).toHaveBeenCalledWith("t1");
    });

    it("sin tenantId, 400; el guard que rechaza sale con su status", async () => {
        const bad = await listGET(get(""));
        expect(bad.status).toBe(400);
        expect((await bad.json()).reason).toBe("invalid_input");
        m.tier.mockRejectedValue(new m.AuthError("Plan insuficiente", 403));
        const res = await listGET(get("?tenantId=t1"));
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "Plan insuficiente" });
    });
});

describe("POST /api/intelligence/external-spend (subida)", () => {
    it("sube con el usuario del token, como Admin u Owner", async () => {
        m.svc.uploadDocument.mockResolvedValue({ id: 1, status: "needs_review" });
        const req = upload({ tenantId: "t1", type: "contract", file: pdf() });
        const res = await uploadPOST(req);
        expect(res.status).toBe(201);
        expect(m.role).toHaveBeenCalledWith(req, "t1", ["Admin", "Owner"]);
        const arg = m.svc.uploadDocument.mock.calls[0][0];
        expect(arg).toMatchObject({ tenantId: "t1", userEmail: "ana@x.com", docType: "contract", originalName: "f.pdf" });
        expect(arg.bytes.subarray(0, 4).toString()).toBe("%PDF");
    });

    it("un rol sin permiso no sube", async () => {
        m.role.mockRejectedValue(new m.AuthError("Rol insuficiente", 403));
        expect((await uploadPOST(upload({ tenantId: "t1", type: "invoice", file: pdf() }))).status).toBe(403);
        expect(m.svc.uploadDocument).not.toHaveBeenCalled();
    });

    it.each([
        ["sin archivo", { tenantId: "t1", type: "invoice" }, 400, "invalid_input"],
        ["tipo desconocido", { tenantId: "t1", type: "receipt", file: pdf() }, 400, "invalid_input"],
        ["más de 10 MB", { tenantId: "t1", type: "invoice", file: pdf(EXTERNAL_SPEND_MAX_BYTES + 1) }, 413, "file_too_large"],
    ])("%s → %i %s", async (_caso, fields, status, reason) => {
        const res = await uploadPOST(upload(fields));
        expect(res.status).toBe(status);
        expect((await res.json()).reason).toBe(reason);
        expect(m.svc.uploadDocument).not.toHaveBeenCalled();
    });

    it.each([
        ["feature_disabled", 403],
        ["quota", 429],
        ["rate_limited", 429],
        ["not_configured", 503],
        ["duplicate", 409],
        ["file_type", 415],
    ] as const)("el motivo %s del servicio sale con %i", async (reason, status) => {
        m.svc.uploadDocument.mockRejectedValue(new ExternalSpendError(reason));
        const res = await uploadPOST(upload({ tenantId: "t1", type: "invoice", file: pdf() }));
        expect(res.status).toBe(status);
        expect((await res.json()).reason).toBe(reason);
    });
});

describe("/api/intelligence/external-spend/[id]", () => {
    it("la demo trae el detalle de muestra; un id que no existe es 404 y uno inválido 400", async () => {
        const res = await docGET(get("/103?tenantId=demo-tenant"), ctx("103"));
        expect(res.status).toBe(200);
        expect((await res.json()).lines.length).toBeGreaterThan(0);
        expect((await docGET(get("/999?tenantId=demo-tenant"), ctx("999"))).status).toBe(404);
        expect((await docGET(get("/abc?tenantId=t1"), ctx("abc"))).status).toBe(400);
        expect(m.tier).not.toHaveBeenCalled();
    });

    const header = {
        vendorName: "Contoso", invoiceNumber: "1", invoiceDate: "2026-09-30", dueDate: null, periodStart: null, periodEnd: null,
        currency: "USD", subtotal: 100, tax: 0, total: 100,
    };

    it("PATCH valida el cuerpo, corrige y devuelve el detalle", async () => {
        const bad = await docPATCH(json("/5", "PATCH", { tenantId: "t1", header: { ...header, invoiceDate: "2026-02-30" }, lines: [] }), ctx("5"));
        expect(bad.status).toBe(400);
        expect(m.svc.updateDocument).not.toHaveBeenCalled();

        const res = await docPATCH(json("/5", "PATCH", { tenantId: "t1", header, lines: [] }), ctx("5"));
        expect(res.status).toBe(200);
        expect(m.svc.updateDocument).toHaveBeenCalledWith("t1", 5, { header, lines: [] });
        expect((await res.json()).id).toBe(5);
    });

    it("PATCH sobre algo que ya no espera revisión: 409", async () => {
        m.svc.updateDocument.mockRejectedValue(new ExternalSpendError("invalid_state"));
        expect((await docPATCH(json("/5", "PATCH", { tenantId: "t1", header, lines: [] }), ctx("5"))).status).toBe(409);
    });

    it("POST aprueba o rechaza con el revisor del token", async () => {
        await docPOST(json("/5", "POST", { tenantId: "t1", action: "approve" }), ctx("5"));
        expect(m.svc.approveDocument).toHaveBeenCalledWith("t1", 5, "ana@x.com");
        await docPOST(json("/5", "POST", { tenantId: "t1", action: "reject" }), ctx("5"));
        expect(m.svc.rejectDocument).toHaveBeenCalledWith("t1", 5, "ana@x.com");
        expect((await docPOST(json("/5", "POST", { tenantId: "t1", action: "delete" }), ctx("5"))).status).toBe(400);
    });

    it("aprobar con bloqueantes: 422 con el motivo", async () => {
        m.svc.approveDocument.mockRejectedValue(new ExternalSpendError("blocking_issues"));
        const res = await docPOST(json("/5", "POST", { tenantId: "t1", action: "approve" }), ctx("5"));
        expect(res.status).toBe(422);
        expect((await res.json()).reason).toBe("blocking_issues");
    });
});

describe("GET /api/intelligence/external-spend/[id]/file", () => {
    it("sirve el original como adjunto, con nosniff y sin caché", async () => {
        m.svc.getDocumentFile.mockResolvedValue({ name: 'fac"tura;x.pdf', mime: "application/pdf", bytes: Buffer.from("%PDF-1.7") });
        const res = await fileGET(get("/5/file?tenantId=t1"), ctx("5"));
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="fac_tura_x.pdf"');
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(res.headers.get("Cache-Control")).toBe("private, no-store");
        expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7");
    });

    it("410 si la retención ya lo borró; 404 si no es del tenant", async () => {
        m.svc.getDocumentFile.mockResolvedValue(null);
        expect((await fileGET(get("/5/file?tenantId=t1"), ctx("5"))).status).toBe(410);
        m.svc.getDocumentFile.mockRejectedValue(new ExternalSpendError("not_found"));
        expect((await fileGET(get("/5/file?tenantId=t1"), ctx("5"))).status).toBe(404);
    });

    it("503 si el storage no responde: es transitorio, no que el original ya no esté", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        m.svc.getDocumentFile.mockRejectedValue(new Error("getaddrinfo ENOTFOUND cuenta.blob.core.windows.net"));
        const res = await fileGET(get("/5/file?tenantId=t1"), ctx("5"));
        expect(res.status).toBe(503);
        expect((await res.json()).error).toBe("No se pudo leer el original. Probá de nuevo en unos minutos.");
        log.mockRestore();
    });
});

describe("compromisos", () => {
    const commitment = { vendorName: "Fabrikam", commitmentType: "saas_subscription", amount: 1200, currency: "USD", startDate: "2026-01-01", endDate: "2026-12-31" };

    it("alta con los valores por defecto", async () => {
        m.svc.createCommitment.mockResolvedValue(3);
        const res = await commitmentPOST(json("/commitments", "POST", { tenantId: "t1", ...commitment }));
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ id: 3 });
        expect(m.svc.createCommitment).toHaveBeenCalledWith("t1", "ana@x.com", {
            ...commitment, renewalDate: null, noticeDays: 0, autoRenew: false, sourceDocumentId: null,
        });
    });

    it.each([
        ["fin antes del inicio", { endDate: "2025-12-31" }],
        ["moneda que no es ISO 4217", { currency: "XYZ" }],
        ["tipo desconocido", { commitmentType: "loan" }],
        ["monto negativo", { amount: -1 }],
    ])("rechaza %s", async (_caso, patch) => {
        const res = await commitmentPOST(json("/commitments", "POST", { tenantId: "t1", ...commitment, ...patch }));
        expect(res.status).toBe(400);
        expect(m.svc.createCommitment).not.toHaveBeenCalled();
    });

    it("baja: ok, o 404 si no es del tenant", async () => {
        const req = new NextRequest(`${URL_BASE}/commitments/3?tenantId=t1`, { method: "DELETE" });
        expect(await (await commitmentDELETE(req, ctx("3"))).json()).toEqual({ ok: true });
        expect(m.role).toHaveBeenCalledWith(req, "t1", ["Admin", "Owner"]);
        m.svc.deleteCommitment.mockRejectedValue(new ExternalSpendError("not_found"));
        expect((await commitmentDELETE(req, ctx("3"))).status).toBe(404);
    });
});

describe("cron external-spend-poll", () => {
    const SECRET = "una-clave-larga-de-cron-123";
    const cron = (auth?: string) =>
        new NextRequest("http://localhost/api/cron/external-spend-poll", { headers: auth ? { authorization: auth } : {} });

    beforeEach(() => {
        process.env.CRON_SECRET = SECRET;
        m.svc.processPendingDocuments.mockResolvedValue({ processed: 2, errors: [] });
        m.svc.purgeExpiredFiles.mockResolvedValue(1);
        m.alerts.mockResolvedValue({ evaluated: 3, notified: 1, errors: [] });
    });

    it("sin CRON_SECRET 503; con otro secreto 401, sin correr nada", async () => {
        delete process.env.CRON_SECRET;
        expect((await cronGET(cron(`Bearer ${SECRET}`))).status).toBe(503);
        process.env.CRON_SECRET = SECRET;
        expect((await cronGET(cron("Bearer otro-secreto-cualquiera"))).status).toBe(401);
        expect(m.svc.processPendingDocuments).not.toHaveBeenCalled();
    });

    it("avanza los documentos, purga, avisa y deja registro (GET y POST)", async () => {
        for (const handler of [cronGET, cronPOST]) {
            const res = await handler(cron(`Bearer ${SECRET}`));
            expect(await res.json()).toEqual({ success: true, processed: 2, purged: 1, evaluated: 3, notified: 1 });
        }
        expect(m.cronRun).toHaveBeenCalledWith(expect.objectContaining({ cronName: "external-spend-poll", status: "ok" }));
    });

    it("con errores parciales responde igual y queda en warning", async () => {
        m.svc.processPendingDocuments.mockResolvedValue({ processed: 1, errors: ["7: timeout"] });
        const res = await cronGET(cron(`Bearer ${SECRET}`));
        expect((await res.json()).errors).toEqual(["7: timeout"]);
        expect(m.cronRun).toHaveBeenCalledWith(expect.objectContaining({ status: "warning" }));
    });
});
