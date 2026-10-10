/**
 * Los nombres de las columnas de SALIDA de un SELECT (el alias, o la columna misma si no lleva): lo que el código lee
 * de cada fila como `r.resource_id`.
 *
 * La base falsa (`baseFalsaDdl.ts`) valida contra qué columnas EXISTEN, pero contesta las filas que arma el test y no
 * notaría un SELECT que las nombre distinto de lo que el servicio lee: el mismo "vacío en silencio" que una columna
 * inexistente, porque `r.resource_id` daría `undefined` y el `if (r.resource_id)` saltearía la fila.
 *
 * Sólo entiende listas de columnas simples: sin subconsultas en el SELECT y sin `EXTRACT(x FROM y)`.
 */
export function columnasDeSalida(sql: string): string[] {
    const s = sql.replace(/\s+/g, " ");
    const iFrom = s.search(/\sFROM\s/i);
    const lista = s.slice(s.search(/SELECT\s/i) + "SELECT ".length, iFrom < 0 ? undefined : iFrom);

    const items: string[] = [];
    let profundidad = 0;
    let desde = 0;
    for (let i = 0; i < lista.length; i++) {
        if (lista[i] === "(") profundidad++;
        else if (lista[i] === ")") profundidad--;
        else if (lista[i] === "," && profundidad === 0) {
            items.push(lista.slice(desde, i));
            desde = i + 1;
        }
    }
    items.push(lista.slice(desde));
    return items.map((item) => /(\w+)\s*$/.exec(item.trim())?.[1] ?? "");
}

/**
 * Contesta `filas` como la base, pero anota en `violaciones` cada clave de las filas que el SELECT no proyecta (las
 * mayúsculas cuentan: mysql2 arma el objeto con el nombre tal como lo escribió el SELECT).
 */
export function conProyeccion<T extends Record<string, unknown>>(sql: string, filas: T[], violaciones: string[]): T[] {
    const salida = new Set(columnasDeSalida(sql));
    for (const fila of filas) {
        for (const clave of Object.keys(fila)) {
            if (!salida.has(clave)) violaciones.push(`el SELECT no proyecta la columna ${clave} que el código lee  ←  ${sql.replace(/\s+/g, " ").slice(0, 100)}`);
        }
    }
    return filas;
}
