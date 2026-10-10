import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

/**
 * El DDL versionado del repo: `{ tabla: columnas }`, en minúsculas.
 *
 * Lo usan los tests que comparan el SQL del código contra el esquema real (`insertColumnasExisten`: los INSERT;
 * `azureAiSummaryColumnas`: los SELECT de una base falsa). TypeScript no mira dentro de un string SQL: sin esto,
 * una columna inexistente se entera uno en producción. Reúne las columnas de las migraciones, del schema de
 * bootstrap y del DDL que los servicios crean en runtime.
 */
export function columnasPorTabla(RAIZ: string = process.cwd()): Map<string, Set<string>> {
    // No alcanza con los .sql: varias tablas se crean en runtime desde TypeScript
    // (`ensureTableExists`, los `CREATE TABLE IF NOT EXISTS` de los servicios), y
    // ahí también se agregan columnas. El DDL vigente es la unión de los dos.
    const fuentes = [
        join(RAIZ, "src/modules/storage/schema.sql"),
        ...readdirSync(join(RAIZ, "migrations"))
            .filter((f) => f.endsWith(".sql"))
            .map((f) => join(RAIZ, "migrations", f)),
        ...execSync("grep -rl 'CREATE TABLE\\|ADD COLUMN' src --include=*.ts", { cwd: RAIZ, encoding: "utf8" })
            .trim().split("\n").filter(Boolean).map((f) => join(RAIZ, f)),
    ];
    const ddl = fuentes.map((f) => readFileSync(f, "utf8")).join("\n");

    const tablas = new Map<string, Set<string>>();
    const agregar = (tabla: string, columna: string) => {
        const clave = tabla.toLowerCase();
        if (!tablas.has(clave)) tablas.set(clave, new Set());
        tablas.get(clave)!.add(columna.toLowerCase());
    };

    // CREATE TABLE [IF NOT EXISTS] `T` ( ...cuerpo... );
    const crear = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*?)\n\s*\)\s*(?:ENGINE|DEFAULT|COMMENT|;)/gi;
    for (const m of ddl.matchAll(crear)) {
        for (const linea of m[2].split("\n")) {
            const l = linea.trim().replace(/^--.*/, "");
            // Sólo definiciones de columna: descarta PRIMARY/UNIQUE/FOREIGN/INDEX/KEY/CONSTRAINT.
            const col = l.match(/^`?(\w+)`?\s+(?:INT|BIGINT|SMALLINT|TINYINT|VARCHAR|CHAR|TEXT|LONGTEXT|MEDIUMTEXT|DECIMAL|DOUBLE|FLOAT|DATE|DATETIME|TIMESTAMP|TIME|JSON|ENUM|SET|BLOB|BOOLEAN|BOOL)/i);
            if (col) agregar(m[1], col[1]);
        }
    }

    // ALTER TABLE `T` ADD ..., ADD ..., ...;  — un ALTER puede agregar varias
    // columnas de una, así que se recorre el statement entero hasta el `;`.
    const alterar = /ALTER\s+TABLE\s+`?(\w+)`?([\s\S]*?);/gi;
    for (const m of ddl.matchAll(alterar)) {
        const adds = /ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi;
        for (const a of m[2].matchAll(adds)) {
            // ADD INDEX/KEY/CONSTRAINT/... no declara columna.
            if (/^(index|key|unique|primary|foreign|constraint|fulltext|spatial|check)$/i.test(a[1])) continue;
            agregar(m[1], a[1]);
        }
    }

    return tablas;
}
