#!/usr/bin/env node
/**
 * Detecta valores que quedaron en español dentro de messages/en.json y
 * messages/pt-BR.json.
 *
 * Por qué hace falta un detector y no alcanza un grep: el modo de falla que
 * esto busca NO deja rastro en el código. La clave existe, el componente la
 * llama bien, y lo que está mal es el contenido del catálogo — messages/en.json
 * decía literalmente "btn_exempt": "Eximir / Ignorar". Un barrido por literales
 * hardcodeados pasa de largo.
 *
 * El caso difícil es pt-BR, porque comparte con el español la mitad del
 * vocabulario: "para", "por", "que", "sobre", "todos", "recurso", "anterior" y
 * "gasto" son las dos cosas a la vez. Buscar "palabras que parecen españolas"
 * marca ~1500 falsos positivos sobre 9273 valores y no sirve para nada.
 *
 * En vez de eso se puntúa con marcadores EXCLUYENTES de cada idioma y se marca
 * sólo cuando hay señal española y CERO señal portuguesa. Los más fiables son
 * ortográficos, no léxicos:
 *
 *     español   ción/sión   ñ    ll   -miento   -anza   ct/cc (activar)
 *     portugués ção/são     nh   lh   -mento    -ança   t/ç   (ativar)
 *
 * Un string realmente traducido al portugués casi siempre trae al menos un ã,
 * õ, ç, nh, "não", "é", "do/da", "em", "com" o "sem". Uno que quedó en español
 * no trae ninguno.
 *
 * Segunda pasada, para lo que no tiene marca ortográfica ("Eximir / Ignorar" no
 * la tiene): valor idéntico al español. Eso solo genera ruido —"SKU", "Total",
 * "Forecast" y los nombres de producto de Azure son legítimamente iguales— así
 * que se reporta aparte y filtrado por longitud y por lista de nombres propios.
 */
import { readFileSync } from "node:fs";

// Marcadores válidos contra CUALQUIER idioma: el inglés y el portugués no los
// tienen. Ojo con las versiones sin tilde: "vision", "version" y "decision" son
// inglés corriente, así que acá la tilde no es cosmética, es el discriminante.
const ES_ORTO = [
  /ñ/,
  /[¿¡]/,
  // El singular sin tilde NO sirve: "provision", "session", "version" y
  // "permission" son inglés corriente. Lo que el inglés no tiene es el
  // singular CON tilde ni el plural en -ciones/-siones.
  /\wción(?![a-záéíóúãõçâêôüñ])/iu, /\wsión(?![a-záéíóúãõçâêôüñ])/iu,
  /\wciones(?![a-záéíóúãõçâêôüñ])/iu, /\wsiones(?![a-záéíóúãõçâêôüñ])/iu,
];
const ES_ORTO_ACENTOS = /[áéíóú]/;

// "y" (pt: "e") y "la" (pt: "a") son marcadores fiables, pero NO pueden ir en
// el léxico: el tokenizador parte por dígitos y guiones, así que veía una "y"
// dentro de "1Y RI" y una "la" dentro del enclítico portugués "otimizá-la".
// Con frontera de espacio a los dos lados, ninguno de esos dos casos entra.
// Los artículos van acá y no en el léxico por la misma razón que "y": el
// portugués forma enclíticos con guión —"executá-las", "otimizá-la"— y el
// tokenizador los partía dejando un "las" que parecía el artículo español.
// Exigir espacio a los dos lados descarta el enclítico y también el "Y" de
// "1Y RI".
const ES_PALABRAS_SUELTAS = [
  /(?:^|\s)y(?=\s)/,
  /(?:^|\s)(el|la|los|las|del|al)(?=\s)/i,
];

// Marcadores que sólo separan español de PORTUGUÉS. Contra el inglés no sirven
// —"active", "direct" y "perfect" son inglés— así que se aplican aparte.
// FIN marca el final de palabra. No se usa \b: con \w en ASCII, la á de
// "Acionáveis" cuenta como frontera y /\wci[oó]n\b/ da un falso positivo
// sobre una palabra portuguesa perfectamente correcta.
const FIN = "(?![a-záéíóúãõçâêôüñ])";
const ES_VS_PT = [
  new RegExp(`\\wción${FIN}`, "iu"), new RegExp(`\\wsión${FIN}`, "iu"),
  new RegExp(`\\wciones${FIN}`, "iu"), new RegExp(`\\wsiones${FIN}`, "iu"),
  new RegExp(`\\w(miento|mientos)${FIN}`, "iu"),   // pt: mento
  new RegExp(`\\w(anza|anzas)${FIN}`, "iu"),       // pt: ança
  // El portugués pierde la c del grupo ct/cc: activar/ativar, directo/direto.
  // Se exige la vocal siguiente para no morder identificadores en CamelCase
  // como "ObjectId". "objeto" queda fuera: se escribe igual en los dos idiomas.
  // Formas explícitas, no un prefijo: un valor portugués puede traer dentro la
  // palabra inglesa "Active" ("Status da entidade (Active/Disabled)") y con
  // /activ[aoe]/ la marcaba como española.
  /\b(activar|activad[ao]s?|activ[ao]s?|efectiv[ao]s?|direct[ao]s?|correct[ao]s?)\b/i,
  // Plural español -ales/-iles frente al portugués -ais/-is: adicionales vs
  // adicionais, principales vs principais, mensuales vs mensais.
  // Largo mínimo antes del sufijo: "Sales", "Scales" y "Files" son inglés y
  // caían con \w(ales|iles). Las españolas reales son largas: adicionales,
  // principales, mensuales, generales.
  new RegExp(`\\w{4,}ales${FIN}`, "iu"),
];
const ES_LEX = new Set(`con sin muy más pero hasta cuando también después ahora
  año años usuario usuarios tamaño nombre fecha costo coste ahorro ahorros cerrar ninguno ninguna
  siguiente mensaje ejemplo ejecutar búsqueda guardar selecciona seleccione ingresa haciendo
  desactivar apagado apagada guardando cargando huérfano huérfanos huérfana vacío vacía
  detenido antiguo asignada asignado hoy ayer siempre nunca sólo mismo misma eximir eximida
  eximido sugerencia limpieza resumen emisiones`.split(/\s+/));
// Deliberadamente FUERA del léxico, aunque suenen españolas: "motivo",
// "adicional", "opcional", "ignorada", "restaurar" y "eliminando" son también
// portugués corriente y marcaban traducciones correctas.
const PT_ORTO = [/[ãõ]/, /ç/, /nh/i, /lh/i, /\w(ção|ções|mento|ança)\b/i];
const PT_LEX = new Set(`não são você com sem até mais muito também depois agora ano anos usuário
  nome data custo economia fechar nenhum próximo mensagem exemplo executar busca salvar selecione
  ativar ativo ação direto do da dos das os as em no na nos nas é foi ser ter seu sua está estão
  pode deve há uma um dois duas isso este esta esse essa aqui ali hoje ontem sempre nunca só mesmo`.split(/\s+/));

const NOMBRES = /^(azure|aws|gcp|sku|api|vm|ip|dns|sql|ai|ml|kpi|csv|pdf|json|id|url|http|iops|gb|tb|mb|usd|eur|ars|brl|n\/a|ok|crawl|walk|run|dev|qa|prod|hot|cool|archive|base|total|forecast|score|tier|hub|tags?|owner|budget|admin|reader|email|dashboard)$/i;

// Los placeholders ICU y las etiquetas se descartan antes de puntuar: el
// nombre de la variable lo eligió un programador y suele estar en inglés
// ("{active} de {total} ativas" no tiene una palabra española).
const limpiar = (s) => s.replace(/\{[^}]*\}/g, " ").replace(/<[^>]*>/g, " ");
const palabras = (s) => (limpiar(s).toLowerCase().match(/[a-záéíóúüñãõçâêô]+/g) || []);
// La ortografía y el léxico NO valen lo mismo y no se pueden sumar en un
// número solo. Un "ción" es prueba casi concluyente; una palabra suelta del
// léxico es un indicio. Antes se sumaba todo y se exigía cero señal portuguesa,
// y entonces "Ingresa una justificación para eximir esta recomendación" no se
// marcaba: DOS "ción" perdían contra un único "esta", que el portugués comparte.
const marcas = (s, orto, lex) => ({
  orto: orto.filter((r) => r.test(limpiar(s))).length,
  lex: palabras(s).filter((p) => lex.has(p)).length,
});

function aplanar(obj, pre = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const n = pre + k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, aplanar(v, n + "."));
    else if (typeof v === "string") out[n] = v;
  }
  return out;
}

const leer = (l) => aplanar(JSON.parse(readFileSync(`messages/${l}.json`, "utf-8")));
const es = leer("es");

for (const locale of ["en", "pt-BR"]) {
  const otro = leer(locale);
  const ciertos = [];
  const dudosos = [];

  for (const [k, v] of Object.entries(otro)) {
    if (!/[a-záéíóúñ]/i.test(v)) continue;

    if (locale === "pt-BR") {
      // Contra portugués se suman los marcadores compartidos y los que sólo
      // separan de él; se exige señal española y CERO señal portuguesa.
      const pt = marcas(v, PT_ORTO, PT_LEX);
      const sp = marcas(v, [...ES_ORTO, ...ES_VS_PT, ...ES_PALABRAS_SUELTAS], ES_LEX);
      // Ortografía española sin ortografía portuguesa: concluyente.
      // Si no, el léxico decide, y tiene que ganar por mayoría.
      const marcar = sp.orto > 0 ? pt.orto === 0 : sp.lex > 0 && sp.lex > pt.lex;
      if (marcar) { ciertos.push([k, v]); continue; }
    } else {
      // Contra inglés alcanza cualquier marca española, pero sin las reglas de
      // ES_VS_PT: el inglés sí tiene "active" y "direct".
      const m = marcas(v, [...ES_ORTO, ...ES_PALABRAS_SUELTAS], ES_LEX);
      if (m.orto + m.lex > 0 || ES_ORTO_ACENTOS.test(v)) { ciertos.push([k, v]); continue; }
    }
    // sin marca ortográfica: sólo queda el valor idéntico al español
    if (es[k] === v && v.length > 3 && !NOMBRES.test(v.trim()) && /\s|[a-z]{5}/i.test(v)) {
      dudosos.push([k, v]);
    }
  }

  console.log(`\n${"=".repeat(70)}\n${locale}  —  ${ciertos.length} ciertos · ${dudosos.length} a revisar (idénticos al es)\n${"=".repeat(70)}`);
  const porNs = (lista) => lista.reduce((a, [k, v]) => ((a[k.split(".")[0]] ??= []).push([k, v]), a), {});
  for (const [ns, items] of Object.entries(porNs(ciertos)).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ### ${ns} (${items.length})`);
    for (const [k, v] of items) console.log(`      ${k.split(".").slice(1).join(".")} = ${JSON.stringify(v)}`);
  }
  if (ciertos.length) process.exitCode = 1;
  if (process.env.VERBOSE && dudosos.length) {
    console.log(`\n  --- idénticos al español (revisar a mano) ---`);
    for (const [k, v] of dudosos) console.log(`      ${k} = ${JSON.stringify(v)}`);
  }
}

// --- Autoprueba: `node scripts/i18n-detectar-espanol.mjs --test` ---
// Los casos positivos son los valores REALES que estaban sin traducir en
// pt-BR.json antes del commit af4e842. Si un cambio al detector deja de
// marcarlos, el detector dejó de servir para lo que se escribió.
if (process.argv.includes("--test")) {
  const debeMarcar = [
    "Eximir / Ignorar", "Ignorada / Eximida", "Guardar Exención", "Editar Exención",
    "Motivo / Resumen", "Restaurar Sugerencia", "Eximir Sugerencia de Limpieza",
    "Detalles técnicos adicionales...", "Sin Etiquetas FinOps", "VM Apagada con Discos",
    "¿Estás seguro de que deseas eliminar la exención para el recurso {name}?",
    "Ingresa una justificación para eximir esta recomendación.",
  ];
  const noDebeMarcar = [
    "Isentar / Ignorar", "Salvar Isenção", "Motivo / Resumo", "Comentário adicional (opcional)",
    "Principais Quick Wins Acionáveis", "{active} de {total} ativas", "SP ObjectId:",
    "eliminando {count} discos zumbis", "Otimizá-la antes de continuar",
    "Custo Anual (1Y RI)", "Migrar para Consumption (Y1)", "Detalhes técnicos adicionais...",
  ];
  const marcado = (v) => {
    const pt = marcas(v, PT_ORTO, PT_LEX);
    const sp = marcas(v, [...ES_ORTO, ...ES_VS_PT, ...ES_PALABRAS_SUELTAS], ES_LEX);
    return sp.orto > 0 ? pt.orto === 0 : sp.lex > 0 && sp.lex > pt.lex;
  };
  let fallas = 0;
  for (const v of debeMarcar) if (!marcado(v)) { console.log(`  FALSO NEGATIVO: ${JSON.stringify(v)}`); fallas++; }
  for (const v of noDebeMarcar) if (marcado(v)) { console.log(`  FALSO POSITIVO: ${JSON.stringify(v)}`); fallas++; }
  console.log(fallas ? `\n${fallas} fallas` : `\nOK: ${debeMarcar.length} positivos y ${noDebeMarcar.length} negativos`);
  process.exitCode = fallas ? 1 : 0;
}
