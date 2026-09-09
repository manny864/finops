import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";

/**
 * Toda tabla con `tenant_id` tiene que colgar de `Tenants` con ON DELETE CASCADE.
 *
 * El borrado de un tenant no enumera tablas: hace `DELETE FROM Tenants` y
 * confía en la cascada. Cuando una tabla nace sin la FK, sus filas sobreviven al
 * tenant y quedan inalcanzables --nadie puede consultarlas, porque toda consulta
 * filtra por un tenant que ya no existe--. Así se juntaron 3.527 filas de 7
 * tenants borrados antes de `20260909-002`.
 *
 * El agujero no lo abre un bug sino una tabla nueva, así que el chequeo va sobre
 * el esquema y no sobre el código: se lee de las migraciones, que es donde
 * aparece la tabla el día que alguien la agrega.
 */

const EXCEPCIONES: Record<string, string> = {
    ActionLogs: "la baja del entorno es justo lo que hay que poder auditar después",
    AuditTrailLogs: "bitácora de acciones con usuario e IP",
    AuthAuditLogs: "trazabilidad de accesos",
    TenantLifecycleEvents: "registra el CANCELED del propio tenant",
    LegalAcceptances: "evidencia legal de aceptación de DPA/términos",
    DataResidencyChanges: "registro de cumplimiento",
    MarketplaceEvents: "webhooks crudos, llegan antes de que el tenant exista",
    PlatformAiUsage: "gasto de IA que absorbe la plataforma, no el tenant",
    Tenants: "es la tabla padre",
};

const DIR = path.join(process.cwd(), "migrations");

function corpus(): string {
    return readdirSync(DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => readFileSync(path.join(DIR, f), "utf8"))
        .join("\n");
}

/** Cuerpo de cada CREATE TABLE, recortado por paréntesis balanceados. */
function tablasCreadas(sql: string): Map<string, string> {
    const out = new Map<string, string>();
    const re = /CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`?\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
        let nivel = 1;
        let i = re.lastIndex;
        while (i < sql.length && nivel > 0) {
            if (sql[i] === "(") nivel++;
            else if (sql[i] === ")") nivel--;
            i++;
        }
        // Una tabla puede aparecer en más de una migración (CREATE + ALTERs).
        out.set(m[1], (out.get(m[1]) || "") + "\n" + sql.slice(re.lastIndex, i - 1));
    }
    return out;
}

function declaraTenantId(cuerpo: string): boolean {
    return /^\s*`?tenant_id`?\s+\w/im.test(cuerpo);
}

describe("cascada de borrado por tenant", () => {
    const sql = corpus();
    const creadas = tablasCreadas(sql);

    // `ALTER TABLE x ADD COLUMN tenant_id`: la tabla gana la columna después.
    const porAlter = new Set(
        Array.from(
            sql.matchAll(/ALTER TABLE\s+`?(\w+)`?[\s\S]{0,400}?ADD (?:COLUMN )?`?tenant_id`?\s+\w/gi),
        ).map((m) => m[1]),
    );

    const candidatasCrudas = Array.from(
        new Set([
            ...Array.from(creadas.entries()).filter(([, c]) => declaraTenantId(c)).map(([n]) => n),
            ...porAlter,
        ]),
    ).sort();

    // Una migración posterior puede borrar la tabla (`AwsAccounts`): sin esto el
    // chequeo pide FK para tablas que ya no existen en ningún entorno.
    const borradas = new Set(
        Array.from(sql.matchAll(/DROP TABLE (?:IF EXISTS )?`?(\w+)`?/gi)).map((m) => m[1]),
    );
    const candidatas = candidatasCrudas.filter((t) => !borradas.has(t));
    it("hay tablas que auditar (si esto falla, el parser dejó de encontrarlas)", () => {
        expect(candidatas.length).toBeGreaterThan(50);
    });

    it("toda tabla con tenant_id cuelga de Tenants, o está en la lista de excepciones", () => {
        const sinFk = candidatas.filter((t) => {
            if (EXCEPCIONES[t]) return false;
            const inline = new RegExp(
                `FOREIGN KEY \\(\`?tenant_id\`?\\)\\s*REFERENCES\\s+\`?Tenants\`?`,
                "i",
            ).test(creadas.get(t) || "");
            const porAlterTabla = new RegExp(
                `ALTER TABLE \`?${t}\`?[\\s\\S]{0,200}?FOREIGN KEY \\(\`?tenant_id\`?\\)\\s*REFERENCES\\s+\`?Tenants\`?`,
                "i",
            ).test(sql);
            return !inline && !porAlterTabla;
        });

        expect(
            sinFk,
            `Estas tablas tienen tenant_id sin FK a Tenants: sus filas van a sobrevivir al ` +
            `borrado del tenant y quedar inalcanzables. Agregá ` +
            `"ADD CONSTRAINT fk_tenant_<tabla> FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE" ` +
            `en una migración nueva, o sumala a EXCEPCIONES explicando por qué sus filas ` +
            `tienen que sobrevivir al tenant.\n  ${sinFk.join("\n  ")}`,
        ).toEqual([]);
    });

    it("cada excepción sigue existiendo: si se borró la tabla, sobra la excepción", () => {
        const sobran = Object.keys(EXCEPCIONES).filter((t) => !creadas.has(t));
        expect(sobran).toEqual([]);
    });
});
