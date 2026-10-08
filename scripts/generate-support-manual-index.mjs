#!/usr/bin/env node
/**
 * Genera el índice de los manuales que usan los borradores de respuesta de
 * soporte con IA (fase 3b de docs/propuesta-capacidades-ia-2026-10-07.md).
 *
 *   npm run support:index
 *
 * Escribe src/generated/supportManualIndex.json, que SE COMMITEA: la imagen de
 * Docker no lleva docs/ ni los .md de la raíz (ver .dockerignore), así que el
 * índice no se puede armar en el build ni en runtime.
 * __tests__/unit/supportManualIndex.test.ts falla si el JSON no corresponde a
 * los manuales actuales.
 *
 * Un chunk por encabezado h2/h3 (los h4 quedan adentro de su h3). Las secciones
 * chicas de un mismo h2 se juntan hasta ~800 tokens y las grandes se parten por
 * párrafos, para que cada chunk quede en el orden de 500-800 tokens.
 *
 * Sin dependencias: sólo node:fs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const OUTPUT = 'src/generated/supportManualIndex.json';

// Corpus de la propuesta (§4.4 y §6.6). Quedan afuera a propósito docs/security,
// docs/lld, docs/hld y los manuales de superadmin: describen la operación
// interna y no se le citan a un cliente. El del partner sólo se usa si quien
// abrió el ticket es partner (lo decide el servicio, no el índice).
export const MANUALS = [
  { file: 'MANUAL_DE_USUARIO.md', manual: 'usuario-resumen', lang: 'es', label: 'Manual de usuario (resumen)' },
  { file: 'docs/manual/MANUAL_USUARIO_ES.md', manual: 'usuario', lang: 'es', label: 'Manual de usuario' },
  { file: 'docs/manual/MANUAL_USUARIO_EN.md', manual: 'usuario', lang: 'en', label: 'User manual' },
  { file: 'docs/manual/MANUAL_USUARIO_PT-BR.md', manual: 'usuario', lang: 'pt-BR', label: 'Manual do usuário' },
  { file: 'docs/manual/MANUAL_PARTNER_ES.md', manual: 'partner', lang: 'es', label: 'Manual del partner' },
  { file: 'docs/manual/MANUAL_PARTNER_EN.md', manual: 'partner', lang: 'en', label: 'Partner manual' },
  { file: 'docs/manual/MANUAL_PARTNER_PT-BR.md', manual: 'partner', lang: 'pt-BR', label: 'Manual do parceiro' },
];

const MAX_TOKENS = 800;
// Aproximación habitual de tokens para texto latino; alcanza para dimensionar.
const tokensOf = (text) => Math.ceil(text.length / 4);

const cleanTitle = (title) => title.replace(/\*\*|`/g, '').trim();

/** Ancla al estilo de GitHub: minúsculas, sin puntuación ni emojis, espacios a guiones. */
function slugger() {
  const seen = new Map();
  return (title) => {
    const base = title.toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replace(/ /g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

function tidy(text) {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !/^-{3,}$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Un índice de contenidos son sólo ítems que linkean a anclas del mismo manual: no aporta. */
const isTableOfContents = (body) => {
  const lines = body.split('\n').filter((line) => line.trim());
  return lines.length > 0 && lines.every((line) => /^\s*(?:\d+\.|[-*])\s+\[[^\]]*\]\(#[^)]*\)\s*$/.test(line));
};

/** Secciones h2/h3 del manual. Lo anterior al primer h2 (portada, título y ficha) no se indexa. */
function parseSections(markdown) {
  const slug = slugger();
  const sections = [];
  let current = null;
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = cleanTitle(heading[2]);
      const anchor = slug(title);
      if (level <= 3) {
        current = level === 1 ? null : { level, title, anchor, lines: [] };
        if (current) sections.push(current);
        continue;
      }
    }
    current?.lines.push(line);
  }
  return sections.map(({ lines, ...section }) => ({ ...section, body: tidy(lines.join('\n')) }));
}

/** Bloques separados por líneas en blanco, sin cortar un bloque de código. */
function paragraphs(text) {
  const blocks = [];
  let block = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === '' && block.length) {
      blocks.push(block.join('\n'));
      block = [];
    } else if (line.trim() !== '' || inFence) {
      block.push(line);
    }
  }
  if (block.length) blocks.push(block.join('\n'));
  return blocks;
}

/** Junta bloques consecutivos mientras no pasen de MAX_TOKENS; un bloque más grande queda solo. */
function pack(blocks, separator = '\n\n') {
  const packs = [];
  let current = [];
  for (const block of blocks) {
    if (current.length && tokensOf([...current, block].join(separator)) > MAX_TOKENS) {
      packs.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length) packs.push(current);
  return packs;
}

function chunkManual(spec, markdown) {
  const chunks = [];
  const push = (anchor, title, text) =>
    chunks.push({ id: `${spec.manual}-${spec.lang}#${anchor}`, manual: spec.manual, lang: spec.lang, label: spec.label, anchor, title, text });

  // Las secciones se agrupan por h2: nunca se mezclan dos temas de primer nivel.
  const groups = [];
  let parentTitle = '';
  for (const section of parseSections(markdown)) {
    if (section.level === 2) {
      parentTitle = section.title;
      groups.push([]);
    }
    // Un encabezado sin texto propio (el h2 que sólo agrupa h3) ya viaja en el título de sus h3.
    if (!section.body || isTableOfContents(section.body) || !groups.length) continue;
    const path = section.level === 3 && parentTitle ? `${parentTitle} › ${section.title}` : section.title;
    const heading = `${'#'.repeat(section.level)} ${section.title}`;
    groups.at(-1).push({ ...section, path, heading, text: `${heading}\n\n${section.body}` });
  }

  for (const group of groups) {
    let run = [];
    const flushRun = () => {
      if (!run.length) return;
      const [first, last] = [run[0], run.at(-1)];
      push(first.anchor, run.length === 1 ? first.path : `${first.path} – ${last.title}`, run.map((s) => s.text).join('\n\n'));
      run = [];
    };
    for (const section of group) {
      if (tokensOf(section.text) > MAX_TOKENS) {
        flushRun();
        // Un bloque que solo ya se pasa (una lista o tabla larga) se parte por líneas.
        const blocks = paragraphs(section.body).flatMap((block) =>
          tokensOf(block) > MAX_TOKENS ? pack(block.split('\n'), '\n').map((lines) => lines.join('\n')) : [block],
        );
        // Cada parte repite el encabezado para no perder el contexto de la sección.
        pack(blocks).forEach((part, i) => {
          push(i === 0 ? section.anchor : `${section.anchor}~${i + 1}`, section.path, `${section.heading}\n\n${part.join('\n\n')}`);
        });
        continue;
      }
      if (run.length && tokensOf([...run, section].map((s) => s.text).join('\n\n')) > MAX_TOKENS) flushRun();
      run.push(section);
    }
    flushRun();
  }
  return chunks;
}

/** Arma el índice a partir de los manuales que hay en `root`. Puro y determinista. */
export function buildSupportManualIndex(root) {
  const chunks = MANUALS.flatMap((spec) => chunkManual(spec, readFileSync(join(root, spec.file), 'utf-8').replace(/\r\n/g, '\n')));
  const ids = new Set();
  for (const chunk of chunks) {
    if (ids.has(chunk.id)) throw new Error(`id de chunk repetido: ${chunk.id}`);
    ids.add(chunk.id);
  }
  return chunks;
}

export const serializeSupportManualIndex = (chunks) => `${JSON.stringify(chunks, null, 2)}\n`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd();
  const chunks = buildSupportManualIndex(root);
  const out = join(root, OUTPUT);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, serializeSupportManualIndex(chunks));
  console.log(`${OUTPUT}: ${chunks.length} chunks de ${MANUALS.length} manuales.`);
}
