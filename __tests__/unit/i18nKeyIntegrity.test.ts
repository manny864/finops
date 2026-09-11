import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Verifica que TODA clave de next-intl referenciada en `src/` exista en los
 * tres diccionarios.
 *
 * Motivo: next-intl no falla en build ante una clave inexistente — lanza
 * MISSING_MESSAGE en runtime y renderiza el nombre crudo de la clave en
 * pantalla. Ya pasó dos veces (56 claves de AdminReport y 37 repartidas entre
 * Billing, pricing.enterpriseModal, TTL, AzureAI y OnboardingWizard), y en
 * ambos casos el defecto llegó a producción porque ni lint ni typecheck lo ven.
 *
 * Alcance honesto: sólo se validan claves con literal estático. Las armadas con
 * template literal (`t(\`col_${id}\`)`) no son resolubles sin ejecutar el
 * componente; se cuentan y se reportan, pero no se verifican.
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
        } else if (/\.(tsx|ts)$/.test(entry)) {
            out.push(p);
        }
    }
    return out;
}

/**
 * Mapea variable → namespace dentro de un archivo. Hace falta porque un mismo
 * archivo puede tener varios (`const t = useTranslations('A')` y
 * `const tA = useTranslations('B')`), y asumir que siempre se llama `t`
 * dejaría claves sin verificar.
 */
function namespacesByVar(src: string): Map<string, string> {
    const map = new Map<string, string>();
    const patterns = [
        /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*['"]([^'"]+)['"]\s*\)/g,
        // getTranslations({ locale, namespace: 'X' })
        /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?getTranslations\(\s*\{[^}]*namespace:\s*['"]([^'"]+)['"]/g,
    ];
    for (const re of patterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) map.set(m[1], m[2]);
    }
    return map;
}

function keysFor(src: string, varName: string): { staticKeys: string[]; dynamic: number } {
    const esc = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Cubre t('k'), t("k") y t.rich('k').
    const reStatic = new RegExp(`\\b${esc}(?:\\.rich)?\\(\\s*(['"])([^'"\`]+?)\\1`, "g");
    const reDynamic = new RegExp(`\\b${esc}(?:\\.rich)?\\(\\s*\``, "g");

    const staticKeys: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = reStatic.exec(src))) staticKeys.push(m[2]);

    return { staticKeys, dynamic: (src.match(reDynamic) || []).length };
}

/** Resuelve `ns` (que puede venir anidado, 'pricing.enterpriseModal') + `key`. */
function resolves(locale: Locale, ns: string, key: string): boolean {
    let node: unknown = messages[locale];
    for (const part of [...ns.split("."), ...key.split(".")]) {
        if (node === null || typeof node !== "object") return false;
        node = (node as Dict)[part];
        if (node === undefined) return false;
    }
    // Un objeto no es un mensaje renderizable.
    return typeof node === "string";
}

interface Violation { file: string; ns: string; key: string; missing: Locale[]; }

function scan() {
    const violations: Violation[] = [];
    let staticChecked = 0;
    let dynamicSkipped = 0;

    for (const file of walk("src")) {
        const src = readFileSync(file, "utf8");
        if (!src.includes("useTranslations") && !src.includes("getTranslations")) continue;

        for (const [varName, ns] of namespacesByVar(src)) {
            const { staticKeys, dynamic } = keysFor(src, varName);
            dynamicSkipped += dynamic;

            for (const key of new Set(staticKeys)) {
                staticChecked++;
                const missing = LOCALES.filter((l) => !resolves(l, ns, key));
                if (missing.length) violations.push({ file, ns, key, missing });
            }
        }
    }
    return { violations, staticChecked, dynamicSkipped };
}

describe("integridad de claves i18n", () => {
    const { violations, staticChecked, dynamicSkipped } = scan();

    it("toda clave referenciada en src/ existe en es, en y pt-BR", () => {
        const report = violations
            .map((v) => `  ${v.ns}.${v.key} — falta en [${v.missing.join(", ")}] (${v.file})`)
            .join("\n");

        expect(
            violations.length,
            violations.length
                ? `\n${violations.length} clave(s) i18n referenciadas pero inexistentes.\n` +
                  `next-intl no falla en build: renderiza el nombre crudo de la clave en pantalla.\n${report}\n`
                : ""
        ).toBe(0);
    });

    it("el escaneo cubre una cantidad significativa de claves", () => {
        // Red de seguridad del propio test: si un refactor rompe las regex, el
        // conteo se desploma y el test pasaría vacío dando falsa tranquilidad.
        expect(staticChecked).toBeGreaterThan(4000);
    });

    it("reporta cuántas claves dinámicas quedan fuera de la verificación", () => {
        // No es un fallo: sólo deja constancia de la cobertura real.
        expect(dynamicSkipped).toBeGreaterThanOrEqual(0);
        console.log(
            `[i18n] ${staticChecked} claves estáticas verificadas x${LOCALES.length} idiomas; ` +
            `${dynamicSkipped} dinámicas no verificables.`
        );
    });
});

/**
 * Segunda pasada: los mapas `*_LABEL_KEYS` a nivel de modulo.
 *
 * El escaneo de arriba sólo ve `t('literal')`. Estos mapas viven donde no hay
 * `t` —a nivel de modulo— y se resuelven con `t(MAPA[x])`, o sea una variable:
 * invisible para la regex. Es justo el hueco por el que entró el defecto del
 * 2026-09-11 en `DatabricksDashboard`, donde dos de las tres entradas eran la
 * frase en castellano en vez de la clave ("Migrar a Automated Jobs DBU"), y
 * `t()` tiraba MISSING_MESSAGE en pantalla.
 *
 * Acá el valor del mapa SÍ es un literal estático, así que se puede verificar.
 */
function escanearMapasDeClaves() {
    const violations: { file: string; entrada: string; valor: string; ns: string; missing: Locale[] }[] = [];
    let entradasVerificadas = 0;

    for (const file of walk("src")) {
        const src = readFileSync(file, "utf8");
        const byVar = namespacesByVar(src);
        if (byVar.size === 0) continue;

        // Un archivo puede tener varios namespaces; se prueba la clave contra
        // todos y basta con que resuelva en uno. Afinar más pediría saber qué
        // variable `t` acompaña al mapa, que es justo lo que no se puede leer
        // estáticamente.
        const namespaces = [...new Set(byVar.values())];

        const reMapa = /const\s+\w*LABEL_KEYS\w*\s*:\s*Record<[^>]*>\s*=\s*\{([\s\S]*?)\n\};/g;
        let mapa: RegExpExecArray | null;
        while ((mapa = reMapa.exec(src))) {
            const reEntrada = /^\s*([A-Za-z0-9_]+)\s*:\s*(['"])([^'"]+)\2\s*,?\s*$/gm;
            let entrada: RegExpExecArray | null;
            while ((entrada = reEntrada.exec(mapa[1]))) {
                const [, nombre, , valor] = entrada;
                entradasVerificadas++;
                const resuelveEnAlguno = namespaces.some((ns) =>
                    LOCALES.every((l) => resolves(l, ns, valor))
                );
                if (resuelveEnAlguno) continue;

                const ns = namespaces[0];
                violations.push({
                    file,
                    entrada: nombre,
                    valor,
                    ns,
                    missing: LOCALES.filter((l) => !namespaces.some((n) => resolves(l, n, valor))),
                });
            }
        }
    }

    return { violations, entradasVerificadas };
}

describe("mapas *_LABEL_KEYS: el valor tiene que ser una clave, no la frase", () => {
    const { violations, entradasVerificadas } = escanearMapasDeClaves();

    it("cada valor resuelve en los tres idiomas", () => {
        const report = violations
            .map((v) => `  ${v.file}: ${v.entrada} -> "${v.valor}" no resuelve en [${v.missing.join(", ")}]`)
            .join("\n");

        expect(
            violations.length,
            violations.length
                ? `\n${violations.length} entrada(s) de mapa que no son claves validas.\n` +
                  `Suele ser la frase original dejada donde iba la clave; t() tira MISSING_MESSAGE en runtime.\n${report}\n`
                : ""
        ).toBe(0);
    });

    it("el escaneo encuentra los mapas", () => {
        // Misma red de seguridad que arriba: si la regex deja de matchear, el
        // test pasaria vacio.
        expect(entradasVerificadas).toBeGreaterThan(15);
    });
});
