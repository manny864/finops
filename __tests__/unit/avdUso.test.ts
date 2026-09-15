// @vitest-environment node
import { describe, it, expect } from "vitest";
import { filasDeRespuestaLA, resumirUso, kqlUsoHostPool } from "@/modules/collectors/azure/avdUsageService";
import { evaluateHostPoolRemediations, alcanceCubre } from "@/modules/collectors/azure/avdService";

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

/**
 * Un host pool solo es usable si tiene un Application Group y ese grupo esta
 * publicado en una Workspace. Si falta cualquiera de los dos, los session hosts
 * siguen encendidos y facturando mientras NADIE puede conectarse. Es el
 * desperdicio mas caro de AVD y el que no se ve en ningun grafico de CPU.
 */
describe("host pool inalcanzable", () => {
    const base = {
        name: "hp-dev",
        hostPoolType: "Pooled" as string | null,
        maxSessionLimit: 10,
        hasScalingPlan: true,
        sessionHostCount: 3,
        totalSessions: 0,
        monthlyCostUsd: 300,
    };

    it("se reporta cuando hay hosts encendidos y ningun grupo publicado", () => {
        const acciones = evaluateHostPoolRemediations({ ...base, alcanzable: false, applicationGroupCount: 1 });
        const rec = acciones.find((a) => a.type === "unreachable_host_pool");
        expect(rec).toBeDefined();
        // El ahorro es el costo COMPLETO: no es rightsizing, no se usa nada.
        expect(rec!.monthlySavingsUsd).toBe(300);
    });

    it("no se reporta si el pool es alcanzable", () => {
        const acciones = evaluateHostPoolRemediations({ ...base, alcanzable: true, applicationGroupCount: 1 });
        expect(acciones.some((a) => a.type === "unreachable_host_pool")).toBe(false);
    });

    it("no se reporta sin session hosts: no hay nada encendido que apagar", () => {
        const acciones = evaluateHostPoolRemediations({
            ...base,
            sessionHostCount: 0,
            monthlyCostUsd: 0,
            alcanzable: false,
            applicationGroupCount: 0,
        });
        expect(acciones.some((a) => a.type === "unreachable_host_pool")).toBe(false);
    });

    it("sin el dato de alcance no inventa el hallazgo", () => {
        // `alcanzable` ausente = no se pudo determinar. Acusar de inalcanzable
        // a un pool que si lo es lleva a apagar algo que se usa.
        const acciones = evaluateHostPoolRemediations(base);
        expect(acciones.some((a) => a.type === "unreachable_host_pool")).toBe(false);
    });
});

/**
 * RBAC hereda: un rol puesto en la suscripcion o el grupo de recursos alcanza
 * al app group de adentro. Comparar solo por igualdad marcaria como "sin
 * usuarios" a un grupo que si tiene gente, y de ahi a recomendar apagarlo hay
 * un paso.
 */
describe("alcance de una asignacion de rol", () => {
    const AG = "/subscriptions/s1/resourceGroups/rg-avd/providers/Microsoft.DesktopVirtualization/applicationGroups/ag1";

    it("alcanza en el scope exacto", () => {
        expect(alcanceCubre(AG, AG)).toBe(true);
    });

    it("alcanza heredando del grupo de recursos y de la suscripcion", () => {
        expect(alcanceCubre("/subscriptions/s1/resourceGroups/rg-avd", AG)).toBe(true);
        expect(alcanceCubre("/subscriptions/s1", AG)).toBe(true);
    });

    it("NO alcanza a un grupo de recursos con nombre parecido", () => {
        // Sin el corte por "/", `rg-a` daria por alcanzado todo `rg-avd`.
        expect(alcanceCubre("/subscriptions/s1/resourceGroups/rg-a", AG)).toBe(false);
    });

    it("NO alcanza desde otra suscripcion", () => {
        expect(alcanceCubre("/subscriptions/s2", AG)).toBe(false);
    });

    it("tolera la barra final", () => {
        expect(alcanceCubre("/subscriptions/s1/resourceGroups/rg-avd/", AG)).toBe(true);
    });

    it("es insensible a mayusculas, como los ids de ARM", () => {
        expect(alcanceCubre("/SUBSCRIPTIONS/S1/RESOURCEGROUPS/RG-AVD", AG)).toBe(true);
    });
});

describe("no acusar sin datos de asignaciones", () => {
    const base = {
        name: "hp-x",
        hostPoolType: "Pooled" as string | null,
        maxSessionLimit: 10,
        hasScalingPlan: true,
        sessionHostCount: 2,
        totalSessions: 0,
        monthlyCostUsd: 200,
        alcanzable: true,
    };

    it("reporta cuando consta que no hay nadie asignado", () => {
        const acciones = evaluateHostPoolRemediations({ ...base, sinUsuariosAsignados: true });
        expect(acciones.some((a) => a.descKey === "rec_avd_no_users_desc")).toBe(true);
    });

    it("NO reporta cuando las asignaciones no se pudieron leer", () => {
        // `undefined` = la credencial no ve los role assignments. Tratarlo como
        // cero haria que la pantalla recomiende apagar TODOS los pools.
        const acciones = evaluateHostPoolRemediations({ ...base, sinUsuariosAsignados: undefined });
        expect(acciones.some((a) => a.descKey === "rec_avd_no_users_desc")).toBe(false);
    });
});
