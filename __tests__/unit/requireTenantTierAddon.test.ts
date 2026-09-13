// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const queryMock = vi.fn();
const getActiveAddons = vi.fn(async () => [] as Array<{ addonKey: string }>);
vi.mock("@/modules/storage/db", () => ({
    default: { query: (...a: unknown[]) => queryMock(...a) },
    initializeDatabase: vi.fn(async () => {}),
}));
vi.mock("@/services/tenantAddons.service", () => ({
    TenantAddonsService: { getActiveAddons: (...a: unknown[]) => getActiveAddons(...(a as [])) },
}));

import { requireTenantTier, AuthError } from "@/lib/requestAuth";

const SECRETO = "un-secreto-de-cron-suficientemente-largo";
const pedido = (path: string) =>
    new NextRequest(`http://localhost${path}`, { headers: { "x-cron-auth": SECRETO } });

/** hasSystemRole (no superadmin) + SELECT tier. */
const tenantProfessional = () => {
    queryMock.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ tier: "Professional" }]]);
};

beforeEach(() => {
    queryMock.mockReset();
    getActiveAddons.mockReset();
    getActiveAddons.mockResolvedValue([]);
    process.env.CRON_SECRET = SECRETO;
});
afterEach(() => { delete process.env.CRON_SECRET; });

describe("requireTenantTier mira los add-ons antes de rechazar", () => {
    // El agujero: el gating por modulo era solo client-side. Un Professional que
    // compraba "Seguridad" veia la pantalla y se comia un 403 en cada fetch.
    it("deja pasar al que compro el modulo aunque su tier no llegue", async () => {
        tenantProfessional();
        getActiveAddons.mockResolvedValue([{ addonKey: "mod_security" }]);

        const identity = await requireTenantTier(pedido("/api/intelligence/security/key-vault"), "t1", "Enterprise");
        expect(identity.tenantId).toBe("t1");
    });

    it("el modulo comprado no abre las APIs de otro modulo", async () => {
        tenantProfessional();
        getActiveAddons.mockResolvedValue([{ addonKey: "mod_security" }]);

        await expect(
            requireTenantTier(pedido("/api/intelligence/monitoring/alerts"), "t1", "Enterprise")
        ).rejects.toBeInstanceOf(AuthError);
    });

    it("sin add-ons sigue rechazando por tier", async () => {
        tenantProfessional();
        await expect(
            requireTenantTier(pedido("/api/intelligence/security/key-vault"), "t1", "Enterprise")
        ).rejects.toBeInstanceOf(AuthError);
    });

    it("si el tier alcanza no consulta add-ons (no paga la query de mas)", async () => {
        queryMock.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ tier: "Enterprise" }]]);
        await requireTenantTier(pedido("/api/intelligence/security/key-vault"), "t1", "Business");
        expect(getActiveAddons).not.toHaveBeenCalled();
    });

    // El pase vencido ya no vuelve en getActiveAddons: el corte sale de ahi.
    it("cuando el pase vence, la API vuelve a rechazar", async () => {
        tenantProfessional();
        getActiveAddons.mockResolvedValue([]); // vencido: getActiveAddons filtra por expires_at
        await expect(
            requireTenantTier(pedido("/api/intelligence/security/key-vault"), "t1", "Enterprise")
        ).rejects.toBeInstanceOf(AuthError);
    });
});
