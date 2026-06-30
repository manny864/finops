// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getRates, POST as postRates } from "@/app/api/fx/rates/route";
import { GET as getPreference, POST as postPreference } from "@/app/api/fx/preference/route";

const mocks = vi.hoisted(() => {
    return {
        mockPoolQuery: vi.fn(),
        mockGetRate: vi.fn(),
        mockGetUserDisplayCurrency: vi.fn(),
        mockSetUserDisplayCurrency: vi.fn(),
        mockRequireTenantAccess: vi.fn(),
    };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: mocks.mockPoolQuery, getConnection: vi.fn() },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/fx", () => ({
    SUPPORTED_CURRENCIES: [
        "USD", "EUR", "GBP", "ARS", "BRL", "MXN", "CLP", "COP", "PEN",
        "CAD", "AUD", "JPY", "CHF", "CNY", "INR",
    ],
    getRate: mocks.mockGetRate,
    getUserDisplayCurrency: mocks.mockGetUserDisplayCurrency,
    setUserDisplayCurrency: mocks.mockSetUserDisplayCurrency,
    isSupportedCurrency: (c: string) => {
        const supported = [
            "USD", "EUR", "GBP", "ARS", "BRL", "MXN", "CLP", "COP", "PEN",
            "CAD", "AUD", "JPY", "CHF", "CNY", "INR",
        ];
        return supported.includes(c);
    },
}));

vi.mock("@/lib/requestAuth", async () => {
    const actual = await vi.importActual<typeof import("@/lib/requestAuth")>("@/lib/requestAuth");
    return {
        ...actual,
        requireTenantAccess: mocks.mockRequireTenantAccess,
        AuthError: actual.AuthError,
    };
});

function makeReq(url: string, init?: RequestInit) {
    return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

describe("GET /api/fx/rates", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
        mocks.mockGetRate.mockReset();
        mocks.mockPoolQuery.mockResolvedValue([[], []]);
        mocks.mockGetRate.mockRejectedValue(new Error("Rate not available"));
    });

    it("returns 200 with success=true and rates.USD=1", async () => {
        const req = makeReq("http://localhost:3000/api/fx/rates");
        const res = await getRates(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.rates.USD).toBe("1");
    });

    it("includes all supported currencies in rates", async () => {
        const req = makeReq("http://localhost:3000/api/fx/rates");
        const res = await getRates(req);
        const data = await res.json();

        expect(data.rates).toHaveProperty("USD");
        expect(data.rates).toHaveProperty("EUR");
        expect(data.rates).toHaveProperty("ARS");
        expect(data.rates).toHaveProperty("BRL");
    });
});

describe("GET /api/fx/preference", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
        mocks.mockGetUserDisplayCurrency.mockReset();
        mocks.mockRequireTenantAccess.mockReset();
        mocks.mockGetUserDisplayCurrency.mockResolvedValue("USD");
    });

    it("returns 400 without tenantId", async () => {
        const req = makeReq("http://localhost:3000/api/fx/preference");
        const res = await getPreference(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("tenantId");
    });

    it("returns 200 with currency when tenantId provided and authenticated", async () => {
        mocks.mockRequireTenantAccess.mockResolvedValue({
            tenantId: "t-123",
            email: "user@example.com",
            claims: { oid: "oid-123", tid: "t-123" },
            isCorporateDomain: false,
        });

        const req = makeReq("http://localhost:3000/api/fx/preference?tenantId=t-123");
        const res = await getPreference(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.currency).toBe("USD");
        expect(data.supported).toBeDefined();
        expect(Array.isArray(data.supported)).toBe(true);
    });

    it("returns 401 when auth fails", async () => {
        const { AuthError } = await vi.importActual<typeof import("@/lib/requestAuth")>("@/lib/requestAuth");
        mocks.mockRequireTenantAccess.mockRejectedValue(new AuthError("Access denied", 401));

        const req = makeReq("http://localhost:3000/api/fx/preference?tenantId=t-123");
        const res = await getPreference(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.success).toBe(false);
    });
});

describe("POST /api/fx/preference", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPoolQuery.mockReset();
        mocks.mockSetUserDisplayCurrency.mockReset();
        mocks.mockRequireTenantAccess.mockReset();
        mocks.mockSetUserDisplayCurrency.mockResolvedValue(undefined);
        mocks.mockRequireTenantAccess.mockResolvedValue({
            tenantId: "t-123",
            email: "user@example.com",
            claims: { oid: "oid-123", tid: "t-123" },
            isCorporateDomain: false,
        });
    });

    it("returns 400 when tenantId missing", async () => {
        const req = makeReq("http://localhost:3000/api/fx/preference", {
            method: "POST",
            body: JSON.stringify({ currency: "EUR" }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postPreference(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("tenantId");
    });

    it("returns 400 when currency missing", async () => {
        const req = makeReq("http://localhost:3000/api/fx/preference", {
            method: "POST",
            body: JSON.stringify({ tenantId: "t-123" }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postPreference(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("currency");
    });

    it("returns 400 for unsupported currency", async () => {
        const req = makeReq("http://localhost:3000/api/fx/preference", {
            method: "POST",
            body: JSON.stringify({ tenantId: "t-123", currency: "ZZZ" }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postPreference(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.success).toBe(false);
        expect(data.error).toContain("no soportada");
    });

    it("returns 200 with success for valid currency", async () => {
        const req = makeReq("http://localhost:3000/api/fx/preference", {
            method: "POST",
            body: JSON.stringify({ tenantId: "t-123", currency: "EUR" }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postPreference(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.currency).toBe("EUR");
    });

    it("returns 401 when auth fails", async () => {
        const { AuthError } = await vi.importActual<typeof import("@/lib/requestAuth")>("@/lib/requestAuth");
        mocks.mockRequireTenantAccess.mockRejectedValue(new AuthError("Access denied", 401));

        const req = makeReq("http://localhost:3000/api/fx/preference", {
            method: "POST",
            body: JSON.stringify({ tenantId: "t-123", currency: "EUR" }),
            headers: { "Content-Type": "application/json" },
        });

        const res = await postPreference(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.success).toBe(false);
    });
});
