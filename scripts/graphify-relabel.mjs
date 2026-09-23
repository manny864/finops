#!/usr/bin/env node
/**
 * Reaplica las etiquetas curadas de comunidades sobre el grafo de graphify.
 *
 * POR QUE EXISTE
 * `graphify-out/` está gitignored a propósito: es un artefacto regenerable de
 * ~11 MB. Pero el etiquetado de comunidades NO es regenerable — es criterio
 * humano, y sin él el 40% de las comunidades se llama como su archivo hub
 * (`requestAuth.ts`, `msalToken.ts`), que no dice nada que el propio nodo no
 * diga ya. Eso degrada toda consulta al grafo, porque la comunidad es el
 * agrupador semántico.
 *
 * Se versiona el MAPA (`docs/graphify-labels.json`, ~19 KB) y no el grafo.
 *
 * POR QUE LA CLAVE ES EL HUB Y NO EL ID DE COMUNIDAD
 * Los ids no son estables entre reconstrucciones: el clustering se recalcula y
 * las comunidades se parten o se fusionan. El propio graphify lo avisa
 * ("community set changed since labeling ... renamed N communities by their
 * hub"). Lo que SÍ es determinístico es el nombre que genera por fallback: el
 * archivo hub. Indexar por ahí hace que el mapa sobreviva al re-clustering.
 *
 * USO
 *   node scripts/graphify-relabel.mjs          # reaplica
 *   node scripts/graphify-relabel.mjs --check  # sólo reporta, no escribe
 *
 * Correr después de `graphify update .`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MAPA = "docs/graphify-labels.json";
const GRAFO = "graphify-out/graph.json";
const LABELS = "graphify-out/.graphify_labels.json";
const soloChequear = process.argv.includes("--check");

if (!existsSync(GRAFO)) {
  console.error(`No existe ${GRAFO}. Corré \`graphify update .\` primero.`);
  process.exit(1);
}

const mapa = JSON.parse(readFileSync(MAPA, "utf8"));
const grafo = JSON.parse(readFileSync(GRAFO, "utf8"));
const labels = existsSync(LABELS) ? JSON.parse(readFileSync(LABELS, "utf8")) : {};

// El separador ` · ` sólo aparece en las etiquetas curadas: las 319 del mapa lo
// tienen y ningún nombre que genere graphify lo lleva. Es lo que permite
// distinguir "ya etiquetada" de "se llama como su hub".
const CURADA = / · /;

// Una etiqueta ya aplicada se reconoce por su VALOR, no por su clave: después
// de un relabel el nodo dice `Persistencia · Db` y la clave `db.ts` ya no está
// en ningún lado. Sin esto, un `--check` sobre un grafo recién reetiquetado
// informaba "aplicadas: 0/319" y las 319 como huérfanas, que es exactamente al
// revés de lo que pasaba.
const claveDeValor = new Map(Object.entries(mapa).map(([k, v]) => [v, k]));

const usadas = new Set();
let nodos = 0;
for (const n of grafo.nodes || []) {
  const actual = n.community_name;
  if (!actual) continue;
  if (Object.hasOwn(mapa, actual)) {
    if (!soloChequear) n.community_name = mapa[actual];
    usadas.add(actual);
    nodos++;
  } else if (claveDeValor.has(actual)) {
    usadas.add(claveDeValor.get(actual));
  }
}
for (const [cid, nombre] of Object.entries(labels)) {
  if (Object.hasOwn(mapa, nombre)) {
    if (!soloChequear) labels[cid] = mapa[nombre];
    usadas.add(nombre);
  } else if (claveDeValor.has(nombre)) {
    usadas.add(claveDeValor.get(nombre));
  }
}

// Las claves sin usar son la señal de deriva: el hub cambió de nombre, o el
// archivo se renombró o se borró. No es un error --el mapa puede tener entradas
// viejas sin romper nada-- pero si son muchas, el mapa se está quedando atrás.
const sinUsar = Object.keys(mapa).filter((k) => !usadas.has(k));

if (!soloChequear) {
  writeFileSync(GRAFO, JSON.stringify(grafo));
  writeFileSync(LABELS, JSON.stringify(labels));
}

// Se cuenta por AUSENCIA del separador y no por un heurístico de extensiones.
// El de antes --buscar `.ts`, `()` o `Community `-- se perdía todas las que el
// clustering nombra con un símbolo pelado (`errorMessage`, `useTenant`,
// `isMockTenant`, 355/274/156 nodos cada una), que son tan automáticas como
// `requestAuth.ts`. Informaba 116 de 966 cuando las que no tienen criterio
// humano son 715: subestimaba la deuda seis veces, y ese 116 viajó a los
// handoffs como si fuera el número.
const nombresDeComunidad = new Set();
for (const n of grafo.nodes || []) if (n.community_name) nombresDeComunidad.add(n.community_name);
const autoRestantes = [...nombresDeComunidad].filter((v) => !CURADA.test(String(v))).length;

console.log(`${soloChequear ? "[check] " : ""}etiquetas aplicadas: ${usadas.size}/${Object.keys(mapa).length} · nodos tocados: ${nodos}`);
console.log(`comunidades sin etiqueta curada: ${autoRestantes} de ${nombresDeComunidad.size}`);
if (sinUsar.length) {
  console.log(`\nclaves del mapa sin correspondencia (${sinUsar.length}) — el hub cambió o el archivo ya no existe:`);
  for (const k of sinUsar.slice(0, 10)) console.log(`   ${k}`);
  if (sinUsar.length > 10) console.log(`   … y ${sinUsar.length - 10} más`);
}
