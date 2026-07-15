# Aceleración de builds/deploys + modelo Anthropic actualizado — 2026-07-15

## 1. Deploys lentos — causas y fixes

`Deploy FinOps` corre `docker compose up -d --build` en el VPS, que rebuildea la
imagen entera en cada push. Un deploy tardaba ~20 min. Tres cambios lo recortan,
**todos validados localmente** con `docker build` (contexto + cache mounts +
imagen completa, exit 0):

### a) `.dockerignore` — contexto de build de 99GB → 9.2MB
El `.dockerignore` viejo solo excluía `node_modules`, `.next`, `.git`. **No**
excluía `.next-3000` (el `distDir` del dev server — `next.config.ts` usa
`.next-${PORT}` con PORT numérico), que acumulaba **99GB** de caché de dev. El
contexto de build se inflaba enormemente. Ahora se excluyen además:
`.next-*`, `.swc`, `coverage`, `playwright-report`, `test-results`,
`playwright/.auth`, `data` (datos de runtime, van en volúmenes), `docs`,
`directivas`, `*.md` (verificado: no se importan desde `src/`), y basura de
editor/OS. Contexto medido: **9.2MB** (antes 99GB+ en local).

### b) BuildKit cache mounts en el `Dockerfile`
- `# syntax=docker/dockerfile:1` habilita `RUN --mount=type=cache` (Compose v2
  usa BuildKit por default).
- `npm ci` → `--mount=type=cache,target=/root/.npm`: reusa las tarballs ya
  descargadas entre deploys (package-lock casi nunca cambia).
- `npm run build` → `--mount=type=cache,target=/app/.next/cache`: persiste la
  caché incremental de Next entre deploys. `.next/cache` **no** forma parte del
  output standalone (solo se copian `.next/standalone` y `.next/static`), así
  que montarla como caché de build es seguro.

Los cache mounts persisten en el VPS entre deploys (el `docker builder prune
--filter until=48h` del pipeline conserva la caché reciente).

### c) Nota operativa
El pipeline hace `docker compose stop finops-app` **antes** de buildear (para
liberar RAM en el VPS), así que la app está caída durante todo el build — por eso
acortar el build reduce el downtime directamente. No se cambió esa estrategia
(el stop-first evita OOM en el VPS).

## 2. Warnings de build de Turbopack (NFT) — no resueltos (cosméticos)

`next build` emite 3 warnings de tracing (`supportAttachments.ts`,
`tenantLogo.ts`): `fs.writeFile(path.join(dir, storedName))` con `dir` dinámico
(`process.env.X || path.join(process.cwd(), ...)`) impide que el tracer resuelva
el path estáticamente, y genera un glob que matchea todo el proyecto.

**Decisión: no se tocan.** El build pasa (exit 0) y la imagen final pesa 404MB
— confirma que el over-trace **no infla** el output (Next acota lo que entra al
standalone); el único costo es tiempo de trace. Silenciarlos requeriría
`outputFileTracingExcludes` (riesgo de excluir dependencias reales y romper el
runtime) o quitar el override de env `SUPPORT_UPLOAD_DIR`/`TENANT_LOGO_UPLOAD_DIR`
(que es solo-dev, nunca seteado en prod). No vale arriesgar producción por un
warning cosmético.

## 3. Modelo Anthropic actualizado (bug: modelo retirado → 404)

El provider Anthropic usaba `claude-3-opus-20240229`, **retirado por Anthropic el
2026-01-05** → daba 404 para cualquier tenant con provider Anthropic. Reemplazado
por `claude-opus-4-8` (reemplazo directo documentado, mismo tier Opus) en
`aiProvider.ts` y `aiService.ts`. Labels de UI actualizados en las dos páginas de
config de IA.
