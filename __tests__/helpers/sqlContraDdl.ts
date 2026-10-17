/**
 * Valida un SELECT de UNA sola tabla contra el DDL versionado (`ddlVersionado.ts`).
 *
 * Lo comparten la base falsa de los tests que ejercitan servicios (`executiveReportColumnas`,
 * `mcpAnomaliasColumnas`) y la guarda que recorre `src/` (`selectColumnasExisten`). TypeScript no mira dentro de
 * un string SQL, y los mocks de `pool.query` aceptan cualquier consulta: una tabla o columna inexistente sólo se
 * entera uno en producción, donde un `catch` la convierte en una sección vacía.
 *
 * Es estructural a propósito, sin levantar MySQL. Sólo analiza lo que puede atribuir sin ambigüedad: un único
 * `FROM`, sin JOIN, UNION ni subconsultas. Todo lo demás devuelve `null` ("no lo entiendo") y se deja pasar, para
 * que la guarda no dé falsos positivos.
 */

/** Palabras que el tokenizador no debe confundir con una columna. */
const PALABRAS_SQL = new Set(
    (
        "select from where and or not null is in like between as asc desc order by group having limit offset distinct " +
        "case when then else end true false interval day days week month year quarter hour minute second microsecond " +
        "current_date current_time current_timestamp binary collate escape regexp rlike div mod xor exists all any some " +
        "unsigned signed for update lock share mode boolean natural against separator using over partition rows " +
        "range unbounded preceding following current row with rollup"
    ).split(" ")
);

export interface AnalisisSelect {
    tabla: string;
    /** Referencias a columnas de esa tabla (sin alias ni duplicados), en minúsculas. */
    columnas: string[];
}

/** Índice del primer `FROM` fuera de paréntesis (un `EXTRACT(MONTH FROM d)` lleva uno adentro), o -1. */
function indiceDeFrom(s: string): number {
    let profundidad = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "(") profundidad++;
        else if (c === ")") profundidad--;
        else if (profundidad === 0 && /^FROM\b/i.test(s.slice(i, i + 5)) && (i === 0 || /\s/.test(s[i - 1]))) return i;
    }
    return -1;
}

/**
 * Las columnas que nombra un fragmento de SQL ya sin strings ni comentarios.
 * Descarta funciones (`COALESCE(`), palabras reservadas, alias (`AS x`) y todo lo calificado con algo que no sea
 * la tabla o su alias.
 */
function columnasDeFragmento(texto: string, tabla: string, alias: string | undefined, aliasesDeColumna: Set<string>): string[] {
    const encontradas = new Set<string>();
    for (const m of texto.matchAll(/(?:([A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*)/g)) {
        const [, calificador, nombre] = m;
        const despues = texto.slice(m.index! + m[0].length);
        const antes = texto.slice(0, m.index!);
        if (/^\s*\(/.test(despues)) continue; // función
        if (/\b(?:AS|COLLATE)\s+$/i.test(antes)) continue; // alias, tipo de CAST o collation
        if (calificador && calificador.toLowerCase() !== tabla && calificador.toLowerCase() !== alias) continue;
        const n = nombre.toLowerCase();
        if (PALABRAS_SQL.has(n) || aliasesDeColumna.has(n)) continue;
        encontradas.add(n);
    }
    return [...encontradas];
}

/**
 * Alias que una expresión del SELECT se da sin `AS` (`COUNT(*) n`, `resource_group rg`): el último identificador de
 * un ítem que no es palabra reservada ni sigue a un operador. Hace falta para no tomar `n` por una columna cuando
 * un ORDER BY posterior lo nombra.
 */
function aliasImplicito(item: string): string | null {
    const m = /^(.*\S)\s+([A-Za-z_]\w*)$/.exec(item.trim());
    if (!m || PALABRAS_SQL.has(m[2].toLowerCase())) return null;
    const ultimo = /([A-Za-z_]\w*)\s*$/.exec(m[1])?.[1];
    if (!ultimo && /[-+*/%=<>,(]\s*$/.test(m[1])) return null; // el resto termina en un operador: `a + b`
    if (ultimo && PALABRAS_SQL.has(ultimo.toLowerCase())) return null; // `a AND b`, `NOT x`
    return m[2].toLowerCase();
}

/** Parte `s` por las comas del nivel 0 (fuera de paréntesis). */
function partirPorComas(s: string): string[] {
    const items: string[] = [];
    let profundidad = 0;
    let desde = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "(") profundidad++;
        else if (s[i] === ")") profundidad--;
        else if (s[i] === "," && profundidad === 0) {
            items.push(s.slice(desde, i));
            desde = i + 1;
        }
    }
    items.push(s.slice(desde));
    return items;
}

/** Descompone un SELECT de una sola tabla. `null` si no es uno (o si no se puede analizar sin ambigüedad). */
export function analizarSelect(sqlCrudo: string): AnalisisSelect | null {
    if (/\$\{/.test(sqlCrudo)) return null; // SQL armado con interpolaciones: no se sabe qué dice
    if (/\$\d/.test(sqlCrudo)) return null; // `$1`: placeholder de PostgreSQL, no de nuestra base (ejemplos de la UI)
    const sql = sqlCrudo
        .replace(/--[^\n]*/g, " ")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, "''")
        .replace(/`/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!/^SELECT\b/i.test(sql)) return null;
    if (/\b(?:JOIN|UNION|INTERSECT|EXCEPT)\b/i.test(sql) || /\(\s*SELECT\b/i.test(sql)) return null;

    const iFrom = indiceDeFrom(sql);
    if (iFrom < 0) return null;
    const lista = sql.slice("SELECT".length, iFrom).trim().replace(/^DISTINCT\s+/i, "");
    const resto = sql.slice(iFrom + "FROM".length).trim();

    const t = /^(\w+(?:\.\w+)?)(?:\s+(?:AS\s+)?(?!WHERE\b|GROUP\b|ORDER\b|HAVING\b|LIMIT\b|FOR\b|LOCK\b|USE\b|FORCE\b|IGNORE\b|WINDOW\b)(\w+))?(.*)$/i.exec(resto);
    if (!t) return null;
    const [, nombreTabla, alias, clausulas] = t;
    if (nombreTabla.includes(".")) return null; // information_schema.*, otra base
    if (/^\s*,/.test(clausulas)) return null; // join con coma
    if (/\b(?:USE|FORCE|IGNORE)\s+INDEX\b/i.test(clausulas)) return null;

    const tabla = nombreTabla.toLowerCase();
    const aliasTabla = alias?.toLowerCase();
    const aliasesDeColumna = new Set([...lista.matchAll(/\bAS\s+(\w+)/gi)].map((m) => m[1].toLowerCase()));
    for (const item of partirPorComas(lista)) {
        const implicito = aliasImplicito(item.replace(/\s+AS\s+\w+\s*$/i, ""));
        if (implicito) aliasesDeColumna.add(implicito);
    }

    // Un alias sólo vale en las cláusulas (WHERE/GROUP/ORDER), NO dentro de la lista: `COALESCE(NULLIF(region, ''), '') AS region`
    // pide la columna `region` aunque el alias se llame igual. Por eso la lista se revisa sin sus propios alias
    // (quitados de cada ítem) y con el conjunto vacío; antes el alias tapaba la columna y esa consulta pasaba (2026-10-16).
    const listaSinAlias = partirPorComas(lista)
        .map((item) => {
            const sinAs = item.replace(/\s+AS\s+\w+\s*$/i, "");
            const implicito = aliasImplicito(sinAs);
            return implicito ? sinAs.replace(/\s+\w+\s*$/, "") : sinAs;
        })
        .join(", ");

    const columnas = new Set<string>();
    for (const c of columnasDeFragmento(listaSinAlias, tabla, aliasTabla, new Set())) columnas.add(c);
    for (const c of columnasDeFragmento(clausulas, tabla, aliasTabla, aliasesDeColumna)) columnas.add(c);
    return { tabla, columnas: [...columnas] };
}

/**
 * Lo que MySQL rechazaría de ese SELECT: la tabla inexistente o las columnas que la tabla no tiene.
 * Vacío si está bien o si no es un SELECT analizable.
 */
export function problemasDeSelect(sql: string, esquema: Map<string, Set<string>>): string[] {
    const analisis = analizarSelect(sql);
    if (!analisis) return [];
    const existentes = esquema.get(analisis.tabla);
    if (!existentes) return [`${analisis.tabla}: la tabla no existe en el DDL`];
    return analisis.columnas.filter((c) => !existentes.has(c)).map((c) => `${analisis.tabla}.${c}: la columna no existe en el DDL`);
}
