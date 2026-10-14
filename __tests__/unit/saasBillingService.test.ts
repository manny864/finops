// @vitest-environment node
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    getTenantBillingDetails,
    getCustomerPortalUrl,
    cancelTenantSubscription,
} from "@/services/saasBilling.service";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
        crearSolicitud: vi.fn(),
        tieneSolicitudPendiente: vi.fn(),
    };
});

vi.mock("@/services/cancellationRequests.service", () => ({
    crearSolicitud: mocks.crearSolicitud,
    tieneSolicitudPendiente: mocks.tieneSolicitudPendiente,
}));

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery, getConnection: vi.fn() },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("saasBilling.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
        mocks.crearSolicitud.mockReset().mockResolvedValue({ id: 1, creada: true });
        mocks.tieneSolicitudPendiente.mockReset().mockResolvedValue(false);
    });

    it("getTenantBillingDetails returns synthetic Enterprise plan for demo tenant", async () => {
        const details = await getTenantBillingDetails("demo-tenant-123");
        expect(details.planTier).toBe("Enterprise");
        expect(details.status).toBe("ACTIVE");
        expect(details.billingCycle).toBe("ANNUAL");
        expect(details.paymentGateway).toBe("PADDLE");
        expect(details.isEnterprise).toBe(true);
        expect(details.invoices.length).toBe(3);
        expect(details.invoices[0].invoiceNumber).toBe("000842");
        expect(details.invoices[0]).toMatchObject({ amount: 1200, currency: "USD" });
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    // El tier sale de `Tenants`, no de `TenantSaaSSubscriptions`: esa tabla NO
    // EXISTE (sin DDL en el repo, sin otro lector ni escritor). La query moría,
    // el catch se la tragaba y el panel mostraba el default del inicializador
    // --"Enterprise"-- a todo tenant real. Y el fallback tampoco servía: filtraba
    // por `WHERE id = ?` cuando la clave es `tenant_id`.
    it("getTenantBillingDetails lee el tier de Tenants para un tenant real", async () => {
        mocks.mockPoolQuery.mockImplementation((sql) => {
            if (sql.includes("FROM Tenants WHERE tenant_id = ?")) {
                return Promise.resolve([
                    [
                        {
                            tier: "Business",
                            subscription_status: "ACTIVE",
                            marketplace_plan_id: null,
                            marketplace_source: "direct",
                            paddle_subscription_id: "sub_live_1",
                        },
                    ],
                    [],
                ]);
            }
            if (sql.includes("FROM BillingTransactions")) {
                return Promise.resolve([
                    [{ id: 7, paddle_transaction_id: "txn_01real", amount: "499.00", billed_on: new Date("2026-08-01T00:00:00Z"), currency: "USD", status: "completed" }],
                    [],
                ]);
            }
            return Promise.resolve([[], []]);
        });

        const details = await getTenantBillingDetails("tenant-live-abc");
        expect(details.planTier).toBe("Business");
        // La única pasarela es Paddle. Antes esto esperaba "STRIPE", que salía de
        // una columna de la tabla inexistente.
        expect(details.paymentGateway).toBe("PADDLE");
        expect(details.hasPaddleSubscription).toBe(true);
        expect(details.cancelAtPeriodEnd).toBe(false);
        // El historial sale de los cobros reales, sin número de factura ni PDF inventados.
        expect(details.invoices).toEqual([
            { id: "7", invoiceNumber: "000007", paddleTransactionId: "txn_01real", billingDateIso: "2026-08-01T00:00:00.000Z", amount: 499, currency: "USD", status: "PAID" },
        ]);
        const sqlHistorial = String(mocks.mockPoolQuery.mock.calls.map((c) => c[0]).find((q) => String(q).includes("BillingTransactions")));
        expect(sqlHistorial).toContain("'completed', 'refund_pending', 'refunded'");
        expect(sqlHistorial).not.toContain("SaaSInvoices");
    });

    it("el historial trae la moneda del cobro y marca los reembolsos", async () => {
        mocks.mockPoolQuery.mockImplementation((sql) =>
            String(sql).includes("FROM BillingTransactions")
                ? Promise.resolve([
                      [
                          { id: 3, paddle_transaction_id: "txn_a", amount: "100.50", currency: "EUR", status: "refund_pending", billed_on: new Date("2026-08-02T00:00:00Z") },
                          { id: 2, paddle_transaction_id: "txn_b", amount: "50.00", currency: "USD", status: "refunded", billed_on: new Date("2026-08-01T00:00:00Z") },
                      ],
                      [],
                  ])
                : Promise.resolve([[], []])
        );
        const { invoices } = await getTenantBillingDetails("tenant-live-abc");
        expect(invoices.map((i) => [i.status, i.currency, i.amount])).toEqual([
            ["REFUND_PENDING", "EUR", 100.5],
            ["REFUNDED", "USD", 50],
        ]);
    });

    it("con el evento guardado, el importe es el total cobrado y trae subtotal e impuestos", async () => {
        const raw = { data: { details: { totals: { subtotal: "29999", tax: "6300", total: "36299" } } } };
        mocks.mockPoolQuery.mockImplementation((sql) =>
            String(sql).includes("FROM BillingTransactions")
                ? Promise.resolve([[{ id: 12, paddle_transaction_id: "txn_x", amount: "299.99", currency: "USD", status: "completed", raw_event: JSON.stringify(raw), billed_on: new Date("2026-08-01T00:00:00Z") }], []])
                : Promise.resolve([[{ tier: "Business", company_name: "Acme Corp" }], []])
        );
        const d = await getTenantBillingDetails("tenant-live-abc");
        expect(d.companyName).toBe("Acme Corp");
        expect(d.invoices[0]).toMatchObject({ invoiceNumber: "000012", amount: 362.99, subtotal: 299.99, tax: 63 });
    });

    it("si no se puede leer el historial, la lista queda vacía y el resto del panel sigue", async () => {
        mocks.mockPoolQuery.mockImplementation((sql) =>
            String(sql).includes("BillingTransactions") ? Promise.reject(new Error("boom")) : Promise.resolve([[], []])
        );
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const details = await getTenantBillingDetails("tenant-live-abc");
        expect(details.invoices).toEqual([]);
    });

    it("getCustomerPortalUrl returns sandbox demo URL for mock tenant", async () => {
        const portal = await getCustomerPortalUrl("demo-tenant-123");
        expect(portal.success).toBe(true);
        expect(portal.portalUrl).toContain("paddle.com");
        expect(portal.gateway).toBe("PADDLE");
    });

    it("cancelTenantSubscription returns success for demo tenant without inserting into db", async () => {
        const result = await cancelTenantSubscription("demo-tenant-123");
        expect(result.success).toBe(true);
        expect(result.message).toContain("cancelada");
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    it("cancelTenantSubscription updates database and logs audit event for real tenant", async () => {
        // Un tenant con suscripción de Paddle y Paddle que acepta: la baja es automática (ver el describe de abajo).
        mocks.mockPoolQuery.mockImplementation(async (sql: string) =>
            String(sql).includes("SELECT paddle_subscription_id") ? [[{ paddle_subscription_id: "sub_01m4plan000000000000000000", marketplace_source: null }], []] : [{ affectedRows: 1 }, []]
        );
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
        process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_de_prueba";
        try {
            const result = await cancelTenantSubscription("tenant-live-abc", "owner@company.com");
            expect(result.success).toBe(true);
            expect(result.pendingApproval).toBeUndefined();
            // La baja se registra en `Tenants.cancel_at_period_end`. Antes escribía en
            // `TenantSaaSSubscriptions` (inexistente) y caía a un fallback con
            // `WHERE id = ?` y un valor que el ENUM no admite: no persistía nada.
            expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
                expect.stringContaining("UPDATE Tenants SET cancel_at_period_end = TRUE WHERE tenant_id = ?"),
                ["tenant-live-abc"]
            );
            expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
                expect.stringContaining("INSERT INTO AuditTrailLogs"),
                expect.arrayContaining(["tenant-live-abc", "owner@company.com", "SUBSCRIPTION_CANCEL_REQUESTED"])
            );
        } finally {
            vi.unstubAllGlobals();
            delete process.env.PADDLE_API_KEY;
        }
    });

    // Antes devolvía success aunque no escribiera en ningún lado: el cliente
    // pedía la baja, la app decía "listo" y no quedaba registro.
    it("cancelTenantSubscription falla si no actualizó ninguna fila", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{ affectedRows: 0 }, []]);
        await expect(cancelTenantSubscription("tenant-que-no-existe")).rejects.toThrow();
    });
});

describe("cancelTenantSubscription: automática o solicitud para aprobar", () => {
    const fetchMock = vi.fn();
    const SUB = "sub_01m4plan000000000000000000";
    beforeEach(() => {
        mocks.mockPoolQuery.mockReset();
        mocks.crearSolicitud.mockReset().mockResolvedValue({ id: 5, creada: true });
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
        process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_de_prueba";
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        delete process.env.PADDLE_API_KEY;
    });

    const tenant = (fila: Record<string, unknown> | null) =>
        mocks.mockPoolQuery.mockImplementation(async (sql: string) =>
            String(sql).includes("SELECT paddle_subscription_id") ? [fila ? [fila] : [], []] : [{ affectedRows: 1 }, []]
        );
    const marcaDeBaja = () => mocks.mockPoolQuery.mock.calls.some(([sql]) => String(sql).includes("UPDATE Tenants SET cancel_at_period_end"));

    it("con suscripción de Paddle que acepta: programa la baja EN PADDLE al final del período y marca la baja (automática)", async () => {
        tenant({ paddle_subscription_id: SUB, marketplace_source: null });
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

        const r = await cancelTenantSubscription("tenant-live-abc", "owner@company.com");

        expect(r.success).toBe(true);
        expect(r.pendingApproval).toBeUndefined();
        expect(fetchMock.mock.calls[0][0]).toBe(`https://sandbox-api.paddle.com/subscriptions/${SUB}/cancel`);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ effective_from: "next_billing_period" });
        expect(marcaDeBaja()).toBe(true);
        expect(mocks.crearSolicitud).not.toHaveBeenCalled();
    });

    it("si Paddle rechaza, el pedido NO se pierde ni vuelve como error: queda una solicitud para aprobar y no se marca la baja", async () => {
        tenant({ paddle_subscription_id: SUB, marketplace_source: null });
        fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: "x", detail: "Subscription already has a scheduled change" } }) });

        const r = await cancelTenantSubscription("tenant-live-abc", "owner@company.com");

        expect(r).toMatchObject({ success: true, pendingApproval: true });
        expect(mocks.crearSolicitud).toHaveBeenCalledWith({
            tenantId: "tenant-live-abc",
            requestedBy: "owner@company.com",
            reasonCode: "paddle-rejected",
            detail: expect.stringContaining("scheduled change"),
        });
        expect(marcaDeBaja()).toBe(false);
    });

    it("si Paddle no responde (red), también queda como solicitud", async () => {
        tenant({ paddle_subscription_id: SUB, marketplace_source: null });
        fetchMock.mockRejectedValue(new Error("ETIMEDOUT"));
        await expect(cancelTenantSubscription("tenant-live-abc", "owner@company.com")).resolves.toMatchObject({ pendingApproval: true });
        expect(mocks.crearSolicitud).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: "paddle-rejected", detail: expect.stringContaining("ETIMEDOUT") }));
    });

    it("sin suscripción de Paddle (alta manual, Enterprise): nada se cancela solo, queda una solicitud y no se llama a Paddle", async () => {
        tenant({ paddle_subscription_id: null, marketplace_source: null });
        const r = await cancelTenantSubscription("tenant-manual", "owner@company.com");
        expect(r).toMatchObject({ success: true, pendingApproval: true });
        expect(mocks.crearSolicitud).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-manual", reasonCode: "no-paddle-subscription" }));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(marcaDeBaja()).toBe(false);
    });

    it("un tenant que factura por el marketplace de Azure: solicitud, aunque tenga un id de Paddle", async () => {
        tenant({ paddle_subscription_id: SUB, marketplace_source: "azure_marketplace" });
        await cancelTenantSubscription("tenant-azure", "owner@company.com");
        expect(mocks.crearSolicitud).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: "azure-marketplace" }));
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sin email del solicitante queda registrado como desconocido, no como vacío", async () => {
        tenant({ paddle_subscription_id: null, marketplace_source: null });
        await cancelTenantSubscription("tenant-manual");
        expect(mocks.crearSolicitud).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: "desconocido" }));
    });

    it("un tenant inexistente falla en vez de crear una solicitud huérfana", async () => {
        tenant(null);
        await expect(cancelTenantSubscription("fantasma", "a@b.c")).rejects.toThrow(/no existe/);
        expect(mocks.crearSolicitud).not.toHaveBeenCalled();
    });

    it("el mensaje al cliente dice que está en revisión, no que se programó", async () => {
        tenant({ paddle_subscription_id: null, marketplace_source: null });
        const r = await cancelTenantSubscription("tenant-manual", "a@b.c");
        expect(r.message).toMatch(/revisa/);
        expect(r.message).not.toMatch(/se cancelará/);
    });
});

describe("getTenantBillingDetails informa si hay una cancelación en revisión", () => {
    it("cancellationPending viene de la solicitud pendiente", async () => {
        mocks.mockPoolQuery.mockReset().mockResolvedValue([[{ tier: "Professional", subscription_status: "ACTIVE", cancel_at_period_end: 0 }]]);
        mocks.tieneSolicitudPendiente.mockReset().mockResolvedValue(true);
        expect((await getTenantBillingDetails("tenant-live-abc")).cancellationPending).toBe(true);
    });

    it("en un entorno sin migrar (la tabla no existe) no rompe la pantalla", async () => {
        mocks.mockPoolQuery.mockReset().mockResolvedValue([[{ tier: "Professional", subscription_status: "ACTIVE", cancel_at_period_end: 0 }]]);
        mocks.tieneSolicitudPendiente.mockReset().mockRejectedValue(new Error("Table 'CancellationRequests' doesn't exist"));
        expect((await getTenantBillingDetails("tenant-live-abc")).cancellationPending).toBe(false);
    });
});
