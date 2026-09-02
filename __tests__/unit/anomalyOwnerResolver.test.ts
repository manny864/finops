// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import { resolveAnomalyOwner } from "@/services/anomalyOwnerResolver";

const contribs = (rg: string) => [{ resource_group: rg, service_name: "Compute" }];
/** Ninguna de las 4 consultas encuentra nada. */
const nothing = () => queryMock.mockResolvedValue([[]]);

beforeEach(() => queryMock.mockReset());

describe("resolveAnomalyOwner — MEJ-33 paso 2", () => {
    it("resuelve por pertenencia explícita a un Cost Group", async () => {
        queryMock.mockResolvedValueOnce([[{ email: "ana@x.com", name: "Plataforma" }]]);
        const r = await resolveAnomalyOwner("t1", contribs("rg-prod"));
        expect(r).toEqual({ assignedTo: "ana@x.com", assignedVia: "cost_group_membership", detail: "Plataforma" });
    });

    // Una asignación manual es una decisión humana deliberada: debe pesar más
    // que una coincidencia de patrón.
    it("la pertenencia manual gana sobre el patrón", async () => {
        queryMock.mockResolvedValueOnce([[{ email: "ana@x.com", name: "Manual" }]]);
        const r = await resolveAnomalyOwner("t1", contribs("rg-prod"));
        expect(r?.assignedVia).toBe("cost_group_membership");
        expect(queryMock).toHaveBeenCalledTimes(1); // ni consulta las otras vías
    });

    it("cae al patrón de nombre si no hay pertenencia", async () => {
        queryMock
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[{ email: "beto@x.com", name: "Todo prod" }]]);
        const r = await resolveAnomalyOwner("t1", contribs("rg-prod-01"));
        expect(r?.assignedVia).toBe("cost_group_pattern");
        expect(r?.assignedTo).toBe("beto@x.com");
    });

    it("cae a la etiqueta que define el Cost Group", async () => {
        queryMock
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[{ email: "caro@x.com", name: "Ventas" }]]);
        const r = await resolveAnomalyOwner("t1", contribs("rg-x"));
        expect(r?.assignedVia).toBe("cost_group_tag");
    });

    // Si el cliente etiquetó un correo, ése es su modelo de responsabilidad
    // aunque esa persona no sea usuario de la plataforma.
    it("último recurso: la etiqueta Owner del recurso", async () => {
        queryMock
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[{ email: "externo@otra.com" }]]);
        const r = await resolveAnomalyOwner("t1", contribs("rg-x"));
        expect(r?.assignedVia).toBe("owner_tag");
        expect(r?.assignedTo).toBe("externo@otra.com");
    });

    // EL PRINCIPIO DE LA MEJORA: asignarle un desvío a quien no corresponde es
    // peor que no asignarlo — esa persona aprende a ignorar las alertas.
    it("devuelve null si la gobernanza del cliente no alcanza", async () => {
        nothing();
        expect(await resolveAnomalyOwner("t1", contribs("rg-huerfano"))).toBeNull();
    });

    it("una etiqueta Owner que no es un correo no se toma como dueño", async () => {
        queryMock
            .mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[{ email: "equipo-plataforma" }]]);
        expect(await resolveAnomalyOwner("t1", contribs("rg-x"))).toBeNull();
    });

    // El pico lo causó el contribuyente principal; atribuirlo al dueño de un
    // contribuyente menor sería decirle "tu recurso causó esto" sin que sea así.
    it("sólo mira el contribuyente principal", async () => {
        nothing();
        await resolveAnomalyOwner("t1", [
            { resource_group: "rg-sin-dueño" },
            { resource_group: "rg-con-dueño" },
        ]);
        for (const call of queryMock.mock.calls) {
            expect(JSON.stringify(call[1])).not.toContain("rg-con-dueño");
        }
    });

    it("sin contribuyentes, o con el agregado '*', no asigna", async () => {
        expect(await resolveAnomalyOwner("t1", [])).toBeNull();
        expect(await resolveAnomalyOwner("t1", undefined)).toBeNull();
        expect(await resolveAnomalyOwner("t1", contribs("*"))).toBeNull();
        expect(queryMock).not.toHaveBeenCalled();
    });

    // La detección no debe romperse porque falte una tabla o el JSON esté feo.
    it("si una consulta falla, sigue sin asignar en vez de tirar", async () => {
        // Falla SÓLO la primera vía (p. ej. la tabla de pertenencia no existe en
        // un entorno viejo); las otras responden vacío.
        queryMock
            .mockImplementationOnce(async () => { throw new Error("tabla ausente"); })
            .mockResolvedValue([[]]);
        await expect(resolveAnomalyOwner("t1", contribs("rg-x"))).resolves.toBeNull();
    });
});
