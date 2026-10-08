// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as listGET, POST as createPOST } from "@/app/api/support/tickets/route";
import { GET as detailGET, POST as replyPOST, PATCH as ticketPATCH } from "@/app/api/support/tickets/[id]/route";
import { GET as adminGET, PATCH as adminPATCH } from "@/app/api/admin/support/tickets/route";
import { POST as aiTriagePOST } from "@/app/api/admin/support/tickets/[id]/ai-triage/route";
import { POST as aiDraftPOST } from "@/app/api/admin/support/tickets/[id]/ai-draft/route";

const mocks = vi.hoisted(() => {
    class MockAuthError extends Error {
        status: number = 401;
        constructor(message: string, status = 401) {
            super(message);
            this.status = status;
        }
    }
    return {
        mockPoolQuery: vi.fn(),
        mockGetConnection: vi.fn(),
        mockRequireTenantAccess: vi.fn(),
        mockRequireSuperAdmin: vi.fn(),
        mockHasSystemRole: vi.fn(),
        mockAfter: vi.fn(),
        mockTriage: vi.fn(),
        mockDraft: vi.fn(),
        MockAuthError,
    };
});

// `after()` real exige el contexto de un request de Next; acá se captura la tarea.
vi.mock("next/server", async (importOriginal) => ({
    ...(await importOriginal<typeof import("next/server")>()),
    after: mocks.mockAfter,
}));

vi.mock("@/services/supportTicketTriage.service", () => ({ triageTicket: mocks.mockTriage }));
vi.mock("@/services/supportReplyDraft.service", () => ({ draftSupportReply: mocks.mockDraft }));

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery, getConnection: mocks.mockGetConnection },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: mocks.mockRequireTenantAccess,
    requireSuperAdmin: mocks.mockRequireSuperAdmin,
    hasSystemRole: mocks.mockHasSystemRole,
    AuthError: mocks.MockAuthError,
}));

// El rate limiter no es objeto de estas pruebas; siempre permite.
vi.mock("@/lib/rateLimiter", () => ({
    default: {
        checkByKeyDistributed: vi.fn().mockResolvedValue({ allowed: true, remaining: 99, resetAt: new Date() }),
    },
}));

const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0001";

const userIdentity = {
    claims: { tid: TENANT, name: "Test User" },
    tenantId: TENANT,
    email: "user@cliente.com",
    isCorporateDomain: false,
};

function makeReq(url: string, init?: RequestInit) {
    return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

function jsonReq(url: string, method: string, body: unknown) {
    return makeReq(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("Support Tickets API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockRequireTenantAccess.mockResolvedValue(userIdentity);
        mocks.mockHasSystemRole.mockResolvedValue(false);
    });

    describe("GET /api/support/tickets", () => {
        it("returns 400 without tenantId", async () => {
            const res = await listGET(makeReq("http://localhost:3000/api/support/tickets"));
            expect(res.status).toBe(400);
        });

        it("returns 403 when tenant access denied", async () => {
            mocks.mockRequireTenantAccess.mockRejectedValue(new mocks.MockAuthError("denegado", 403));
            const res = await listGET(makeReq(`http://localhost:3000/api/support/tickets?tenantId=${TENANT}`));
            expect(res.status).toBe(403);
        });

        it("returns tickets with quota info for the tenant tier", async () => {
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ tier: "Professional", company_name: "Contoso" }], []])
                .mockResolvedValueOnce([[{ id: 1, tenant_id: TENANT, subject: "Ayuda", status: "open", created_at: "2026-08-22T10:00:00.000Z" }], []])
                .mockResolvedValueOnce([[{ c: 2 }], []]);
            const res = await listGET(makeReq(`http://localhost:3000/api/support/tickets?tenantId=${TENANT}`));
            const json = await res.json();
            expect(res.status).toBe(200);
            // Contrato del módulo: los tickets vienen normalizados dentro de
            // `summary`, con el SLA ya calculado a partir del tier.
            expect(json.summary.tickets).toHaveLength(1);
            expect(json.summary.tickets[0].ticketNumber).toBe("TICK-1");
            expect(json.summary.tickets[0].status).toBe("OPEN");
            expect(json.summary.openTicketsCount).toBe(1);
            expect(json.summary.planSlaHours).toBe(24);
            expect(json.source).toBe("live");
            expect(json.quota).toEqual({ monthlyLimit: 20, usedThisMonth: 2, firstResponseSlaHours: 24 });
        });
    });

    describe("POST /api/support/tickets", () => {
        const validBody = {
            tenantId: TENANT,
            subject: "Problema con costos",
            message: "El dashboard muestra un valor raro.",
            category: "technical",
            priority: "high",
        };

        it("returns 400 when subject is too short", async () => {
            const res = await createPOST(jsonReq("http://localhost:3000/api/support/tickets", "POST", { ...validBody, subject: "ab" }));
            expect(res.status).toBe(400);
        });

        it("returns 403 with quotaExceeded when the Professional monthly quota is reached", async () => {
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ tier: "Professional" }], []])
                .mockResolvedValueOnce([[{ c: 20 }], []]);
            const res = await createPOST(jsonReq("http://localhost:3000/api/support/tickets", "POST", validBody));
            const json = await res.json();
            expect(res.status).toBe(403);
            expect(json.quotaExceeded).toBe(true);
        });

        it("creates ticket + first message in a transaction for unlimited tiers", async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce([[{ tier: "Enterprise" }], []]);
            const conn = {
                beginTransaction: vi.fn(),
                query: vi.fn()
                    .mockResolvedValueOnce([{ insertId: 42 }, []])
                    .mockResolvedValueOnce([{}, []]),
                commit: vi.fn(),
                rollback: vi.fn(),
                release: vi.fn(),
            };
            mocks.mockGetConnection.mockResolvedValue(conn);
            const res = await createPOST(jsonReq("http://localhost:3000/api/support/tickets", "POST", validBody));
            const json = await res.json();
            expect(res.status).toBe(201);
            expect(json.ticketId).toBe(42);
            expect(conn.commit).toHaveBeenCalled();
            expect(conn.release).toHaveBeenCalled();

            // Triaje con IA: se programa después del commit y corre fuera de la respuesta.
            expect(mocks.mockAfter).toHaveBeenCalledTimes(1);
            expect(conn.commit.mock.invocationCallOrder[0]).toBeLessThan(mocks.mockAfter.mock.invocationCallOrder[0]);
            expect(mocks.mockTriage).not.toHaveBeenCalled();
            await mocks.mockAfter.mock.calls[0][0]();
            expect(mocks.mockTriage).toHaveBeenCalledWith(
                expect.objectContaining({ ticketId: 42, tenantId: TENANT, creatorEmail: "user@cliente.com", subject: "Problema con costos" })
            );
        });

        it("si no se puede programar el triaje, el ticket se crea igual", async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce([[{ tier: "Enterprise" }], []]);
            const conn = {
                beginTransaction: vi.fn(),
                query: vi.fn().mockResolvedValueOnce([{ insertId: 43 }, []]).mockResolvedValueOnce([{}, []]),
                commit: vi.fn(),
                rollback: vi.fn(),
                release: vi.fn(),
            };
            mocks.mockGetConnection.mockResolvedValue(conn);
            mocks.mockAfter.mockImplementationOnce(() => {
                throw new Error("`after` was called outside a request scope");
            });
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const res = await createPOST(jsonReq("http://localhost:3000/api/support/tickets", "POST", validBody));
            expect(res.status).toBe(201);
            expect(conn.rollback).not.toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ticket 43"));
            errorSpy.mockRestore();
        });
    });

    describe("POST /api/support/tickets/[id] (reply)", () => {
        const params = { params: Promise.resolve({ id: "7" }) };

        it("returns 409 when ticket is closed", async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce([[{ id: 7, status: "closed" }], []]);
            const res = await replyPOST(
                jsonReq("http://localhost:3000/api/support/tickets/7", "POST", { tenantId: TENANT, message: "hola" }),
                params
            );
            expect(res.status).toBe(409);
        });

        it("stores reply as 'user' and reopens the ticket for tenant users", async () => {
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ id: 7, status: "waiting_customer" }], []])
                .mockResolvedValueOnce([{}, []])
                .mockResolvedValueOnce([{}, []]);
            const res = await replyPOST(
                jsonReq("http://localhost:3000/api/support/tickets/7", "POST", { tenantId: TENANT, message: "sigue igual" }),
                params
            );
            const json = await res.json();
            expect(res.status).toBe(201);
            expect(json.status).toBe("open");
            const insertArgs = mocks.mockPoolQuery.mock.calls[1][1];
            expect(insertArgs).toContain("user");
        });

        it("stores reply as 'support' and sets waiting_customer for superadmins", async () => {
            mocks.mockRequireTenantAccess.mockResolvedValue({
                ...userIdentity,
                email: "soporte@cscloudsolutions.com.ar",
                isCorporateDomain: true,
            });
            mocks.mockHasSystemRole.mockResolvedValue(true);
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ id: 7, status: "open" }], []])
                .mockResolvedValueOnce([{}, []])
                .mockResolvedValueOnce([{}, []]);
            const res = await replyPOST(
                jsonReq("http://localhost:3000/api/support/tickets/7", "POST", { tenantId: TENANT, message: "revisado" }),
                params
            );
            const json = await res.json();
            expect(res.status).toBe(201);
            expect(json.status).toBe("waiting_customer");
            const insertArgs = mocks.mockPoolQuery.mock.calls[1][1];
            expect(insertArgs).toContain("support");
        });

        it("si el equipo responde con un borrador de IA, lo marca como usado (KPI)", async () => {
            mocks.mockRequireTenantAccess.mockResolvedValue({
                ...userIdentity,
                email: "soporte@cscloudsolutions.com.ar",
                isCorporateDomain: true,
            });
            mocks.mockHasSystemRole.mockResolvedValue(true);
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ id: 7, status: "open" }], []])
                .mockResolvedValueOnce([{ insertId: 88 }, []])
                .mockResolvedValueOnce([{}, []])
                .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
            const res = await replyPOST(
                jsonReq("http://localhost:3000/api/support/tickets/7", "POST", {
                    tenantId: TENANT,
                    message: "Revisá la conexión con Azure.",
                    aiDraftId: "9",
                }),
                params
            );
            expect(res.status).toBe(201);
            const [sql, args] = mocks.mockPoolQuery.mock.calls[3];
            expect(sql).toContain("UPDATE SupportTicketAiDrafts SET used_at");
            expect(sql).toContain("used_at IS NULL");
            // Sólo un borrador de este mismo ticket.
            expect(args).toEqual([9, 7]);
        });

        it("ni una nota interna ni una respuesta del cliente cuentan como borrador usado", async () => {
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ id: 7, status: "open" }], []])
                .mockResolvedValueOnce([{}, []])
                .mockResolvedValueOnce([{}, []]);
            await replyPOST(
                jsonReq("http://localhost:3000/api/support/tickets/7", "POST", { tenantId: TENANT, message: "gracias", aiDraftId: 9 }),
                params
            );

            mocks.mockRequireTenantAccess.mockResolvedValue({
                ...userIdentity,
                email: "soporte@cscloudsolutions.com.ar",
                isCorporateDomain: true,
            });
            mocks.mockHasSystemRole.mockResolvedValue(true);
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ id: 7, status: "open" }], []])
                .mockResolvedValueOnce([{}, []])
                .mockResolvedValueOnce([{}, []]);
            await replyPOST(
                jsonReq("http://localhost:3000/api/support/tickets/7", "POST", {
                    tenantId: TENANT,
                    message: "borrador",
                    isInternalNote: true,
                    aiDraftId: 9,
                }),
                params
            );
            expect(mocks.mockPoolQuery).toHaveBeenCalledTimes(6);
            expect(mocks.mockPoolQuery.mock.calls.some(([sql]) => String(sql).includes("SupportTicketAiDrafts"))).toBe(false);
        });

        it("si no se puede marcar el borrador, la respuesta queda guardada igual", async () => {
            mocks.mockRequireTenantAccess.mockResolvedValue({
                ...userIdentity,
                email: "soporte@cscloudsolutions.com.ar",
                isCorporateDomain: true,
            });
            mocks.mockHasSystemRole.mockResolvedValue(true);
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ id: 7, status: "open" }], []])
                .mockResolvedValueOnce([{ insertId: 88 }, []])
                .mockResolvedValueOnce([{}, []])
                .mockRejectedValueOnce(new Error("lock wait timeout"));
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const res = await replyPOST(
                jsonReq("http://localhost:3000/api/support/tickets/7", "POST", { tenantId: TENANT, message: "listo", aiDraftId: 9 }),
                params
            );
            expect(res.status).toBe(201);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("borrador 9"));
            errorSpy.mockRestore();
        });
    });

    describe("GET /api/support/tickets/[id]", () => {
        const params = { params: Promise.resolve({ id: "7" }) };
        const ticketRow = { id: 7, tenant_id: TENANT, subject: "x", status: "open", created_at: "2026-08-22T10:00:00.000Z" };
        const messageRows = [
            { id: 1, author_role: "user", body: "no veo costos", is_internal_note: 0, ai_draft_id: null },
            { id: 2, author_role: "support", body: "Borrador [S1]", is_internal_note: 1, ai_draft_id: 9 },
        ];
        const mockThread = () =>
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[ticketRow], []])
                .mockResolvedValueOnce([messageRows, []])
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([[{ tier: "Enterprise", company_name: "Contoso" }], []]);

        it("el equipo ve qué nota interna es un borrador de IA", async () => {
            mocks.mockRequireTenantAccess.mockResolvedValue({
                ...userIdentity,
                email: "soporte@cscloudsolutions.com.ar",
                isCorporateDomain: true,
            });
            mocks.mockHasSystemRole.mockResolvedValue(true);
            mockThread();
            const res = await detailGET(makeReq(`http://localhost:3000/api/support/tickets/7?tenantId=${TENANT}`), params);
            const json = await res.json();
            expect(String(mocks.mockPoolQuery.mock.calls[1][0])).toContain("LEFT JOIN SupportTicketAiDrafts d ON d.message_id = m.id");
            expect(json.messages.map((m: { aiDraftId?: string }) => m.aiDraftId)).toEqual([undefined, "9"]);
        });

        it("el cliente no recibe el borrador (es una nota interna)", async () => {
            mockThread();
            const res = await detailGET(makeReq(`http://localhost:3000/api/support/tickets/7?tenantId=${TENANT}`), params);
            const json = await res.json();
            expect(json.messages).toHaveLength(1);
            expect(JSON.stringify(json)).not.toContain("aiDraftId");
        });
    });

    describe("PATCH /api/support/tickets/[id]", () => {
        const params = { params: Promise.resolve({ id: "7" }) };

        it("blocks tenant users from changing priority", async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce([[{ id: 7, status: "open" }], []]);
            const res = await ticketPATCH(
                jsonReq("http://localhost:3000/api/support/tickets/7", "PATCH", { tenantId: TENANT, priority: "urgent" }),
                params
            );
            expect(res.status).toBe(403);
        });

        it("blocks tenant users from setting intermediate statuses", async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce([[{ id: 7, status: "open" }], []]);
            const res = await ticketPATCH(
                jsonReq("http://localhost:3000/api/support/tickets/7", "PATCH", { tenantId: TENANT, status: "in_progress" }),
                params
            );
            expect(res.status).toBe(403);
        });

        it("lets tenant users close their ticket", async () => {
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ id: 7, status: "open" }], []])
                .mockResolvedValueOnce([{}, []]);
            const res = await ticketPATCH(
                jsonReq("http://localhost:3000/api/support/tickets/7", "PATCH", { tenantId: TENANT, status: "closed" }),
                params
            );
            expect(res.status).toBe(200);
        });

        it("blocks tenant users from changing category or module", async () => {
            mocks.mockPoolQuery.mockResolvedValueOnce([[{ id: 7, status: "open" }], []]);
            const res = await ticketPATCH(
                jsonReq("http://localhost:3000/api/support/tickets/7", "PATCH", { tenantId: TENANT, category: "billing" }),
                params
            );
            expect(res.status).toBe(403);
        });

        it("el equipo aplica prioridad, categoría y módulo en un solo PATCH (aceptar el triaje con IA)", async () => {
            mocks.mockRequireTenantAccess.mockResolvedValue({ ...userIdentity, email: "soporte@cscloudsolutions.com.ar", isCorporateDomain: true });
            mocks.mockHasSystemRole.mockResolvedValue(true);
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[{ id: 7, status: "open" }], []])
                .mockResolvedValueOnce([{}, []]);
            const res = await ticketPATCH(
                jsonReq("http://localhost:3000/api/support/tickets/7", "PATCH", {
                    tenantId: TENANT,
                    priority: "high",
                    category: "technical",
                    relatedModule: "Alerts",
                }),
                params
            );
            expect(res.status).toBe(200);
            const [sql, args] = mocks.mockPoolQuery.mock.calls[1];
            expect(sql).toContain("priority = ?, category = ?, related_module = ?");
            expect(args).toEqual(["high", "technical", "Alerts", 7, TENANT]);
            expect(sql).not.toContain("sla_deadline");
        });

        it("rechaza una categoría o un módulo desconocidos", async () => {
            mocks.mockRequireTenantAccess.mockResolvedValue({ ...userIdentity, email: "soporte@cscloudsolutions.com.ar", isCorporateDomain: true });
            mocks.mockHasSystemRole.mockResolvedValue(true);
            for (const body of [{ category: "CONSULTA" }, { relatedModule: "Billing" }]) {
                mocks.mockPoolQuery.mockResolvedValueOnce([[{ id: 7, status: "open" }], []]);
                const res = await ticketPATCH(
                    jsonReq("http://localhost:3000/api/support/tickets/7", "PATCH", { tenantId: TENANT, ...body }),
                    params
                );
                expect(res.status).toBe(400);
            }
        });
    });

    describe("GET /api/admin/support/tickets", () => {
        it("returns 403 for non-superadmins", async () => {
            mocks.mockRequireSuperAdmin.mockRejectedValue(new mocks.MockAuthError("denegado", 403));
            const res = await adminGET(makeReq("http://localhost:3000/api/admin/support/tickets"));
            expect(res.status).toBe(403);
        });

        it("returns the global queue with status counts", async () => {
            mocks.mockRequireSuperAdmin.mockResolvedValue({});
            mocks.mockPoolQuery
                .mockResolvedValueOnce([
                    [{ id: 1, tenant_id: TENANT, subject: "x", status: "open", tenant_name: "Contoso", tenant_tier: "Enterprise", created_at: "2026-08-22T10:00:00.000Z" }],
                    [],
                ])
                .mockResolvedValueOnce([[{ status: "open", c: 1 }], []])
                .mockResolvedValueOnce([[{}], []]);
            const res = await adminGET(makeReq("http://localhost:3000/api/admin/support/tickets"));
            const json = await res.json();
            expect(res.status).toBe(200);
            expect(json.summary.tickets).toHaveLength(1);
            expect(json.summary.tickets[0].tenantDisplayName).toBe("Contoso");
            // Sin asignar y sin resolver: los dos KPIs de la cola.
            expect(json.summary.unassignedCount).toBe(1);
            expect(json.summary.avgResolutionTimeHours).toBe(0);
            // Los contadores de las pills son globales y en el enum del dominio.
            expect(json.statusCounts).toEqual({ OPEN: 1, IN_PROGRESS: 0, WAITING_USER: 0, RESOLVED: 0, CLOSED: 0 });
            expect(json.summary.tickets[0].aiTriage).toBeUndefined();
        });

        it("incluye la sugerencia de triaje con IA de cada ticket", async () => {
            mocks.mockRequireSuperAdmin.mockResolvedValue({});
            mocks.mockPoolQuery
                .mockResolvedValueOnce([
                    [{
                        id: 1, tenant_id: TENANT, subject: "x", status: "open", priority: "low", tenant_tier: "Enterprise",
                        created_at: "2026-08-22T10:00:00.000Z",
                        ai_suggested_priority: "CRITICAL", ai_suggested_category: "INCIDENCIA_TECNICA", ai_suggested_module: null,
                        ai_production_impact: 1, ai_rationale: "Producción caída.", ai_confidence: "0.90",
                    }],
                    [],
                ])
                .mockResolvedValueOnce([[{ status: "open", c: 1 }], []])
                .mockResolvedValueOnce([[{}], []]);
            const res = await adminGET(makeReq("http://localhost:3000/api/admin/support/tickets"));
            const json = await res.json();
            expect(String(mocks.mockPoolQuery.mock.calls[0][0])).toContain("LEFT JOIN SupportTicketAiTriage");
            // La sugerencia no pisa la prioridad del ticket: viaja aparte.
            expect(json.summary.tickets[0].priority).toBe("LOW");
            expect(json.summary.tickets[0].aiTriage).toMatchObject({
                suggestedPriority: "CRITICAL",
                productionImpact: true,
                confidence: 0.9,
                status: "pending",
            });
        });

        it("suma los KPIs de los últimos 30 días: primera respuesta, SLA incumplido y borradores de IA usados", async () => {
            mocks.mockRequireSuperAdmin.mockResolvedValue({});
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([
                    [{ tickets_created: 12, avg_first_response_minutes: "135.0000", sla_breaches: "2", ai_drafts_generated: 5, ai_drafts_used: 3 }],
                    [],
                ]);
            const res = await adminGET(makeReq("http://localhost:3000/api/admin/support/tickets"));
            const json = await res.json();
            expect(json.kpis).toEqual({
                windowDays: 30,
                ticketsCreated: 12,
                avgFirstResponseHours: 2.3,
                slaBreaches: 2,
                aiDraftsGenerated: 5,
                aiDraftsUsed: 3,
            });
            const [sql, args] = mocks.mockPoolQuery.mock.calls[2];
            expect(sql).toContain("t.first_responded_at > t.sla_deadline");
            expect(sql).toContain("d.used_at IS NOT NULL");
            expect(args).toEqual([30, 30, 30]);
        });

        it("sin respuestas todavía el promedio queda vacío, y si los KPIs fallan la cola sale igual", async () => {
            mocks.mockRequireSuperAdmin.mockResolvedValue({});
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([[{ tickets_created: 0, avg_first_response_minutes: null, sla_breaches: 0 }], []]);
            let json = await (await adminGET(makeReq("http://localhost:3000/api/admin/support/tickets"))).json();
            expect(json.kpis.avgFirstResponseHours).toBeNull();

            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            mocks.mockPoolQuery
                .mockResolvedValueOnce([[], []])
                .mockResolvedValueOnce([[], []])
                .mockRejectedValueOnce(new Error("timeout"));
            const res = await adminGET(makeReq("http://localhost:3000/api/admin/support/tickets"));
            json = await res.json();
            expect(res.status).toBe(200);
            expect(json.kpis).toBeUndefined();
            expect(json.statusCounts.OPEN).toBe(0);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("KPIs de soporte"));
            errorSpy.mockRestore();
        });

        it("PATCH asigna el ticket al que lo pide, no a un email arbitrario del body", async () => {
            mocks.mockRequireSuperAdmin.mockResolvedValue({ email: "agente@cscloudsolutions.com.ar" });
            mocks.mockPoolQuery.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
            const res = await adminPATCH(
                jsonReq("http://localhost:3000/api/admin/support/tickets", "PATCH", { ticketId: 7, assignedAdminEmail: "me" })
            );
            const json = await res.json();
            expect(res.status).toBe(200);
            expect(json.assignedAdminEmail).toBe("agente@cscloudsolutions.com.ar");
        });
    });

    describe("POST /api/admin/support/tickets/[id]/ai-triage", () => {
        const params = { params: Promise.resolve({ id: "7" }) };
        const decide = (decision: unknown) =>
            aiTriagePOST(jsonReq("http://localhost:3000/api/admin/support/tickets/7/ai-triage", "POST", { decision }), params);

        it("returns 403 for non-superadmins", async () => {
            mocks.mockRequireSuperAdmin.mockRejectedValue(new mocks.MockAuthError("denegado", 403));
            const res = await decide("accept");
            expect(res.status).toBe(403);
            expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
        });

        it("rechaza una decisión desconocida", async () => {
            mocks.mockRequireSuperAdmin.mockResolvedValue({ email: "agente@cscloudsolutions.com.ar" });
            const res = await decide("apply");
            expect(res.status).toBe(400);
        });

        it("sella quién aceptó, sólo si la sugerencia sigue pendiente, y no toca el ticket", async () => {
            mocks.mockRequireSuperAdmin.mockResolvedValue({ email: "agente@cscloudsolutions.com.ar" });
            mocks.mockPoolQuery.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
            const res = await decide("accept");
            const json = await res.json();
            expect(res.status).toBe(200);
            expect(json.status).toBe("accepted");
            const [sql, args] = mocks.mockPoolQuery.mock.calls[0];
            expect(sql).toContain("UPDATE SupportTicketAiTriage");
            expect(sql).toContain("accepted_by = ?");
            expect(sql).toContain("accepted_at IS NULL AND dismissed_at IS NULL");
            expect(args).toEqual(["agente@cscloudsolutions.com.ar", 7]);
            expect(mocks.mockPoolQuery).toHaveBeenCalledTimes(1);
        });

        it("devuelve 409 si no hay sugerencia pendiente (ya decidida o inexistente)", async () => {
            mocks.mockRequireSuperAdmin.mockResolvedValue({ email: "agente@cscloudsolutions.com.ar" });
            mocks.mockPoolQuery.mockResolvedValueOnce([{ affectedRows: 0 }, []]);
            const res = await decide("dismiss");
            expect(res.status).toBe(409);
        });
    });

    describe("POST /api/admin/support/tickets/[id]/ai-draft", () => {
        const suggest = (id = "7") =>
            aiDraftPOST(makeReq(`http://localhost:3000/api/admin/support/tickets/${id}/ai-draft`, { method: "POST" }), {
                params: Promise.resolve({ id }),
            });
        const agent = { email: "agente@cscloudsolutions.com.ar", claims: { name: "Agente" } };

        it("returns 403 for non-superadmins", async () => {
            mocks.mockRequireSuperAdmin.mockRejectedValue(new mocks.MockAuthError("denegado", 403));
            const res = await suggest();
            expect(res.status).toBe(403);
            expect(mocks.mockDraft).not.toHaveBeenCalled();
        });

        it("valida el id y que el ticket exista y no esté cerrado", async () => {
            mocks.mockRequireSuperAdmin.mockResolvedValue(agent);
            expect((await suggest("abc")).status).toBe(400);

            mocks.mockPoolQuery.mockResolvedValueOnce([[], []]);
            expect((await suggest()).status).toBe(404);

            mocks.mockPoolQuery.mockResolvedValueOnce([[{ id: 7, tenant_id: TENANT, status: "closed" }], []]);
            expect((await suggest()).status).toBe(409);
            expect(mocks.mockDraft).not.toHaveBeenCalled();
        });

        it("pide el borrador para el tenant del ticket y a nombre del operador", async () => {
            mocks.mockRequireSuperAdmin.mockResolvedValue(agent);
            mocks.mockPoolQuery.mockResolvedValueOnce([
                [{ id: 7, tenant_id: TENANT, subject: "Sin costos", category: "technical", status: "open", created_by_email: "ana@cliente.com" }],
                [],
            ]);
            mocks.mockDraft.mockResolvedValueOnce({ aiAvailable: true, messageId: "501", draftId: "9" });
            const res = await suggest();
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ aiAvailable: true, messageId: "501", draftId: "9" });
            expect(mocks.mockDraft).toHaveBeenCalledWith(
                { id: 7, tenantId: TENANT, subject: "Sin costos", category: "technical", createdByEmail: "ana@cliente.com" },
                { email: "agente@cscloudsolutions.com.ar", name: "Agente" }
            );
        });

        it("si la IA no está disponible devuelve el motivo con 200, para que la pantalla lo traduzca", async () => {
            mocks.mockRequireSuperAdmin.mockResolvedValue(agent);
            mocks.mockPoolQuery.mockResolvedValueOnce([[{ id: 7, tenant_id: TENANT, status: "open" }], []]);
            mocks.mockDraft.mockResolvedValueOnce({ aiAvailable: false, reason: "tenant_disabled" });
            const res = await suggest();
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ aiAvailable: false, reason: "tenant_disabled" });
        });
    });
});
