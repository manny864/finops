/**
 * Aplica un mapeo `string en español -> clave i18n` sobre un componente, y
 * agrega las tres traducciones a messages/{es,en,pt-BR}.json.
 *
 * POR QUÉ ASÍ
 * Editar a mano 40 strings en un JSX de 800 líneas rompe componentes. Esto
 * separa el juicio del trabajo mecánico: el mapeo (qué string, qué clave, cómo
 * se traduce) lo decide una persona; la sustitución es por coincidencia exacta
 * y **falla ruidosamente** si un string del mapeo no aparece en el archivo, que
 * es el modo de falla que importa: un panel a medio traducir se ve más roto que
 * uno sin traducir.
 *
 * Uso: node scripts/i18n-apply.mjs <mapeo.json>
 *
 * Forma del mapeo:
 * {
 *   "archivo": "src/components/.../Panel.tsx",
 *   "namespace": "AnomalyPanel",
 *   "strings": {
 *     "Detección de Anomalías Financieras": {
 *       "key": "title",
 *       "en": "Financial Anomaly Detection",
 *       "pt-BR": "Detecção de Anomalias Financeiras"
 *     }
 *   }
 * }
 */
import { readFileSync, writeFileSync } from "fs";

const mapeoPath = process.argv[2];
if (!mapeoPath) { console.error("uso: node scripts/i18n-apply.mjs <mapeo.json>"); process.exit(1); }
const mapeo = JSON.parse(readFileSync(mapeoPath, "utf8"));

let src = readFileSync(mapeo.archivo, "utf8");
const noEncontrados = [];
let sustituciones = 0;

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const [texto, def] of Object.entries(mapeo.strings)) {
    const llamada = `t('${def.key}')`;
    const e = escapar(texto);
    let hechas = 0;

    // 1. Línea suelta de texto JSX (el caso que el formateo de prettier genera).
    const soloLinea = new RegExp(`^([ \\t]*)${e}[ \\t]*$`, "gm");
    src = src.replace(soloLinea, (_m, indent) => { hechas++; return `${indent}{${llamada}}`; });

    // 2. Texto JSX en la misma línea que los tags.
    const enLinea = new RegExp(`>(\\s*)${e}(\\s*)<`, "g");
    src = src.replace(enLinea, (_m, a, b) => { hechas++; return `>${a}{${llamada}}${b}<`; });

    // 3. Prop de JSX: attr="Texto" -> attr={t('key')}
    const prop = new RegExp(`([a-zA-Z-]+)=(["'])${e}\\2`, "g");
    src = src.replace(prop, (_m, attr) => { hechas++; return `${attr}={${llamada}}`; });

    // 4. Literal en contexto JS (objetos, arrays, ternarios): "Texto" -> t('key')
    const literal = new RegExp(`(["'])${e}\\1`, "g");
    src = src.replace(literal, () => { hechas++; return llamada; });

    if (hechas === 0) noEncontrados.push(texto);
    sustituciones += hechas;
}

if (noEncontrados.length) {
    console.error(`\nABORTADO: ${noEncontrados.length} string(s) del mapeo no aparecen en ${mapeo.archivo}:`);
    for (const t of noEncontrados) console.error(`  - ${t}`);
    console.error("\nNo se escribió nada. Corregir el mapeo (¿acentos, espacios, texto partido en dos líneas?).");
    process.exit(1);
}

// El hook. Se inserta después del último import y antes del primer uso.
if (!src.includes("useTranslations")) {
    // Después del último import COMPLETO. Un `import {` multilínea no se puede
    // usar como ancla: la primera versión de esto insertó la línea DENTRO del
    // bloque de tipos y rompió el archivo con "Identifier expected".
    const lineas = src.split("\n");
    let ultimo = -1;
    for (let i = 0; i < lineas.length; i++) {
        if (/^(import .*from\s+["'].*["'];?|import\s+["'].*["'];?|\}\s*from\s+["'].*["'];?)\s*$/.test(lineas[i])) ultimo = i;
    }
    if (ultimo === -1) { console.error("ABORTADO: no encontré dónde poner el import"); process.exit(1); }
    lineas.splice(ultimo + 1, 0, 'import { useTranslations } from "next-intl";');
    src = lineas.join("\n");
}
const firmaComponente = new RegExp(`(export default function ${mapeo.componente}\\([^)]*\\)\\s*\\{\\n)`);
if (!firmaComponente.test(src)) {
    console.error(`ABORTADO: no encontré la firma de 'export default function ${mapeo.componente}(...)'`);
    process.exit(1);
}
src = src.replace(firmaComponente, `$1  const t = useTranslations("${mapeo.namespace}");\n`);

writeFileSync(mapeo.archivo, src, "utf8");
console.log(`${mapeo.archivo}: ${sustituciones} sustituciones, ${Object.keys(mapeo.strings).length} claves`);

// Las traducciones, en los tres idiomas.
for (const loc of ["es", "en", "pt-BR"]) {
    const p = `messages/${loc}.json`;
    const json = JSON.parse(readFileSync(p, "utf8"));
    if (json[mapeo.namespace] && !mapeo.merge) {
        console.error(`ABORTADO: el namespace "${mapeo.namespace}" ya existe en ${p}. Usar "merge": true si es a propósito.`);
        process.exit(1);
    }
    const bloque = json[mapeo.namespace] || {};
    for (const [texto, def] of Object.entries(mapeo.strings)) {
        bloque[def.key] = loc === "es" ? texto : def[loc];
    }
    json[mapeo.namespace] = bloque;
    writeFileSync(p, JSON.stringify(json, null, 2) + "\n", "utf8");
    console.log(`  ${p}: ${Object.keys(bloque).length} claves en "${mapeo.namespace}"`);
}
