#!/usr/bin/env node
/**
 * Genera los inventarios del LLD a partir del CÓDIGO, no de la memoria de nadie.
 *
 *   node scripts/generate-lld.mjs
 *
 * Escribe docs/lld/generated/*.md. Esos archivos NO se editan a mano: se
 * regeneran. La documentación narrativa (docs/lld/0*.md) sí es escrita a mano,
 * porque requiere criterio; ésta es la parte que se desactualiza sola y por eso
 * se deriva del árbol de archivos.
 *
 * Sin dependencias: sólo node:fs. Corre en cualquier checkout con `node`.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'docs', 'lld', 'generated');

const GUARDS = [
  'requireSuperAdmin',
  'requireTenantRole',
  'requireTenantTier',
  'requireTenantAccess',
  'requireRequestIdentity',
];

function walk(dir, filter, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, filter, acc);
    else if (filter(full)) acc.push(full);
  }
  return acc;
}

const rel = (p) => relative(ROOT, p).split(sep).join('/');

// ---------------------------------------------------------------------------
// 1. Inventario de rutas API: método, guard de auth, tier y si es mock-aware.
// ---------------------------------------------------------------------------
function apiInventory() {
  const files = walk(join(ROOT, 'src', 'app', 'api'), (f) => f.endsWith('route.ts'));
  const rows = files.map((f) => {
    const src = readFileSync(f, 'utf8');
    const endpoint = '/' + rel(f).replace(/^src\/app\//, '').replace(/\/route\.ts$/, '');
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
      .filter((m) => new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(src));
    const guards = GUARDS.filter((g) => src.includes(g));
    // El tier exigido sale del 2º/3er argumento literal de requireTenantTier.
    const tierMatch = src.match(/requireTenantTier\([^)]*['"](Essential|Professional|Business|Enterprise)['"]/);
    const usesCronSecret = /CRON_SECRET/.test(src);
    const mockAware = /isMockTenant/.test(src);
    return {
      endpoint,
      methods: methods.length ? methods.join(', ') : '—',
      guards: guards.length ? guards.join(', ') : (usesCronSecret ? '_CRON_SECRET_' : '—'),
      tier: tierMatch ? tierMatch[1] : '',
      mockAware,
    };
  }).sort((a, b) => a.endpoint.localeCompare(b.endpoint));

  const sinGuard = rows.filter((r) => r.guards === '—');
  const lines = [
    '# Inventario de rutas API (generado)',
    '',
    '> Generado por `scripts/generate-lld.mjs`. No editar a mano.',
    '',
    `Total: **${rows.length}** rutas.`,
    '',
    'La columna *Guard* es el guard de `src/lib/requestAuth.ts` presente en el archivo.',
    '`_CRON_SECRET_` = no usa guard de tenant; autentica con el header `Authorization: Bearer $CRON_SECRET`.',
    '`—` = ningún mecanismo de los anteriores: revisar caso por caso (ver más abajo).',
    '',
    '| Endpoint | Métodos | Guard | Tier | Mock-aware |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| \`${r.endpoint}\` | ${r.methods} | ${r.guards} | ${r.tier || '—'} | ${r.mockAware ? 'sí' : '—'} |`),
    '',
    '## Rutas sin guard de tenant ni CRON_SECRET',
    '',
    'Requieren justificación explícita. Son públicas por diseño (pre-login, webhooks',
    'firmados, API pública con su propia autenticación por API key, health checks) o',
    'son un hallazgo. Contrastar contra `docs/lld/03-seguridad-y-rbac.md`.',
    '',
    ...(sinGuard.length
      ? sinGuard.map((r) => `- \`${r.endpoint}\``)
      : ['_Ninguna._']),
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 2. Tablas de la base: de schema.sql (baseline) + migrations/ (fuente de verdad
//    de los cambios encima del baseline).
// ---------------------------------------------------------------------------
function dbInventory() {
  const schemaPath = join(ROOT, 'src', 'modules', 'storage', 'schema.sql');
  const migDir = join(ROOT, 'migrations');
  const migrations = existsSync(migDir)
    ? readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
    : [];

  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
  const collect = (sql) => {
    const found = new Set();
    let m;
    while ((m = createRe.exec(sql)) !== null) found.add(m[1]);
    createRe.lastIndex = 0;
    return found;
  };

  const baseline = existsSync(schemaPath) ? collect(readFileSync(schemaPath, 'utf8')) : new Set();
  const fromMigrations = new Map(); // tabla -> primera migración que la crea
  for (const f of migrations) {
    for (const t of collect(readFileSync(join(migDir, f), 'utf8'))) {
      if (!fromMigrations.has(t)) fromMigrations.set(t, f);
    }
  }

  const all = [...new Set([...baseline, ...fromMigrations.keys()])].sort((a, b) =>
    a.localeCompare(b)
  );

  return [
    '# Modelo de datos: tablas (generado)',
    '',
    '> Generado por `scripts/generate-lld.mjs`. No editar a mano.',
    '',
    `Total: **${all.length}** tablas. Migraciones aplicables: **${migrations.length}**.`,
    '',
    '`schema.sql` es el baseline de referencia y **no se ejecuta**; `migrations/` es la',
    'fuente de verdad de todo cambio encima de él (ver `docs/lld/02-modelo-de-datos.md`).',
    '',
    '| Tabla | En baseline | Creada por migración |',
    '|---|---|---|',
    ...all.map((t) => {
      const inBase = baseline.has(t) ? 'sí' : '—';
      const mig = fromMigrations.get(t) || '—';
      return `| \`${t}\` | ${inBase} | ${mig === '—' ? '—' : `\`${mig}\``} |`;
    }),
    '',
    '## Migraciones, en orden de aplicación',
    '',
    ...migrations.map((f) => `- \`migrations/${f}\``),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 3. Variables de entorno declaradas en .env.example, con quién las consume.
// ---------------------------------------------------------------------------
function envInventory() {
  const examplePath = join(ROOT, '.env.example');
  if (!existsSync(examplePath)) return '# Variables de entorno\n\n_No hay .env.example._\n';

  const names = readFileSync(examplePath, 'utf8')
    .split('\n')
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=/))
    .filter(Boolean)
    .map((m) => m[1]);

  const srcFiles = walk(join(ROOT, 'src'), (f) => /\.(ts|tsx)$/.test(f));
  const blobs = srcFiles.map((f) => ({ f: rel(f), src: readFileSync(f, 'utf8') }));

  const rows = [...new Set(names)].sort().map((name) => {
    const users = blobs.filter((b) => b.src.includes(`process.env.${name}`)).map((b) => b.f);
    return { name, count: users.length, sample: users.slice(0, 2) };
  });

  return [
    '# Variables de entorno (generado)',
    '',
    '> Generado por `scripts/generate-lld.mjs`. No editar a mano.',
    '',
    `Declaradas en \`.env.example\`: **${rows.length}**.`,
    '',
    'Una variable con 0 usos está declarada pero no la lee nadie: o es de build/infra',
    '(la consume el Dockerfile, Terraform o Next en tiempo de build), o quedó huérfana.',
    '',
    '| Variable | Usos en src/ | Ejemplo de consumidor |',
    '|---|---|---|',
    ...rows.map(
      (r) => `| \`${r.name}\` | ${r.count} | ${r.sample.length ? r.sample.map((s) => `\`${s}\``).join(', ') : '—'} |`
    ),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 4. Superficie de UI: rutas del App Router por módulo.
// ---------------------------------------------------------------------------
function uiInventory() {
  const base = join(ROOT, 'src', 'app', '[locale]');
  const files = walk(base, (f) => f.endsWith('page.tsx'));
  const routes = files
    .map((f) => '/' + rel(f).replace('src/app/[locale]/', '').replace(/\/?page\.tsx$/, ''))
    .map((r) => (r === '/' ? '/' : r.replace(/\/$/, '')))
    .sort();

  const byModule = new Map();
  for (const r of routes) {
    const mod = r.split('/')[1] || '(raíz)';
    if (!byModule.has(mod)) byModule.set(mod, []);
    byModule.get(mod).push(r);
  }

  const out = [
    '# Superficie de UI: rutas del App Router (generado)',
    '',
    '> Generado por `scripts/generate-lld.mjs`. No editar a mano.',
    '',
    `Total: **${routes.length}** páginas, bajo \`src/app/[locale]/\`.`,
    'Todas cuelgan del segmento de locale (`es` por defecto, `en`, `pt-BR`).',
    '',
  ];
  for (const [mod, rs] of [...byModule.entries()].sort()) {
    out.push(`## \`${mod}\` (${rs.length})`, '');
    out.push(...rs.map((r) => `- \`${r}\``));
    out.push('');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 5. Capa de negocio: services y modules con su tamaño (proxy de complejidad).
// ---------------------------------------------------------------------------
function codeInventory() {
  const section = (title, dir, note) => {
    const files = walk(join(ROOT, dir), (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts'));
    const rows = files
      .map((f) => {
        const src = readFileSync(f, 'utf8');
        const exports = (src.match(/^export\s+(async\s+)?(function|const|class|interface|type)\s+(\w+)/gm) || [])
          .map((m) => m.split(/\s+/).pop());
        return { path: rel(f), lines: src.split('\n').length, exports };
      })
      .sort((a, b) => b.lines - a.lines);
    return [
      `## ${title}`,
      '',
      note,
      '',
      `${rows.length} archivos.`,
      '',
      '| Archivo | Líneas | Exports principales |',
      '|---|---|---|',
      ...rows.map(
        (r) =>
          `| \`${r.path}\` | ${r.lines} | ${
            r.exports.length ? r.exports.slice(0, 6).map((e) => `\`${e}\``).join(', ') + (r.exports.length > 6 ? ', …' : '') : '—'
          } |`
      ),
      '',
    ].join('\n');
  };

  return [
    '# Capa de negocio: services y modules (generado)',
    '',
    '> Generado por `scripts/generate-lld.mjs`. No editar a mano.',
    '',
    'Ordenado por tamaño descendente: los archivos más largos son los candidatos',
    'naturales a revisar primero cuando algo del dominio no cierra.',
    '',
    section(
      'src/services/',
      'src/services',
      'Un archivo por dominio funcional. Los llaman los route handlers, nunca la UI directamente.'
    ),
    section(
      'src/modules/',
      'src/modules',
      'Integración con SDKs de Azure (`collectors/`), motores agnósticos (`core/`) y persistencia (`storage/`).'
    ),
  ].join('\n');
}

// ---------------------------------------------------------------------------

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const artifacts = {
    'api-inventory.md': apiInventory(),
    'db-tables.md': dbInventory(),
    'env-vars.md': envInventory(),
    'ui-routes.md': uiInventory(),
    'code-inventory.md': codeInventory(),
  };
  for (const [name, content] of Object.entries(artifacts)) {
    writeFileSync(join(OUT_DIR, name), content);
    console.log(`escrito docs/lld/generated/${name} (${content.split('\n').length} líneas)`);
  }
}

main();
