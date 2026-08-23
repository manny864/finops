# Handoff — Saneo de módulos y erradicación de datos fabricados (2026-08-23)

Documento autocontenido. **No hace falta leer la conversación previa.**

- **Rama:** `main`, **29 commits por delante de `origin/main`** (26 de esta sesión + 3 de documentación
  previos). **Nada pusheado.**
- **Validación local:** `npm run lint -- --quiet` ✅ 0 errores · `npm run typecheck` ✅ · `npm run test` ✅
  **1739 tests** (189 archivos, 3 skipped).
- **Tenant de validación real:** `81ebe027-e6af-4e09-bc73-58c9012c6408` — es el único con consumo real.
  Todo lo verificado en esta sesión se probó contra el tenant **demo** (no hay sesión del tenant real en
  el entorno local), así que las cifras del tenant real quedan sujetas a validación del usuario.

---

## 1. El hilo conductor: tres patrones de bug, repetidos en siete módulos

Casi todo lo arreglado cae en uno de estos tres patrones. Vale conocerlos antes de tocar cualquier módulo.

### Patrón A — Números fabricados cuando Azure no reporta nada

Código que, ante la ausencia de un costo medido, **inventaba** un valor por tipo de recurso y lo
presentaba como dato. Eliminado en:

| Módulo | Qué fabricaba | Síntoma reportado | Commit |
|---|---|---|---|
| Recursos | `estimateCostFromTypeAndSku`: 20 USD por defecto; 95 USD para todo tipo que contuviera `virtualmachines` (¡incluidas las extensiones de VM!) | "todos los recursos cuestan 20 dólares" | `86b56f5` |
| Recursos (etiquetas) | `resourcesCount × 38,50` cuando no había costo atribuible + consulta a `TheLastMonth` bajo una columna rotulada MTD + promedio diario dividiendo por 30 fijo | "imposible que den esos números" | `86b56f5` |
| Progreso Histórico | `SAVINGS_BY_ARM_TYPE` con fallback de 15 USD, sin entradas para Bastion ni AKS | "eliminar un Bastion declara 15 USD de ahorro" | `6594ee8` |
| Ahorro Capturado | `realizedSavings = waste × 0.6` y literales 45/110/75 USD por tipo de acción | KPIs en 0 con el gráfico mostrando 30/18 | `0992086` |
| White Board | carbono = `costMtd × 0.003` | "Impacto Ambiental muestra 0.0" | `772d2d2` |
| **Pendiente** | `resourceConfig` de `/api/dashboard/summary` | — | **MEJ-10** |

Solución adoptada: catálogo único `AZURE_MONTHLY_BASELINE_BY_TYPE` + `baselineForResourceType()` en
`src/lib/realizedSavings.ts`, que devuelve `{ monthly, source }`; sin línea base el valor es 0 y la UI
muestra `—` con tooltip. **Queda un único bolsón sin migrar: MEJ-10** (ver §4).

### Patrón B — `if (res.ok)` sin rama `else` sobre una ruta con RBAC

Un `fetch` de mutación **sin cabecera `Authorization`** contra una ruta que exige RBAC devuelve 401, y el
código sólo miraba `res.ok`: fallo silencioso, sin mensaje, sin log.

| Síntoma | Causa | Commit |
|---|---|---|
| "Posponer 30/90 días no funciona" (Advisor) | POST a `/api/advisor/suppress` sin token; requiere Admin/Owner | `2bdb510` |
| "El paso 6 del wizard no deja finalizar" (Madurez) | POST a `/api/intelligence/maturity` sin token | `679c825` |
| KPIs de zombies y carbono en 0 (White Board) | self-fetch server-to-server a `/api/dashboard/summary` mandando sólo `x-forwarded-request` | `772d2d2` |

### Patrón C — Intercepciones demo con shape divergente

`TenantProvider` parchea `window.fetch` para tenants mock. Siete intercepciones devolvían una forma
distinta a la del contrato que consume el panel → paneles vacíos o absurdos **sólo en demo**, lo que
convertía la validación en falsos negativos.

| Ruta | Qué mostraba | Commit |
|---|---|---|
| `/api/advisor` | KPIs en 0, tabla vacía (mock sin `pillars`) | `2bdb510` |
| `/api/intelligence/maturity` | página vacía (`{score, breakdown}` en vez de `summary.dimensions`) | `679c825` |
| `/api/intelligence/history` | columna % sin datos | `cc7d56c` |
| `/api/intelligence/top-expenses` | todo en $0.00 (`{name, cost}` vs `costUSD`) | `25298a4` |
| `/api/resources/*` (4) | ~46.000 USD por recurso (mock sin `resourcesCount`) | `86b56f5` |
| `/api/intelligence/captured-savings` | historial de remediaciones vacío (formato legacy sin `auditLog`) | `0992086` |

Las siete rutas ya hacían short-circuit con su propio generador mock, así que se **quitaron las
intercepciones** y se borraron los cases huérfanos de `mockData.ts`. El resto queda por auditar: **MEJ-03**.

---

## 2. Qué se arregló, por módulo

### White Board (`772d2d2`, `dcea06c`, `b956b5b`, `64f513f`)
KPIs de zombies/carbono (patrón B + `??` que dejaba ganar al 0), conteos de Advisor deduplicados,
quick wins con comando por tipo real de recurso, y el enlace "Ver todos los servicios" que daba 404.

### Header / layout (`789a117`, `ca173c1`, `aee450d`)
"En celular no se muestran los iconos": reproducido a **844×390** (celular en horizontal). El header medía
1026 px de contenido en 780 disponibles y el cluster campana/ayuda/avatar quedaba recortado por el
`overflow-hidden` del shell, sin scroll posible. Ahora ese cluster es `shrink-0` y lo que cede es la marca
y el selector de alcance. Además la barra de impersonación era `fixed top-0` sin reservar espacio y tapaba
el header entero en móvil.

### Azure Advisor (`95a9d78`, `6321e6f`, `56012d5`, `be842f4`, `2bdb510`, `e38776c`, `bd2148d`)
Seis bugs: GUID del tenant como nombre de empresa, mezcla de idiomas (`category`/`impact` llegan siempre
en inglés desde Azure), ARM ID crudo y `rg-default` inventado, duplicados por variante de término,
optimizaciones que hablaban de etiquetas en recursos de cómputo, y el snooze que no persistía. Más un pase
completo de contraste (13 elementos medidos en oscuro, todos ≥ 4,5:1).

### Madurez FinOps (`679c825`, `4427b2f`)
El wizard no dejaba finalizar (patrón B) **y** el radar no reflejaba la autoevaluación: el backend
calculaba las 6 dimensiones sólo con telemetría y jamás leía `MaturityAssessments`. Ahora la respuesta del
equipo manda sobre su dominio y la telemetría queda como contraste (divergencia > 20 puntos se anota en el
plan de acción).

### FinOps Copilot (`29d517f`)
`decryptSecret` lanzaba cuando no había clave configurada y tumbaba el chat entero: nueva cadena de
fallback + `tryDecryptSecret` tolerante en lectura. **Se rechazó explícitamente** agregar la clave por
defecto hardcodeada que pedía el pedido original (una clave maestra en el repo vuelve descifrable
cualquier secreto de la base). El "esperando datos de la página" era el texto del estado vacío, no un
bloqueo: ahora abre en "Listo para ayudarte" con pills y tope de 2 s para la hidratación del contexto.

### Progreso Histórico (`6594ee8`, `cc7d56c`)
Ahorro realizado sobre costo real (`resolveRealizedCostDelta`), porcentaje con guarda de división por cero
(el AKS "Oaks" mostraba vacío/NaN), resource group parseado del ARM ID en vez del literal `general-rg`, y
contraste de ejes/iconos.

### TOP Gastos (`25298a4`)
Leyendas ilegibles (`YAxis` con `fill: "#1B2A41"` navy sobre fondo oscuro; el `LabelList` tenía un `style`
inline que **pisaba** su propia clase `dark:`), iconos Tabler en blanco vía override global de
`.vhead .vt .vico`, y barras vacías por shape divergente del mock.

### Recursos (`86b56f5`)
Patrón A en dos lugares (costo por recurso y costo por etiqueta) + inventario por tipo ilegible en oscuro.

### Ahorro Capturado (`0992086`)
El historial sólo veía acciones de la plataforma: nuevo `detectAzureOriginatedSavings` que detecta ahorros
hechos **fuera** del portal comparando el run-rate mensual del recurso en `CostSnapshots` (badge
Portal/Azure en la tabla). Más cuatro defectos de KPI: potencial y desperdicio salían del mismo campo, el
60 % fabricado, el KPI leyendo el último punto aunque viniera vacío, y los literales por tipo de acción.

### Fugas Financieras (`9989686`)
"El entorno está 100% optimizado en costos" con la tabla de abajo llena: los hallazgos de gobernanza
(`issueType: 'governance'`, savings 0 por definición) quedaban excluidos del donut y del desglose. Ahora se
cuentan como hallazgos sin costo directo.

### Limpieza (`c870892`)
**1726 líneas de código muerto eliminadas**: `HistoricalProgressDashboard.tsx` (913 líneas, sin
importadores), `historicalProgressGenerator.ts`, `historicalProgressModel.ts`, `advisorMock.ts`, su test, y
los cases huérfanos de `mockData.ts`. Ojo: `advisorModel.ts` es **otro** archivo y sí se usa
(`parseAzureNumber`).

---

## 3. Infraestructura nueva que conviene conocer

| Archivo | Qué es | Por qué existe |
|---|---|---|
| `src/lib/chartTheme.ts` | `useChartTheme()`: tokens de Recharts por tema (`accent`, `grid`, `tick`, `axis`, `tooltip`) | Los colores de ejes y series van como props SVG, donde las clases `dark:` de Tailwind **no** aplican |
| `src/lib/realizedSavings.ts` | Catálogo único de líneas base + `safeSavingsPercentage`, `formatSavingsPercentage`, `monthlyRunRate` | Reemplaza los catálogos dispersos del patrón A |
| `src/lib/advisorRemediation.ts` → `generateAdvisorRemediationAction` | Sintetizador determinista de la acción de remediación por tipo real de recurso | Corre sobre cientos de recomendaciones por carga; una inferencia LLM por ítem costaría segundos para devolver lo mismo |
| `docs/MEJORAS-FUTURAS.md` | Backlog técnico **con contexto** (10 entradas) | Cada mejora documenta cómo apareció, no sólo qué hacer |

Detalle transversal descubierto: **las animaciones de Recharts dependen de `requestAnimationFrame`**, que
el navegador pausa en pestañas en segundo plano. Con el ciclo detenido la serie queda en el frame 0 y el
gráfico se ve **vacío con el dato ya cargado** (verificado leyendo el `path`: `M246,144L246,144…`, radio 0,
con `score: 25` en los props). Se apagó la animación en las gráficas donde se observó el fallo (radar de
Madurez, barras de TOP Gastos, áreas de Ahorro Capturado, donut de Fugas, barras de Recursos). Quedan ~59
componentes: **MEJ-02**.

---

## 4. Pendiente inmediato

### 4.1 MEJ-10 — el último bolsón de números fabricados

`/api/dashboard/summary` conserva un `resourceConfig` con precios fijos por categoría de audit, y su
`totalSavings` alimenta el White Board, Ahorro Capturado, Fugas Financieras y los snapshots diarios de 12
meses. Convive con el catálogo de `realizedSavings.ts`, del que **ya divergió en tres tipos**.

**Prompt de ejecución listo para pasarle a otro IDE:**
[`docs/PROMPT-MEJ-10-catalogo-precios.md`](PROMPT-MEJ-10-catalogo-precios.md) — incluye el diagnóstico
verificado, los archivos, las reglas aplicables, la comparación antes/después obligatoria sobre el tenant
real y las cuatro trampas ya pisadas en esta sesión.

Contexto largo en [`docs/MEJORAS-FUTURAS.md`](MEJORAS-FUTURAS.md) → MEJ-10.

### 4.2 Push (requiere pedido explícito del usuario)

```bash
git push origin main:staging   # esperar CI verde
git push origin main:main      # monitorear el deploy hasta verde (AGENTS.md #7)
```

29 commits por delante de `origin/main`. `deploy-azure.yml` **no** corre lint ni tests: el CI de `staging`
es el único gate.

### 4.3 Validación en el tenant real `81ebe027-…`

Lo que hay que mirar concretamente, porque se verificó en demo:

| Módulo | Qué debería verse ahora |
|---|---|
| Recursos → Buscar | Action Group, Runbook y extensiones con `—`, no con $20 / $95 |
| Recursos → Costos por Etiqueta | Importes de Cost Management MTD; un $0,00 ahora significa que Azure no atribuye costo a esa etiqueta |
| Ahorro Capturado | Filas con badge **Azure** = ahorros que la plataforma nunca contaba. Un `—` en ahorro = sin historial en `CostSnapshots` para medir el delta, no ahorro cero |
| Fugas Financieras | Los recursos sin etiquetas contabilizados como hallazgos de gobernanza, no "100% optimizado" |
| Advisor | Conteos por pilar coincidiendo con el portal de Azure; posponer 30/90 días debe persistir (requiere rol Admin/Owner) |
| Madurez | Terminar la evaluación debe mover el radar y el nivel global |

### 4.4 Otras mejoras registradas

`docs/MEJORAS-FUTURAS.md`: MEJ-01 (atribución de ahorros de Azure vía Activity Log — el "quién" que
`CostSnapshots` no da), MEJ-02 (animaciones), MEJ-03 (auditar intercepciones demo restantes), MEJ-04
(persistir el desperdicio como métrica propia), MEJ-05 (costo de recursos hijos al padre), MEJ-06 (prosa de
IA sobre el motor determinista), MEJ-07 (`dedupKey` en posposiciones históricas), MEJ-08 (ponderación
telemetría vs autoevaluación), MEJ-09 (deuda de lint, tiene documento propio).

---

## 5. Los 26 commits de esta sesión

```
9989686 fix(fugas): dejar de declarar el entorno optimizado cuando si hay hallazgos
925018b docs: crear el backlog de mejoras futuras con contexto
0992086 fix(ahorro-capturado): leer ahorros hechos en Azure y corregir la logica de KPIs
86b56f5 fix(recursos): costo real por recurso y por etiqueta, sin estimaciones inventadas
25298a4 fix(top-gastos): leyendas legibles en oscuro, iconos en blanco y barras con dato
4427b2f fix(maturity): que el radar refleje la autoevaluacion y no dependa de rAF
c870892 chore: eliminar el codigo muerto del cluster de progreso historico y advisor mock
33537ce docs: registrar los arreglos de Madurez, Copilot y Progreso Historico
cc7d56c fix(progress): contraste en modo oscuro y recurso legible en la tabla de hitos
6594ee8 fix(progress): ahorro realizado calculado sobre costo real, no valores fijos
29d517f fix(copilot): no romper por llave de cifrado ausente y abrir en estado listo
679c825 fix(maturity): desbloquear el paso 6 del wizard y contraste real en modo oscuro
e38776c fix(advisor): pase completo de contraste en modo oscuro, colores e iconos
bd2148d docs: documentar el saneo del modulo Azure Advisor
2bdb510 fix(advisor): posponer funcional con UI optimista, recurso legible y accion aplicable
be842f4 fix(advisor): invalidar cache tras posponer y tipar el endpoint de snooze
56012d5 fix(advisor): nombre de organizacion, dedupe determinista y snooze estable
6321e6f feat(advisor): sintetizador de remediacion por tipo real de recurso
95a9d78 fix(advisor): normalizador de categorias/impacto y parser ARM completo
aee450d docs: registrar el fix del header en anchos intermedios
ca173c1 fix(header): selector de alcance encogible y boton de demo sin w-full
789a117 fix(layout): que la campana, la ayuda y el avatar no se salgan del viewport
64f513f docs: documentar el saneo del White Board (KPIs, Advisor y quick wins)
772d2d2 fix(whiteboard): KPIs de zombies/carbono, conteos de Advisor y quick wins reales
b956b5b fix(advisor): generar comandos de remediacion segun el tipo real del recurso
dcea06c fix(whiteboard): apuntar "Ver todos los servicios" a una ruta existente
```

## 6. Comandos útiles

```bash
git log --oneline f149979..HEAD          # los commits de esta sesión
npm run lint -- --quiet && npm run typecheck && npm run test
grep -rn "config.savings\|fallbackSavings" src/app/api/dashboard/summary/route.ts   # lo que MEJ-10 debe borrar
grep -rl recharts src/components | wc -l                                            # gráficas alcanzadas por MEJ-02
```

> Nota de entorno: el dev server del usuario ocupa el puerto 3000 y hace fallar `npm run build` por el
> directorio `.next-3000`. El gate real es el CI de `staging`.
