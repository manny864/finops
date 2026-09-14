/**
 * @vitest-environment node
 *
 * Ningún INSERT puede nombrar una columna que la tabla no tiene.
 *
 * POR QUÉ. El modal de presupuesto de un grupo de costo devolvía 500 desde el
 * 2026-08-17: el INSERT en `Budgets` nombraba `cost_center_tag_key`,
 * `alert_threshold_percent`, `subscription_id` y `period`, cuatro columnas que
 * la tabla nunca tuvo. TypeScript no mira dentro de un string SQL y la ruta
 * sólo se ejercita apretando el botón, así que el error vivió un mes en prod.
 *
 * El chequeo es estructural a propósito: no levanta MySQL, compara los nombres
 * del INSERT contra el DDL versionado (CREATE TABLE + ALTER TABLE ADD COLUMN).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const RAIZ = process.cwd();

/** Columnas declaradas en migraciones y en el schema de bootstrap. */
function columnasPorTabla(): Map<string, Set<string>> {
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

/**
 * Tablas cuyo DDL versionado NO es la autoridad: existen en prod con nombres de
 * columna distintos según cuándo se creó el tenant. `20260813-001` lo asume
 * explícitamente -- resuelve el nombre en runtime contra information_schema
 * entre tres variantes (tenant_id/tenantId, policy_name/policyName/tag_key). Un
 * chequeo estático sobre el .sql daría un falso positivo garantizado.
 */
const SIN_DDL_UNICO = new Set(["taggingpolicies"]);

describe("INSERT ... (columnas) contra el DDL versionado", () => {
    const tablas = columnasPorTabla();

    it("el DDL se parsea (si esto falla, el resto del test no prueba nada)", () => {
        expect(tablas.get("budgets")).toBeDefined();
        expect(tablas.get("budgets")!.has("cost_center_tag_value")).toBe(true);
        expect(tablas.get("budgets")!.has("cost_center_tag_key")).toBe(false);
    });

    it("ningún INSERT nombra una columna inexistente", () => {
        const archivos = execSync("grep -rl 'INSERT INTO' src --include=*.ts", { cwd: RAIZ, encoding: "utf8" })
            .trim().split("\n").filter(Boolean);

        const problemas: string[] = [];
        for (const rel of archivos) {
            const texto = readFileSync(join(RAIZ, rel), "utf8");
            // INSERT [IGNORE] INTO T ( lista ) — sólo la forma con columnas explícitas.
            for (const m of texto.matchAll(/INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?\s*\(([^)]*)\)/gi)) {
                const tabla = m[1].toLowerCase();
                if (SIN_DDL_UNICO.has(tabla)) continue;
                const conocidas = tablas.get(tabla);
                if (!conocidas) continue; // tabla creada en runtime o fuera del DDL versionado

                for (const bruta of m[2].split(",")) {
                    const col = bruta.replace(/--.*/g, "").trim().replace(/`/g, "").toLowerCase();
                    if (!col || col.includes("$") || /[^a-z0-9_]/.test(col)) continue; // interpolaciones, no columnas
                    if (!conocidas.has(col)) problemas.push(`${rel}: ${tabla}.${col} no existe`);
                }
            }
        }

        expect(problemas).toEqual([]);
    });
});
