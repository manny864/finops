# Deuda de linting — estado y plan

**Última medición:** 2026-08-21, tras la tanda de limpieza de esa fecha.
**Estado del gate:** `npm run lint` devuelve **0 errores**. El CI corre `npm run lint -- --quiet`, que
sólo reporta errores, así que **ningún warning bloquea el pipeline**. Esto es higiene y prevención de bugs,
no un blocker de release.

## Dónde estamos

| Momento | Warnings |
|---|---:|
| Antes de la limpieza del 2026-08-21 | 4157 |
| Después | **2790** |

Reducción del 33%. El desglose de lo que se hizo está en los commits `9b46e97`..`27b8ce1`.

### Qué se corrigió y por qué (no fue sólo bajar el número)

| Categoría | Antes | Ahora | Naturaleza |
|---|---:|---:|---|
| `react-hooks/rules-of-hooks` | 8 | **0** | **Bugs reales.** Hooks después de un early return en `intelligence/network/page.tsx`, `M365UsersBoard` y `MockBanner`: producen "Rendered fewer hooks than expected" al cambiar la rama entre renders. Más dos `require('next-intl')` que escondían la misma falla al linter. |
| `react-hooks/purity` | 3 | **0** | **Bugs reales.** `Date.now()` en render → hydration mismatch. Uno de ellos además fabricaba un timestamp de activación falso en el historial de alertas, violando la Directiva 24.1. |
| `@typescript-eslint/no-explicit-any` en `catch` | 516 | **27** | **Riesgo de tipos real.** `catch (e: any)` apaga el chequeo justo en el manejo de errores. Migrados a `errorMessage` / `errorStatus` / `errorCode` de `src/lib/apiErrors.ts`. Los 27 restantes usan `.name` / `.cause` / `.response`, fuera del alcance de los helpers. |
| `@typescript-eslint/no-unused-vars` | 589 | 183 | Código muerto: 308 imports y 58 bindings de `catch` eliminados. |
| `@typescript-eslint/no-unused-expressions` | 348 | **0** | Ruido: venía íntegro de `gsap.min.js` vendorizado en `.agents/`, ahora fuera del lint. |
| `no-this-alias`, `no-require-imports` | 81 | 0 | Idem — `.agents/` más los dos `require()` de `next-intl`. |

## Qué queda: 2790 warnings

### `@typescript-eslint/no-explicit-any` — 2255 (81% del total)

Esta es la deuda de fondo y **no es mecanizable**. Requiere modelar tipos por dominio, archivo por archivo.
Forma de los casos:

| Forma | Cantidad | Comentario |
|---|---:|---|
| Firmas, casts y genéricos varios | 894 | Requiere decidir el tipo caso por caso. |
| `as any` | 531 | Cada uno esconde una incompatibilidad concreta que hay que resolver, no reemplazar. |
| `(r: any) =>` sobre JSON de Azure/ARG | 478 | **Discutible que valga la pena.** Azure Resource Graph devuelve filas sin tipar; `unknown` obligaría a estrechar en cada acceso, con el mismo riesgo y más ruido. Lo correcto sería un tipo `ArgRow<T>` por consulta en `kqlCatalog.ts`, alineado con el KQL que la produce. |
| `any[]` | 234 | Suele ser el resultado de lo anterior. |
| `useState<any>` | 74 | El más barato de arreglar: el tipo casi siempre ya existe en `src/types/`. |
| `Record<string, any>` | 42 | Mayormente payloads de API; muchos podrían ser `Record<string, unknown>`. |

Distribución: `src/app` 917 · `src/components` 713 · `src/services` 327 · `src/modules` 218 · `src/lib` 67.

**Plan sugerido (incremental, no big-bang).** Cambiar la regla a `error` de golpe rompería el CI en 2255
lugares. En vez de eso:

1. **Congelar el crecimiento primero.** Elevar `no-explicit-any` a `error` **sólo para archivos nuevos**, vía
   un override en `eslint.config.mjs` por directorio a medida que cada uno queda limpio. Sin esto, cualquier
   avance se compensa con deuda nueva.
2. **Priorizar por riesgo, no por volumen.** En este orden:
   - `src/lib` (67) — utilidades de dinero (`money.ts`, `fx.ts`, `pricingUnits.ts`) y auth. Un `any` acá puede
     dejar pasar un `number` donde la Regla Cero exige `Decimal`. **Máxima prioridad pese a ser el más chico.**
   - `src/services` (327) y `src/modules` (218) — lógica de negocio y cálculo de costos.
   - `src/components` (713) y `src/app` (917) — presentación; el impacto de un `any` acá es menor.
3. **Empezar por `useState<any>` (74).** Es el subconjunto con mejor relación esfuerzo/beneficio: el tipo
   correcto casi siempre ya está definido en `src/types/`.
4. **Los 478 callbacks de ARG, aparte.** No tratarlos como deuda de lint sino como una tarea de diseño:
   un tipo de fila por consulta en `kqlCatalog.ts`. Hasta entonces, `any` ahí es una decisión defendible.

Archivos más cargados: `M365UsersBoard.tsx` (65), `ExecutiveReportPanel.tsx` (60),
`api/intelligence/azure-ai/route.ts` (55), `TenantProvider.tsx` (51), `api/intelligence/compute/workloads/route.ts` (44).

### `react-hooks/set-state-in-effect` — 144

Setear estado dentro de un `useEffect` sin condición de corte provoca un render extra y, en el peor caso, un
bucle. Muchos son inofensivos (sincronizar estado derivado), pero **el subconjunto que merece revisión es el
que setea estado a partir de props o de otro estado**: ahí normalmente el valor debería derivarse en render o
memoizarse, no guardarse. Revisión manual, caso por caso. No mecanizable.

### `react-hooks/exhaustive-deps` — 102

Arrays de dependencias incompletos. **Peligroso automatizar**: agregar la dependencia faltante a ciegas puede
convertir un efecto que corría una vez en uno que corre en loop. Cada caso necesita decidir si falta la
dependencia o si el efecto está mal planteado.

### `react-hooks/immutability` — 6

Los seis restantes están todos en **`TenantProvider.tsx`** y **no se tocan sin rediseñar el modo demo**: son
el monkey-patching deliberado de `window.fetch` y de `instance.acquireTokenSilent` que intercepta las
llamadas cuando la sesión es demo. Funciona y es load-bearing; "arreglarlo" significa rediseñar la
intercepción, no reordenar código. Es el bloqueante real si alguna vez se habilita el React Compiler.

(Los otros 5 —`data-residency`, `superadmin/health`, `superadmin/support`, `support`,
`SubscriptionProvider`— eran `useEffect` referenciando una función `const` declarada más abajo; se
resolvieron con un reorden puro en el commit `27b8ce1`.)

### Resto — 66

`static-components` (39), `preserve-manual-memoization` (22), `no-img-element` (12),
`no-unescaped-entities` (10), `no-html-link-for-pages` (8), `incompatible-library` (5),
`no-anonymous-default-export` (1). Cosméticos o de optimización.
`no-img-element` conviene tratarlo con cuidado: migrar `<img>` a `next/image` cambia el layout y necesita
verificación visual, no un reemplazo ciego.

## Regla operativa

Al tocar un archivo, dejarlo con **menos** warnings de los que tenía. Es la forma barata de drenar esto sin
una tarea dedicada de varias semanas.
