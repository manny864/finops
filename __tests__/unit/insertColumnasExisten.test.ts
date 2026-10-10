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
import { readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { columnasPorTabla } from "../helpers/ddlVersionado";

const RAIZ = process.cwd();

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
