// @vitest-environment node
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    listAllTenantsForSuperAdmin,
    createManualTenant,
    updateTenantTierAndStatus,
    updateCommercialDeal,
    generatePaddleCheckoutLink,
} from "@/services/superAdminTenants.service";
import { verificarVinculo } from "@/lib/checkoutBinding";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery, getConnection: vi.fn() },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

describe("superAdminTenants.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
    });

    it("listAllTenantsForSuperAdmin returns 7 mock tenants when isMock is true", async () => {
        const tenants = await listAllTenantsForSuperAdmin(true);
        expect(tenants.length).toBe(7);
        expect(tenants[0].organizationName).toBe("ACME Corporation");
        expect(tenants[0].planTier).toBe("Enterprise");
        expect(tenants[0].salesRepName).toBe("Juan Manuel Chavez");
        expect(tenants[0].salesCommissionPercent).toBe(15.0);
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    it("listAllTenantsForSuperAdmin queries database for real superadmin call", async () => {
        mocks.mockPoolQuery.mockResolvedValue([
            [
                {
                    tenant_id: "tenant-live-01",
                    entra_tenant_id: "0000-1111-2222",
                    organization_name: "Live Enterprise Corp",
                    subscription_status: "ACTIVE",
                    plan_tier: "Enterprise",
                    sales_rep_name: "Carlos Vendedor",
                    sales_commission_percent: 12.0,
                    paddle_price_id: "pri_live_123",
                    is_manual_bypass: 1,
                    created_at: "2026-08-01T00:00:00Z",
                },
            ],
            [],
        ]);

        const tenants = await listAllTenantsForSuperAdmin(false);
        expect(tenants.length).toBe(1);
        expect(tenants[0].organizationName).toBe("Live Enterprise Corp");
        expect(tenants[0].planTier).toBe("Enterprise");
        expect(tenants[0].salesRepName).toBe("Carlos Vendedor");
    });

    it("createManualTenant creates tenant in mock mode without database calls", async () => {
        const result = await createManualTenant(
            {
                entraTenantId: "12345678-1234-1234-1234-123456789012",
                organizationName: "Mock Corp B2B",
                initialPlanTier: "Enterprise",
            },
            true
        );

        expect(result.success).toBe(true);
        expect(result.tenant.entraTenantId).toBe("12345678-1234-1234-1234-123456789012");
        expect(result.tenant.organizationName).toBe("Mock Corp B2B");
        expect(result.tenant.isManualBypass).toBe(true);
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    it("createManualTenant inserts into Tenants and TenantCommercialDeals in real mode", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);

        const result = await createManualTenant(
            {
                entraTenantId: "guid-real-001",
                organizationName: "Live Tenant Provisioned",
                initialPlanTier: "Business",
            },
            false
        );

        expect(result.success).toBe(true);
        expect(result.tenant.subscriptionStatus).toBe("ACTIVE");
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("INSERT INTO Tenants"),
            ["guid-real-001", "Live Tenant Provisioned", "Business", "ACTIVE"]
        );
    });

    // Las columnas reales de Tenants son tenant_id/company_name. El INSERT usaba
    // domain/name, que no existen en ninguna migración: el alta manual real
    // siempre tiraba error y sólo "andaba" en mock. Este test lo fija.
    it("createManualTenant uses the real Tenants column names", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);

        await createManualTenant(
            { entraTenantId: "guid-cols", organizationName: "Col Check", initialPlanTier: "Business" },
            false
        );

        const sql = String(mocks.mockPoolQuery.mock.calls[0][0]);
        expect(sql).toContain("tenant_id");
        expect(sql).toContain("company_name");
        expect(sql).not.toMatch(/\bdomain\b/);
        expect(sql).not.toMatch(/\bname\b(?!_)/);
    });

    it.each([7, 15, 30] as const)("createManualTenant sets a %i-day trial", async (days) => {
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);

        const result = await createManualTenant(
            {
                entraTenantId: `guid-trial-${days}`,
                organizationName: "Trial Corp",
                initialPlanTier: "Professional",
                trialDays: days,
            },
            false
        );

        expect(result.tenant.subscriptionStatus).toBe("TRIAL");
        const [sql, values] = mocks.mockPoolQuery.mock.calls[0];
        expect(String(sql)).toContain("DATE_ADD(NOW(), INTERVAL ? DAY)");
        expect(values).toEqual([`guid-trial-${days}`, "Trial Corp", "Professional", "TRIAL", days]);
    });

    it("createManualTenant ignores a trial length outside the whitelist", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);

        const result = await createManualTenant(
            {
                entraTenantId: "guid-bogus",
                organizationName: "Bogus Corp",
                initialPlanTier: "Business",
                trialDays: 300 as never,
            },
            false
        );

        // Sin trial, no un trial de 300 días.
        expect(result.tenant.subscriptionStatus).toBe("ACTIVE");
        const [sql, values] = mocks.mockPoolQuery.mock.calls[0];
        expect(String(sql)).toContain("NULL");
        expect(values).not.toContain(300);
    });

    it("createManualTenant in mock mode reflects the requested trial", async () => {
        const result = await createManualTenant(
            {
                entraTenantId: "guid-mock-trial",
                organizationName: "Mock Trial Corp",
                initialPlanTier: "Business",
                trialDays: 15,
            },
            true
        );

        expect(result.tenant.subscriptionStatus).toBe("TRIAL");
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
    });

    it("updateTenantTierAndStatus updates database for real call", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await updateTenantTierAndStatus(
            {
                tenantId: "tenant-live-01",
                planTier: "Enterprise",
                subscriptionStatus: "ACTIVE",
            },
            false
        );

        expect(result.success).toBe(true);
        // El WHERE viejo era `id = ? OR domain = ?`: `domain` no existe y `id` es
        // el autoincrement, no el GUID. El UPDATE nunca tocaba una fila.
        expect(mocks.mockPoolQuery).toHaveBeenCalledWith(
            expect.stringContaining("WHERE tenant_id = ?"),
            ["Enterprise", "ACTIVE", "tenant-live-01"]
        );
        const tierSql = String(mocks.mockPoolQuery.mock.calls[0][0]);
        expect(tierSql).not.toMatch(/\bdomain\b/);
    });

    it("updateCommercialDeal updates sales rep and commission in database", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await updateCommercialDeal(
            {
                tenantId: "tenant-live-01",
                salesRepName: "Mariana Lopez",
                salesCommissionPercent: 14.5,
            },
            false
        );

        expect(result.success).toBe(true);
        const [sql, values] = mocks.mockPoolQuery.mock.calls[0];
        expect(String(sql)).toContain("INSERT INTO TenantCommercialDeals");
        // `id` es VARCHAR(36) PK sin default: sin él el INSERT tira error 1364.
        expect(String(sql)).toContain("id");
        // 6 desde MEJ-14 (`sold_at` y `contract_term`, el arranque y la
        // modalidad del devengamiento) y 8 desde 2026-10-06: `sales_rep_id`, el
        // vínculo con el comercial, y al final si ese vínculo se toca.
        expect(values).toHaveLength(8);
        expect(String(values[0])).toMatch(/^[0-9a-f-]{36}$/);
        expect(values.slice(1, 5)).toEqual(["tenant-live-01", "Mariana Lopez", null, 14.5]);
        expect(String(values[5])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(values[6]).toBe("monthly");
        // Sin salesRepId en el pedido, el vínculo que ya tenía el acuerdo no se toca.
        expect(values[7]).toBe(0);
    });

    it("createManualTenant registers is_manual_bypass on TenantSubscriptions, not on the deals table", async () => {
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);

        await createManualTenant(
            { entraTenantId: "guid-bypass", organizationName: "Bypass SA", initialPlanTier: "Business" },
            false
        );

        const allSql = mocks.mockPoolQuery.mock.calls.map((c) => String(c[0]));
        const dealsSql = allSql.find((s) => s.includes("TenantCommercialDeals")) ?? "";
        const subsSql = allSql.find((s) => s.includes("TenantSubscriptions")) ?? "";

        expect(dealsSql).not.toContain("is_manual_bypass");
        expect(subsSql).toContain("is_manual_bypass");
    });

});

/**
 * El enlace Enterprise que genera el panel de SuperAdmin tiene que ser el `checkout.url` de una TRANSACCIÓN creada en Paddle.
 *
 * Antes el servicio armaba `https://buy.paddle.com/checkout?price_id=…&custom_data=…` sin llamar a Paddle; el test que lo
 * cuidaba afirmaba justamente esa URL (`toContain("price_id=")`), o sea que daba por bueno el defecto: el enlace abría un
 * marco de checkout en blanco y, aunque hubiera abierto algo, `custom_data` iba como `{ tenantId }` cuando el webhook lee
 * `tenant_id`.
 */
describe("generatePaddleCheckoutLink", () => {
    const TENANT = "81ebe027-e6af-4e09-bc73-58c9012c6408";
    const PRECIO = "pri_01kve67ce9j9b9697hm7jb58s7";
    const fetchMock = vi.fn();
    const respuesta = (cuerpo: unknown, status = 200) => ({ ok: status < 400, status, json: async () => cuerpo });
    const creada = (url: string | null = "https://finops.sandbox.paddle.io/pay/hsc_x?_ptxn=txn_01m4rzzzzzzzzzzzzzzzzzzzzz") =>
        respuesta({ data: { id: "txn_01m4rzzzzzzzzzzzzzzzzzzzzz", status: "ready", checkout: { url } } });

    beforeEach(() => {
        mocks.mockPoolQuery.mockReset();
        mocks.mockPoolQuery.mockResolvedValue([{}, []]);
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(creada());
        vi.stubGlobal("fetch", fetchMock);
        process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_de_prueba";
        process.env.PADDLE_WEBHOOK_SECRET = "secreto-de-prueba";
        vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        delete process.env.PADDLE_API_KEY;
        delete process.env.PADDLE_WEBHOOK_SECRET;
    });

    it("crea la transacción con el precio, cobro automático y el tenant y el tier en custom_data, y devuelve el checkout.url de Paddle", async () => {
        const r = await generatePaddleCheckoutLink({ tenantId: TENANT, paddlePriceId: PRECIO }, false);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://sandbox-api.paddle.com/transactions");
        expect(init.method).toBe("POST");
        expect(init.headers.Authorization).toBe("Bearer pdl_sdbx_apikey_de_prueba");
        expect(JSON.parse(init.body)).toEqual({
            items: [{ price_id: PRECIO, quantity: 1 }],
            collection_mode: "automatic",
            // snake_case: es lo que lee el webhook (`custom_data.tenant_id`); con `tenantId` el pago no activaba a nadie.
            // + el precio y la firma con que el webhook comprueba que el vínculo lo armó el servidor (checkoutBinding.ts).
            custom_data: { tenant_id: TENANT, tier: "Enterprise", price_id: PRECIO, sig: expect.any(String) },
        });
        expect(verificarVinculo(JSON.parse(init.body).custom_data, [PRECIO])).toMatchObject({ tenantId: TENANT, tier: "Enterprise" });
        expect(r).toEqual({
            checkoutUrl: "https://finops.sandbox.paddle.io/pay/hsc_x?_ptxn=txn_01m4rzzzzzzzzzzzzzzzzzzzzz",
            priceId: PRECIO,
            tenantId: TENANT,
            transactionId: "txn_01m4rzzzzzzzzzzzzzzzzzzzzz",
        });
    });

    it("el pedido a Paddle lleva un tope de tiempo", async () => {
        await generatePaddleCheckoutLink({ tenantId: TENANT, paddlePriceId: PRECIO }, false);
        expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it("con una clave de producción va a la API de producción", async () => {
        process.env.PADDLE_API_KEY = "pdl_live_apikey_de_prueba";
        await generatePaddleCheckoutLink({ tenantId: TENANT, paddlePriceId: PRECIO }, false);
        expect(fetchMock.mock.calls[0][0]).toBe("https://api.paddle.com/transactions");
    });

    it("el enlace nunca es una URL armada a mano con price_id y custom_data en la query (no abre ningún checkout)", async () => {
        const r = await generatePaddleCheckoutLink({ tenantId: TENANT, paddlePriceId: PRECIO }, false);
        expect(r.checkoutUrl).not.toContain("price_id=");
        expect(r.checkoutUrl).not.toContain("custom_data=");
        expect(r.checkoutUrl).not.toContain("buy.paddle.com/checkout");
    });

    it("registra el precio para el tenant ANTES de pedirle el enlace a Paddle: es lo que el webhook acepta como prueba del deal", async () => {
        await generatePaddleCheckoutLink({ tenantId: TENANT, paddlePriceId: `  ${PRECIO}  ` }, false);

        const [sql, params] = mocks.mockPoolQuery.mock.calls[0];
        expect(String(sql)).toContain("TenantSubscriptions");
        expect(String(sql)).toContain("paddle_price_id");
        expect(String(sql)).not.toContain("TenantCommercialDeals");
        expect(params).toContain(TENANT);
        expect(params).toContain(PRECIO); // sin los espacios
        expect(mocks.mockPoolQuery.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    });

    it("si no se puede registrar el precio (el tenant no existe, la base falla) NO le pide nada a Paddle y avisa", async () => {
        mocks.mockPoolQuery.mockRejectedValue(new Error("Cannot add or update a child row: a foreign key constraint fails"));
        await expect(generatePaddleCheckoutLink({ tenantId: TENANT, paddlePriceId: PRECIO }, false)).rejects.toThrow(/foreign key/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("si Paddle rechaza la transacción, lanza con el motivo que dio y status 502; no devuelve ningún enlace", async () => {
        fetchMock.mockResolvedValue(
            respuesta({ error: { type: "request_error", code: "transaction_default_checkout_url_not_set", detail: "Cannot create a transaction or open a checkout as no default payment link has been set for this account." } }, 400)
        );
        await expect(generatePaddleCheckoutLink({ tenantId: TENANT, paddlePriceId: PRECIO }, false)).rejects.toMatchObject({
            status: 502,
            message: expect.stringContaining("no default payment link has been set"),
        });
    });

    it("si Paddle rechaza sin cuerpo JSON, el mensaje lleva el HTTP status", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error("no json"); } });
        await expect(generatePaddleCheckoutLink({ tenantId: TENANT, paddlePriceId: PRECIO }, false)).rejects.toMatchObject({
            status: 502,
            message: expect.stringContaining("HTTP 500"),
        });
    });

    it("si Paddle crea la transacción pero no devuelve checkout.url, no inventa un enlace: 502 con la pista del default payment link", async () => {
        fetchMock.mockResolvedValue(creada(null));
        await expect(generatePaddleCheckoutLink({ tenantId: TENANT, paddlePriceId: PRECIO }, false)).rejects.toMatchObject({
            status: 502,
            message: expect.stringContaining("default payment link"),
        });
    });

    it("sin PADDLE_API_KEY falla antes de tocar la base y Paddle", async () => {
        delete process.env.PADDLE_API_KEY;
        await expect(generatePaddleCheckoutLink({ tenantId: TENANT, paddlePriceId: PRECIO }, false)).rejects.toMatchObject({
            message: expect.stringContaining("PADDLE_API_KEY"),
        });
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ["falta el tenant", { tenantId: "", paddlePriceId: PRECIO }],
        ["falta el precio", { tenantId: TENANT, paddlePriceId: "" }],
        ["el precio no empieza con pri_", { tenantId: TENANT, paddlePriceId: "pro_01kve6535wab28k3hzxekkwv32" }],
        ["el precio trae caracteres que no son de un ID", { tenantId: TENANT, paddlePriceId: "pri_x\"},{\"y" }],
    ])("%s: 400 sin llamar a la base ni a Paddle", async (_caso, payload) => {
        await expect(generatePaddleCheckoutLink(payload, false)).rejects.toMatchObject({ status: 400 });
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("el modo demo no llama a Paddle ni a la base y devuelve un enlace claramente falso", async () => {
        const r = await generatePaddleCheckoutLink({ tenantId: "tenant-acme-prod", paddlePriceId: PRECIO }, true);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(mocks.mockPoolQuery).not.toHaveBeenCalled();
        expect(r.checkoutUrl).toContain("example.invalid");
        expect(r).toMatchObject({ priceId: PRECIO, tenantId: "tenant-acme-prod" });
    });
});
