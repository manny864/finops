# Mejoras futuras del SaaS FinOps

Backlog técnico **con contexto**. No es una lista de deseos: cada entrada nace de algo observado en el
código o en producción, y documenta *por qué* existe la oportunidad, no sólo qué habría que hacer.

**Cómo usar este archivo**

- Una entrada por mejora, con ID incremental `MEJ-NN`. Los IDs no se reciclan.
- **El contexto es obligatorio.** Sin el "cómo apareció esto", en tres meses nadie sabe si la mejora
  sigue teniendo sentido. Si la mejora surgió al arreglar un bug, citar el commit o el archivo.
- Estado: `Propuesta` → `Aceptada` → `En curso` → `Hecha` (mover a la sección de cerradas con el commit)
  o `Descartada` (dejar el motivo: un descarte razonado también es información).
- Si la mejora ya tiene su propio documento profundo (por ejemplo `docs/lint-debt.md`), esta entrada es
  sólo el puntero: no duplicar el análisis.

## Índice

| ID | Mejora | Módulo | Impacto | Esfuerzo | Estado |
|---|---|---|---|---|---|
| [MEJ-01](#mej-01--atribución-de-ahorros-hechos-en-azure-vía-activity-log) | Atribuir a un autor los ahorros hechos fuera de la plataforma | Ahorro Capturado | Alto | Medio | Propuesta |
| [MEJ-02](#mej-02--animaciones-de-recharts-que-dependen-de-requestanimationframe) | Centralizar el apagado de animaciones de Recharts | Transversal (gráficas) | Medio | Bajo | Propuesta |
| [MEJ-03](#mej-03--auditar-las-intercepciones-demo-restantes-de-tenantprovider) | Auditar las intercepciones demo restantes | Demo / mocks | Alto | Medio | Propuesta |
| [MEJ-04](#mej-04--persistir-el-desperdicio-detectado-como-métrica-propia) | Persistir el desperdicio detectado como métrica propia | Ahorro Capturado | Medio | Bajo | Propuesta |
| [MEJ-05](#mej-05--atribuir-el-costo-de-recursos-hijos-a-su-recurso-padre) | Atribuir costo de recursos hijos al padre | Recursos | Medio | Medio | Propuesta |
| [MEJ-06](#mej-06--prosa-generada-por-ia-sobre-el-motor-determinista-de-remediación) | Prosa de IA sobre el motor determinista de remediación | Azure Advisor | Bajo | Bajo | Propuesta |
| [MEJ-07](#mej-07--migrar-las-posposiciones-históricas-a-la-dedupkey-estable) | Migrar posposiciones históricas a `dedupKey` | Azure Advisor | Bajo | Bajo | Propuesta |
| [MEJ-08](#mej-08--ponderación-configurable-entre-telemetría-y-autoevaluación) | Ponderación telemetría vs autoevaluación configurable | Madurez FinOps | Bajo | Bajo | Propuesta |
| [MEJ-09](#mej-09--deuda-de-linting) | Deuda de linting (documento propio) | Transversal | Medio | Alto | En curso |
| [MEJ-10](#mej-10--unificar-los-dos-catálogos-de-precios-y-marcar-el-origen-del-ahorro) | Unificar los dos catálogos de precios del audit | Transversal (KPIs) | Alto | Medio | Propuesta |

---

## MEJ-01 — Atribución de ahorros hechos en Azure vía Activity Log

**Módulo:** Ahorro Capturado · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Propuesta

### Contexto

El historial de remediaciones leía únicamente `ActionLogs`, es decir sólo lo ejecutado desde este portal.
Los ahorros que el equipo consigue trabajando directamente en Azure —borrar un disco desde el portal,
apagar una VM por CLI, achicar un SKU por IaC— eran reales y aquí invisibles. Se resolvió en el commit
`0992086` con `detectAzureOriginatedSavings`, que detecta el evento comparando el run-rate mensual del
recurso en `CostSnapshots` antes y después, y lo etiqueta con `origin: 'azure'`.

Eso cierra el **cuánto**, pero no el **quién**: `CostSnapshots` dice que un recurso dejó de costar, no
quién lo dio de baja ni cuándo exactamente. Hoy esas filas muestran "Detectado en Azure (fuera de la
plataforma)" como ejecutor, y la fecha es la del último cargo, no la de la acción.

### Propuesta

Leer el **Azure Activity Log** (`Microsoft.Insights/eventtypes/values`, vía `@azure/arm-monitor`, ya
presente como dependencia) para las operaciones de escritura/borrado de los últimos 90 días, y cruzarlo
por `resourceId` + ventana temporal con los eventos detectados por costo:

- `caller` → ejecutor real (usuario, service principal o Managed Identity).
- `eventTimestamp` → fecha exacta de la acción, en vez de la del último cargo.
- `operationName` → categoría precisa (`Microsoft.Compute/disks/delete`, `.../virtualMachines/write`).
- `claims`/`authorization` → distinguir persona de automatización.

El costo medido sigue siendo la fuente del ahorro; el Activity Log sólo aporta atribución. Si el cruce
no encuentra el evento (retención de 90 días vencida), la fila se mantiene como está hoy.

### Consideraciones

- **Permisos:** `Microsoft.Insights/eventtypes/values/read` está incluido en el rol **Reader**, que ya se
  asigna en el tier Professional (ver matriz de roles en `README.md`), así que no habría que pedir
  permisos nuevos al cliente. **Verificar antes de implementar**, no asumirlo.
- **Retención:** el Activity Log guarda 90 días. Para atribución histórica más larga habría que
  exportarlo a Log Analytics o a una tabla propia, lo que ya es otra mejora.
- **Volumen:** filtrar por `resourceUri` de los recursos con evento de ahorro detectado, no traer el log
  completo por suscripción.

### Archivos

`src/services/azureCapturedSavings.service.ts` (`detectAzureOriginatedSavings`),
`src/types/capturedSavings.types.ts` (`RemediationAuditItem.executedBy`, `origin`).

### Criterio de aceptación

Una baja de recurso hecha desde el portal de Azure aparece en el historial con el email real de quien la
hizo y la fecha de la operación, no con el texto genérico ni la fecha del último cargo.

---

## MEJ-02 — Animaciones de Recharts que dependen de requestAnimationFrame

**Módulo:** Transversal (gráficas) · **Impacto:** Medio · **Esfuerzo:** Bajo · **Estado:** Propuesta

### Contexto

Recharts anima la entrada de cada serie sobre `requestAnimationFrame`. El navegador **pausa** ese ciclo en
pestañas en segundo plano y lo reduce con "reducir movimiento" del sistema: si el ciclo no avanza, la
serie queda congelada en el frame 0 y el gráfico se ve **vacío aunque el dato ya esté cargado**.

Se diagnosticó midiendo el `path` del radar de Madurez FinOps: `M246,144L246,144…` (todos los vértices en
el centro, radio 0) con los props del `RadarChart` trayendo ya `score: 25`. El mismo síntoma apareció en
las barras de TOP Gastos y en las áreas de Ahorro Capturado. Se corrigió puntualmente con
`isAnimationActive={false}` en esas tres (commits `4427b2f`, `25298a4`, `0992086`).

### Propuesta

Hay **64 componentes con gráficas** en `src/components`. En vez de repetir el flag, exponerlo desde el
hook que ya centraliza los tokens de tema (`src/lib/chartTheme.ts`):

```ts
const chart = useChartTheme();
<Bar isAnimationActive={chart.animate} … />
```

con `animate` en `false` cuando `document.visibilityState !== 'visible'` o cuando
`window.matchMedia('(prefers-reduced-motion: reduce)')` coincide — y `true` en el resto, para no perder la
animación donde sí aporta. Luego un barrido de las gráficas restantes.

### Archivos

`src/lib/chartTheme.ts` y los componentes con `recharts` (`grep -rl recharts src/components`).

### Criterio de aceptación

Una gráfica cargada en una pestaña en segundo plano muestra sus valores al volver a ella, sin necesidad de
recargar ni redimensionar.

---

## MEJ-03 — Auditar las intercepciones demo restantes de TenantProvider

**Módulo:** Demo / mocks · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Propuesta

### Contexto

`src/components/TenantProvider.tsx` parchea `window.fetch` en tenants demo y devuelve mocks desde
`getMockDataForRoute`. El problema es que esos mocks **derivaron** del contrato que consume cada panel: la
ruta real ya hace short-circuit con su propio generador (con el shape correcto), mientras el interceptor
servía otra forma. El resultado no era un error visible sino un panel silenciosamente vacío o absurdo.

Encontradas y corregidas seis, todas con el mismo patrón:

| Ruta | Qué mostraba la demo | Causa |
|---|---|---|
| `/api/advisor` | KPIs en 0, tabla vacía | mock sin `pillars` (shape `AdvisorModel`) |
| `/api/intelligence/maturity` | página vacía | `{success, score, breakdown}` en vez de `summary.dimensions` |
| `/api/intelligence/history` | columna % sin datos | generador legacy sin porcentaje |
| `/api/intelligence/top-expenses` | todo en $0.00 | `{name, cost}` en vez de `costUSD` |
| `/api/resources/*` (4 rutas) | ~46.000 USD por recurso | mock sin `resourcesCount` |
| `/api/intelligence/captured-savings` | historial vacío | formato legacy sin `auditLog` |

### Propuesta

Dos partes:

1. **Auditar el resto de las intercepciones** (quedan varias decenas en `TenantProvider`): para cada una,
   comparar el shape del mock con el tipo que consume el componente. Si la ruta ya hace short-circuit con
   un generador propio, **quitar la intercepción** (fue la solución en los seis casos) y borrar el case
   huérfano de `mockData.ts`.
2. **Prevenir la recaída**: hacer que los generadores mock devuelvan el mismo tipo TypeScript que el
   camino vivo (`function generateMockX(): XResponse`), de modo que un cambio de contrato rompa el
   `typecheck` en vez de degradar la demo en silencio. Donde el mock viva en `mockData.ts`, tiparlo.

### Por qué importa más de lo que parece

La demo es lo que se le muestra a un prospecto **y** lo que se usa para validar cambios sin tocar un
tenant real. Un mock divergente convierte esa validación en falsos negativos: en esta sesión varios
"bugs de producción" resultaron ser sólo la demo mostrando otra cosa.

### Archivos

`src/components/TenantProvider.tsx`, `src/lib/mockData.ts`, los `generateMock*` de `src/services/`.

---

## MEJ-04 — Persistir el desperdicio detectado como métrica propia

**Módulo:** Ahorro Capturado · **Impacto:** Medio · **Esfuerzo:** Bajo · **Estado:** Propuesta

### Contexto

El snapshot diario (`recordDailySnapshotAsync(tenantId, 'dashboard_summary', …)` en
`src/app/api/dashboard/summary/route.ts`) guarda `actualCost`, `projectedCost`, `totalSavings`,
`zombieCount` y `environmentalImpact`. **No guarda el desperdicio detectado como campo propio.**

Por eso el módulo mostraba "Ahorro Potencial" y "Desperdicio Detectado" con el mismo número: los dos
salían de `totalSavings`. En el commit `0992086` se resolvió derivando el potencial como
`desperdicio − ahorro ya capturado`, lo que da dos series distintas y útiles, pero el desperdicio sigue
siendo una sola medición reusada, no dos mediciones independientes.

### Propuesta

Añadir `detectedWasteUSD` (y idealmente `zombieMonthlyWasteUSD`) al payload del snapshot diario, tomándolo
del resultado del audit que ya se calcula en esa misma ruta. A partir de ahí, el histórico tendría las dos
métricas medidas por separado y el potencial dejaría de ser un derivado.

### Nota

Es retroactivamente incompleto: el histórico anterior no tendrá el campo. El código debe seguir aceptando
puntos sin `detectedWasteUSD` y derivarlo como hoy, sin romper la serie de 12 meses.

---

## MEJ-05 — Atribuir el costo de recursos hijos a su recurso padre

**Módulo:** Recursos · **Impacto:** Medio · **Esfuerzo:** Medio · **Estado:** Propuesta

### Contexto

En "Buscar Recursos" todos los recursos mostraban 20 USD y cualquiera cuyo tipo contuviera
`virtualmachines` mostraba 95 USD —incluidas las **extensiones** de VM
(`Microsoft.Compute/virtualMachines/extensions`)—, porque una función estimaba el costo cuando Cost
Management no reportaba cargo. Se eliminó el estimador y ahora esos recursos muestran "—" con el tooltip
"sin cargo directo" (commit `86b56f5`).

Eso es correcto y honesto, pero incompleto: una extensión, una NIC o un disco **sí** contribuyen a un
costo, sólo que facturado en su recurso padre o en el disco asociado. El "—" es exacto a nivel de recurso
y a la vez poco informativo para el analista.

### Propuesta

Resolver la jerarquía del ARM ID (el padre es el prefijo del hijo) y mostrar en la fila del hijo el costo
del padre etiquetado como tal: por ejemplo "facturado en `vm-app-01` — 142,00 USD/mes". Requiere sumar
correctamente para no doble-contar en los KPIs: el costo se sigue contando **una vez**, en el padre.

### Archivos

`src/services/azureResourcesInventory.service.ts` (`searchLiveResources`, `getResourceCostsById`),
`src/components/dashboard/ResourcesBoard.tsx` (celda de costo),
`src/lib/advisorI18n.ts` (`extractResourceDisplayName`, que ya resuelve tipos anidados).

---

## MEJ-06 — Prosa generada por IA sobre el motor determinista de remediación

**Módulo:** Azure Advisor · **Impacto:** Bajo · **Esfuerzo:** Bajo · **Estado:** Propuesta

### Contexto

`generateAdvisorRemediationAction` (`src/lib/advisorRemediation.ts`) sintetiza la acción concreta de cada
recomendación —rightsizing con SKU destino, purga de huérfano, HA, etc.— con reglas deterministas.

Se eligió deterministic **a propósito**: corre sobre cientos de recomendaciones por tenant en cada carga y
el payload de Advisor ya trae el tipo de recurso, el SKU destino, la utilización de CPU y el ahorro. Una
inferencia por ítem costaría segundos y dinero para devolver exactamente lo mismo.

### Propuesta

Si se quiere redacción más natural o adaptada al interlocutor (técnico vs. financiero), envolver la salida
del motor con `src/modules/core/aiProvider.ts` y **cachear por `recommendationTypeId` + locale**, no por
recomendación: el texto depende de la regla, no del recurso. Con eso el costo es de decenas de llamadas por
tenant, no de cientos, y el motor determinista sigue siendo el que decide `actionType` y SKU.

### Restricción

La IA no debe decidir la acción ni el SKU: sólo reescribir el texto. Si se le delega la decisión, se pierde
la trazabilidad de por qué se recomienda algo y vuelve el problema original de las "optimizaciones
genéricas".

---

## MEJ-07 — Migrar las posposiciones históricas a la `dedupKey` estable

**Módulo:** Azure Advisor · **Impacto:** Bajo · **Esfuerzo:** Bajo · **Estado:** Propuesta

### Contexto

Posponer una recomendación 30/90 días persiste en `RecommendationActions` con `status='suppressed'` y
`expires_at`. El id crudo de Advisor **cambia entre consultas y suscripciones**, así que se pasó a guardar
la `dedupKey` estable (`categoría + recommendationTypeId + recurso`) como `recommendation_id`, y el filtro
compara contra las tres claves posibles para no perder las filas antiguas (commit `56012d5`).

Esa tolerancia es deuda: cada lectura hace tres comparaciones y el conjunto de claves viejas nunca se
limpia.

### Propuesta

Migración de datos que, para las filas con `status='suppressed'` vigentes, reescriba `recommendation_id`
con la `dedupKey` correspondiente cuando se pueda resolver (cruzando `resource_id` + `category` contra las
recomendaciones vivas). Después, simplificar el filtro a una sola comparación.

### Nota

No es urgente: la tolerancia funciona y el volumen es bajo. Hacerlo cuando se toque esa tabla por otro
motivo.

---

## MEJ-08 — Ponderación configurable entre telemetría y autoevaluación

**Módulo:** Madurez FinOps · **Impacto:** Bajo · **Esfuerzo:** Bajo · **Estado:** Propuesta

### Contexto

El radar de madurez ignoraba la autoevaluación: las 6 dimensiones salían sólo de telemetría de Azure y el
cuestionario se guardaba sin efecto visible. Se corrigió (`4427b2f`) haciendo que **la respuesta del equipo
manda sobre su dominio**, con la telemetría como contraste: si divergen más de 20 puntos, se anota en el
plan de acción.

La decisión de que la autoevaluación gane es la correcta para el modelo Crawl-Walk-Run de la FinOps
Foundation, pero es una política fija en el código.

### Propuesta

Hacer la ponderación configurable por tenant (por ejemplo `TenantGlobalSettings.maturity_score_policy`:
`self_assessment` | `telemetry` | `blended_50_50`). Un cliente auditado querrá que pese la evidencia; un
equipo en fase de adopción querrá que pese su propia lectura.

### Archivos

`src/services/azureMaturity.service.ts` (`applySelfAssessment`), `TenantGlobalSettings`.

---

## MEJ-09 — Deuda de linting

**Módulo:** Transversal · **Impacto:** Medio · **Esfuerzo:** Alto · **Estado:** En curso

Tiene documento propio con la medición, el desglose por regla y el plan priorizado:
**[`docs/lint-debt.md`](lint-debt.md)**.

Resumen: 0 errores (el CI no se bloquea) y ~3.025 warnings, de los cuales el 81% son
`@typescript-eslint/no-explicit-any` que requieren modelar tipos por dominio. La prioridad es congelar el
crecimiento y atacar `src/lib` antes que `src/components`, porque un `any` en `money.ts`/`fx.ts` puede
dejar pasar un `number` donde la Regla Cero exige `Decimal`.

---

---

## MEJ-10 — Unificar los dos catálogos de precios y marcar el origen del ahorro

**Módulo:** Transversal (KPIs de desperdicio) · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Propuesta

### Contexto

Apareció revisando "Fugas Financieras". `src/app/api/dashboard/summary/route.ts` tiene un
`resourceConfig` con **un costo mensual fijo por categoría de audit** (`ddos: 2944`, `appGateways: 180`,
`vnetGateways: 130`, `emptyAse: 300`, `stoppedVirtualMachines: 30`…) y calcula:

```ts
const fallbackSavings = diskSizeGB ? diskSizeGB * 0.15 : (sizeGB ? sizeGB * 0.05 : config.savings);
const potentialSavings = estimatedMonthlyCost || fallbackSavings;
```

Es decir: si el audit no devolvió `estimatedMonthlyCost` para el recurso, el número que la plataforma
presenta como "fuga" es un literal de esa tabla. Es el mismo patrón que se eliminó en Recursos
(`estimateCostFromTypeAndSku`, commit `86b56f5`), en Progreso Histórico (`SAVINGS_BY_ARM_TYPE`, `6594ee8`)
y en Ahorro Capturado (los literales 45/110/75, `0992086`) — pero **acá sigue vivo**, y es el más central
de todos: `totalSavings` de este endpoint alimenta el KPI de ahorro potencial del White Board, el
desperdicio detectado de Ahorro Capturado, los zombies del resumen ejecutivo y el módulo de Fugas.

Hay además un **segundo catálogo** creado después, `AZURE_MONTHLY_BASELINE_BY_TYPE` en
`src/lib/realizedSavings.ts`, con la misma intención y valores en su mayoría coincidentes (venían de la
misma lista de precios), pero ya con divergencias:

| Tipo | `resourceConfig` (summary) | `AZURE_MONTHLY_BASELINE_BY_TYPE` |
|---|---:|---:|
| VM detenida | 30,00 | 70,00 (VM genérica) |
| App Service Environment | 300,00 | — (no catalogado) |
| Disco | `sizeGB × 0,15` | 19,71 (P10 128 GiB ≈ 0,154/GiB) |

Dos tablas para lo mismo van a divergir más con cada cambio, y hoy nada distingue en el payload si un
`potentialSavings` fue **medido** contra Cost Management o **estimado** por tipo.

### Propuesta

1. Que `resourceConfig` deje de tener precios: la línea base sale de `baselineForResourceType`
   (`src/lib/realizedSavings.ts`), única fuente. Completar allí lo que falte (`App Service Environment`,
   VM detenida como caso propio: una VM apagada sólo paga discos e IP, no cómputo).
2. Agregar `savingsSource: 'cost_management' | 'type_baseline'` a cada item de `mappedData` y propagarlo
   por el payload, para que cada módulo pueda mostrar "—" o marcar la cifra como estimación, tal como ya
   hacen Recursos y Ahorro Capturado.
3. Recién entonces decidir, con el dato a la vista, si los KPI de desperdicio deben sumar sólo lo medido
   o ambos con distinción visual.

### Por qué no se hizo junto con el resto

El radio de impacto es la plataforma entera: cambiar la semántica de `totalSavings` mueve los KPI del
White Board, de Ahorro Capturado y del resumen ejecutivo a la vez. Merece su propio cambio controlado, con
una comparación antes/después sobre un tenant real, no ir de pasada en un arreglo de otro módulo.

### Archivos

`src/app/api/dashboard/summary/route.ts` (`resourceConfig`, `mapAuditData`),
`src/lib/realizedSavings.ts` (`AZURE_MONTHLY_BASELINE_BY_TYPE`, `baselineForResourceType`).

## Mejoras cerradas

_(mover aquí las entradas al completarlas, con el commit que las cierra, para conservar el contexto)_

| ID | Mejora | Cerrada en |
|---|---|---|
| — | — | — |
