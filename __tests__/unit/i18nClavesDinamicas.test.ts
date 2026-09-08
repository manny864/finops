// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { createTranslator } from "next-intl";
import { ALL_MODULES } from "@/types/tenantUsers.types";
import { WEEKDAY_KEYS } from "@/types/azurePowerManagement.types";
import { WATERFALL_STEP_KEYS } from "@/types/azureWhatIf.types";
import { REDIS_RULE_I18N } from "@/types/redisCache";
import { MONGO_RULE_I18N } from "@/types/azureMongoDb";
import { MYSQL_RULE_I18N } from "@/types/azureMySQL";
import { POSTGRES_RULE_I18N } from "@/types/azurePostgreSQL";
import { COSMOS_RULE_I18N } from "@/types/cosmosDb";
import { FABRIC_RULE_I18N } from "@/types/azureFabric";

/**
 * Descubre las claves de comentario de script leyendo los marcadores
 * `{{cmt.X}}` que las rutas realmente emiten.
 *
 * Se descubren en vez de listarse a mano por el mismo motivo que WEEKDAY_KEYS
 * se importa: una lista escrita a mano sólo puede dar un falso positivo o un
 * test que no prueba nada. Así, un marcador nuevo en cualquier ruta queda
 * cubierto sin tocar este archivo.
 */
function clavesDeMarcadoresDeScript(): string[] {
    const claves = new Set<string>();
    const caminar = (dir: string) => {
        for (const entrada of readdirSync(dir)) {
            const p = join(dir, entrada);
            if (statSync(p).isDirectory()) caminar(p);
            else if (/\.tsx?$/.test(entrada)) {
                for (const m of readFileSync(p, "utf-8").matchAll(/\{\{cmt\.([A-Za-z0-9_]+)\}\}/g)) {
                    claves.add(m[1]);
                }
            }
        }
    };
    // Solo las rutas: `src/lib/scriptComments.ts` documenta el formato con un
    // `{{cmt.X}}` de ejemplo, y el scanner lo tomaba como una clave llamada "X".
    // Los marcadores REALES los emiten las rutas.
    caminar("src/app/api");
    return [...claves];
}

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

/** Args que una cadena ICU exige: `{scope}` y `{count, plural, ...}` → scope, count. */
function placeholdersICU(icu: string): string[] {
    return [...new Set([...icu.matchAll(/\{\s*(\w+)/g)].map((m) => m[1]))];
}

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
            // El simulador What-If manda `stepKey` en vez del nombre del paso:
            // el servicio no conoce el locale del lector y su payload se
            // cachea. La UI arma `waterfall_<stepKey>` al renderizar el eje.
            que: "pasos del waterfall del simulador (WATERFALL_STEP_KEYS)",
            ns: "WhatIfSimulator",
            claves: WATERFALL_STEP_KEYS.map((k) => `waterfall_${k}`),
        },
        {
            // OptimizationTarget.riskLevel es la union "low" | "medium" | "high".
            que: "nivel de riesgo del modal de remediación",
            ns: "RemediationModals",
            claves: ["low", "medium", "high"].map((r) => `fo_risk_${r}`),
        },
        {
            // Las recomendaciones de Azure Cache for Redis mandan `ruleKey` en
            // vez del título y la descripción armados. El servicio no conoce el
            // locale, y su payload se cachea con una clave que NO incluye el
            // locale, así que traducir en el servidor serviría el idioma
            // equivocado desde el cache.
            que: "recomendaciones de Redis (REDIS_RULE_I18N)",
            ns: "RedisCache",
            // Solo los titulos. Las descripciones llevan parametros
            // (`{hitRate}`, `{name}`...) y esta capa resuelve la clave SIN
            // valores, asi que una descripcion parametrizada fallaria por su
            // forma y no porque falte. Inventarle valores probaria que el test
            // sabe inventar valores, no que el catalogo este completo.
            claves: Object.values(REDIS_RULE_I18N).map((v) => v.title),
        },
        {
            // Igual que Redis: `ruleKey` en vez del titulo armado.
            que: "recomendaciones de MongoDB (MONGO_RULE_I18N)",
            ns: "AzureMongoDB",
            // Solo los titulos SIN parametros: `rec_vcore_downsize_title` lleva
            // {sku} y {target}, y esta capa resuelve la clave sin valores.
            claves: [MONGO_RULE_I18N.vcore_ha_dev_test.title, MONGO_RULE_I18N.reserved_capacity.title, MONGO_RULE_I18N.storage_index_optimization.title],
        },
        {
            // Igual que Redis y MongoDB. Todos los titulos de MySQL, PostgreSQL y
            // Cosmos son sin parametros, asi que se pueden afirmar los seis.
            que: "recomendaciones de MySQL (MYSQL_RULE_I18N)",
            ns: "AzureMySQL",
            claves: Object.values(MYSQL_RULE_I18N).map((v) => v.title),
        },
        {
            que: "recomendaciones de PostgreSQL (POSTGRES_RULE_I18N)",
            ns: "AzurePostgreSQL",
            claves: Object.values(POSTGRES_RULE_I18N).map((v) => v.title),
        },
        {
            // `index_overhead_heavy` e `index_overhead_default` comparten titulo
            // y difieren en la descripcion: son dos diagnosticos del mismo tema.
            que: "recomendaciones de Cosmos DB (COSMOS_RULE_I18N)",
            ns: "CosmosDb",
            claves: [...new Set(Object.values(COSMOS_RULE_I18N).map((v) => v.title))],
        },
        {
            que: "recomendaciones de Microsoft Fabric (FABRIC_RULE_I18N)",
            ns: "MicrosoftFabric",
            // Fabric no interpola: titulos Y descripciones se pueden afirmar.
            claves: Object.values(FABRIC_RULE_I18N).flatMap((v) => [v.title, v.desc]),
        },
        {
            // Los comentarios de los scripts CLI/Bicep viajan como marcadores
            // `{{cmt.X}}` y los resuelve `resolveScriptComments` en el cliente,
            // por el mismo motivo del cache. Las claves salen de los marcadores
            // que realmente aparecen en las rutas, no de una lista a mano.
            que: "comentarios de scripts marcados con {{cmt.X}}",
            ns: "ScriptComments",
            claves: clavesDeMarcadoresDeScript(),
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

/**
 * Capa 3 — las claves de las notificaciones, que no las ve NINGUNA de las otras dos.
 *
 * `i18nKeyIntegrity` sólo mira literales dentro de un `t()`, y estas claves nunca
 * pasan por uno en el fuente: se escriben en un `createNotification({ titleKey })`,
 * se guardan en una fila de `Notifications` y recién en el cliente
 * `textoDeNotificacion` las resuelve. La capa 1 tampoco, porque descubre familias
 * leyendo `` t(`prefijo_${x}`) `` y acá no hay template literal que leer.
 *
 * Y el modo de falla es peor que el de siempre. Cuando falta una clave normal,
 * next-intl escupe el nombre crudo en pantalla: feo, pero se ve. Acá
 * `textoDeNotificacion` atrapa el error y cae al texto guardado, que está **en
 * castellano** — o sea que una clave rota no se manifiesta como un texto roto sino
 * como el bug original intacto, en silencio, y encima sólo para el que lee en otro
 * idioma. Nadie lo va a reportar.
 *
 * Por eso son dos afirmaciones y no una: que la clave exista en los tres catálogos,
 * y que los parámetros que el mensaje pide sean los que el call site manda. Un
 * `{scope}` en el catálogo contra un `params: { scopeName }` en el código falla de
 * esta misma forma muda.
 */
describe("i18n · capa 3: las notificaciones persistidas", () => {
    /**
     * Descubre los call sites en vez de listarlos: una notificación nueva queda
     * cubierta sin tocar este archivo.
     *
     * El discriminador es el prefijo `notif_` y no el nombre del campo, porque
     * `titleKey` está usado para otra cosa en los boards de recomendaciones
     * (`titleKey: "recScaleToZero"`), que no son notificaciones ni viven en este
     * namespace.
     */
    function callSites(): Array<{ archivo: string; titleKey: string; messageKey: string; params: string[] }> {
        // ponytail: regex, no un parser de TS. Aguanta la forma que tienen hoy los
        // 9 call sites (las tres props juntas, comentarios en el medio). Si alguna
        // vez se arma el objeto en pedazos, esto deja de verlo -- y el test avisa,
        // porque el conteo de abajo baja.
        const re = /titleKey:\s*"(notif_\w+)",\s*messageKey:\s*"(notif_\w+)",(?:\s*params:\s*\{([^}]*)\})?/g;
        const encontrados: Array<{ archivo: string; titleKey: string; messageKey: string; params: string[] }> = [];

        for (const archivo of fuentes("src")) {
            // Los comentarios se sacan antes: en anomalyDetectionService hay dos
            // líneas de `//` entre `titleKey` y `messageKey`.
            const codigo = readFileSync(archivo, "utf8").replace(/^[ \t]*\/\/[^\n]*$/gm, "");
            for (const m of codigo.matchAll(re)) {
                const cuerpo = m[3] ?? "";
                encontrados.push({
                    archivo,
                    titleKey: m[1],
                    messageKey: m[2],
                    // Nombre de propiedad = lo que abre un segmento del objeto.
                    params: [...cuerpo.matchAll(/(?:^|[{,])\s*(\w+)\s*:/g)].map((p) => p[1]),
                });
            }
        }
        return encontrados;
    }

    const sitios = callSites();

    it("el escáner encuentra los call sites (si esto falla, se rompió el escáner)", () => {
        // 7 `createNotification` reales + los 3 del tenant de demo. El piso es el
        // total de hoy y no un número holgado: con holgura, un call site que el
        // regex deja de ver pasa desapercibido, que es justo lo que este test cuida.
        expect(sitios.length).toBeGreaterThanOrEqual(10);
    });

    it("cada clave existe en los tres catálogos", () => {
        const faltantes: string[] = [];
        for (const { archivo, titleKey, messageKey } of sitios) {
            for (const locale of LOCALES) {
                for (const clave of [titleKey, messageKey]) {
                    if (typeof catalogos[locale].Notifications?.[clave] !== "string") {
                        faltantes.push(`${locale} · Notifications.${clave} (${archivo})`);
                    }
                }
            }
        }
        expect(faltantes, faltantes.join("\n")).toEqual([]);
    });

    it("los params del call site cubren lo que el mensaje interpola, en los tres idiomas", () => {
        const huecos: string[] = [];
        for (const { archivo, titleKey, messageKey, params } of sitios) {
            for (const locale of LOCALES) {
                for (const clave of [titleKey, messageKey]) {
                    const icu = catalogos[locale].Notifications?.[clave];
                    if (typeof icu !== "string") continue; // ya lo reporta el test de arriba
                    for (const arg of placeholdersICU(icu)) {
                        if (!params.includes(arg)) {
                            huecos.push(`${locale} · Notifications.${clave} pide {${arg}} y el call site no lo manda (${archivo})`);
                        }
                    }
                }
            }
        }
        expect(huecos, huecos.join("\n")).toEqual([]);
    });

    it("con sus params, cada clave rinde una frase sin marcadores sueltos", () => {
        for (const { titleKey, messageKey, params } of sitios) {
            // Valor numérico: sirve para `{count, plural, ...}` y también donde el
            // arg es texto. Al revés no: un string en un plural revienta.
            const valores = Object.fromEntries(params.map((p) => [p, 1]));
            for (const locale of LOCALES) {
                const t = traducir(locale, "Notifications");
                for (const clave of [titleKey, messageKey]) {
                    const texto = t(clave, valores);
                    expect(texto, `${locale} · Notifications.${clave}`).not.toContain(clave);
                    expect(texto, `${locale} · Notifications.${clave}`).not.toMatch(/[{}]/);
                }
            }
        }
    });
});

describe("i18n · capa 4: las recomendaciones de cómputo", () => {
    /**
     * Mismo truco que la capa 3: descubre los call sites en vez de listarlos, así
     * una regla nueva queda cubierta sin tocar este archivo.
     *
     * Estas claves viajan en el payload de `/api/intelligence/compute/workloads`
     * y del colector de ARO, y las resuelven 5 boards y 4 modales. El texto no se
     * arma en el servidor porque el payload se cachea en Redis con una clave que
     * NO incluye el locale: el segundo lector recibiría el idioma del primero.
     *
     * El discriminador es el prefijo `rec_` junto al par titleKey/descKey. En los
     * boards hay otros `titleKey` (`titleKey: "recScaleToZero"`) que no son esto.
     */
    function sitiosDeRecomendacion(): Array<{ archivo: string; titleKey: string; descKey: string; params: string[] }> {
        const re = /titleKey:\s*"(rec_\w+)",\s*descKey:\s*"(rec_\w+)",(?:\s*params:\s*\{([^}]*)\})?/g;
        const encontrados: Array<{ archivo: string; titleKey: string; descKey: string; params: string[] }> = [];

        for (const archivo of fuentes("src")) {
            const codigo = readFileSync(archivo, "utf8").replace(/^[ \t]*\/\/[^\n]*$/gm, "");
            for (const m of codigo.matchAll(re)) {
                const cuerpo = m[3] ?? "";
                encontrados.push({
                    archivo,
                    titleKey: m[1],
                    descKey: m[2],
                    // Acepta forma abreviada (`{ targetSku, sku }`) además de `nombre: valor`.
                    params: [...cuerpo.matchAll(/(?:^|[{,])\s*(\w+)\s*(?=[:,}]|$)/g)].map((p) => p[1]),
                });
            }
        }
        return encontrados;
    }

    const sitios = sitiosDeRecomendacion();

    it("el escáner encuentra los call sites (si esto falla, se rompió el escáner)", () => {
        // 38 en la ruta compartida de workloads (VMSS, App Service, Function Apps
        // y VMs, mock + camino real de Azure) + 5 en el colector de ARO. Piso
        // exacto y no holgado: con holgura, un call site que el regex deja de ver
        // pasa desapercibido, que es justo lo que este test cuida.
        expect(sitios.length).toBeGreaterThanOrEqual(43);
    });

    it("cada clave existe en los tres catálogos", () => {
        const faltantes: string[] = [];
        for (const { archivo, titleKey, descKey } of sitios) {
            for (const locale of LOCALES) {
                for (const clave of [titleKey, descKey]) {
                    if (typeof catalogos[locale].ComputeRecommendations?.[clave] !== "string") {
                        faltantes.push(`${locale} · ComputeRecommendations.${clave} (${archivo})`);
                    }
                }
            }
        }
        expect(faltantes, faltantes.join("\n")).toEqual([]);
    });

    it("los params del call site cubren lo que el texto interpola, en los tres idiomas", () => {
        const huecos: string[] = [];
        for (const { archivo, titleKey, descKey, params } of sitios) {
            for (const locale of LOCALES) {
                for (const clave of [titleKey, descKey]) {
                    const icu = catalogos[locale].ComputeRecommendations?.[clave];
                    if (typeof icu !== "string") continue; // ya lo reporta el test de arriba
                    for (const arg of placeholdersICU(icu)) {
                        if (!params.includes(arg)) {
                            huecos.push(`${locale} · ComputeRecommendations.${clave} pide {${arg}} y el call site no lo manda (${archivo})`);
                        }
                    }
                }
            }
        }
        expect(huecos, huecos.join("\n")).toEqual([]);
    });

    it("con sus params, cada clave rinde una frase sin marcadores sueltos", () => {
        for (const { titleKey, descKey, params } of sitios) {
            const valores = Object.fromEntries(params.map((p) => [p, 1]));
            for (const locale of LOCALES) {
                const t = traducir(locale, "ComputeRecommendations");
                for (const clave of [titleKey, descKey]) {
                    const texto = t(clave, valores);
                    expect(texto, `${locale} · ComputeRecommendations.${clave}`).not.toContain(clave);
                    expect(texto, `${locale} · ComputeRecommendations.${clave}`).not.toMatch(/[{}]/);
                }
            }
        }
    });
});
