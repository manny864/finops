// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: db }));

import { filtroDeAlcance, GRUPO_SIN_ASIGNAR } from "@/services/perspectivesData.service";
import type { FilaDeCosto } from "@/services/perspectives.service";

/** Una Perspective con dos grupos, como la devolveria la base. */
function conPerspectiva() {
    db.query.mockReset();
    db.query
        .mockResolvedValueOnce([[{ id: 7, name: "Entorno", description: null }]])
        .mockResolvedValueOnce([[
            { id: 1, perspective_id: 7, group_name: "Producción", match_type: "tag", match_key: "Environment", match_value: "prod", sort_order: 0 },
            { id: 2, perspective_id: 7, group_name: "Desarrollo", match_type: "resource_group", match_key: null, match_value: "rg-dev*", sort_order: 1 },
        ]]);
}

const prod: FilaDeCosto = { subscriptionId: "s", resourceGroup: "rg-prod", tags: { Environment: "prod" }, costo: 10 };
const dev: FilaDeCosto = { subscriptionId: "s", resourceGroup: "rg-dev-1", tags: { Environment: "dev" }, costo: 5 };
const otro: FilaDeCosto = { subscriptionId: "s", resourceGroup: "rg-qa", tags: { Environment: "qa" }, costo: 3 };

describe("filtroDeAlcance", () => {
    it("sin perspective no filtra nada", async () => {
        expect(await filtroDeAlcance("t", null, null)).toBeNull();
    });

    it("una perspective de OTRO tenant tampoco filtra, y no vacia la pantalla", async () => {
        // Devolver un predicado que rechaza todo haria que la pantalla se lea
        // como "este grupo no tiene gasto", que es una afirmacion falsa.
        db.query.mockReset();
        db.query.mockResolvedValueOnce([[]]);
        expect(await filtroDeAlcance("t", 999, "Producción")).toBeNull();
    });

    it("acota a un grupo", async () => {
        conPerspectiva();
        const f = (await filtroDeAlcance("t", 7, "Producción"))!;
        expect([prod, dev, otro].filter(f)).toEqual([prod]);
    });

    it("sin grupo deja TODO lo asignado, que no es lo mismo que no filtrar", async () => {
        conPerspectiva();
        const f = (await filtroDeAlcance("t", 7, null))!;
        expect([prod, dev, otro].filter(f)).toEqual([prod, dev]);
    });

    it("acota al sin asignar, que es donde mira quien quiere subir la cobertura", async () => {
        conPerspectiva();
        const f = (await filtroDeAlcance("t", 7, GRUPO_SIN_ASIGNAR))!;
        expect([prod, dev, otro].filter(f)).toEqual([otro]);
    });
});
