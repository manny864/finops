import { columnasPorTabla } from "./ddlVersionado";
import { analizarSelect, problemasDeSelect } from "./sqlContraDdl";

export type Fila = Record<string, unknown>;
/** Lo que contesta la base cuando un SELECT pide esa tabla: las filas, ya como las devuelve mysql2. */
export type Respuesta = (params: unknown[], sql: string) => Fila[];

/**
 * Una base falsa que lee el DDL REAL del repo (`ddlVersionado.ts`) y rechaza, como MySQL, toda tabla o columna que
 * no existe. Los mocks de `pool.query` aceptan cualquier consulta, y por eso un SELECT con una columna inventada
 * pasa todos los tests y falla recién en producción, donde un `catch` lo vuelve una sección vacía.
 *
 * Sólo entiende SELECT de una tabla (ver `sqlContraDdl.ts`); cualquier otra consulta se contesta vacía.
 *
 *   const base = crearBaseFalsa();
 *   query.mockImplementation(base.query({ anomalies: () => [base.fila("Anomalies", {...})] }));
 *   ...
 *   expect(base.violaciones).toEqual([]);
 */
export function crearBaseFalsa() {
    const esquema = columnasPorTabla();
    const violaciones: string[] = [];

    return {
        esquema,
        /** Todo lo que MySQL habría rechazado, más las filas de prueba que inventan columnas. Se vacía con `reiniciar`. */
        violaciones,
        reiniciar: () => void violaciones.splice(0),

        /** Una fila de prueba de `tabla`: no puede traer columnas que la tabla no tiene. */
        fila(tabla: string, datos: Fila): Fila {
            const columnas = esquema.get(tabla.toLowerCase());
            for (const k of Object.keys(datos)) {
                if (!columnas?.has(k.toLowerCase())) violaciones.push(`${tabla}: los datos de prueba traen la columna inexistente ${k}`);
            }
            return datos;
        },

        /** La implementación de `pool.query`: valida cada SELECT contra el DDL y contesta con `respuestas[tabla]`. */
        query(respuestas: Record<string, Respuesta>) {
            return async (sql: string, params: unknown[] = []) => {
                const tabla = analizarSelect(sql)?.tabla;
                const problemas = problemasDeSelect(sql, esquema);
                if (problemas.length) {
                    violaciones.push(...problemas.map((p) => `${p}  ←  ${sql.replace(/\s+/g, " ").slice(0, 100)}`));
                    const existe = esquema.has(tabla ?? "");
                    throw Object.assign(
                        new Error(existe ? `Unknown column in 'field list': ${problemas[0]}` : `Table 'finops.${tabla}' doesn't exist`),
                        { code: existe ? "ER_BAD_FIELD_ERROR" : "ER_NO_SUCH_TABLE" }
                    );
                }
                const responder = tabla ? respuestas[tabla] : undefined;
                return [responder ? responder(params, sql) : [], []];
            };
        },
    };
}
