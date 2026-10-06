// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * exigirScopesDelTenant: la frontera entre clientes de lo que se lee o escribe
 * en Azure. Con Lighthouse la credencial es una sola para todos los clientes
 * delegados, así que un id de recurso ajeno en el request llegaba a ARM y ARM
 * lo ejecutaba o lo devolvía.
 */

const { listMock, modeloMock } = vi.hoisted(() => ({ listMock: vi.fn(), modeloMock: vi.fn() }));
vi.mock("@/lib/azure", () => ({ listTenantSubscriptions: listMock }));
vi.mock("@/lib/lighthouseAccess", () => ({ getAccessModel: modeloMock }));

import {
    exigirScopesDelTenant,
    exigirSuscripcionDelTenant,
    olvidarSubsDelTenant,
    soloSuscripcionesDelTenant,
} from "@/lib/scopeDelTenant";

const PROPIA = "aaaaaaaa-1111-2222-3333-444444444444";
const AJENA = "bbbbbbbb-1111-2222-3333-444444444444";
const vm = (sub: string) => `/subscriptions/${sub}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1`;

beforeEach(() => {
    olvidarSubsDelTenant();
    // ARM devuelve los GUID en cualquier capitalización.
    listMock.mockReset().mockResolvedValue([{ subscriptionId: PROPIA.toUpperCase() }]);
    modeloMock.mockReset().mockResolvedValue("lighthouse");
});

describe("exigirScopesDelTenant", () => {
    it("acepta recurso, resource group o subscriptionId suelto del tenant, sin importar mayúsculas", async () => {
        await expect(
            exigirScopesDelTenant("t1", [vm(PROPIA), `/SUBSCRIPTIONS/${PROPIA}/resourceGroups/rg`, PROPIA, `/subscriptions/${PROPIA}`])
        ).resolves.toBeUndefined();
    });

    it("una suscripción de otro tenant da 404, no 403: no confirma que el recurso exista", async () => {
        await expect(exigirScopesDelTenant("t1", [vm(PROPIA), vm(AJENA)])).rejects.toMatchObject({ status: 404 });
        await expect(exigirScopesDelTenant("t1", [AJENA])).rejects.toMatchObject({ status: 404 });
    });

    it("rechaza sin consultar ARM lo que el parser de URL reinterpreta", async () => {
        // Cada uno empieza en la suscripción propia y, ya concatenado en
        // `https://management.azure.com${scope}`, termina pidiendo otra cosa.
        const subir = "/..".repeat(8);
        for (const scope of [
            `${vm(PROPIA)}${subir}/subscriptions/${AJENA}`,
            `${vm(PROPIA)}${"/%2e%2e".repeat(8)}/subscriptions/${AJENA}`,
            `${vm(PROPIA)}${"\\..".repeat(8)}\\subscriptions\\${AJENA}`,
            `${vm(PROPIA)}${"/.\t.".repeat(8)}/subscriptions/${AJENA}`,
            `${vm(PROPIA)}?api-version=2020-01-01`,
            `${vm(PROPIA)}#x`,
            // Sin `/` inicial cambia el host: management.azure.com.evil.example
            `.evil.example/subscriptions/${PROPIA}`,
            `subscriptions/${PROPIA}`,
            "/subscriptions/no-es-un-guid/resourceGroups/rg",
            "",
            undefined,
            null,
            42,
        ]) {
            await expect(exigirScopesDelTenant("t1", [scope]), JSON.stringify(scope)).rejects.toMatchObject({ status: 404 });
        }
        expect(listMock).not.toHaveBeenCalled();
    });

    it("nivel tenant (management group, reserva) sólo pasa con app registration", async () => {
        const mg = "/providers/Microsoft.Management/managementGroups/corp";
        const reserva = `/providers/Microsoft.Capacity/reservationOrders/${AJENA}/reservations/${PROPIA}`;
        // Con Lighthouse el token es nuestro: ARM resolvería el MG o la reserva
        // en NUESTRO directorio, nunca en el del cliente.
        await expect(exigirScopesDelTenant("t1", [mg])).rejects.toMatchObject({ status: 404 });
        await expect(exigirScopesDelTenant("t1", [reserva])).rejects.toMatchObject({ status: 404 });

        modeloMock.mockResolvedValue("app_registration");
        await expect(exigirScopesDelTenant("t1", [mg, reserva])).resolves.toBeUndefined();
        // Ni con app registration se acepta una ruta que se escape con `..`.
        await expect(exigirScopesDelTenant("t1", [`${mg}/../../subscriptions/${AJENA}`])).rejects.toMatchObject({ status: 404 });
        expect(listMock).not.toHaveBeenCalled();
    });

    it("si ARM no puede listar las suscripciones, no se escribe", async () => {
        listMock.mockRejectedValue(Object.assign(new Error("AccessDenied"), { statusCode: 403 }));
        await expect(exigirScopesDelTenant("t1", [vm(PROPIA)])).rejects.toThrow("AccessDenied");
    });

    it("un tenant mock no tiene Azure detrás: no se consulta nada", async () => {
        await expect(exigirScopesDelTenant("demo-tenant", [vm(AJENA)])).resolves.toBeUndefined();
        expect(listMock).not.toHaveBeenCalled();
        expect(modeloMock).not.toHaveBeenCalled();
    });
});

describe("lista del tenant en memoria", () => {
    it("un tablero que dispara varias lecturas le pregunta a ARM una sola vez", async () => {
        await Promise.all([1, 2, 3].map(() => exigirScopesDelTenant("t1", [PROPIA])));
        await exigirScopesDelTenant("t1", [vm(PROPIA)]);
        expect(listMock).toHaveBeenCalledTimes(1);
        // Cada tenant tiene la suya.
        await expect(exigirScopesDelTenant("t2", [PROPIA])).resolves.toBeUndefined();
        expect(listMock).toHaveBeenCalledTimes(2);
    });

    it("ni un fallo ni una lista vacía se recuerdan: el pedido siguiente vuelve a ARM", async () => {
        listMock.mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce([]);
        await expect(exigirScopesDelTenant("t1", [PROPIA])).rejects.toThrow("ECONNRESET");
        await expect(exigirScopesDelTenant("t1", [PROPIA])).rejects.toMatchObject({ status: 404 });
        await expect(exigirScopesDelTenant("t1", [PROPIA])).resolves.toBeUndefined();
        expect(listMock).toHaveBeenCalledTimes(3);
    });

    it("vence a los 60 segundos", async () => {
        // Sólo Date: las promesas tienen que seguir resolviendo solas.
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
            const t0 = Date.now();
            await exigirScopesDelTenant("t1", [PROPIA]);
            vi.setSystemTime(t0 + 59_000);
            await exigirScopesDelTenant("t1", [PROPIA]);
            expect(listMock).toHaveBeenCalledTimes(1);
            vi.setSystemTime(t0 + 61_000);
            await exigirScopesDelTenant("t1", [PROPIA]);
            expect(listMock).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("exigirSuscripcionDelTenant (una suscripción opcional)", () => {
    it("vacía o All es todo el tenant: no hay nada que validar", async () => {
        for (const s of [undefined, null, "", "All", "all"]) {
            await expect(exigirSuscripcionDelTenant("t1", s)).resolves.toBeUndefined();
        }
        expect(listMock).not.toHaveBeenCalled();
    });

    it("una suscripción ajena, o algo que no es un GUID, da 404", async () => {
        await expect(exigirSuscripcionDelTenant("t1", PROPIA)).resolves.toBeUndefined();
        await expect(exigirSuscripcionDelTenant("t1", AJENA)).rejects.toMatchObject({ status: 404 });
        // Varias rutas la pegan en un KQL: `' or 1==1` no llega.
        await expect(exigirSuscripcionDelTenant("t1", `${PROPIA}' or subscriptionId != '`)).rejects.toMatchObject({ status: 404 });
    });
});

describe("soloSuscripcionesDelTenant (varias suscripciones)", () => {
    it("deja las del tenant y descarta el resto en silencio", async () => {
        await expect(soloSuscripcionesDelTenant("t1", [PROPIA, AJENA, "no-es-un-guid"])).resolves.toEqual([PROPIA]);
    });

    it("si no queda ninguna da 404: vacía, el llamador la leería como 'sin filtro'", async () => {
        await expect(soloSuscripcionesDelTenant("t1", [AJENA])).rejects.toMatchObject({ status: 404 });
        await expect(soloSuscripcionesDelTenant("t1", [])).rejects.toMatchObject({ status: 404 });
    });

    it("un tenant mock devuelve lo pedido sin consultar", async () => {
        await expect(soloSuscripcionesDelTenant("demo-tenant", [AJENA])).resolves.toEqual([AJENA]);
        expect(listMock).not.toHaveBeenCalled();
    });
});
