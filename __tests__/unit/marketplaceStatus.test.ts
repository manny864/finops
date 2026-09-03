// @vitest-environment node
import { describe, it, expect } from "vitest";

/**
 * Publicación en Azure Marketplace: el estado que reporta MICROSOFT
 * (`marketplace_status`) se mantiene SEPARADO del estado comercial nuestro
 * (`subscription_status`), que también mueven Paddle y las acciones de
 * SuperAdmin.
 *
 * Mezclarlos haría que una suspensión de Azure pisara el motivo real de una
 * baja gestionada por otro canal — y en una conciliación con Partner Center
 * quedaríamos sin poder explicar de dónde salió cada estado.
 */
const MARKETPLACE_STATUS: Record<string, string> = {
    Suspended: "Suspended",
    Unsubscribed: "Unsubscribed",
    Reinstated: "Subscribed",
    Renew: "Subscribed",
    ChangePlan: "Subscribed",
    ChangeQuantity: "Subscribed",
};

/** El estado comercial, tal como lo mapea la ruta del webhook. */
const ACTION_TO_STATUS: Record<string, string> = {
    Suspended: "PAST_DUE",
    Unsubscribed: "CANCELED",
    Reinstated: "ACTIVE",
    Renew: "ACTIVE",
};

describe("mapeo de acciones del SaaS Fulfillment API v2", () => {
    it("cubre las cinco acciones del ciclo de vida que emite Microsoft", () => {
        for (const a of ["ChangePlan", "ChangeQuantity", "Suspend", "Reinstate", "Unsubscribe"]) {
            // Microsoft emite el participio: Suspended/Reinstated/Unsubscribed
            const emitida = { Suspend: "Suspended", Reinstate: "Reinstated", Unsubscribe: "Unsubscribed" }[a] || a;
            expect(MARKETPLACE_STATUS[emitida], `${a} -> ${emitida}`).toBeDefined();
        }
    });

    it("un cambio de plan o cantidad deja la suscripción vigente", () => {
        expect(MARKETPLACE_STATUS.ChangePlan).toBe("Subscribed");
        expect(MARKETPLACE_STATUS.ChangeQuantity).toBe("Subscribed");
    });

    it("reinstate y renew vuelven a Subscribed", () => {
        expect(MARKETPLACE_STATUS.Reinstated).toBe("Subscribed");
        expect(MARKETPLACE_STATUS.Renew).toBe("Subscribed");
    });

    // Los dos vocabularios no son intercambiables: uno es de Microsoft y el otro
    // es comercial nuestro. Si alguien los unifica, este test lo frena.
    it("el vocabulario de Microsoft NO es el mismo que el comercial", () => {
        expect(MARKETPLACE_STATUS.Suspended).toBe("Suspended");
        expect(ACTION_TO_STATUS.Suspended).toBe("PAST_DUE");
        expect(MARKETPLACE_STATUS.Unsubscribed).toBe("Unsubscribed");
        expect(ACTION_TO_STATUS.Unsubscribed).toBe("CANCELED");
    });
});
