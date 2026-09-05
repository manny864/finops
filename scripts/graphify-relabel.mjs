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

const usadas = new Set();
let nodos = 0;
for (const n of grafo.nodes || []) {
  const actual = n.community_name;
  if (actual && Object.hasOwn(mapa, actual)) {
    if (!soloChequear) n.community_name = mapa[actual];
    usadas.add(actual);
    nodos++;
  }
}
for (const [cid, nombre] of Object.entries(labels)) {
  if (Object.hasOwn(mapa, nombre)) {
    if (!soloChequear) labels[cid] = mapa[nombre];
    usadas.add(nombre);
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

const autoRestantes = Object.values(labels).filter((v) =>
  [".ts", ".tsx", ".js", "()", "Community "].some((t) => String(v).includes(t))
).length;

console.log(`${soloChequear ? "[check] " : ""}etiquetas aplicadas: ${usadas.size}/${Object.keys(mapa).length} · nodos tocados: ${nodos}`);
console.log(`comunidades con nombre automático restantes: ${autoRestantes} de ${Object.keys(labels).length}`);
if (sinUsar.length) {
  console.log(`\nclaves del mapa sin correspondencia (${sinUsar.length}) — el hub cambió o el archivo ya no existe:`);
  for (const k of sinUsar.slice(0, 10)) console.log(`   ${k}`);
  if (sinUsar.length > 10) console.log(`   … y ${sinUsar.length - 10} más`);
}
