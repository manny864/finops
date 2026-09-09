// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { createTranslator } from "next-intl";
import { ALL_MODULES } from "@/types/tenantUsers.types";
import { WEEKDAY_KEYS } from "@/types/azurePowerManagement.types";
import { DDOS_REMEDIATION_CATEGORIES } from "@/types/ddosProtection.types";
import { BASIC_NETWORK_REMEDIATION_CATEGORIES } from "@/types/basicNetworking.types";
import { HYBRID_REMEDIATION_CATEGORIES } from "@/types/hybridConnectivity.types";
import { LOAD_BALANCING_REMEDIATION_CATEGORIES } from "@/types/loadBalancing.types";
import { INTERNET_ACCESS_REMEDIATION_CATEGORIES } from "@/types/internetAccess.types";
import { LAW_REMEDIATION_CATEGORIES } from "@/types/azureLogAnalytics.types";
import { AZURE_MONITOR_REMEDIATION_CATEGORIES } from "@/types/azureMonitor.types";
import { SENTINEL_REMEDIATION_CATEGORIES } from "@/types/azureSentinel.types";
import { NETWORK_WATCHER_REMEDIATION_CATEGORIES } from "@/types/azureNetworkWatcher.types";
import { ACTION_GROUP_REMEDIATION_CATEGORIES, ACTION_GROUP_CHANNELS } from "@/types/azureActionGroups.types";
import { WATERFALL_STEP_KEYS } from "@/types/azureWhatIf.types";
import { REDIS_RULE_I18N } from "@/types/redisCache";
import { MONGO_RULE_I18N } from "@/types/azureMongoDb";
import { MYSQL_RULE_I18N } from "@/types/azureMySQL";
import { POSTGRES_RULE_I18N } from "@/types/azurePostgreSQL";
import { COSMOS_RULE_I18N } from "@/types/cosmosDb";
import { FABRIC_RULE_I18N } from "@/types/azureFabric";
import { PAGES, pageTitleKey, pageDescKey } from "@/lib/pageRegistry";

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
        /**
         * Valores de prueba para las familias cuyas claves interpolan. No hace
         * falta que sean realistas: la aserción que importa es la de abajo, que
         * el texto resuelto no tenga llaves. Si a una traducción le falta un
         * placeholder que las otras dos sí tienen, o le sobra uno que nadie
         * manda, queda `{algo}` a la vista y el test lo caza.
         */
        params?: Record<string, string | number>;
    }> = [
        {
            que: "canales de Action Group (ACTION_GROUP_CHANNELS)",
            ns: "ActionGroups",
            claves: ACTION_GROUP_CHANNELS.map((c) => `channel_${c}`),
        },
        {
            que: "recomendaciones de Action Groups (ACTION_GROUP_REMEDIATION_CATEGORIES)",
            ns: "ActionGroups",
            params: { name: "ag-oncall", alerts: 3, bounces: 2, failures: 5, receivers: 7 },
            claves: ACTION_GROUP_REMEDIATION_CATEGORIES.flatMap((c) => [`rem_${c}_title`, `rem_${c}_desc`]),
        },
        {
            // Las cuatro familias de monitoreo comparten molde: sin `_impact`,
            // porque el tipo de esos servicios nunca tuvo `impactSummary`.
            que: "recomendaciones de Log Analytics (LAW_REMEDIATION_CATEGORIES)",
            ns: "LogAnalyticsPanel",
            params: { name: "law-prod", tier: 100, gb: "140.0", payg: 2.3, rate: 1.96, savings: "1470.00", rg: "rg-dev", days: 365 },
            claves: LAW_REMEDIATION_CATEGORIES.flatMap((c) => [`rem_${c}_title`, `rem_${c}_desc`]),
        },
        {
            que: "recomendaciones de Azure Monitor (AZURE_MONITOR_REMEDIATION_CATEGORIES)",
            ns: "AzureMonitorPanel",
            params: { name: "alert-5xx", gb: "420.0", cost: "966.00", savings: "676.20", rg: "rg-dev", target: "vm-legacy" },
            claves: AZURE_MONITOR_REMEDIATION_CATEGORIES.flatMap((c) => [`rem_${c}_title`, `rem_${c}_desc`]),
        },
        {
            que: "recomendaciones de Sentinel (SENTINEL_REMEDIATION_CATEGORIES)",
            ns: "SentinelPanel",
            params: { name: "law-sentinel-prod", tier: 100, gb: "141.8", rate: "3.23", savings: "3,950", rules: 4, days: 365 },
            claves: SENTINEL_REMEDIATION_CATEGORIES.flatMap((c) => [`rem_${c}_title`, `rem_${c}_desc`]),
        },
        {
            que: "recomendaciones de Network Watcher (NETWORK_WATCHER_REMEDIATION_CATEGORIES)",
            ns: "NetworkWatcher",
            params: { location: "eastus", rg: "rg-dev", count: 3, storage: "stflowlogs", gb: "12.4", rate: 1.01, seconds: 30 },
            claves: NETWORK_WATCHER_REMEDIATION_CATEGORIES.flatMap((c) => [`rem_${c}_title`, `rem_${c}_desc`]),
        },
        {
            // Mismo molde que las otras familias de red.
            que: "recomendaciones de conectividad hibrida (HYBRID_REMEDIATION_CATEGORIES)",
            ns: "HybridConnectivityFinops",
            params: { name: "vgw-hq", service: "VPN Gateway", sku: "VpnGw3", savings: 248.2 },
            claves: HYBRID_REMEDIATION_CATEGORIES.flatMap((c) => [
                `rem_${c}_title`,
                `rem_${c}_desc`,
                `rem_${c}_impact`,
            ]),
        },
        {
            // Mismo molde que las otras familias de red.
            que: "recomendaciones de balanceo de carga (LOAD_BALANCING_REMEDIATION_CATEGORIES)",
            ns: "LoadBalancingFinops",
            params: { name: "lb-dev", env: "dev", minCap: 4, savings: 295 },
            claves: LOAD_BALANCING_REMEDIATION_CATEGORIES.flatMap((c) => [
                `rem_${c}_title`,
                `rem_${c}_desc`,
                `rem_${c}_impact`,
            ]),
        },
        {
            // Mismo molde que las otras familias de red.
            que: "recomendaciones de salida a internet (INTERNET_ACCESS_REMEDIATION_CATEGORIES)",
            ns: "InternetAccessFinops",
            params: { name: "pip-dev", ip: "20.84.212.99", env: "qa", tier: "Standard", ips: 6, savings: 1750 },
            claves: INTERNET_ACCESS_REMEDIATION_CATEGORIES.flatMap((c) => [
                `rem_${c}_title`,
                `rem_${c}_desc`,
                `rem_${c}_impact`,
            ]),
        },
        {
            // Mismo caso que DDoS, y el mismo molde: los cinco servicios de red
            // se escribieron a partir de la misma plantilla. El mock y la ruta
            // real generaban el mismo consejo con dos redacciones distintas por
            // copiar y pegar; ahora comparten clave y el mock manda sus nombres
            // de demo como params.
            que: "recomendaciones de red basica (BASIC_NETWORK_REMEDIATION_CATEGORIES)",
            ns: "BasicNetworkingFinops",
            params: { name: "nsg-01", rg: "rg-dev", cidr: "10.0.0.0/16", env: "DEV", cost: 7.3 },
            claves: BASIC_NETWORK_REMEDIATION_CATEGORIES.flatMap((c) => [
                `rem_${c}_title`,
                `rem_${c}_desc`,
                `rem_${c}_impact`,
            ]),
        },
        {
            // Las recomendaciones de DDoS ya no viajan con el texto armado: el
            // servidor no conoce el locale del lector y la respuesta se cachea
            // sin el en la clave, asi que el segundo lector recibiria el idioma
            // del primero. `category` alcanza para identificar cada una, asi
            // que la UI arma `rem_<category>_...` y el payload solo lleva los
            // valores a interpolar. Si alguien suma una categoria y se olvida
            // del catalogo, en pantalla se ve la clave cruda: este test es el
            // unico que avisa antes.
            que: "recomendaciones de DDoS (DDOS_REMEDIATION_CATEGORIES)",
            ns: "DdosProtection",
            params: { plan: "vnet-prod", cost: 199, ips: 3, ipRate: 199, savings: 500, planCost: 2944, vnets: 2 },
            claves: DDOS_REMEDIATION_CATEGORIES.flatMap((c) => [
                `rem_${c}_title`,
                `rem_${c}_desc`,
                `rem_${c}_impact`,
            ]),
        },
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
            // Los atajos de pagina no guardan prosa: PageEntry solo tiene el id
            // y la UI arma `page_<id>_title` / `page_<id>_desc` al renderizar.
            // Nadie escribe estas claves a mano, asi que si alguien suma una
            // ruta a PAGES y se olvida del catalogo, el unico que se entera es
            // este test — en la pantalla se ve el id crudo.
            que: "atajos de pagina (PAGES)",
            ns: "MyDashboard",
            claves: PAGES.flatMap((p) => [pageTitleKey(p.id), pageDescKey(p.id)]),
        },
        {
            // ShortcutWidget muestra la categoria de la ruta como rotulo y la
            // resuelve contra el vocabulario del sidebar.
            que: "categorias de las rutas pineables (PAGES[].category)",
            ns: "Navigation",
            claves: [...new Set(PAGES.map((p) => p.category))],
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

    for (const { que, ns, claves, params } of FAMILIAS) {
        it(`${que}: cada clave resuelve en los tres idiomas`, () => {
            expect(claves.length).toBeGreaterThan(0);
            for (const locale of LOCALES) {
                const t = traducir(locale, ns);
                for (const clave of claves) {
                    const texto = t(clave, params ?? {});
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

describe("i18n · capa 4: las recomendaciones que viajan en claves", () => {
    /**
     * Cinco familias, un solo escáner. Antes esto eran dos describes casi
     * idénticos (cómputo y almacenamiento) y agregar disks/backups/adls iba a
     * hacer un tercero: en vez de copiar, la diferencia se movió a esta tabla.
     *
     * Todas estas claves viajan en el payload de una API o de un servicio y las
     * resuelve `useTextoDeRecomendacion` en el render. El texto no se arma en el
     * servidor porque el payload se cachea sin el locale en la clave —en cómputo
     * en Redis, en el resto con SWR del lado del cliente— así que el segundo
     * lector, o el mismo tras cambiar de idioma, veía el idioma equivocado.
     *
     * Descubre los call sites en vez de listarlos: una regla nueva queda cubierta
     * sin tocar este archivo.
     */
    const FAMILIAS = [
        // prefijo, namespace, piso de call sites
        { prefijo: "rec_sto_", ns: "StorageEfficiency", piso: 10 },
        { prefijo: "rec_adls_", ns: "DataLakeFinops", piso: 4 },
        { prefijo: "rec_disk_", ns: "ManagedDisks", piso: 3 },
        { prefijo: "rec_bkp_", ns: "BackupsFinops", piso: 4 },
        // `rec_` es el cajón general de cómputo; excluye a los de arriba.
        { prefijo: "rec_", ns: "ComputeRecommendations", piso: 43 },
    ] as const;

    const OTRAS_FAMILIAS = /"rec_(sto|adls|disk|bkp)_/;

    /**
     * Barre por ventana de líneas en vez de con un regex de bloque. Es más aburrido
     * pero aguanta las tres formas que existen hoy: con `impactKey`, con `stepKeys`,
     * y sin `params` (varias acciones de cómputo no interpolan nada). Un `descKey`
     * puede además ser un ternario, así que se juntan TODAS las claves de la ventana
     * en vez de leer campo por campo.
     */
    function sitios(prefijo: string) {
        const reTitulo = new RegExp(`titleKey:\\s*"(${prefijo}\\w+)"`);
        const reClaves = new RegExp(`"(${prefijo}\\w+)"`, "g");
        const encontrados: Array<{ archivo: string; claves: string[]; params: string[] }> = [];

        for (const archivo of fuentes("src")) {
            const lineas = readFileSync(archivo, "utf8").split("\n");
            for (let i = 0; i < lineas.length; i++) {
                if (!reTitulo.test(lineas[i])) continue;
                if (prefijo === "rec_" && OTRAS_FAMILIAS.test(lineas[i])) continue;

                const ventana = lineas.slice(i, i + 12).join("\n");
                const params = ventana.match(/params:\s*\{([^}]*)\}/);
                encontrados.push({
                    archivo,
                    claves: [...new Set([...ventana.matchAll(reClaves)].map((m) => m[1]))],
                    // Acepta forma abreviada (`{ targetSku, sku }`) además de `nombre: valor`.
                    params: params ? [...params[1].matchAll(/(?:^|[,{])\s*(\w+)\s*(?=[:,}]|$)/g)].map((m) => m[1]) : [],
                });
            }
        }
        return encontrados;
    }

    describe.each(FAMILIAS)("$ns", ({ prefijo, ns, piso }) => {
        const encontrados = sitios(prefijo);

        it("el escáner encuentra los call sites (si esto falla, se rompió el escáner)", () => {
            // Piso exacto y no holgado: con holgura, un call site que el escáner
            // deja de ver pasa desapercibido, que es justo lo que esto cuida.
            expect(encontrados.length).toBeGreaterThanOrEqual(piso);
        });

        it("cada clave existe en los tres catálogos", () => {
            const faltantes: string[] = [];
            for (const { archivo, claves } of encontrados) {
                for (const locale of LOCALES) {
                    for (const clave of claves) {
                        if (typeof catalogos[locale][ns]?.[clave] !== "string") {
                            faltantes.push(`${locale} · ${ns}.${clave} (${archivo})`);
                        }
                    }
                }
            }
            expect(faltantes, faltantes.join("\n")).toEqual([]);
        });

        it("los params del call site cubren lo que el texto interpola, en los tres idiomas", () => {
            const huecos: string[] = [];
            for (const { archivo, claves, params } of encontrados) {
                for (const locale of LOCALES) {
                    for (const clave of claves) {
                        const icu = catalogos[locale][ns]?.[clave];
                        if (typeof icu !== "string") continue; // ya lo reporta el test de arriba
                        for (const arg of placeholdersICU(icu)) {
                            if (!params.includes(arg)) {
                                huecos.push(`${locale} · ${ns}.${clave} pide {${arg}} y el call site no lo manda (${archivo})`);
                            }
                        }
                    }
                }
            }
            expect(huecos, huecos.join("\n")).toEqual([]);
        });

        it("con sus params, cada clave rinde una frase sin marcadores sueltos", () => {
            for (const { claves, params } of encontrados) {
                const valores = Object.fromEntries(params.map((p) => [p, 1]));
                for (const locale of LOCALES) {
                    const t = traducir(locale, ns);
                    for (const clave of claves) {
                        const texto = t(clave, valores);
                        expect(texto, `${locale} · ${ns}.${clave}`).not.toContain(clave);
                        expect(texto, `${locale} · ${ns}.${clave}`).not.toMatch(/[{}]/);
                    }
                }
            }
        });
    });
});

/**
 * Capa 5 — castellano hardcodeado en los tableros ya traducidos.
 *
 * Las capas 1 a 4 verifican que las claves EXISTAN y RINDAN. Ninguna ve el caso
 * inverso, que es el que se escapó cuatro veces seguidas: el texto que nunca
 * pasó por `t()` y quedó literal en el JSX. Salía en la UI en castellano en los
 * tres idiomas y ningún test se enteraba; lo encontraba el usuario mirando la
 * pantalla.
 *
 * Estos archivos ya están limpios. La capa los congela: si alguien agrega
 * `<span>Discos activos</span>` en vez de `t("...")`, esto falla nombrando el
 * archivo y la línea.
 *
 * ponytail: detecta castellano por acentos + palabras funcionales + morfología.
 * Techo medido rompiéndolo a propósito:
 *   "Purgar Huérfanos"       -> lo ve (acento)
 *   "Eliminar los respaldos" -> lo ve (palabra funcional "los")
 *   "Purgar Huerfanos"       -> CIEGO (sin acento, sin funcional, sin sufijo)
 *   "Reintentar"             -> CIEGO (idem, palabra sola)
 * Para ese resto está `scan_es2.py --todo` en los archivos de sesión, que marca
 * TODO literal visible y se revisa a mano. Si el residuo molesta, el paso
 * siguiente es lista blanca de términos técnicos + prohibir cualquier literal.
 */
/*
 * Componentes muertos: cero importaciones en todo `src/`. No se traducen
 * (gastar claves de catalogo en codigo que nadie renderiza es basura) ni se
 * borran (esa decision es del dueno del producto, no del guard).
 *
 * La exclusion se auto-invalida: el test de abajo exige que sigan muertos. Si
 * alguien los importa, ese test falla y obliga a decidir —traducir o borrar—
 * en vez de dejar que la excepcion sobreviva callada al motivo que la creo.
 */
const TABLEROS_MUERTOS = [
    "src/components/dashboard/AnomalyDashboard.tsx",
    "src/components/dashboard/TrialStatusCard.tsx",
];

const TABLEROS_LIMPIOS = [
    "src/components/monitoring/ActionGroupsBoard.tsx",
    "src/components/monitoring/AzureMonitorPanel.tsx",
    "src/components/monitoring/LogAnalyticsPanel.tsx",
    "src/components/monitoring/NetworkWatcherPanel.tsx",
    "src/components/monitoring/SentinelPanel.tsx",
    "src/components/budgets/BudgetCard.tsx",
    "src/components/budgets/BudgetMonthlyChart.tsx",
    "src/components/budgets/KillSwitchConfig.tsx",
    "src/components/budgets/PlatformBudgetsManager.tsx",
    "src/components/cleanup/NetworkingZombiesPanel.tsx",
    "src/components/cleanup/OrphanBackupsPanel.tsx",
    "src/components/cleanup/TtlEnforcementPanel.tsx",
    "src/components/cleanup/ZombieAuditPanel.tsx",
    "src/components/dashboard/AIAnalyticsDashboard.tsx",
    "src/components/dashboard/AMLDashboard.tsx",
    "src/components/dashboard/AdfFinopsDashboard.tsx",
    "src/components/dashboard/AksChargebackCard.tsx",
    "src/components/dashboard/AksIntelligence.tsx",
    "src/components/dashboard/AlertRulesManager.tsx",
    "src/components/dashboard/AllocationManager.tsx",
    "src/components/dashboard/ApimFinopsDashboard.tsx",
    "src/components/dashboard/AppServiceFinopsCmpBoard.tsx",
    "src/components/dashboard/AppServiceRemediationModal.tsx",
    "src/components/dashboard/AppServiceRightsizingTab.tsx",
    "src/components/dashboard/AroClusterBoard.tsx",
    "src/components/dashboard/AzureMongoDbFinopsBoard.tsx",
    "src/components/dashboard/AzureMySqlFinopsBoard.tsx",
    "src/components/dashboard/AzurePostgreSqlFinopsBoard.tsx",
    "src/components/dashboard/AzureSqlFinopsBoard.tsx",
    "src/components/dashboard/BackupsFinopsDashboard.tsx",
    "src/components/dashboard/BasicNetworkingFinopsDashboard.tsx",
    "src/components/dashboard/BillingDashboard.tsx",
    "src/components/dashboard/BudgetBurnChart.tsx",
    "src/components/dashboard/CapturedSavingsBoard.tsx",
    "src/components/dashboard/CoinDashboard.tsx",
    "src/components/dashboard/CoinRecommendationsModal.tsx",
    "src/components/dashboard/CommitmentSimulatorDashboard.tsx",
    "src/components/dashboard/Commitments.tsx",
    "src/components/dashboard/ComputeEfficiencyDashboard.tsx",
    "src/components/dashboard/ComputeServiceCostBoard.tsx",
    "src/components/dashboard/ComputeWorkloadBoard.tsx",
    "src/components/dashboard/ComputeWorkloadFinopsCmpBoard.tsx",
    "src/components/dashboard/ContainerAppsCard.tsx",
    "src/components/dashboard/ContainersFinopsCmpBoard.tsx",
    "src/components/dashboard/ContentSafetyDashboard.tsx",
    "src/components/dashboard/CosmosDbFinopsBoard.tsx",
    "src/components/dashboard/CostByCategoryDashboard.tsx",
    "src/components/dashboard/CostCenterBudgetsBoard.tsx",
    "src/components/dashboard/CostGroupDetailModal.tsx",
    "src/components/dashboard/CostGroupsBoard.tsx",
    "src/components/dashboard/CostHistogramCard.tsx",
    "src/components/dashboard/CostProjectionCard.tsx",
    "src/components/dashboard/CostToggle.tsx",
    "src/components/dashboard/DataLakeGen2FinopsDashboard.tsx",
    "src/components/dashboard/DatabaseFamilyCostBoard.tsx",
    "src/components/dashboard/DatabaseFinopsCmpBoard.tsx",
    "src/components/dashboard/DatabaseStateBadge.tsx",
    "src/components/dashboard/DatabricksDashboard.tsx",
    "src/components/dashboard/DdosProtectionDashboard.tsx",
    "src/components/dashboard/EventGridFinopsDashboard.tsx",
    "src/components/dashboard/EventHubsFinopsDashboard.tsx",
    "src/components/dashboard/ExecutiveSummaryBoard.tsx",
    "src/components/dashboard/ExecutiveSummaryCard.tsx",
    "src/components/dashboard/FinOpsRemediationModal.tsx",
    "src/components/dashboard/FinancialLeaksBoard.tsx",
    "src/components/dashboard/FinopsTableControls.tsx",
    "src/components/dashboard/FocusCostPieChart.tsx",
    "src/components/dashboard/FocusExecutiveSummaryCard.tsx",
    "src/components/dashboard/FunctionAppFinopsCmpBoard.tsx",
    "src/components/dashboard/FunctionAppRemediationModal.tsx",
    "src/components/dashboard/GlobalPagePinButton.tsx",
    "src/components/dashboard/HABreakdownCard.tsx",
    "src/components/dashboard/HistoricalProgressBoard.tsx",
    "src/components/dashboard/HybridBenefitCard.tsx",
    "src/components/dashboard/HybridConnectivityFinopsDashboard.tsx",
    "src/components/dashboard/IntegrationServiceFinopsBoard.tsx",
    "src/components/dashboard/InteractiveDashboard.tsx",
    "src/components/dashboard/InternetAccessFinopsDashboard.tsx",
    "src/components/dashboard/InvoicingReportPanel.tsx",
    "src/components/dashboard/KubernetesHubDashboard.tsx",
    "src/components/dashboard/LighthouseDelegationPanel.tsx",
    "src/components/dashboard/LoadBalancingFinopsDashboard.tsx",
    "src/components/dashboard/LogAnalyticsCard.tsx",
    "src/components/dashboard/LogicAppsFinopsDashboard.tsx",
    "src/components/dashboard/M365CopilotConfigPanel.tsx",
    "src/components/dashboard/M365UsersBoard.tsx",
    "src/components/dashboard/MACCTracker.tsx",
    "src/components/dashboard/ManagedDisksFinopsDashboard.tsx",
    "src/components/dashboard/MaturityDashboard.tsx",
    "src/components/dashboard/MonitoringServiceCostBoard.tsx",
    "src/components/dashboard/MyPinnedWidgets.tsx",
    "src/components/dashboard/NetworkAnalyticsDashboard.tsx",
    "src/components/dashboard/NetworkServiceCostBoard.tsx",
    "src/components/dashboard/NetworkingZombiesPanel.tsx",
    "src/components/dashboard/OptimizationDashboard.tsx",
    "src/components/dashboard/PageHeaderTierBadge.tsx",
    "src/components/dashboard/PartnerMarkup.tsx",
    "src/components/dashboard/PinButton.tsx",
    "src/components/dashboard/RatesOptimization.tsx",
    "src/components/dashboard/RealConsumptionDashboard.tsx",
    "src/components/dashboard/RedisCacheFinopsBoard.tsx",
    "src/components/dashboard/ReservationRenewalModal.tsx",
    "src/components/dashboard/ReservationUtilizationModal.tsx",
    "src/components/dashboard/ResourcesBoard.tsx",
    "src/components/dashboard/RightsizingBlade.tsx",
    "src/components/dashboard/RiskConfidenceBadges.tsx",
    "src/components/dashboard/SecurityServiceCostBoard.tsx",
    "src/components/dashboard/ServiceBusFinopsDashboard.tsx",
    "src/components/dashboard/ShortcutWidget.tsx",
    "src/components/dashboard/SpeechLanguageDashboard.tsx",
    "src/components/dashboard/SqlDbRightsizingTab.tsx",
    "src/components/dashboard/SqlFamilyOverview.tsx",
    "src/components/dashboard/StorageEfficiencyDashboard.tsx",
    "src/components/dashboard/StorageFinopsCmpBoard.tsx",
    "src/components/dashboard/StorageHistoryModal.tsx",
    "src/components/dashboard/StorageRightsizingTab.tsx",
    "src/components/dashboard/StorageServiceCostBoard.tsx",
    "src/components/dashboard/SustainabilityBoard.tsx",
    "src/components/dashboard/TagInheritancePanel.tsx",
    "src/components/dashboard/TenantHealthDashboard.tsx",
    "src/components/dashboard/TopExpensesBoard.tsx",
    "src/components/dashboard/TopSpendBoard.tsx",
    "src/components/dashboard/VisionVideoDashboard.tsx",
    "src/components/dashboard/VmFinopsCmpBoard.tsx",
    "src/components/dashboard/VmRemediationModal.tsx",
    "src/components/dashboard/VmssFinopsCmpBoard.tsx",
    "src/components/dashboard/VmssRemediationModal.tsx",
    "src/components/dashboard/VmssRightsizingTab.tsx",
    "src/components/dashboard/WhiteboardAdvisorWidget.tsx",
    "src/components/dashboard/WhiteboardBudgetWidget.tsx",
    "src/components/dashboard/WhiteboardForecastWidget.tsx",
    "src/components/dashboard/WhiteboardGovernanceWidget.tsx",
    "src/components/dashboard/WhiteboardPinnedWidget.tsx",
    "src/components/dashboard/WhiteboardQuickWinsWidget.tsx",
    "src/components/dashboard/WhiteboardTopServicesWidget.tsx",
    "src/components/dashboard/ZeroCostInventory.tsx",
    "src/components/dashboard/widgetRegistry.tsx",
];

const ACENTOS = /[áéíóúñ¿¡]/i;
const FUNCION = /(?<![\w-])(de|del|la|el|los|las|en|por|para|con|sin|un|una|al|es|son|no|se|su|sus|que|mas|este|esta|estos|estas|cada|entre|sobre|desde|hasta|segun|donde|cuando)(?![\w-])/i;
const MORFO = /(?<![\w-])\w{3,}(cion|ciones|dad|dades|able|ables|miento|mientos|ado|ada|ados|adas|ando|iendo|ivo|iva|ivos|ivas)(?![\w-])/i;
// Clases de Tailwind y tokens que no son prosa.
const NO_ES_PROSA = /(^|\s)(text|bg|border|flex|grid|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|w|h|min|max|rounded|shadow|gap|space|items|justify|hover|dark|sm|md|lg|xl|font|leading|tracking|overflow|absolute|relative|z|opacity|transition|duration|ring)-/;

const pareceCastellano = (t: string) => {
    const s = t.trim();
    if (s.length < 4 || NO_ES_PROSA.test(s)) return false;
    if (!/[a-záéíóúñ]{3}/i.test(s)) return false;
    /*
     * Un token sin espacios y en ASCII puro es un identificador o una clave de
     * i18n, no una frase. Esto tapa un choque real: el sufijo -able de MORFO
     * ("optimizable") es identico en ingles, asi que `Available`, `Burstable`,
     * `DATA_FLOW_CACHE_ENABLE`, `col_available`, `action_disable` y
     * `tooltip_no_measurable` daban positivo. Cubre camelCase, PascalCase,
     * snake_case y SCREAMING_SNAKE de una sola vez.
     *
     * Lo que se pierde: castellano de UNA palabra y sin acento que solo MORFO
     * veria ("Optimizable", "Habilitado" sueltos). Es el techo del escaner ya
     * documentado abajo, no una regresion nueva: sin acento, sin espacio y sin
     * palabra funcional, un token es indistinguible de una clave. Si lleva
     * acento ("Configuracion" con o tildada) NO entra aca, porque el patron
     * exige ASCII: se sigue evaluando.
     */
    if (!/\s/.test(s) && /^[A-Za-z][A-Za-z0-9_]*$/.test(s)) return false;
    return ACENTOS.test(s) || FUNCION.test(s) || MORFO.test(s);
};

/**
 * Saca las {interpolaciones} y los `${...}`, incluidos los anidados: se repite
 * el reemplazo del par mas interno hasta que no cambia mas.
 *
 * Antes esto era un `replace` de una sola pasada, y una sola pasada no alcanza:
 * en `{item.metricsAvailable && x ? \`${item.cpuAvg}%\` : "N/D"}` la pasada
 * unica solo saca el `${item.cpuAvg}` interno y deja `metricsAvailable` a la
 * vista, que termina en -able y dispara MORFO.
 *
 * Sin esto, el guard leia el CODIGO de la interpolacion como si fuera texto de
 * interfaz. `${t("x", { action: tituloDeAccion(action) })}` daba positivo por
 * `tituloDeAccion`, que termina en -cion y dispara la regla morfologica: el
 * identificador de una funcion, no un rotulo. La cura no es aflojar la regla
 * morfologica —que es la que encuentra la mayoria de las fugas reales— sino no
 * pasarle codigo.
 */
const sinInterpolacion = (t: string) => {
    let previo = t;
    for (;;) {
        const actual = previo.replace(/\$\{[^{}]*\}/g, " ").replace(/\{[^{}]*\}/g, " ");
        if (actual === previo) return actual;
        previo = actual;
    }
};

describe("i18n · capa 5: los tableros traducidos no vuelven a tener castellano suelto", () => {
    it.each(TABLEROS_LIMPIOS)("%s no tiene texto literal en castellano", (relativo) => {
        const fuente = readFileSync(join(process.cwd(), relativo), "utf-8").split("\n");
        const hallazgos: string[] = [];
        let enBloque = false;

        fuente.forEach((lineaCruda, i) => {
            // Comentarios de bloque `/* */` y `{/* */}`: son prosa para quien lee
            // el código, no rótulos. Se sacan ANTES de mirar la línea. Sin esto,
            // un comentario en castellano de varias líneas —que este repo usa a
            // menudo— haría fallar el guard sin que haya fuga alguna, y el
            // reflejo sería aflojar el guard en vez de arreglar el ruido.
            let cruda = lineaCruda;
            if (enBloque) {
                const fin = cruda.indexOf("*/");
                if (fin < 0) return;
                cruda = cruda.slice(fin + 2);
                enBloque = false;
            }
            cruda = cruda.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ");
            const ini = cruda.indexOf("/*");
            if (ini >= 0) {
                cruda = cruda.slice(0, ini);
                enBloque = true;
            }

            // corta el comentario al final de línea, que no es texto de interfaz
            const linea = cruda.replace(/\s\/\/(?!\/).*$/, "");
            const s = linea.trim();
            if (s.startsWith("//") || s.startsWith("*") || s.startsWith("/*")) return;

            // texto JSX en una línea: >texto<
            for (const m of linea.matchAll(/>([^<>\n]{3,140})</g)) {
                if (pareceCastellano(sinInterpolacion(m[1]))) {
                    hallazgos.push(`${relativo}:${i + 1}  ${m[1].trim()}`);
                }
            }
            // texto JSX que ocupa su propia línea (puede arrancar con {interpolación})
            // Una linea con las llaves desbalanceadas es un pedazo de una
            // expresion multilinea, no texto: puede ser la apertura
            // (`{mix.inventoryAvailable` de un ternario) o el cierre
            // (`: t("inventoryUnavailable")}`). Juzgar un fragmento suelto,
            // fuera de la expresion que lo contiene, da falsos positivos.
            const fragmento =
                (s.match(/\{/g)?.length ?? 0) !== (s.match(/\}/g)?.length ?? 0);
            if (!fragmento && !/[<>]/.test(s) && !/[,{;(]$/.test(s) && !s.includes("=")) {
                if (pareceCastellano(sinInterpolacion(s))) hallazgos.push(`${relativo}:${i + 1}  ${s}`);
            }
            // literales dentro de expresiones JSX y props de texto
            for (const m of linea.matchAll(/"([^"\n]{4,140})"|'([^'\n]{4,140})'|`([^`\n]{4,140})`/g)) {
                const crudoLit = m[1] ?? m[2] ?? m[3];
                // Solo en backticks: en comillas no hay interpolacion, y sacar
                // `${...}` ahi borraria texto de verdad.
                const lit = m[3] !== undefined ? sinInterpolacion(crudoLit) : crudoLit;
                if (lit.includes("/") && !lit.includes(" ")) continue; // rutas de import
                if (pareceCastellano(lit)) hallazgos.push(`${relativo}:${i + 1}  ${crudoLit}`);
            }
        });

        expect(
            hallazgos,
            `Texto en castellano sin t() en ${relativo}:\n  ${[...new Set(hallazgos)].join("\n  ")}`
        ).toEqual([]);
    });

    it.each(TABLEROS_MUERTOS)("%s sigue sin usarse (si no, hay que traducirlo)", (relativo) => {
        const nombre = relativo.split("/").pop()!.replace(/\.tsx?$/, "");
        const usos = fuentes("src")
            .filter((f) => f.replace(/\\/g, "/") !== relativo)
            .filter((f) => new RegExp(`\\b${nombre}\\b`).test(readFileSync(f, "utf8")));

        expect(
            usos,
            `${relativo} esta excluido de la capa 5 por estar muerto, pero ahora lo usa:\n  ${usos.join("\n  ")}\n` +
                "Decidi: traducilo y moveilo a TABLEROS_LIMPIOS, o borralo."
        ).toEqual([]);
    });

    /*
     * El detector se fue aflojando para sacar falsos positivos. Cada excepcion
     * es una chance de cegarlo, asi que las dos columnas quedan fijadas: la
     * izquierda son fugas que DEBE ver, la derecha ruido que NO debe marcar.
     * Si una excepcion futura se pasa de rosca, la columna izquierda avisa.
     */
    it("el detector de castellano no quedo ciego al aflojarlo", () => {
        const fugas = [
            "Configuración de red",
            "Eliminar los respaldos",
            "Purgar Huérfanos",
            "Cobertura de Cómputo con Savings Plans",
            "Nodos Master y Workers estables",
            "Revisá la configuración antes de aplicar",
        ];
        const ruido = [
            "DATA_FLOW_CACHE_ENABLE",
            "col_available",
            "action_disable",
            "tooltip_no_measurable",
            "cost_sort_unavailable",
            "inventoryUnavailable",
            "Burstable",
            "Available",
            "px-4 py-3 text-slate-600",
        ];

        expect(fugas.filter((f) => !pareceCastellano(f)), "deja pasar castellano").toEqual([]);
        expect(ruido.filter((r) => pareceCastellano(r)), "marca ruido como castellano").toEqual([]);
    });
});

/**
 * Capa 6 — toda clave literal `t("x")` existe en los tres catálogos.
 *
 * Esta capa nace de un hallazgo concreto. Había 31 llamadas de la forma
 * `t("clave", { defaultMessage: "texto en castellano" })`. Parecía una red de
 * seguridad: si falta la clave, cae al castellano. No es así. `defaultMessage`
 * es API de react-intl; next-intl NO la conoce y trata ese objeto como valores
 * ICU. Comprobado contra la librería instalada (use-intl 4.13):
 *
 *   clave que existe -> devuelve el valor del catálogo (ignora defaultMessage)
 *   clave que falta  -> devuelve "Namespace.clave", NO el defaultMessage
 *
 * O sea: el fallback no cae, y encima el castellano muerto tapaba el problema.
 * Las 31 llamadas se limpiaron. Esta capa impide que la falsa red vuelva, pero
 * atacando la causa y no el síntoma: en vez de prohibir `defaultMessage`, exige
 * que la clave EXISTA, que es lo único que de verdad importa.
 *
 * Alcance: resuelve `const X = useTranslations("NS")` y luego busca `X("clave")`
 * en el mismo archivo. Hoy cubre 450 variables en 266 archivos. Quedan afuera
 * los ~51 archivos que reciben `t` por prop: su namespace vive en otro archivo y
 * seguirlo pide análisis entre módulos. No se disimula: el test afirma el piso
 * de cobertura, así que si el descubridor se rompe y pasa a ver 3 variables, el
 * test falla en vez de quedarse en verde sin probar nada.
 */
describe("i18n · capa 6: toda clave literal t(\"x\") existe en los tres catálogos", () => {
    const DECL = /const\s+(\w+)\s*=\s*use(?:Provider)?Translations\(\s*["']([^"']+)["']\s*\)/g;

    /** Recorre "a.b.c" dentro del namespace; los catálogos anidan en algunos casos. */
    function resolver(catalogo: Record<string, unknown>, ns: string, clave: string): unknown {
        let cur: unknown = catalogo[ns];
        for (const parte of clave.split(".")) {
            cur = typeof cur === "object" && cur !== null ? (cur as Record<string, unknown>)[parte] : undefined;
        }
        return cur;
    }

    function usos() {
        const encontrados: Array<{ archivo: string; ns: string; clave: string }> = [];
        for (const archivo of fuentes("src")) {
            const s = readFileSync(archivo, "utf8");
            for (const [, variable, ns] of s.matchAll(DECL)) {
                const llamadas = new RegExp(`\\b${variable}\\(\\s*"([A-Za-z0-9_.]+)"`, "g");
                for (const m of s.matchAll(llamadas)) encontrados.push({ archivo, ns, clave: m[1] });
            }
        }
        return encontrados;
    }

    const encontrados = usos();

    it("el descubridor ve las variables de traducción (si esto falla, se rompió el escáner)", () => {
        const variables = new Set(encontrados.map((u) => `${u.archivo}·${u.ns}`));
        // Pisos exactos medidos hoy, no holgados: con holgura, un descubridor
        // que deja de ver la mitad de los archivos sigue pasando en verde.
        // Cuenta pares (archivo, namespace) CON al menos una clave literal; los
        // archivos que sólo arman claves dinámicas no suman acá — de esos se
        // ocupa la capa 1.
        expect(variables.size).toBeGreaterThanOrEqual(236);
        expect(encontrados.length).toBeGreaterThanOrEqual(19500);
    });

    it("ninguna clave rinde su propia ruta en pantalla", () => {
        const rotas: string[] = [];
        for (const { archivo, ns, clave } of encontrados) {
            for (const locale of LOCALES) {
                if (typeof resolver(catalogos[locale], ns, clave) !== "string") {
                    rotas.push(`${locale} · ${ns}.${clave} (${archivo})`);
                }
            }
        }
        expect([...new Set(rotas)], [...new Set(rotas)].join("\n")).toEqual([]);
    });
});
