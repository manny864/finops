// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { createTranslator } from "next-intl";
import { ALL_MODULES } from "@/types/tenantUsers.types";
import { WEEKDAY_KEYS } from "@/types/azurePowerManagement.types";

/**
 * Guard de las claves i18n que se ARMAN EN RUNTIME.
 *
 * `i18nKeyIntegrity` sólo puede verificar claves con literal estático — lo dice
 * su propio encabezado. Una clave construida como `` t(`module_${m}`) `` es
 * invisible para él: si falta en un catálogo, next-intl no rompe el build,
 * lanza MISSING_MESSAGE en runtime y **renderiza el nombre crudo de la clave en
 * pantalla**. Ni lint, ni tsc, ni el otro test lo ven.
 *
 * Hay 40 familias de estas en el código. El test tiene dos capas porque los dos
 * modos de falla son distintos:
 *
 *   Capa 1 — desalineación entre idiomas. Se agrega `module_billing` a es.json
 *   y se olvida en en/pt. Se detecta sin conocer el dominio del discriminador:
 *   alcanza con exigir que el conjunto de claves de cada familia sea idéntico
 *   en los tres catálogos. Los prefijos se descubren leyendo el código, así que
 *   una familia nueva queda cubierta sola, sin tocar este archivo.
 *
 *   Capa 2 — la clave no está en NINGÚN catálogo. Para esto hay que enumerar el
 *   dominio, y sólo se puede afirmar donde el dominio es real: una constante
 *   exportada o un rango cerrado. Adivinar los valores daría un test que pasa
 *   sin probar nada.
 */

const LOCALES = ["es", "en", "pt-BR"] as const;
type Locale = (typeof LOCALES)[number];

const catalogos = Object.fromEntries(
    LOCALES.map((l) => [l, JSON.parse(readFileSync(`messages/${l}.json`, "utf8"))])
) as Record<Locale, Record<string, any>>;

function fuentes(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
            if (entry !== "node_modules" && entry !== ".next") fuentes(p, out);
        } else if (/\.tsx?$/.test(entry)) out.push(p);
    }
    return out;
}

/** Prefijos de familias dinámicas presentes en el código: t(`foo_${x}`) → "foo_". */
function prefijosDinamicos(): string[] {
    const encontrados = new Set<string>();
    const re = /\bt\w*(?:\.rich|\.raw)?\(\s*`([A-Za-z0-9_.]*?)\$\{/g;
    for (const archivo of fuentes("src")) {
        const s = readFileSync(archivo, "utf8");
        for (const m of s.matchAll(re)) if (m[1]) encontrados.add(m[1]);
    }
    return [...encontrados].sort();
}

const traducir = (locale: Locale, ns: string) =>
    createTranslator({ locale, messages: catalogos[locale], namespace: ns }) as unknown as (
        k: string,
        args?: Record<string, string | number>
    ) => string;

describe("i18n · capa 1: las familias dinámicas están alineadas en los tres idiomas", () => {
    const prefijos = prefijosDinamicos();

    it("hay familias dinámicas que cubrir (si esto falla, el detector se rompió)", () => {
        expect(prefijos.length).toBeGreaterThan(20);
    });

    it("cada familia tiene el mismo conjunto de claves en es, en y pt-BR", () => {
        const desalineadas: string[] = [];

        for (const ns of Object.keys(catalogos.es)) {
            if (typeof catalogos.es[ns] !== "object" || catalogos.es[ns] === null) continue;

            for (const prefijo of prefijos) {
                const porIdioma = LOCALES.map((l) => {
                    const arbol = catalogos[l][ns];
                    if (!arbol || typeof arbol !== "object") return new Set<string>();
                    return new Set(Object.keys(arbol).filter((k) => k.startsWith(prefijo)));
                });

                const [base, ...resto] = porIdioma;
                if (base.size === 0) continue;

                resto.forEach((otro, i) => {
                    const falta = [...base].filter((k) => !otro.has(k));
                    const sobra = [...otro].filter((k) => !base.has(k));
                    const idioma = LOCALES[i + 1];
                    for (const k of falta) desalineadas.push(`${ns}.${k} falta en ${idioma}`);
                    for (const k of sobra) desalineadas.push(`${ns}.${k} sobra en ${idioma} (no está en es)`);
                });
            }
        }

        expect(desalineadas, desalineadas.slice(0, 20).join("\n")).toEqual([]);
    });
});

describe("i18n · capa 2: los dominios que se pueden enumerar de verdad", () => {
    /**
     * Cada entrada declara de dónde sale el dominio. Si mañana alguien agrega un
     * módulo a ALL_MODULES o un día a la semana, el dominio crece solo y el test
     * exige la clave nueva.
     *
     * Por qué son sólo tres y no las 40: el dominio tiene que vivir en un módulo
     * importable sin arrastrar React. `tab_*` sale de un `const TABS` local a
     * CostGroupDetailModal, e importar el componente trae su árbol entero
     * (next/navigation) y revienta el entorno node del test. Moverlo a un módulo
     * de tipos sería reestructurar el fuente para satisfacer un test, y la capa
     * 1 ya cubre el modo de falla frecuente de esas familias. Cuando una familia
     * nueva tenga su dominio en un `const` exportado desde types/ o lib/, sumarla
     * acá es una línea.
     */
    const FAMILIAS: Array<{
        que: string;
        ns: string;
        claves: string[];
    }> = [
        {
            // UserPermissionsDrawer renderiza un checkbox por módulo y pide dos
            // claves por cada uno: el nombre y su descripción.
            que: "permisos por módulo (ALL_MODULES)",
            ns: "AdminUsers",
            claves: ALL_MODULES.flatMap((m) => [`module_${m}`, `module_${m}_desc`]),
        },
        {
            // VmPowerManagementPanel recorre WEEKDAY_KEYS (Mon..Sun) y pide los
            // tres formatos de cada día. Se importa la constante en vez de
            // escribir la lista: mi primer intento asumió índices 0-6 y el test
            // falló contra un catálogo que estaba bien. Un dominio inventado
            // sólo puede dar un falso positivo o un test que no prueba nada.
            que: "días de la semana en los tres formatos (WEEKDAY_KEYS)",
            ns: "PowerManagement",
            claves: WEEKDAY_KEYS.flatMap((d) => [
                `weekday_${d}`,
                `weekdayShort_${d}`,
                `weekdayInitial_${d}`,
            ]),
        },
        {
            // OptimizationTarget.riskLevel es la union "low" | "medium" | "high".
            que: "nivel de riesgo del modal de remediación",
            ns: "RemediationModals",
            claves: ["low", "medium", "high"].map((r) => `fo_risk_${r}`),
        },
    ];

    for (const { que, ns, claves } of FAMILIAS) {
        it(`${que}: cada clave resuelve en los tres idiomas`, () => {
            expect(claves.length).toBeGreaterThan(0);
            for (const locale of LOCALES) {
                const t = traducir(locale, ns);
                for (const clave of claves) {
                    const texto = t(clave);
                    // next-intl devuelve la ruta de la clave cuando no la
                    // encuentra: es exactamente lo que se vería en pantalla.
                    expect(texto, `${locale} · ${ns}.${clave}`).not.toContain(clave);
                    expect(texto, `${locale} · ${ns}.${clave}`).not.toMatch(/[{}]/);
                }
            }
        });
    }
});
