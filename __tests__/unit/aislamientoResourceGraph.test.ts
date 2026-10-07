// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Una consulta de Resource Graph sin `subscriptions` ni `managementGroups`
 * abarca todo lo que ve la credencial, "and includes Azure Lighthouse delegated
 * resources" (Learn, Resource Graph, "Query scope"). Con Lighthouse la
 * credencial es una sola, la nuestra, delegada sobre todos los clientes: el
 * 2026-10-06 había 76 consultas así (de 153), y cada una devolvía recursos de
 * todos sin que el usuario mandara nada.
 *
 * El recorte vive en un solo lugar, `getResourceGraphClient`. Como con
 * `listTenantSubscriptions`, la guardia cuida la puerta: mientras nadie arme un
 * cliente por fuera, el recorte no se puede saltear.
 */

const { listTenantSubscriptions } = vi.hoisted(() => ({ listTenantSubscriptions: vi.fn() }));
vi.mock("@/lib/azure", async (original) => ({
    ...(await original<typeof import("@/lib/azure")>()),
    listTenantSubscriptions,
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() }, initializeDatabase: vi.fn() }));

import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getResourceGraphClient } from "@/lib/azure";
import { olvidarSubsDelTenant } from "@/lib/scopeDelTenant";

function fuentes(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) fuentes(p, out);
        else if (/\.tsx?$/.test(entry)) out.push(p.replace(/\\/g, "/"));
    }
    return out;
}

/*
 * `verificarDelegacion` consulta con NUESTRA credencial las delegaciones de
 * todos los clientes a propósito: así descubre cuáles son de este tenant, y
 * descarta cada fila cuyo tenant delegante no sea el pedido antes de usarla.
 */
const PERMITIDOS = new Set(["src/lib/azure.ts", "src/services/lighthouseVerification.service.ts"]);

describe("aislamiento entre tenants · Resource Graph", () => {
    const archivos = fuentes("src");

    it("nadie construye un cliente de Resource Graph fuera de la fábrica", () => {
        const directos = archivos.filter(
            (f) => !PERMITIDOS.has(f) && /new\s+ResourceGraphClient\s*\(|extends\s+ResourceGraphClient\b/.test(readFileSync(f, "utf8")),
        );
        expect(
            directos,
            "Estos archivos consultan Resource Graph sin el recorte al tenant.\n" +
                "Usá getResourceGraphClient(tenantId, credential) de @/lib/azure.",
        ).toEqual([]);
    });

    it("nadie le pega a la API REST de Resource Graph a mano", () => {
        const crudos = archivos.filter((f) => f !== "src/lib/azure.ts" && readFileSync(f, "utf8").includes("Microsoft.ResourceGraph/resources"));
        expect(crudos, "Un fetch a Microsoft.ResourceGraph/resources se saltea el recorte: usá getResourceGraphClient.").toEqual([]);
    });
});

const TENANT = "11111111-aaaa-4bbb-8ccc-000000000001";
const SUB_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const SUB_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const AJENA = "cccccccc-0000-4000-8000-00000000000c";
const credencial = { getToken: async () => ({ token: "t", expiresOnTimestamp: Date.now() + 3_600_000 }) };

describe("getResourceGraphClient · cada consulta sale acotada al tenant", () => {
    // El prototipo REAL del SDK: si la fábrica no lo sobrescribiera de verdad
    // (por ejemplo, si el SDK definiera `resources` en la instancia), la
    // consulta llegaría acá sin recortar y estos tests lo dirían.
    const enviadas = vi.spyOn(ResourceGraphClient.prototype, "resources");

    beforeEach(() => {
        olvidarSubsDelTenant();
        enviadas.mockReset().mockResolvedValue({ totalRecords: 1, count: 1, resultTruncated: "false", data: [{ ok: 1 }] } as never);
        // ARM devuelve los ids en mayúsculas y desordenados: la lista sale normalizada.
        listTenantSubscriptions.mockReset().mockResolvedValue([{ subscriptionId: SUB_B.toUpperCase() }, { subscriptionId: SUB_A }]);
    });

    const consultar = async (pedido: Record<string, unknown>) =>
        (await getResourceGraphClient(TENANT, credencial)).resources({ query: "Resources", ...pedido } as never);

    it("sin `subscriptions`, lleva todas las del tenant, ordenadas", async () => {
        await consultar({});
        expect(enviadas).toHaveBeenCalledWith({ query: "Resources", subscriptions: [SUB_A, SUB_B] }, undefined);
    });

    it("una suscripción ajena se descarta y quedan las propias", async () => {
        await consultar({ subscriptions: [AJENA, SUB_B.toUpperCase()], options: { top: 5 } });
        expect(enviadas).toHaveBeenCalledWith({ query: "Resources", subscriptions: [SUB_B], options: { top: 5 } }, undefined);
    });

    it("si no queda ninguna, no llama a Resource Graph y devuelve vacío", async () => {
        const r = await consultar({ subscriptions: [AJENA] });
        expect(enviadas).not.toHaveBeenCalled();
        expect(r.data).toEqual([]);
        expect(r.totalRecords).toBe(0);
    });

    it("el MG raíz del propio tenant pasa intacto", async () => {
        await consultar({ managementGroups: [TENANT.toUpperCase()] });
        expect(enviadas).toHaveBeenCalledWith({ query: "Resources", managementGroups: [TENANT.toUpperCase()] }, undefined);
        expect(listTenantSubscriptions).not.toHaveBeenCalled();
    });

    it("otro MG se reemplaza por las suscripciones del tenant (no se pueden mandar juntos)", async () => {
        await consultar({ managementGroups: ["mg-de-otro"] });
        expect(enviadas).toHaveBeenCalledWith({ query: "Resources", subscriptions: [SUB_A, SUB_B] }, undefined);
    });

    it("si ARM no contesta la lista, no consulta: falla cerrado", async () => {
        listTenantSubscriptions.mockRejectedValue(new Error("AccessDenied"));
        await expect(consultar({})).rejects.toThrow("AccessDenied");
        expect(enviadas).not.toHaveBeenCalled();
    });

    it("resourcesHistory no está acotado y no se deja usar", async () => {
        const client = await getResourceGraphClient(TENANT, credencial);
        expect(() => client.resourcesHistory({ query: "Resources" } as never)).toThrow(/no está acotado/);
    });
});
