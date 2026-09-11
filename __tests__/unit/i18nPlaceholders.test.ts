import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Los placeholders que el mensaje exige tienen que ser los que la llamada pasa.
 *
 * Motivo: next-intl no falla en build. Si el catálogo dice `~{v}/mo` y el
 * componente llama `t("k", { amount })`, en runtime sale
 * `FORMATTING_ERROR: The intl string context variable "v" was not provided`,
 * y como eso ocurre DENTRO de un render de React **se cae el árbol entero**, no
 * sólo ese texto. Ya pasó: `SentinelPanel.estSavingsPerMonth` tumbó
 * /intelligence/monitoreo/microsoft-sentinel.
 *
 * Lo que los otros tests de i18n NO cubren: `i18nKeyIntegrity` verifica que la
 * clave EXISTA; nunca miró los parámetros. Una clave presente con el
 * placeholder mal nombrado pasa ese test y revienta la pantalla.
 *
 * Alcance honesto: sólo llamadas con un objeto literal (`t("k", { a })`). Las
 * que arman los valores en una variable o usan spread no son resolubles
 * estáticamente y se saltean — se cuentan para la red de seguridad de abajo.
 */

const LOCALES = ["es", "en", "pt-BR"] as const;
type Locale = (typeof LOCALES)[number];
type Dict = Record<string, unknown>;

const messages: Record<Locale, Dict> = Object.fromEntries(
    LOCALES.map((l) => [l, JSON.parse(readFileSync(`messages/${l}.json`, "utf8"))])
) as Record<Locale, Dict>;

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
            if (entry !== "node_modules" && entry !== ".next") walk(p, out);
        } else if (/\.(tsx|ts)$/.test(entry)) out.push(p);
    }
    return out;
}

function resolveMessage(locale: Locale, ns: string, key: string): string | undefined {
    let node: unknown = messages[locale];
    for (const part of [...ns.split("."), ...key.split(".")]) {
        if (node === null || typeof node !== "object") return undefined;
        node = (node as Dict)[part];
        if (node === undefined) return undefined;
    }
    return typeof node === "string" ? node : undefined;
}

/**
 * Nombres que el mensaje ICU exige como argumento.
 *
 * La sutileza: en `{count, plural, one {hallazgo} other {hallazgos}}` el único
 * argumento es `count`; `hallazgo` y `hallazgos` son TEXTO de la rama. Contarlos
 * como placeholders da 50 falsos positivos, así que dentro de un plural/select
 * sólo cuenta lo que trae coma (`{otro, number}`), que sí es un argumento.
 */
function placeholdersRequeridos(msg: string): Set<string> {
    const req = new Set<string>();
    let k = 0;
    while (k < msg.length) {
        const c = msg[k];
        if (c === "'") {
            // apóstrofo: es el carácter de escape de ICU
            if (msg[k + 1] === "'") { k += 2; continue; }
            const cierre = msg.indexOf("'", k + 1);
            k = cierre === -1 ? msg.length : cierre + 1;
            continue;
        }
        if (c !== "{") { k++; continue; }

        const m = /^\{\s*([A-Za-z0-9_]+)\s*(,|\})/.exec(msg.slice(k));
        if (!m) { k++; continue; }
        req.add(m[1]);
        if (m[2] === "}") { k += m[0].length; continue; }

        const resto = msg.slice(k + m[0].length);
        const tm = /^\s*([A-Za-z0-9_]+)/.exec(resto);
        const tipo = tm ? tm[1] : "";
        let prof = 1;
        let j = k + 1;
        const esRama = tipo === "plural" || tipo === "select" || tipo === "selectordinal";
        while (j < msg.length && prof > 0) {
            const ch = msg[j];
            if (ch === "'") {
                const cierre = msg.indexOf("'", j + 1);
                j = cierre === -1 ? msg.length : cierre + 1;
                continue;
            }
            if (ch === "{") {
                if (esRama) {
                    const mm = /^\{\s*([A-Za-z0-9_]+)\s*,/.exec(msg.slice(j));
                    if (mm) req.add(mm[1]);
                }
                prof++;
            } else if (ch === "}") prof--;
            j++;
        }
        k = j;
    }
    return req;
}

/** Claves del objeto literal: `a: x` y el shorthand `a`. */
function argsDelObjeto(txt: string): { args: Set<string>; spread: boolean } {
    const args = new Set<string>();
    let spread = false;
    let prof = 0;
    let tok = "";
    const top: string[] = [];
    for (const c of txt) {
        if (c === "{" || c === "(" || c === "[") prof++;
        if (c === "}" || c === ")" || c === "]") prof--;
        if (c === "," && prof === 0) { top.push(tok); tok = ""; continue; }
        tok += c;
    }
    top.push(tok);
    for (const t of top) {
        const x = t.trim();
        if (!x) continue;
        if (x.startsWith("...")) { spread = true; continue; }
        const m = /^([A-Za-z0-9_]+)\s*:/.exec(x) || /^([A-Za-z0-9_]+)$/.exec(x);
        if (m) args.add(m[1]);
    }
    return { args, spread };
}

function scan() {
    const violations: string[] = [];
    let checked = 0;
    let skipped = 0;

    for (const file of walk("src")) {
        const src = readFileSync(file, "utf8");
        const nsByVar = new Map<string, string>();
        for (const re of [
            /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*['"]([^'"]+)['"]\s*\)/g,
            /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?getTranslations\(\s*\{[^}]*namespace:\s*['"]([^'"]+)['"]/g,
        ]) {
            let m: RegExpExecArray | null;
            while ((m = re.exec(src))) nsByVar.set(m[1], m[2]);
        }

        for (const [v, ns] of nsByVar) {
            const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const re = new RegExp(`\\b${esc}(?:\\.rich)?\\(\\s*(['"])([^'"\`]+?)\\1\\s*,\\s*\\{`, "g");
            let m: RegExpExecArray | null;
            while ((m = re.exec(src))) {
                const ini = m.index + m[0].length - 1;
                let prof = 0;
                let fin = ini;
                for (let i = ini; i < src.length; i++) {
                    if (src[i] === "{") prof++;
                    else if (src[i] === "}") { prof--; if (prof === 0) { fin = i; break; } }
                }
                const { args, spread } = argsDelObjeto(src.slice(ini + 1, fin));
                if (spread) { skipped++; continue; }
                const key = m[2];
                for (const locale of LOCALES) {
                    const msg = resolveMessage(locale, ns, key);
                    if (msg === undefined) continue; // lo cubre i18nKeyIntegrity
                    checked++;
                    const faltan = [...placeholdersRequeridos(msg)].filter((p) => !args.has(p));
                    if (faltan.length) {
                        violations.push(
                            `  ${ns}.${key} [${locale}] pide {${faltan.join("}, {")}} y la llamada pasa {${[...args].join(", ")}}\n` +
                            `     ${file}\n     "${msg.slice(0, 90)}"`
                        );
                    }
                }
            }
        }
    }
    return { violations, checked, skipped };
}

describe("i18n · los placeholders del mensaje son los que la llamada pasa", () => {
    const { violations, checked, skipped } = scan();

    it("ninguna llamada omite un placeholder que su mensaje exige", () => {
        expect(
            violations.length,
            violations.length
                ? `\n${violations.length} desajuste(s) de placeholder.\n` +
                  `next-intl tira FORMATTING_ERROR en runtime y, dentro de un render, se lleva el arbol entero.\n` +
                  `${violations.join("\n")}\n`
                : ""
        ).toBe(0);
    });

    it("el escaneo cubre una cantidad significativa de llamadas", () => {
        // Red de seguridad: si las regex se rompen, el conteo cae y el test
        // pasaria vacio dando falsa tranquilidad.
        expect(checked).toBeGreaterThan(2000);
        console.log(`[i18n] ${checked} llamadas con args verificadas; ${skipped} salteadas por spread.`);
    });
});
