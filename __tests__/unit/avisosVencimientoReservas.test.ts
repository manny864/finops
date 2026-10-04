// @vitest-environment node
/**
 * MEJ-16, criterio 3 — avisos de vencimiento de reservas a 90, 60 y 30 días.
 *
 * Lo que se cuida: que cada escalón se avise UNA vez aunque el cron corra todos
 * los días, que una corrida perdida no pierda el aviso, y que una reserva que
 * ya no está viva (cancelada, dividida, fusionada) no avise.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
    escalonPara, diasHastaVencer, avisosDeVencimiento, gravedad, textoDelAviso,
} from "@/services/reservationExpiryAlerts.service";
import type { ActiveReservationDetail } from "@/services/reservationService";

const HOY = new Date("2026-10-04T12:00:00Z");

/** Una reserva que vence en `dias` días contados desde HOY. */
function reserva(dias: number, extra: Partial<ActiveReservationDetail> = {}): ActiveReservationDetail {
    const vence = new Date(Date.UTC(2026, 9, 4 + dias)).toISOString();
    return {
        reservationId: `r-${dias}`, orderId: "o", name: `RI ${dias}d`, status: "Succeeded",
        provisioningState: "Succeeded", expiryDate: vence, scopeType: "Shared", scope: "Shared",
        type: "VirtualMachines", productName: "D2s_v5", region: "eastus", renew: false, quantity: 1,
        term: "P1Y", utilizationLastDay: null, utilizationLast7Days: null, ...extra,
    };
}

describe("la escalera", () => {
    it.each([
        [0, 30], [1, 30], [30, 30], [31, 60], [60, 60], [61, 90], [90, 90],
    ])("a %i días le toca el escalón de %i", (dias, escalon) => {
        expect(escalonPara(dias)).toBe(escalon);
    });

    it("fuera de la ventana o ya vencida, ninguno", () => {
        expect(escalonPara(91)).toBeNull();
        expect(escalonPara(-1)).toBeNull();
    });

    it("cuenta días de calendario en UTC, no horas", () => {
        expect(diasHastaVencer("2026-10-05", new Date("2026-10-04T23:59:00Z"))).toBe(1);
        expect(diasHastaVencer("2026-10-04", new Date("2026-10-04T00:01:00Z"))).toBe(0);
    });
});

describe("qué reservas avisan", () => {
    it("una corrida perdida no pierde el aviso: a 58 días todavía toca el de 60", () => {
        const [a] = avisosDeVencimiento([reserva(58)], HOY);
        expect(a.escalon).toBe(60);
    });

    it("lo que ya no está vivo no avisa, aunque su fecha siga adelante", () => {
        const avisos = avisosDeVencimiento([
            reserva(20, { reservationId: "cancelada", provisioningState: "Cancelled" }),
            reserva(20, { reservationId: "dividida", provisioningState: "Split" }),
            reserva(20, { reservationId: "fusionada", provisioningState: "Merged" }),
            reserva(20, { reservationId: "viva", status: "Expiring" }),
        ], HOY);
        expect(avisos.map((a) => a.reservationId)).toEqual(["viva"]);
    });

    it("sin fecha o más allá de 90 días, no avisa; el resto sale de la más próxima a la más lejana", () => {
        const avisos = avisosDeVencimiento([
            reserva(80), reserva(120), reserva(10), reserva(45, { expiryDate: null }),
        ], HOY);
        expect(avisos.map((a) => a.dias)).toEqual([10, 80]);
    });
});

describe("qué tan fuerte avisa", () => {
    it("con renovación automática no deja de cubrir: es informativo", () => {
        expect(gravedad(avisosDeVencimiento([reserva(10, { renew: true })], HOY))).toBe("info");
    });

    it("sin renovación, a 30 días o menos es crítico; antes, advertencia", () => {
        expect(gravedad(avisosDeVencimiento([reserva(10)], HOY))).toBe("critical");
        expect(gravedad(avisosDeVencimiento([reserva(45)], HOY))).toBe("warning");
    });

    it("el texto dice cuál se renueva sola y cuál no", () => {
        const { message } = textoDelAviso(avisosDeVencimiento([reserva(10), reserva(40, { renew: true })], HOY));
        expect(message).toContain("RI 10d — vence el 2026-10-14 (en 10 días) · SIN renovación automática");
        expect(message).toContain("RI 40d — vence el 2026-11-13 (en 40 días) · se renueva sola");
    });
});

// ─── El cron ────────────────────────────────────────────────────────────────

const m = vi.hoisted(() => ({
    query: vi.fn(),
    credencial: vi.fn(),
    reservas: vi.fn(),
    modelo: vi.fn(),
    addons: vi.fn(),
    campanita: vi.fn(),
    canales: vi.fn(),
}));

vi.mock("@/modules/storage/db", () => ({
    default: { query: m.query },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/azure", () => ({ getAzureCredential: m.credencial }));
vi.mock("@/lib/lighthouseAccess", () => ({ getAccessModel: m.modelo }));
vi.mock("@/services/tenantAddons.service", () => ({ TenantAddonsService: { getActiveAddons: m.addons } }));
vi.mock("@/services/reservationService", () => ({ getActiveReservations: m.reservas }));
vi.mock("@/lib/notify", () => ({ createNotification: m.campanita }));
vi.mock("@/lib/notifications", () => ({ notifyTenant: m.canales }));
vi.mock("@/lib/cronRunTracker", () => ({ recordCronRun: vi.fn() }));

const SECRET = "una-clave-larga-de-cron-123";
const pedir = () => new NextRequest(new URL("http://localhost:3000/api/cron/reservation-expiry-alerts"), {
    headers: { authorization: `Bearer ${SECRET}` },
});

describe("GET /api/cron/reservation-expiry-alerts", () => {
    let tenants: { tenant_id: string; tier: string }[];
    let anotados: Set<string>;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CRON_SECRET = SECRET;
        tenants = [{ tenant_id: "t-ent", tier: "Enterprise" }];
        anotados = new Set();
        // La tabla de avisos, de verdad: la clave primaria es la que decide.
        m.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
            if (/FROM Tenants/.test(sql)) return [tenants];
            if (/INSERT IGNORE INTO ReservationExpiryNotices/.test(sql)) {
                const k = args.join("|");
                if (anotados.has(k)) return [{ affectedRows: 0 }];
                anotados.add(k);
                return [{ affectedRows: 1 }];
            }
            return [[]];
        });
        m.credencial.mockResolvedValue({});
        m.modelo.mockResolvedValue("app_registration");
        m.addons.mockResolvedValue([]);
        m.reservas.mockResolvedValue([reserva(45)]);
        m.canales.mockResolvedValue({ sent: 1, failed: 0, results: [] });
    });

    it("sin el secreto del cron no corre", async () => {
        const { GET } = await import("@/app/api/cron/reservation-expiry-alerts/route");
        const res = await GET(new NextRequest(new URL("http://localhost:3000/api/cron/reservation-expiry-alerts")));
        expect(res.status).toBe(401);
    });

    it("avisa una vez por escalón aunque corra todos los días", async () => {
        const { GET } = await import("@/app/api/cron/reservation-expiry-alerts/route");
        await GET(pedir());
        await GET(pedir());
        expect(m.campanita).toHaveBeenCalledTimes(1);
        expect(m.canales).toHaveBeenCalledTimes(1);
        expect(m.campanita.mock.calls[0][0]).toMatchObject({
            tenantId: "t-ent", severity: "warning", params: { count: 1, days: 45 },
            href: "/intelligence/optimizacion-y-ahorro/reservas-de-instancias-ris",
        });
    });

    it("cuando pasan los días y la reserva baja al escalón siguiente, vuelve a avisar", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
            const { GET } = await import("@/app/api/cron/reservation-expiry-alerts/route");
            vi.setSystemTime(HOY);
            await GET(pedir());                       // 45 días: escalón de 60
            vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
            await GET(pedir());                       // 25 días: escalón de 30
            vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
            await GET(pedir());                       // 24 días: mismo escalón, nada
            expect(m.campanita).toHaveBeenCalledTimes(2);
            expect(m.campanita.mock.calls[1][0]).toMatchObject({ severity: "critical", params: { days: 25 } });
            expect(m.canales.mock.calls[1][1]).toMatchObject({ severity: "error" });
        } finally {
            vi.useRealTimers();
        }
    });

    it("si la reserva se renueva y cambia su fecha, la escalera empieza de nuevo", async () => {
        const { GET } = await import("@/app/api/cron/reservation-expiry-alerts/route");
        await GET(pedir());
        m.reservas.mockResolvedValue([{ ...reserva(45), expiryDate: reserva(50).expiryDate }]);
        await GET(pedir());
        expect(m.campanita).toHaveBeenCalledTimes(2);
    });

    it("un tenant por Lighthouse no se consulta: la lista sería la de nuestro directorio", async () => {
        m.modelo.mockResolvedValue("lighthouse");
        const { GET } = await import("@/app/api/cron/reservation-expiry-alerts/route");
        await GET(pedir());
        expect(m.credencial).not.toHaveBeenCalled();
        expect(m.campanita).not.toHaveBeenCalled();
    });

    it("sin la pantalla de reservas no avisa, salvo que haya comprado el módulo", async () => {
        tenants = [{ tenant_id: "t-bus", tier: "Business" }];
        const { GET } = await import("@/app/api/cron/reservation-expiry-alerts/route");
        await GET(pedir());
        expect(m.reservas).not.toHaveBeenCalled();

        m.addons.mockResolvedValue([{ addonKey: "mod_optimization" }]);
        await GET(pedir());
        expect(m.campanita).toHaveBeenCalledTimes(1);
    });
});
