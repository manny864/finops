// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * exigirScopesDelTenant: la frontera entre clientes de las escrituras en Azure.
 * Con Lighthouse la credencial es una sola para todos los clientes delegados,
 * así que un id de recurso ajeno en el body llegaba a ARM y ARM lo ejecutaba.
 */

const { listMock, modeloMock } = vi.hoisted(() => ({ listMock: vi.fn(), modeloMock: vi.fn() }));
vi.mock("@/lib/azure", () => ({ listTenantSubscriptions: listMock }));
vi.mock("@/lib/lighthouseAccess", () => ({ getAccessModel: modeloMock }));

import { exigirScopesDelTenant } from "@/lib/scopeDelTenant";

const PROPIA = "aaaaaaaa-1111-2222-3333-444444444444";
const AJENA = "bbbbbbbb-1111-2222-3333-444444444444";
const vm = (sub: string) => `/subscriptions/${sub}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1`;

beforeEach(() => {
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
