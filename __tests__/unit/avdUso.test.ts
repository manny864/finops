// @vitest-environment node
import { describe, it, expect } from "vitest";
import { filasDeRespuestaLA, resumirUso, kqlUsoHostPool } from "@/modules/collectors/azure/avdUsageService";

const HOSTPOOL = "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.DesktopVirtualization/hostPools/hp-Prod";

describe("parseo de la respuesta de Log Analytics", () => {
    it("cruza columnas con filas", () => {
        const payload = {
            tables: [
                {
                    name: "PrimaryResult",
                    columns: [{ name: "usuariosUnicos" }, { name: "conexiones" }, { name: "horasConexion" }],
                    rows: [[26, 412, 1893.42]],
                },
            ],
        };
        expect(filasDeRespuestaLA(payload)).toEqual([
            { usuariosUnicos: 26, conexiones: 412, horasConexion: 1893.42 },
        ]);
    });

    it("una respuesta sin tablas no explota", () => {
        expect(filasDeRespuestaLA({})).toEqual([]);
        expect(filasDeRespuestaLA({ tables: [] })).toEqual([]);
    });
});

describe("resumen de uso", () => {
    it("marca disponible y redondea las horas", () => {
        const uso = resumirUso([
            { usuariosUnicos: 26, conexiones: 412, horasConexion: 1893.4231, picoConcurrencia: 9 },
        ]);
        expect(uso.disponible).toBe(true);
        expect(uso.usuariosUnicos).toBe(26);
        expect(uso.horasConexion).toBe(1893.4);
        expect(uso.picoConcurrencia).toBe(9);
    });

    it("sin filas devuelve NO disponible, no ceros mudos", () => {
        // La diferencia importa: cero usuarios es un hallazgo (el pool no se
        // usa y se puede apagar); "no hay dato" es una tarea de configuracion.
        // Mostrar lo segundo como lo primero es lo que hace que alguien apague
        // un pool que si se estaba usando.
        const uso = resumirUso([]);
        expect(uso.disponible).toBe(false);
        expect(uso.motivo).toBe("sin_datos");
    });

    it("un valor no numerico no se propaga como NaN", () => {
        const uso = resumirUso([{ usuariosUnicos: null, conexiones: "x", horasConexion: undefined }]);
        expect(uso.usuariosUnicos).toBe(0);
        expect(uso.conexiones).toBe(0);
        expect(uso.horasConexion).toBe(0);
    });
});

describe("KQL de uso por host pool", () => {
    const kql = kqlUsoHostPool(HOSTPOOL);

    it("filtra por el host pool en minuscula", () => {
        expect(kql).toContain(HOSTPOOL.toLowerCase());
        expect(kql).toContain("tolower(_ResourceId)");
    });

    it("no depende de valores de State", () => {
        // Los estados de conexion son un enum de Azure que no esta documentado
        // de forma estable. La duracion sale del span entre el primer y el
        // ultimo evento de cada CorrelationId, asi que agregar o renombrar un
        // estado no rompe la metrica.
        expect(kql).not.toMatch(/State\s*==/);
        expect(kql).toContain("min(TimeGenerated)");
        expect(kql).toContain("max(TimeGenerated)");
    });

    it("cuenta usuarios y conexiones distintos", () => {
        expect(kql).toContain("dcount(UserName)");
        expect(kql).toContain("dcount(CorrelationId)");
    });

    it("no se puede romper con una comilla en el id", () => {
        const malicioso = kqlUsoHostPool("/subscriptions/x'/hostPools/y");
        expect(malicioso).not.toContain("x'/");
    });
});
