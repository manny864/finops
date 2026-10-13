// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const connMock = {
    query: (...a: unknown[]) => queryMock(...a),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
};
vi.mock("@/modules/storage/db", () => ({ default: { getConnection: async () => connMock, query: (...a: unknown[]) => queryMock(...a) } }));

const { churn } = vi.hoisted(() => ({ churn: vi.fn() }));
vi.mock("@/services/commissions.service", () => ({ cancelarComisionesPorChurn: churn }));

import { recordTenantLifecycleTransition } from "@/services/tenantLifecycle.service";

const currentStatus = (s: string) => [[{ subscription_status: s }]];
const lastEvent = (t: string | null) => [t ? [{ event_type: t }] : []];

beforeEach(() => {
    churn.mockReset().mockResolvedValue({ canceladas: 0 });
    queryMock.mockReset();
    connMock.commit.mockClear();
    connMock.rollback.mockClear();
});

/** SQL del UPDATE a Tenants (la 2ª query tras leer el estado). */
const updateSql = () => String(queryMock.mock.calls[1][0]);
const eventParams = () => queryMock.mock.calls[2][1] as unknown[];

describe("recordTenantLifecycleTransition — MEJ-12", () => {
    it("CANCELED estampa canceled_at, guarda el motivo y deja el evento", async () => {
        queryMock
            .mockResolvedValueOnce(currentStatus("ACTIVE"))
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([{}]);

        const applied = await recordTenantLifecycleTransition("t1", "CANCELED", {
            actor: "paddle-webhook", reason: "payment_delinquency",
        });

        expect(applied).toBe(true);
        expect(updateSql()).toContain("canceled_at = NOW()");
        expect(updateSql()).toContain("cancellation_reason = ?");
        const ev = eventParams();
        expect(ev).toContain("CANCELED");
        expect(ev).toContain("paddle-webhook");
        expect(ev).toContain("payment_delinquency");
        // El estado ANTERIOR queda registrado: sin él la línea de tiempo habría
        // que inferirla del orden de las filas.
        expect(ev).toContain("ACTIVE");
        expect(connMock.commit).toHaveBeenCalled();
    });

    it("SUSPENDED estampa suspended_at y NO toca canceled_at", async () => {
        queryMock
            .mockResolvedValueOnce(currentStatus("ACTIVE"))
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([{}]);

        await recordTenantLifecycleTransition("t1", "SUSPENDED", { actor: "paddle-webhook" });

        expect(updateSql()).toContain("suspended_at = NOW()");
        expect(updateSql()).not.toContain("canceled_at = NOW()");
    });

    // Reactivar abre un período nuevo: el estado actual describe el período
    // vigente, y los anteriores siguen enteros en el historial.
    it("REACTIVATED limpia la baja y la suspensión", async () => {
        // Sin mock de "último evento": el guard de idempotencia sólo consulta
        // cuando el estado actual YA es el destino, y acá CANCELED != ACTIVE.
        queryMock
            .mockResolvedValueOnce(currentStatus("CANCELED"))
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([{}]);

        await recordTenantLifecycleTransition("t1", "REACTIVATED", { actor: "admin@x.com" });

        const sql = updateSql();
        expect(sql).toContain("activated_at = NOW()");
        expect(sql).toContain("canceled_at = NULL");
        expect(sql).toContain("suspended_at = NULL");
    });

    // Un contrato vencido es churn: sin fecha no entraría en ninguna cohorte.
    it("EXPIRED estampa canceled_at con motivo contract_expired por defecto", async () => {
        queryMock
            .mockResolvedValueOnce(currentStatus("ACTIVE"))
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([{}]);

        await recordTenantLifecycleTransition("t1", "EXPIRED", { actor: "cron-trial-expiry" });

        expect(updateSql()).toContain("canceled_at = NOW()");
        expect(eventParams()).toContain("contract_expired");
    });

    it("usa 'system' como actor si no se indica", async () => {
        queryMock
            .mockResolvedValueOnce(currentStatus("ACTIVE"))
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([{}]);
        await recordTenantLifecycleTransition("t1", "CANCELED");
        expect(eventParams()).toContain("system");
    });
});

describe("idempotencia ante reentrega de webhooks", () => {
    // Paddle y el Marketplace reentregan. Sin este guard, cada reintento
    // agregaría un CANCELED más al historial y movería `canceled_at`.
    it("descarta el mismo evento repetido sobre el mismo estado", async () => {
        queryMock
            .mockResolvedValueOnce(currentStatus("CANCELED"))
            .mockResolvedValueOnce(lastEvent("CANCELED"));

        const applied = await recordTenantLifecycleTransition("t1", "CANCELED", { actor: "paddle-webhook" });

        expect(applied).toBe(false);
        expect(queryMock).toHaveBeenCalledTimes(2); // no llegó a escribir
        expect(connMock.rollback).toHaveBeenCalled();
        expect(connMock.commit).not.toHaveBeenCalled();
    });

    // Pero un ciclo REAL (baja -> alta -> baja) sí debe registrarse dos veces.
    it("NO descarta una baja nueva si en el medio hubo una reactivación", async () => {
        queryMock
            .mockResolvedValueOnce(currentStatus("CANCELED"))
            .mockResolvedValueOnce(lastEvent("REACTIVATED"))
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([{}]);

        const applied = await recordTenantLifecycleTransition("t1", "CANCELED", { actor: "paddle-webhook" });
        expect(applied).toBe(true);
        expect(connMock.commit).toHaveBeenCalled();
    });
});

describe("atomicidad", () => {
    // Si el UPDATE entrara y el INSERT no, quedaría un cambio de estado sin
    // registro: justo lo que el historial existe para impedir.
    it("hace rollback si falla el INSERT del evento", async () => {
        queryMock
            .mockResolvedValueOnce(currentStatus("ACTIVE"))
            .mockResolvedValueOnce([{}])
            .mockRejectedValueOnce(new Error("insert falló"));

        await expect(recordTenantLifecycleTransition("t1", "CANCELED")).rejects.toThrow("insert falló");
        expect(connMock.rollback).toHaveBeenCalled();
        expect(connMock.commit).not.toHaveBeenCalled();
        expect(connMock.release).toHaveBeenCalled();
    });

    // Un webhook puede traer un tenant de otro entorno que comparte la cuenta
    // de facturación. Si esto tirara, el proveedor reintentaría para siempre un
    // evento que nunca va a poder aplicarse.
    it("ignora (sin lanzar) un tenant inexistente, para no forzar reintentos infinitos", async () => {
        queryMock.mockResolvedValueOnce([[]]);
        const applied = await recordTenantLifecycleTransition("fantasma", "CANCELED");
        expect(applied).toBe(false);
        expect(connMock.commit).not.toHaveBeenCalled();
        expect(connMock.rollback).toHaveBeenCalled();
    });
});

describe("una baja corta las cuotas no exigibles del comercial, venga por donde venga", () => {
    const transicion = (estado: string, evento: "CANCELED" | "EXPIRED" | "SUSPENDED" | "ACTIVATED" | "REACTIVATED", ultimo: string | null = null) => {
        queryMock
            .mockResolvedValueOnce(currentStatus(estado))
            .mockResolvedValueOnce(lastEvent(ultimo))
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([{}]);
        return recordTenantLifecycleTransition("t1", evento, { actor: "cualquiera" });
    };

    it.each(["CANCELED", "EXPIRED"] as const)("%s cancela las comisiones pendientes del tenant", async (evento) => {
        await transicion("ACTIVE", evento);
        expect(churn).toHaveBeenCalledWith("t1");
    });

    it.each(["SUSPENDED", "ACTIVATED", "REACTIVATED"] as const)("%s no toca las comisiones: no es una baja", async (evento) => {
        await transicion("ACTIVE", evento);
        expect(churn).not.toHaveBeenCalled();
    });

    it("sólo después de confirmar la transacción de la baja", async () => {
        const orden: string[] = [];
        connMock.commit.mockImplementationOnce(async () => { orden.push("commit"); });
        churn.mockImplementationOnce(async () => { orden.push("churn"); return { canceladas: 0 }; });
        await transicion("ACTIVE", "CANCELED");
        expect(orden).toEqual(["commit", "churn"]);
    });

    it("una repetición del mismo evento (reentrega del webhook) no vuelve a cancelar nada", async () => {
        queryMock.mockResolvedValueOnce(currentStatus("CANCELED")).mockResolvedValueOnce(lastEvent("CANCELED"));
        expect(await recordTenantLifecycleTransition("t1", "CANCELED")).toBe(false);
        expect(churn).not.toHaveBeenCalled();
    });

    it("un tenant inexistente no cancela nada", async () => {
        queryMock.mockResolvedValueOnce([[]]);
        expect(await recordTenantLifecycleTransition("fantasma", "CANCELED")).toBe(false);
        expect(churn).not.toHaveBeenCalled();
    });

    it("si la baja falla, tampoco se cancelan comisiones", async () => {
        queryMock.mockResolvedValueOnce(currentStatus("ACTIVE")).mockRejectedValueOnce(new Error("deadlock"));
        await expect(recordTenantLifecycleTransition("t1", "CANCELED")).rejects.toThrow("deadlock");
        expect(churn).not.toHaveBeenCalled();
    });
});
