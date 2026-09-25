// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
    evaluarFila, repartir, nombreDeRecurso, tipoDeRecurso, coincidePatron, valorDeEtiqueta,
    type ReglaPerspectiva, type FilaDeCosto,
} from "@/services/perspectives.service";

const fila = (p: Partial<FilaDeCosto> = {}): FilaDeCosto => ({
    subscriptionId: "sub-1", resourceGroup: "rg-prod", serviceName: "Storage",
    resourceId: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/disks/disco-01",
    tags: { CostCenter: "IT", Environment: "prod" }, costo: 100, ...p,
});

describe("lectura del resourceId", () => {
    it("saca nombre y tipo ARM", () => {
        const id = "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/disks/disco-01";
        expect(nombreDeRecurso(id)).toBe("disco-01");
        expect(tipoDeRecurso(id)).toBe("microsoft.compute/disks");
    });

    it("sin id devuelve null y NO cadena vacia", () => {
        // La diferencia habilita distinguir "no matcheo el patron" de "no se
        // pudo evaluar el patron", que es medio punto de esta mejora.
        expect(nombreDeRecurso(null)).toBeNull();
        expect(tipoDeRecurso("/subscriptions/s/resourceGroups/rg")).toBeNull();
    });
});

describe("coincidencias", () => {
    it("el comodin es *, el resto literal", () => {
        expect(coincidePatron("vm-prod-01", "vm-prod-*")).toBe(true);
        expect(coincidePatron("vm-dev-01", "vm-prod-*")).toBe(false);
        // Un punto es un punto y no "cualquier caracter": sin escapar, `a.b`
        // matchearia `axb`.
        expect(coincidePatron("axb", "a.b")).toBe(false);
    });

    it("la clave de etiqueta tolera mayusculas y separadores, el valor no", () => {
        // Mismo criterio que allocationTags: `cost-center` y `CostCenter` son la
        // misma etiqueta. El VALOR no se normaliza porque `prod` y `Prod` pueden
        // ser dos entornos distintos y no nos toca decidirlo.
        expect(valorDeEtiqueta({ "cost-center": "IT" }, "CostCenter")).toBe("IT");
        expect(valorDeEtiqueta({ BusinessUnit: "IT" }, "CostCenter")).toBe("IT");
        expect(valorDeEtiqueta({ CostCenter: "IT" }, "Environment")).toBeUndefined();
    });
});

describe("evaluarFila — la primera regla que matchea gana (criterio 1)", () => {
    const reglas: ReglaPerspectiva[] = [
        { grupo: "Producción", tipo: "tag", clave: "Environment", valor: "prod", orden: 1 },
        { grupo: "IT", tipo: "tag", clave: "CostCenter", valor: "IT", orden: 2 },
    ];

    it("gana la de orden menor aunque matcheen las dos", () => {
        expect(evaluarFila(fila(), reglas).grupo).toBe("Producción");
    });

    it("cambiar el orden cambia el grupo, sin tocar nada mas (criterio 5)", () => {
        const alReves = reglas.map((r) => ({ ...r, orden: 3 - r.orden }));
        expect(evaluarFila(fila(), alReves).grupo).toBe("IT");
    });

    it("un recurso cae en UN grupo por perspectiva, nunca en dos", () => {
        const r = evaluarFila(fila(), reglas);
        expect(typeof r.grupo).toBe("string");
    });
});

describe("evaluarFila — los dos motivos de quedar afuera", () => {
    it("sin-regla: se pudieron evaluar y ninguna matcheo", () => {
        const r = evaluarFila(fila({ tags: { Environment: "dev" } }), [
            { grupo: "Producción", tipo: "tag", clave: "Environment", valor: "prod", orden: 1 },
        ]);
        expect(r.grupo).toBeNull();
        expect(r.motivo).toBe("sin-regla");
    });

    it("sin-datos: TODAS las reglas piden algo que la fila no tiene ingerido", () => {
        // El caso real: los tenants que sincronizan por la Query API de Cost
        // Management tienen `CostSnapshots.Tags` en NULL. Contar eso como "sin
        // asignar" le echa al cliente la culpa de un hueco nuestro.
        const r = evaluarFila(fila({ tags: null }), [
            { grupo: "Producción", tipo: "tag", clave: "Environment", valor: "prod", orden: 1 },
        ]);
        expect(r.grupo).toBeNull();
        expect(r.motivo).toBe("sin-datos");
        expect(r.falta).toBe("etiquetas");
    });

    it("basta UNA regla evaluable para que la fila haya tenido oportunidad", () => {
        // Con tags nulos pero una regla por grupo de recursos, la fila SI se
        // pudo evaluar: si no matchea es sin-regla, no sin-datos.
        const r = evaluarFila(fila({ tags: null }), [
            { grupo: "Producción", tipo: "tag", clave: "Environment", valor: "prod", orden: 1 },
            { grupo: "Otro", tipo: "resource_group", valor: "rg-que-no-existe", orden: 2 },
        ]);
        expect(r.motivo).toBe("sin-regla");
    });

    it("una perspectiva sin reglas no manda todo a sin-datos", () => {
        expect(evaluarFila(fila(), []).motivo).toBe("sin-regla");
    });
});

describe("repartir", () => {
    const reglas: ReglaPerspectiva[] = [
        { grupo: "Producción", tipo: "tag", clave: "Environment", valor: "prod", orden: 1 },
        { grupo: "Desarrollo", tipo: "resource_group", valor: "rg-dev*", orden: 2 },
    ];

    it("la suma de grupos + sin asignar + sin datos da EXACTO el total (criterio 4)", () => {
        // Con decimales a proposito: es donde un acumulador en float se separa
        // del total y la pantalla deja de ser auditable.
        const filas = [
            fila({ costo: 33.33 }),
            fila({ costo: 66.67, tags: { Environment: "dev" }, resourceGroup: "rg-dev-1" }),
            fila({ costo: 0.01, tags: { Environment: "qa" }, resourceGroup: "rg-qa" }),
            fila({ costo: 10.99, tags: null, resourceGroup: null, resourceId: null }),
        ];
        const r = repartir(filas, reglas);
        const suma = r.grupos.reduce((a, g) => a + g.costo, 0) + r.sinAsignar.costo + r.sinDatos.costo;
        expect(suma).toBe(r.total);
        expect(r.total).toBe(111);
    });

    it("separa el sin asignar del sin datos y dice que dato falto (criterio 3)", () => {
        const r = repartir(
            [fila({ costo: 50, tags: { Environment: "qa" } }), fila({ costo: 30, tags: null, resourceGroup: null, resourceId: null })],
            [{ grupo: "Producción", tipo: "tag", clave: "Environment", valor: "prod", orden: 1 }],
        );
        expect(r.sinAsignar.costo).toBe(50);
        expect(r.sinDatos.costo).toBe(30);
        expect(r.sinDatos.motivos).toEqual(["etiquetas"]);
        // Y la cobertura no miente: 0% cayo en un grupo.
        expect(r.coberturaPct).toBe(0);
    });

    it("informa la cobertura, que es lo que hace util al reporte", () => {
        const r = repartir(
            [fila({ costo: 60 }), fila({ costo: 40, tags: { Environment: "qa" } })],
            reglas,
        );
        expect(r.coberturaPct).toBe(60);
        expect(r.grupos[0]).toMatchObject({ grupo: "Producción", costo: 60, porcentaje: 60, filas: 1 });
    });

    it("ordena los grupos por costo, de mayor a menor", () => {
        const r = repartir(
            [fila({ costo: 10 }), fila({ costo: 90, tags: { Environment: "dev" }, resourceGroup: "rg-dev-1" })],
            reglas,
        );
        expect(r.grupos.map((g) => g.grupo)).toEqual(["Desarrollo", "Producción"]);
    });

    it("no se rompe sin filas", () => {
        for (const vacio of [null, undefined, []]) {
            const r = repartir(vacio as any, reglas);
            expect(r.total).toBe(0);
            expect(r.coberturaPct).toBe(0);
            expect(r.grupos).toEqual([]);
        }
    });
});

describe("el mismo recurso en Perspectives distintas (criterio 2)", () => {
    it("cae en un grupo de cada una", () => {
        const porEntorno: ReglaPerspectiva[] = [{ grupo: "Producción", tipo: "tag", clave: "Environment", valor: "prod", orden: 1 }];
        const porTipo: ReglaPerspectiva[] = [{ grupo: "Almacenamiento", tipo: "resource_type", valor: "microsoft.compute/disks", orden: 1 }];
        const f = fila();
        expect(evaluarFila(f, porEntorno).grupo).toBe("Producción");
        expect(evaluarFila(f, porTipo).grupo).toBe("Almacenamiento");
    });
});
