// @vitest-environment node
/**
 * Fase 4 de IA (gasto externo): avisos de renovación de `Commitments` con la
 * escalera de las reservas (90, 60 y 30 días) contra la FECHA LÍMITE DEL
 * PREAVISO, una vez por escalón, sólo a quien tiene la pantalla.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ query: vi.fn(), notify: vi.fn(), channels: vi.fn(), addons: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: { query: m.query } }));
vi.mock("@/lib/notify", () => ({ createNotification: m.notify }));
vi.mock("@/lib/notifications", () => ({ notifyTenant: m.channels }));
vi.mock("@/services/tenantAddons.service", () => ({ TenantAddonsService: { getActiveAddons: m.addons } }));
vi.mock("@/lib/routeTiers", () => ({ getRequiredTierForPath: () => "Business" }));

import {
    renewalNoticeText, renewalNotices, renewalSeverity, sendCommitmentRenewalAlerts,
} from "@/services/commitmentRenewalAlerts.service";

const HOY = new Date("2026-10-08T12:00:00Z");
const enDias = (d: number) => new Date(Date.UTC(2026, 9, 8 + d)).toISOString().slice(0, 10);
const fila = (commitmentId: number, dias: number, autoRenew = true, vendorName = `Proveedor ${commitmentId}`) =>
    ({ commitmentId, vendorName, deadline: enDias(dias), autoRenew });

describe("qué compromisos avisan", () => {
    it("por escalón según los días a la fecha límite, del más próximo al más lejano", () => {
        const avisos = renewalNotices([fila(1, 85), fila(2, 95), fila(3, 25), fila(4, -1), fila(5, 55)], HOY);
        expect(avisos.map((a) => [a.commitmentId, a.days, a.threshold])).toEqual([[3, 25, 30], [5, 55, 60], [1, 85, 90]]);
    });

    it("la gravedad la marca el escalón más cercano", () => {
        const [a30, a60, a90] = renewalNotices([fila(1, 10), fila(2, 50), fila(3, 80)], HOY);
        expect(renewalSeverity([a30, a90])).toBe("critical");
        expect(renewalSeverity([a60, a90])).toBe("warning");
        expect(renewalSeverity([a90])).toBe("info");
    });

    it("el texto de respaldo dice qué vence y si se renueva solo", () => {
        const uno = renewalNoticeText(renewalNotices([fila(1, 0, false, "Fabrikam")], HOY));
        expect(uno.title).toBe("📝 1 compromiso con proveedores tiene fecha límite de preaviso en los próximos 30 días");
        expect(uno.message).toContain("• Fabrikam — el preaviso vence hoy · SIN renovación automática");

        const muchos = renewalNoticeText(renewalNotices(Array.from({ length: 16 }, (_, i) => fila(i + 1, 20)), HOY));
        expect(muchos.title).toContain("16 compromisos con proveedores tienen");
        expect(muchos.message).toContain(`el preaviso vence el ${enDias(20)} (en 20 días) · se renueva solo`);
        expect(muchos.message).toContain("… y 1 más.");
    });
});

describe("sendCommitmentRenewalAlerts", () => {
    let claimed: Set<string>;

    beforeEach(() => {
        vi.clearAllMocks();
        claimed = new Set();
        m.addons.mockResolvedValue([]);
        m.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
            if (sql.includes("FROM Commitments c JOIN Tenants t")) {
                return [[
                    { id: 1, tenant_id: "t1", tier: "Business", vendor_name: "Fabrikam", auto_renew: 1, deadline: enDias(25) },
                    { id: 2, tenant_id: "t1", tier: "Business", vendor_name: "Northwind", auto_renew: 0, deadline: enDias(80) },
                    { id: 3, tenant_id: "t2", tier: "Professional", vendor_name: "Contoso", auto_renew: 1, deadline: enDias(10) },
                    { id: 4, tenant_id: "demo-tenant", tier: "Enterprise", vendor_name: "Demo", auto_renew: 1, deadline: enDias(10) },
                ]];
            }
            if (sql.startsWith("INSERT IGNORE INTO CommitmentRenewalNotices")) {
                const key = params.join("|");
                const fresh = !claimed.has(key);
                claimed.add(key);
                return [{ affectedRows: fresh ? 1 : 0 }];
            }
            throw new Error(`SQL no esperado: ${sql}`);
        });
    });

    it("avisa cada escalón una vez, por campanita y por los canales del tenant", async () => {
        await expect(sendCommitmentRenewalAlerts("https://app.example.com", HOY)).resolves.toEqual({ evaluated: 1, notified: 1, errors: [] });
        expect(m.notify).toHaveBeenCalledTimes(1);
        expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: "t1",
            titleKey: "notif_commitment_renewal_title",
            messageKey: "notif_commitment_renewal_msg",
            params: { count: 2, days: 25 },
            href: "/intelligence/external-spend",
            severity: "critical",
            source: "commitment_renewal",
        }));
        expect(m.channels).toHaveBeenCalledWith("t1", expect.objectContaining({
            severity: "error", link: "https://app.example.com/intelligence/external-spend",
        }));
        expect(claimed).toEqual(new Set([`1|${enDias(25)}|30`, `2|${enDias(80)}|90`]));

        await expect(sendCommitmentRenewalAlerts("https://app.example.com", HOY)).resolves.toMatchObject({ notified: 0 });
        expect(m.notify).toHaveBeenCalledTimes(1);
    });

    it("sin la pantalla (plan menor sin el módulo) o en la demo, no avisa", async () => {
        await sendCommitmentRenewalAlerts("https://app.example.com", HOY);
        expect(m.addons).toHaveBeenCalledWith("t2");
        expect(m.notify.mock.calls.map(([n]) => n.tenantId)).toEqual(["t1"]);
        expect(m.addons).not.toHaveBeenCalledWith("demo-tenant");
    });

    it("si falla un tenant, sigue con el resto y lo informa", async () => {
        m.addons.mockResolvedValue([{ addonKey: "nada" }]);
        m.notify.mockRejectedValueOnce(new Error("sin base de notificaciones"));
        const res = await sendCommitmentRenewalAlerts("https://app.example.com", HOY);
        expect(res.errors).toEqual(["t1: sin base de notificaciones"]);
    });
});
