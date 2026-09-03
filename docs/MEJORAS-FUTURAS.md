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
| [MEJ-02](#mej-02--animaciones-de-recharts-que-dependen-de-requestanimationframe) | Centralizar el apagado de animaciones de Recharts | Transversal (gráficas) | Medio | Bajo | Parcial |
| [MEJ-03](#mej-03--auditar-las-intercepciones-demo-restantes-de-tenantprovider) | Auditar las intercepciones demo restantes | Demo / mocks | Alto | Medio | Parcial |
| [MEJ-04](#mej-04--persistir-el-desperdicio-detectado-como-métrica-propia) | Persistir el desperdicio detectado como métrica propia | Ahorro Capturado | Medio | Bajo | Hecha |
| [MEJ-05](#mej-05--atribuir-el-costo-de-recursos-hijos-a-su-recurso-padre) | Atribuir costo de recursos hijos al padre | Recursos | Medio | Medio | Propuesta |
| [MEJ-06](#mej-06--prosa-generada-por-ia-sobre-el-motor-determinista-de-remediación) | Prosa de IA sobre el motor determinista de remediación | Azure Advisor | Bajo | Bajo | Hecha |
| [MEJ-07](#mej-07--migrar-las-posposiciones-históricas-a-la-dedupkey-estable) | Migrar posposiciones históricas a `dedupKey` | Azure Advisor | Bajo | Bajo | Propuesta |
| [MEJ-08](#mej-08--ponderación-configurable-entre-telemetría-y-autoevaluación) | Ponderación telemetría vs autoevaluación configurable | Madurez FinOps | Bajo | Bajo | Propuesta |
| [MEJ-09](#mej-09--deuda-de-linting) | Deuda de linting (documento propio) | Transversal | Medio | Alto | En curso |
| [MEJ-11](#mej-11--módulo-de-comunicaciones-globales-a-usuarios-popups-banners-y-alertas) | Módulo de comunicaciones globales a usuarios (popups, banners y alertas) | SuperAdmin / Transversal | Alto | Medio | Parcial |
| [MEJ-12](#mej-12--trazabilidad-de-ciclo-de-vida-de-tenants-fechas-de-activación-suspensión-y-bajas) | Trazabilidad de ciclo de vida de tenants (fechas de activación y bajas) | SuperAdmin / Gobernanza | Alto | Bajo | Hecha |
| [MEJ-13](#mej-13--marketplace-de-add-ons-y-capacidades-a-la-carta-para-tiers-professional-y-business) | Marketplace de add-ons y features a la carta (Professional y Business) | Facturación / Marketplace | Alto | Medio | Propuesta |
| [MEJ-14](#mej-14--trazabilidad-de-ventas-por-comercial-y-cálculo-automatizado-de-comisiones) | Trazabilidad de ventas por comercial y cálculo de comisiones (20%) | SuperAdmin / Comercial | Alto | Medio | Propuesta |
| [MEJ-15](#mej-15--expansión-multi-tenant-por-contrato-y-adición-de-tenants-con-capacidad-heredada-por-tier) | Expansión multi-tenant por contrato y adición de tenants con capacidad heredada por tier | Facturación / Multi-Tenant | Alto | Medio | Hecha |
| [MEJ-16](#mej-16--gestión-avanzada-de-compromisos-reservas-y-savings-plans) | Gestión avanzada de compromisos (Reservas y Savings Plans) con simulador de Breakeven, Mix Óptimo, límite de devolución $50k USD y alertas de expiración | Compromisos / FinOps | Alto | Medio | Propuesta |
| [MEJ-17](#mej-17--aks-finops-cockpit-costos-por-namespace-workload-y-eficiencia-de-contenedores) | AKS FinOps Cockpit (Costos por Namespace, Workload y Eficiencia de Contenedores con OpenCost/Add-on) | Cómputo / Kubernetes | Alto | Alto | Propuesta |
| [MEJ-18](#mej-18--cosmos-db--cargas-nosql-finops-cockpit) | Cosmos DB & Cargas NoSQL FinOps Cockpit (Optimizador de RU/s, Detección de Hot Partitions y Matriz Serverless) | Bases de Datos / NoSQL | Alto | Medio | Propuesta |
| [MEJ-19](#mej-19--mapa-de-tráfico-de-red-egress-y-fugas-de-datos) | Mapa de tráfico de red, egress y fugas de datos (Inter-AZ, Cross-Region, NAT Gateway, Private Endpoints y ExpressRoute/VPN) | Redes / Egress | Alto | Medio | Propuesta |
| [MEJ-20](#mej-20--shift-left-finops-integración-cicd-y-gatekeeper-de-iac) | Shift-Left FinOps: Integración CI/CD y Gatekeeper de IaC (PR Cost Estimator y Budget Gates) | Shift-Left / DevOps | Alto | Medio | Propuesta |
| [MEJ-21](#mej-21--orquestación-de-remediación-inteligente-conectores-itsm-y-generador-de-policy-as-code) | Orquestación de remediación con Rollback, conectores ITSM (Teams, Slack, Jira, ServiceNow) y generador de Azure Policy | Gobernanza / Automatización | Alto | Alto | Propuesta |
| [MEJ-22](#mej-22--cambio-de-prioridad-de-tickets-por-agentes-de-soporte) | Cambio de prioridad de tickets por agentes desde la cola global y el Drawer | Soporte / Mesa de ayuda | Alto | Bajo | Hecha |
| [MEJ-23](#mej-23--bug-horarios-programados-de-vms-no-se-reflejan-en-la-ui-tras-guardar) | Bug: Horarios programados de VMs no se reflejan en la UI tras guardar | Power Schedules | Alto | Bajo | Hecha |
| [MEJ-24](#mej-24--eliminar-referencia-a-onmicrosoftcom-del-modal-de-correo-laboral) | Eliminar referencia a `.onmicrosoft.com` del modal de correo laboral | Signup / UX | Bajo | Bajo | Hecha |
| [MEJ-25](#mej-25--desvincular-eliminar-una-suscripción-azure-desde-cuentas-cloud) | Desvincular (eliminar) una suscripción Azure desde Cuentas Cloud | Configuración / Cuentas Cloud | Alto | Medio | Hecha |
| [MEJ-26](#mej-26--continuidad-del-copilot-entre-páginas-nueva-conversación) | Continuidad del Copilot entre páginas + botón "Nueva conversación" | FinOps Copilot / IA | Medio | Bajo | Hecha |
| [MEJ-27](#mej-27--tool-calling-el-copilot-consulta-los-datos-en-vez-de-recibirlos) | Tool-calling: el Copilot consulta los datos en vez de recibirlos | FinOps Copilot / IA | Alto | Alto | Propuesta |
| [MEJ-28](#mej-28--harness-de-evaluación-de-calidad-de-respuestas-del-copilot) | Harness de evaluación de calidad de respuestas del Copilot | FinOps Copilot / QA | Medio | Alto | Propuesta |
| [MEJ-29](#mej-29--costo-por-recurso--servicio-en-consumo-real) | Costo por recurso × servicio en Consumo Real | Consumo Real / Costos | Medio | Medio | Propuesta |
| [MEJ-30](#mej-30--etiquetas-en-el-pipeline-de-costos-costsnapshotstags--resourceid) | Etiquetas en el pipeline de costos (`CostSnapshots.Tags` / `ResourceId`) | Costos / Ingesta | Alto | Alto | Hecha |
| [MEJ-32](#mej-32--tres-catálogos-de-precios-duplicados-y-ya-divergidos-mej-10-reabierta) | Tres catálogos de precios duplicados y ya divergidos (MEJ-10 reabierta) | Transversal / Ahorro | Alto | Bajo | Propuesta |
| [MEJ-33](#mej-33--cerrar-el-lazo-del-desvío-dueño-estado-persistente-y-seguimiento) | Cerrar el lazo del desvío: dueño, estado persistente y seguimiento | Anomalías / Gobernanza | Alto | Medio | Hecha |
| [MEJ-31](#mej-31--test-de-storage-history-hardcodea-meses-absolutos-contra-reloj-real) | Test de storage-history hardcodea meses absolutos contra reloj real (rompe todos los meses) | Storage Efficiency / Tests | Medio | Bajo | Hecha |

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

**Módulo:** Transversal (gráficas) · **Impacto:** Medio · **Esfuerzo:** Bajo · **Estado:** Parcial

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

### Solución implementada (2026-09-01) — alcance recortado a propósito

`useChartTheme()` (`src/lib/chartTheme.ts`) ahora expone `animate: boolean`, calculado una sola vez al
montar (no reactivo a cambios de pestaña DESPUÉS de montado — el bug reportado es "cargó oculto", no "se
ocultó a mitad de la animación"; ver el comentario en `computeInitialAnimate` para por qué esa segunda
mitad se deja afuera a propósito). Va gateado por el mismo `mounted` que ya usaba el hook para el tema
(evita el mismo hydration mismatch, y de paso resuelve `animate` ANTES del primer paint visible del
cliente, no después con un salto de `true` a `false`).

**Se aplicó a los 6 archivos con el bug ya diagnosticado y reproducido** (los que tenían
`isAnimationActive={false}` hardcodeado, deshabilitando la animación SIEMPRE en vez de sólo cuando hace
falta):

- `src/components/CostPieChart.tsx`
- `src/components/history/HistoryButton.tsx`
- `src/components/dashboard/CapturedSavingsBoard.tsx` (3 series)
- `src/components/dashboard/TopSpendBoard.tsx`
- `src/components/dashboard/MaturityDashboard.tsx`
- `src/components/dashboard/ResourcesBoard.tsx`

Antes estos 6 perdían la animación SIEMPRE, incluso con la pestaña visible y sin "reducir movimiento" --
`chart.animate` es una mejora estricta sobre el parche puntual, no sólo una relocalización del mismo
`false`.

4 tests en `chartTheme.test.ts` sobre `computeInitialAnimate` (exportada para testear sin montar el hook
completo). Verificado que el primero falla si se rompe el chequeo de `visibilityState` a propósito.

### Por qué NO se tocaron los otros 57 archivos con `recharts`

`grep -rl "from ['recharts']" src/components` da 63 archivos en total. Los 57 restantes NUNCA
tuvieron el bug diagnosticado -- usan el default de Recharts (animación activada) sin haber sido
reportados como congelados. Barrerlos mecánicamente sin leer cada uno (formato JSX heterogéneo, algunos
con múltiples series animables, nombres de variable que podrían colisionar con un `chart` ya usado para
otra cosa) es exactamente el tipo de "diff chico en el lugar equivocado" que hay que evitar: cada uno
necesita el mismo tratamiento de 3 pasos (import + `const chart = useChartTheme()` + prop en cada
primitiva animable) pero verificado uno por uno, no en lote. Quedan listados para cuando se retome:

- `src/components/analytics/AnomalyDetectionPanel.tsx`
- `src/components/analytics/MaccTrackingPanel.tsx`
- `src/components/analytics/TenantHealthPanel.tsx`
- `src/components/analytics/UnitEconomicsPanel.tsx`
- `src/components/analytics/WhatIfScenarioSimulator.tsx`
- `src/components/budgets/BudgetMonthlyChart.tsx`
- `src/components/dashboard/AIAnalyticsDashboard.tsx`
- `src/components/dashboard/AMLDashboard.tsx`
- `src/components/dashboard/AdfFinopsDashboard.tsx`
- `src/components/dashboard/AksChargebackCard.tsx`
- `src/components/dashboard/AnomalyDashboard.tsx`
- `src/components/dashboard/ApimFinopsDashboard.tsx`
- `src/components/dashboard/BasicNetworkingFinopsDashboard.tsx`
- `src/components/dashboard/BudgetBurnChart.tsx`
- `src/components/dashboard/CoinDashboard.tsx`
- `src/components/dashboard/Commitments.tsx`
- `src/components/dashboard/ComputeEfficiencyDashboard.tsx`
- `src/components/dashboard/ContainerAppsCard.tsx`
- `src/components/dashboard/ContentSafetyDashboard.tsx`
- `src/components/dashboard/CostByCategoryDashboard.tsx`
- `src/components/dashboard/CostForecastChart.tsx`
- `src/components/dashboard/CostGroupDetailModal.tsx`
- `src/components/dashboard/CostHistogramCard.tsx`
- `src/components/dashboard/CostProjectionCard.tsx`
- `src/components/dashboard/DatabricksDashboard.tsx`
- `src/components/dashboard/DdosProtectionDashboard.tsx`
- `src/components/dashboard/EventGridFinopsDashboard.tsx`
- `src/components/dashboard/EventHubsFinopsDashboard.tsx`
- `src/components/dashboard/FocusCostPieChart.tsx`
- `src/components/dashboard/HABreakdownCard.tsx`
- `src/components/dashboard/HistoricalProgressBoard.tsx`
- `src/components/dashboard/HybridConnectivityFinopsDashboard.tsx`
- `src/components/dashboard/InteractiveDashboard.tsx`
- `src/components/dashboard/InternetAccessFinopsDashboard.tsx`
- `src/components/dashboard/LoadBalancingFinopsDashboard.tsx`
- `src/components/dashboard/LogAnalyticsCard.tsx`
- `src/components/dashboard/M365UsersBoard.tsx`
- `src/components/dashboard/NetworkAnalyticsDashboard.tsx`
- `src/components/dashboard/NetworkServiceCostBoard.tsx`
- `src/components/dashboard/ReservationUtilizationModal.tsx`
- `src/components/dashboard/ServiceBusFinopsDashboard.tsx`
- `src/components/dashboard/SpeechLanguageDashboard.tsx`
- `src/components/dashboard/VisionVideoDashboard.tsx`
- `src/components/dashboard/WhiteboardForecastWidget.tsx`
- `src/components/dashboard/WhiteboardTopServicesWidget.tsx`
- `src/components/governance/AutoBlockPoliciesPanel.tsx`
- `src/components/monitoring/ActionGroupsBoard.tsx`
- `src/components/monitoring/AlertsManagementPanel.tsx`
- `src/components/monitoring/AppInsightsDashboard.tsx`
- `src/components/monitoring/AzureMonitorPanel.tsx`
- `src/components/monitoring/LogAnalyticsPanel.tsx`
- `src/components/monitoring/NetworkWatcherPanel.tsx`
- `src/components/monitoring/SentinelPanel.tsx`
- `src/components/monitoring/WorkbooksManagementPanel.tsx`
- `src/components/security/DefenderForCloudPanel.tsx`
- `src/components/security/EntraIdPanel.tsx`
- `src/components/security/KeyVaultPanel.tsx`

### Archivos involucrados (esta pasada)

- `src/lib/chartTheme.ts` (`animate` + `computeInitialAnimate`)
- Los 6 listados arriba
- `__tests__/unit/chartTheme.test.ts` (nuevo, 4 tests)

---

## MEJ-03 — Auditar las intercepciones demo restantes de TenantProvider

**Módulo:** Demo / mocks · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Parcial (auditoría hecha)

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

### Auditoría (2026-09-02)

**Hallazgo principal: el interceptor podía filtrar mocks a un tenant REAL.**

Los mocks son sólo para demo. El parche a `window.fetch` se instala
**sincrónicamente durante el render**, pero sólo se desinstala en un
`useEffect` — y React corre los efectos de los hijos ANTES que los del padre. Al
pasar de un tenant demo a uno real:

1. El render evalúa la condición como falsa y **no restaura nada**: el parche
   sigue instalado.
2. Los hijos disparan sus fetches contra el parche todavía activo.
3. Recién después el efecto del padre restaura el `fetch` real.

En esa ventana un tenant real recibía cifras inventadas. En un producto de
gestión de costos es el peor error posible: el cliente decide sobre plata que no
existe. Y no dejaba rastro — los números se veían normales.

El interceptor además decidía **sólo por URL**, sin revalidar de qué tenant se
trataba. Se agregó una guarda que consulta `window.__finopsDemoActive` en cada
llamada; esa bandera se escribe en cada render, así que se apaga en el mismo
render del cambio de tenant sin esperar al efecto. Fijado en
`__tests__/unit/demoFetchLeak.test.ts`, que reproduce la fuga sin la guarda.

**Inventario de las 107 intercepciones:**

| Estado | Cantidad | Qué significa |
|---|---|---|
| Muertas | 3 | No existe ninguna ruta con ese prefijo: nunca disparan |
| Redundantes | 79 | La ruta ya hace short-circuit con su propio mock del lado servidor |
| Necesarias | 25 | Sin mock en el server; si se quitan, la demo queda vacía |

**Eliminadas ahora (las muertas de riesgo cero):**

- `/api/intelligence/budgets` — la ruta real es `/api/budgets`. Nunca se sirvió, y
  encima el payload era de un contrato viejo (`{name, limit, status}` contra el
  actual `{id, costCenter, monthlyLimit, utilization, dailyBurnRate, ...}`). Se
  borró también el case huérfano de `mockData.ts`, dejando una nota para que
  nadie lo reactive tal cual.
- `/api/intelligence/compute-efficiency` — la ruta real es
  `compute-cost-per-core`, que ya trae su mock del lado servidor.

La tercera (`/api/intelligence/integration-services/service-cost`) es un disyunto
dentro de una condición compuesta con tres URLs vivas. Se deja: tocar esa
condición no aporta nada funcional y sí puede romper las tres que sí sirven.

### Falta

**Las 79 redundantes NO se eliminaron en bloque, a propósito.** "Redundante"
acá es una heurística: significa que la ruta o alguno de sus servicios menciona
mock. No garantiza que el mock del servidor tenga la MISMA forma que el del
interceptor, y el componente puede depender de la del interceptor. Los seis
casos que esta entrada ya documenta fallaron justamente por diferencias de
forma, y cada uno necesitó análisis propio.

El camino seguro es de a una: comparar el shape que sirve el interceptor contra
el que devuelve la ruta, verificar en la demo, y recién entonces quitar la
intercepción. El listado categorizado para hacerlo está en esta auditoría.

### Parte 2 (2026-09-02): contratos tipados — y el bug que destapó

`getMockDataForRoute` devolvía `any`, así que un cambio de contrato dejaba el
mock con la forma vieja **sin que nada fallara**. Se agregó el mapa
`MockContracts`, que ata una clave de mock al tipo que devuelve la ruta viva, y
el payload se anota con `satisfies`. Verificado quitando `totalCost` a propósito:
el build rompe con `Property 'totalCost' is missing in type ... FinOpsCategoryDetail`.

El mapa se llena de a poco: una clave sin entrada sigue en `any` y se comporta
como antes. Agregar una es una línea más el `satisfies` en su case.

**El primer contrato tipado encontró la causa del bug reportado ese mismo día**
(`[DecimalError] Invalid argument: undefined` en
`/intelligence/consumo-y-presupuesto/por-categoria`, página en blanco):

1. En demo, el interceptor atrapa `/api/intelligence/cost-by-category`.
2. Servía `categories: [{ category, cost, percent }]`.
3. El componente lee `format(c.totalCost)` — que no existía en ese payload.
4. `new Decimal(undefined)` lanza y se lleva puesto el árbol de React.

El mock correcto sí existía (`getMockCategoryOverview`, tipado como
`CategoryOverview` en el servicio), pero **nunca corría**: el interceptor le
ganaba. Es exactamente el patrón que esta entrada describe, y muestra por qué
las 79 intercepciones "redundantes" no se pueden borrar en bloque — acá la
redundante era la que rompía.

No se importó el generador del servicio a `mockData` a propósito: arrastraría el
SDK de Azure al bundle del cliente. Se reescribió el payload en su lugar, atado
al contrato.

La proyección usa días fijos y no `new Date().getDate()`: con el run-rate real,
un día 2 del mes proyecta 15x lo gastado y la demo parece rota. Al prospecto hay
que mostrarle un mes en curso creíble.

### Falta (parte 2)

Quedan ~59 claves de `getMockDataForRoute` sin contrato declarado. Cada una es
una línea en `MockContracts` más el `satisfies` en su case — y, como se vio acá,
anotarla puede destapar una divergencia que hay que arreglar.

**Cuidado al elegir el tipo: no alcanza con que el nombre coincida.** Al intentar
atar `scorecard`, `anomalies` y `unit_economics` se descubrió que la clave del
mock y el panel homónimo **no siempre hablan de la misma ruta**:

| Clave del mock | La sirve | El panel del mismo nombre consume |
|---|---|---|
| `scorecard` | `/api/intelligence/scorecard` | `/api/analytics/scorecard` |
| `anomalies` | `/api/intelligence/anomalies` | `/api/analytics/anomalies` |

Atar `scorecard` a `ScorecardPayload` habría fijado el contrato de **otra
feature**, metiendo un error peor que el que se quería evitar. El procedimiento
correcto, en este orden:

1. Encontrar qué ruta sirve esa clave (`getMockDataForRoute('<clave>'` en
   `src/app/api/`, más la intercepción en `TenantProvider`).
2. Encontrar qué componente pide **esa** URL exacta.
3. Recién entonces atar al tipo que ese componente consume, y correr `tsc`.

Conviene hacerlo por orden de visibilidad de la página.

**Corrección de estimación (2026-09-03).** "Una línea más el `satisfies`" vale
sólo cuando el contrato vivo YA existe como tipo exportado. Al recorrer los pares
verificados clave→ruta→componente se encontró que **la mayoría de los componentes
no importa ningún tipo de payload**: definen la forma inline o usan `any`. Para
esas claves hay que *escribir* primero el tipo de respuesta, que es el trabajo de
verdad — y el que da el beneficio real, porque tipar el contrato protege también
al camino vivo, no sólo al mock.

Atados y verificados hasta ahora: `cost-by-category` (destapó el DecimalError) y
`compute-efficiency` (conformaba sin cambios).

El script que produce los pares limpios clave→ruta→componente, sin ambigüedad,
está descrito arriba: intercepciones de `TenantProvider` más
`getMockDataForRoute` en `src/app/api/`, cruzado con los `fetch` de los
componentes y descartando `TenantProvider` como consumidor.

### Por qué importa más de lo que parece

La demo es lo que se le muestra a un prospecto **y** lo que se usa para validar cambios sin tocar un
tenant real. Un mock divergente convierte esa validación en falsos negativos: en esta sesión varios
"bugs de producción" resultaron ser sólo la demo mostrando otra cosa.

### Archivos

`src/components/TenantProvider.tsx`, `src/lib/mockData.ts`, los `generateMock*` de `src/services/`.

---

## MEJ-04 — Persistir el desperdicio detectado como métrica propia

**Módulo:** Ahorro Capturado · **Impacto:** Medio · **Esfuerzo:** Bajo · **Estado:** Hecha

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

### Hecho (2026-09-01)

`computeWasteMetrics` (exportada desde `dashboard/summary/route.ts`, mismo criterio que `mapAuditData`:
exportar para poder testear) devuelve las dos métricas, que van al payload del snapshot diario Y a la
respuesta de la API — hay consumidores que leen cada uno de los dos lados.

- **`detectedWasteUSD`** es el mismo número que `totalSavings`, pero con su nombre honesto (`totalSavings`
  suena a ahorro conseguido y no lo es). Se persisten los dos: el día que la semántica de `totalSavings`
  cambie, el histórico de desperdicio no se mueve con él.
- **`zombieMonthlyWasteUSD`** sí es una medición distinta: sólo los hallazgos de COSTO, dejando afuera los
  de gobernanza (falta de etiquetas, certificados vencidos), que son hallazgos válidos pero no dinero
  quemado.

**Hallazgo del camino.** El problema que MEJ-04 describe estaba en su forma más literal en
`/api/intelligence/whiteboard` (líneas 230-231): `zombieMonthlyWasteUSD` y `potentialSavingsUSD` se
alimentaban **los dos** de `payload.totalSavings`, así que dos KPI distintos del Whiteboard mostraban
siempre el mismo número — y el de zombies incluía gobernanza. Ahora cada uno lee su campo.

**Compatibilidad hacia atrás**, como pedía la nota: los lectores usan
`payload?.detectedWasteUSD ?? payload?.totalSavings`. Es `??` y no `||` a propósito — un desperdicio de $0
es un dato válido (no queda nada por limpiar) y con `||` caería al valor viejo, mostrando desperdicio
fantasma justo después de una limpieza completa. Verificado rompiéndolo a propósito.

8 tests en `__tests__/unit/wasteMetrics.test.ts` (la separación costo/gobernanza y los cuatro casos del
fallback histórico).

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

**Módulo:** Azure Advisor · **Impacto:** Bajo · **Esfuerzo:** Bajo · **Estado:** Hecha

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

### Solución implementada (2026-09-01)

Alcance elegido: **sólo reescritura de prosa**, sin toggle de audiencia técnico/financiero (eso queda
fuera, no se pidió).

- `src/lib/advisorRemediation.ts`: `generateAdvisorRemediationAction` no cambió ni un carácter del texto
  que ya devolvía (13 tests de `azureAdvisorService.test.ts` intactos). Ahora además expone, sin
  interpolar, la plantilla de `actionDescription` (`descriptionTemplate`, con placeholders
  `{name}`/`{skuText}`/`{cpuText}`) más sus `descriptionVars` y un `ruleKey` por rama (9 en total —
  `DELETE_ZOMBIE` cubre dos ramas de texto distinto, así que `ruleKey` es más fino que `actionType`).
  `actionType`/`targetSku`/`estimatedMonthlySavingsUSD`/`actionTitle` siguen 100% deterministas siempre.
- `src/services/advisorRemediationNarration.ts` (nuevo): manda **sólo la plantilla genérica** a la IA —
  nunca el nombre del recurso ni ningún dato del tenant — cacheada por `ruleKey + locale` en la tabla
  `AiCache` existente (mismo patrón que `getAssessment`). La caché es **compartida entre tenants a
  propósito**: como el prompt no lleva datos de nadie, compartirla es seguro y baja el costo de "decenas
  de llamadas por tenant" (estimado en la propuesta) a "unidades por día para toda la plataforma".
  Guard de integridad: si la IA pierde o inventa un placeholder, se descarta la reescritura y se usa la
  plantilla determinista (un placeholder roto interpola peor que no reescribir nada). Best-effort: si el
  tenant no tiene IA configurada, no se llama a nada y no cambia el comportamiento actual.
- `src/app/api/advisor/route.ts`: la reescritura se dispara sólo acá, dentro de la caché SWR de 30 min ya
  existente — no en `getAdvisorExecutiveData`/`collectAdvisorData`, porque `coinIndexService` y
  `whiteboard/route.ts` consumen los mismos datos para puntajes numéricos, no para mostrar prosa.
- `src/types/azureAdvisor.types.ts`: `ruleKey`/`descriptionTemplate`/`descriptionVars` opcionales en
  `AdvisorSuggestedAction` (no rompe a nadie que construya el tipo sin ellos).

### Archivos involucrados

- `src/lib/advisorRemediation.ts`
- `src/services/advisorRemediationNarration.ts` (nuevo)
- `src/app/api/advisor/route.ts`
- `src/types/azureAdvisor.types.ts`
- `__tests__/unit/advisorRemediationNarration.test.ts` (nuevo, 6 tests)

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

## MEJ-11 — Módulo de comunicaciones globales a usuarios (popups, banners y alertas)

**Módulo:** SuperAdmin / Transversal · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Parcial

### Contexto

Actualmente no existe un canal nativo para que los operadores de la plataforma (**SuperAdmins**) puedan emitir avisos operativos, ventanas de mantenimiento programado, alertas de degradación o anuncios de nuevas capacidades a los usuarios de todos los tenants (o tenants específicos).
Las alertas en `Notifications` son generadas exclusivamente por reglas automáticas de gasto, auditorías y anomalías, sin capacidad de difusión broadcast o programada desde un panel administrativo.

### Propuesta

Construir un **Módulo de Gestión de Comunicaciones y Anuncios Globales**, accesible **única y exclusivamente para usuarios con rol `SuperAdmin`** (`requireSuperAdmin`), con ciclo de vida completo (programación, activación, visualización multicanal, acuse de recibo y archivado histórico en storage/DB).

### Canales de Entrega y Experiencia de Usuario

1. **Banner Superior en Whiteboard / Dashboard:**
   - **Ubicación:** Barra destacada fija en la parte superior del Whiteboard / Layout principal (`WhiteboardLayout.tsx` o encabezado superior).
   - **Comportamiento:** Se muestra en tiempo real durante la ventana activa (`starts_at <= now <= ends_at`) y **desaparece automáticamente de la interfaz** una vez expirada la fecha/hora de finalización.
   - **Diseño:** Barra con contraste accesible según severidad (`info` en azul corporativo `#0054A6`, `maintenance`/`warning` en ámbar, `critical` en rojo) con botón de colapsar/cerrar.

2. **Popup / Modal al Inicio de Sesión:**
   - **Ubicación:** Modal centrado que se dispara al iniciar sesión o cargar la aplicación por primera vez en el día/sesión.
   - **Comportamiento:** Ideal para mantenimientos críticos o anuncios de alto impacto.
   - **Control de usuario:** Permite al usuario hacer clic en *"Entendido / No volver a mostrar"* (`dismissed_at`), guardando la preferencia por usuario/dispositivo (`localStorage` + registro en DB) para no volver a interrumpirlo durante la vigencia del anuncio.

3. **Panel de Notificaciones / Alertas del Tenant:**
   - **Ubicación:** Integración con la campana de notificaciones (`NotificationsBell.tsx`) y el panel de alertas (`TenantNotificationsPanel.tsx`).
   - **Comportamiento:** Se registra como una alerta de tipo `SYSTEM_BROADCAST` / `MAINTENANCE`, quedando disponible para consulta en el historial.

### Capacidades del Panel SuperAdmin (`/super-admin/comunicaciones`)

- **Editor de Anuncios:**
  - Título y Mensaje (soporte de texto enriquecido / Markdown sanitizado).
  - Tipo y Severidad (`info`, `maintenance`, `warning`, `critical`).
  - Canales activos (selección combinable: `[x] Banner superior`, `[x] Popup de inicio de sesión`, `[x] Panel de notificaciones`).
  - Ventana de vigencia: Fecha y hora de inicio (`starts_at`) y fecha y hora de finalización (`ends_at`).
  - Alcance / Target: Global (todos los tenants) o lista de `tenant_id` específicos.
  - Enlace de acción opcional (`action_url`, ej. enlace al status page o notas de la versión).
- **Control de Estado y Ciclo de Vida:**
  - Estados: `Borrador`, `Programado`, `Activo`, `Finalizado / Expirado`, `Cancelado`.
  - Acción de finalización inmediata o cancelación de emergencia.
- **Archivado Histórico en Storage / DB:**
  - Persistencia de todas las comunicaciones en la tabla `SystemAnnouncements` / Azure Blob Storage para auditoría y trazabilidad histórica de avisos emitidos.
  - Métricas de impacto: Conteo de visualizaciones y usuarios que descartaron el popup.

### Consideraciones Técnicas y de Seguridad

- **RBAC Estricto:** Rutas de creación, edición, borrado y archivado protegidas con `requireSuperAdmin(request)`.
- **Ruta Pública/Autenticada de Lectura:** `GET /api/announcements/active?tenantId=...` con cache Redis de corto tiempo (sub-segundo / SWR) filtrada por ventana temporal `NOW() BETWEEN starts_at AND ends_at` y exclusión de anuncios descartados por el usuario.
- **Mocks por Tier:** Soporte para simulación de banners y popups en `/demo` con mocks asociados.
- **i18n:** Soporte multilingüe en mensajes base (ES, EN, PT-BR) o mensajes con fallback automático.

### Archivos Involucrados (Estimados)

- **Backend / Migraciones:**
  - `migrations/YYYYMMDD-NNN-system-announcements-table.sql` (tabla `SystemAnnouncements` y `UserAnnouncementDismissals`).
  - `src/services/systemAnnouncements.service.ts` (lógica de negocio, filtrado temporal y archivado).
  - `src/app/api/super-admin/announcements/route.ts` (CRUD SuperAdmin).
  - `src/app/api/announcements/active/route.ts` (lectura de anuncios vigentes para usuarios).
  - `src/app/api/announcements/dismiss/route.ts` (registro de descarte de popup por usuario).
- **Frontend / UI:**
  - `src/components/super-admin/SystemAnnouncementsManager.tsx` (panel administrativo SuperAdmin).
  - `src/components/announcements/GlobalAnnouncementBanner.tsx` (banner superior en Whiteboard/Layout).
  - `src/components/announcements/GlobalAnnouncementPopup.tsx` (modal de inicio de sesión con opción "no volver a mostrar").
  - `src/components/NotificationsBell.tsx` y `TenantNotificationsPanel.tsx` (incorporación del tipo `SYSTEM_BROADCAST`).

### Criterio de Aceptación

1. Un SuperAdmin puede crear un anuncio con ventana de vigencia (ej. mantenimiento de 22:00 a 02:00 UTC) seleccionando canales (banner + popup).
2. Los usuarios dentro de la ventana de vigencia ven el banner superior en el Whiteboard y el popup al ingresar.
3. Si el usuario cierra el popup marcando "No volver a mostrar", el popup no vuelve a desplegarse en esa sesión/dispositivo.
4. Al cumplirse la fecha/hora de finalización (`ends_at`), el banner desaparece automáticamente de la interfaz de todos los usuarios sin requerir intervención manual.
5. El historial completo de anuncios permanece archivado en la base de datos para consulta administrativa.

### Solución implementada (2026-09-01) — alcance recortado a propósito

Los 5 criterios de aceptación de arriba **no mencionan el canal 3** (panel de notificaciones), así
que se implementaron sólo **banner + popup**. Ver "Qué queda afuera" antes de dar la mejora por
cerrada del todo.

- **Migración** (`20260901-001-system-announcements.sql`): `SystemAnnouncements` +
  `UserAnnouncementDismissals`. Dos simplificaciones deliberadas sobre el diseño original:
  - `status` sólo tiene 3 valores reales (`draft`/`published`/`cancelled`). Los estados
    "Programado"/"Activo"/"Finalizado" que pedía la propuesta NO se guardan como filas: se derivan
    de `starts_at`/`ends_at` contra `NOW()` en cada lectura (`computeDisplayStatus`). Materializarlos
    hubiese exigido un cron que los mantenga sincronizados, sin ganar nada — la consulta "¿está
    activo?" es la misma cuenta.
  - Sin tabla de vínculos para el alcance: `target_tenant_ids` es una columna JSON en la misma fila,
    resuelta en JS al leer (mismo criterio ya usado en `fetchResourceGroupsByTag`, MEJ-30). Sin FK a
    `Tenants` a propósito — mismo motivo que `TenantExcludedSubscriptions` (colación incompatible
    entre entornos bloquea el runner completo).
- **Servicio** (`src/services/systemAnnouncements.service.ts`): CRUD + `getActiveAnnouncementsForTenant`
  (filtra por status/ventana/alcance y marca `dismissedByUser` por usuario) + `recordDismissal`
  (`INSERT IGNORE`, idempotente).
- **Rutas**: `super-admin/announcements` (GET/POST) y `super-admin/announcements/[id]`
  (PATCH/DELETE) con `requireSuperAdmin`; `announcements/active` y `announcements/dismiss` con
  `requireTenantAccess`, gateadas por `isMockTenant` (demo devuelve `[]` sin tocar la tabla real).
- **Banner** (`GlobalAnnouncementBanner.tsx`): montado en `ClientShell` junto a `ImpersonationBanner`.
  El botón de cerrar es un colapso **por sesión** (`sessionStorage`), no un descarte persistente en
  DB — el criterio 4 sólo pide que desaparezca solo al vencer, no un "no volver a mostrar" permanente
  para el banner (eso sólo lo pide el popup, criterio 3).
- **Popup** (`GlobalAnnouncementPopup.tsx`): montado junto a `TelemetryDelayModal`, mismo patrón de
  retardo de 1200ms. Mensaje renderizado con `ReactMarkdown` + `remarkGfm` (mismo patrón ya auditado
  en `GlobalCopilot.tsx`, sin `rehype-raw`, así que no ejecuta HTML embebido — no hizo falta sumar
  una pasada de DOMPurify aparte).
- **Panel SuperAdmin** (`SystemAnnouncementsPanel.tsx` en `/superadmin/announcements`): tabla +
  modal de alta/edición, entrada nueva en `Sidebar.tsx` gateada por `systemRole === 'SUPERADMIN'`.
- 14 tests nuevos en `systemAnnouncementsService.test.ts`, incluida la validación de fechas al
  editar (verificada rompiendo el guard a propósito: sin él, un `PATCH` que sólo toca `endsAt` no
  valida contra el `startsAt` ya guardado).

### Qué queda afuera (documentado, no perdido)

- **Canal 3 (panel de notificaciones / `SYSTEM_BROADCAST`)**: `useTenantNotifications` materializa
  una fila por tenant desde reglas automáticas de gasto/auditoría — un mecanismo distinto a un
  anuncio administrado por un humano con ventana de vigencia y alcance elegible. Integrarlo exige
  un proceso que enumere los tenants target y materialice/expire filas por anuncio, sincronizado con
  `starts_at`/`ends_at`. Mezclarlo en esta pasada hubiese forzado una abstracción que no encaja bien
  en ninguno de los dos lados.
- **i18n del contenido** (ES/EN/PT-BR por anuncio): un solo campo `message`, en el idioma que el
  SuperAdmin elija escribir — consistente con el resto de la UI de SuperAdmin en este código, que ya
  es texto fijo en español (`ImpersonationBanner`, `TelemetryDelayModal`, etc.), no i18n por tenant.
- **Métricas de impacto** (conteo de visualizaciones): no hay tracking de "vistas", sólo de
  descartes del popup (que es lo que pide el criterio 3). Ver-y-no-descartar no se registra.
- ~~**Selector de tenants con búsqueda**~~: hecho (2026-09-01). El alcance específico ya no es texto
  libre: es una lista con búsqueda por nombre o ID sobre `GET /api/superadmin/tenants`, que ya
  existía (no hizo falta endpoint nuevo). Se excluyen sólo los `CANCELED` — un `TRIAL` o `PAST_DUE`
  sigue entrando a la plataforma, y a un `PAST_DUE` es justamente a quien se le quiere avisar. La
  lista se pide al abrir el modal, no al montar el panel. Un anuncio ya dirigido a un tenant que hoy
  no está en la lista lo muestra igual, marcado "Fuera de la lista", para poder desmarcarlo en vez
  de perderlo en silencio al guardar.
- **Mocks para `/demo`**: `isMockTenant` devuelve `[]` de entrada; no hay anuncios simulados para
  probar la UI en el tenant demo.

### Archivos involucrados (reales, no estimados)

- `migrations/20260901-001-system-announcements.sql`
- `src/types/systemAnnouncements.types.ts`
- `src/services/systemAnnouncements.service.ts`
- `src/app/api/super-admin/announcements/route.ts` y `.../[id]/route.ts`
- `src/app/api/announcements/active/route.ts` y `.../dismiss/route.ts`
- `src/components/announcements/GlobalAnnouncementBanner.tsx` y `GlobalAnnouncementPopup.tsx`
- `src/components/superadmin/SystemAnnouncementsPanel.tsx`
- `src/app/[locale]/superadmin/announcements/page.tsx`
- `src/components/ClientShell.tsx` (monta banner + popup) y `src/components/Sidebar.tsx` (nav)
- `messages/{es,en,pt-BR}.json` (clave `Navigation.superadmin_announcements`)
- `__tests__/unit/systemAnnouncementsService.test.ts` (nuevo, 14 tests)

---

## MEJ-12 — Trazabilidad de ciclo de vida de tenants (fechas de activación, suspensión y bajas)

**Módulo:** SuperAdmin / Gobernanza / Facturación · **Impacto:** Alto · **Esfuerzo:** Bajo · **Estado:** Hecha

### Contexto

Actualmente la tabla `Tenants` almacena la fecha de creación del registro (`created_at`) y el estado general (`status`), pero no registra explícitamente la **fecha exacta de activación efectiva** (`activated_at`) cuando el cliente completa su onboarding o su primer pago, ni la **fecha de suspensión** (`suspended_at`) o la **fecha de baja formal** (`deactivated_at` / `canceled_at`).
Esto impide calcular con exactitud métricas financieras y de negocio críticas como el Churn Rate mensual/anual, el Customer Lifetime Value (LTV), la retención por cohortes y la auditoría contable de permanencia en el panel de SuperAdmin.

### Propuesta

Extender el modelo de datos de tenants y la suite de webhooks para registrar el ciclo de vida de cada tenant de forma inmutable y auditable:

1. **Esquema de Datos Extendido (`Tenants` y `TenantLifecycleEvents`):**
   - `activated_at`: Fecha y hora en que el tenant completó su onboarding, validó credenciales y/o acreditó su primer pago.
   - `suspended_at`: Fecha y hora en que el tenant fue suspendido (por impago, límite de cuota o acción administrativa).
   - `canceled_at` / `deactivated_at`: Fecha y hora de baja definitiva o no-renovación.
   - `cancellation_reason`: Motivo clasificado de la baja (`voluntary_churn`, `payment_delinquency`, `contract_expired`, `admin_deprovisioning`).
   - Tabla `TenantLifecycleEvents`: Registro append-only con `tenant_id`, `event_type` (`ACTIVATED`, `SUSPENDED`, `REACTIVATED`, `CANCELED`), `occurred_at`, `actor_id` y `metadata`.

2. **Automatización en Webhooks y Onboarding:**
   - En el onboarding exitoso o webhook de suscripción creada (`subscription.created` / `subscription.activated` de Paddle o Azure Marketplace), estampar automáticamente `activated_at = NOW()`.
   - En eventos de cancelación (`subscription.canceled`), registrar `canceled_at = NOW()` y archivar el motivo.

3. **Panel SuperAdmin (`/super-admin/tenants` y `/super-admin/funnel`):**
   - Columnas dedicadas de "Fecha de Activación" y "Fecha de Baja".
   - Filtros por estado y rango de fechas (ej. "Tenants activados en Q3", "Bajas del mes en curso").
   - Exportación de métricas de retención y permanencia promedio en meses.

### Archivos Involucrados (Estimados)

- `migrations/YYYYMMDD-NNN-tenant-lifecycle-timestamps.sql` (columnas en `Tenants` y tabla `TenantLifecycleEvents`).
- `src/services/superAdminTenants.service.ts` y `src/app/api/super-admin/tenants/route.ts`.
- `src/app/api/webhooks/paddle/route.ts` y `src/app/api/marketplace/webhook/route.ts`.
- `src/components/super-admin/SuperAdminTenantsList.tsx`.

### Criterio de Aceptación

1. Cada tenant muestra su fecha de activación y, si aplica, su fecha de baja en el panel de SuperAdmin.
2. La cancelación desde Paddle o Azure Marketplace actualiza `canceled_at` y genera un evento en el log histórico.
3. El SuperAdmin puede filtrar tenants por fecha de activación/baja y exportar el informe contable.

### BUG ENCONTRADO Y ARREGLADO EN EL CAMINO (2026-09-01): las cancelaciones fallaban en silencio

Antes de poder registrar `canceled_at` hubo que arreglar que la cancelación **no se aplicaba**.

`Tenants.subscription_status` quedó como `ENUM('TRIAL','ACTIVE','EXPIRED')` en toda base cuya tabla sea
anterior al bootstrap del 2026-06-28. Ese bootstrap SÍ declara el enum completo, pero es
`CREATE TABLE IF NOT EXISTS`: sobre una tabla que ya existía **corrió, se registró como aplicado en
`SchemaMigrations`, y no modificó nada**. `src/modules/storage/schema.sql` —el baseline de referencia, que
no se ejecuta— arrastraba el mismo error.

Con `STRICT_TRANS_TABLES` (el `sql_mode` real, verificado):

```
UPDATE Tenants SET subscription_status='CANCELED' WHERE tenant_id=...;
ERROR 1265 (01000): Data truncated for column 'subscription_status'
```

El UPDATE aborta y **el tenant queda `ACTIVE`**. O sea: un cliente que cancelaba en Paddle o en el
Marketplace conservaba el acceso, y ninguna baja quedó registrada nunca. Afectaba a 5 rutas (webhooks de
Paddle y Marketplace, `/api/billing`, `/api/billing/subscription`, `saasBilling.service`). `EXPIRED` sí
era válido, así que el cron de vencimiento funcionaba — por eso el hueco pasó desapercibido.

Arreglado en `migrations/20260901-004-fix-subscription-status-enum.sql` (con `MODIFY COLUMN`, que sí
actúa sobre tablas existentes) y alineado el baseline de `schema.sql`.

**CORRECCIÓN (2026-09-01): lo que se verificó NO era producción.**

Una primera versión de esta entrada afirmaba que el enum roto estaba confirmado en producción. Ese dato
salió de `finops-vps` (187.127.11.253), un VPS que sigue encendido pero está **fuera de servicio desde el
2026-07-27**: es la fecha en que la plataforma migró a Azure Container Apps. La primera línea de
`.github/workflows/deploy-azure.yml` lo dice —"REEMPLAZA al deploy por SSH al VPS"— y ese workflow es el
que corre en push a `main`, mientras que `deploy.yml` (el de SSH) quedó en `workflow_dispatch`. El
"producción 5 semanas atrasada, 51 de 104 migraciones" describía ese servidor abandonado, no el sistema
real.

**Producción real:** Azure Container Apps, `cscs-finops-prod-westus2-web` (RG
`cscs-finops-prod-westus2-rg`), revisión `0000144` del 2026-08-31, imagen del commit `163a183`. Las
migraciones corren como Container App Job (`cscs-finops-prod-wus2-migrate`), con 4 ejecuciones exitosas
el 2026-08-31. O sea: producción está al día, no atrasada.

**El estado del enum en producción queda SIN VERIFICAR.** La base
(`cscs-finops-prod-westus2-mysql`) tiene el acceso público deshabilitado y sólo se alcanza desde la VNet.
La pregunta concreta es si la tabla `Tenants` de Azure nació ejecutando `20260628-001-core-bootstrap.sql`
sobre una base vacía —en cuyo caso el enum es el correcto y el bug no existe ahí— o si se restauró desde
un dump del VPS, que habría traído el enum roto. Para comprobarlo, desde dentro de la VNet:

```sql
SELECT COLUMN_TYPE FROM information_schema.COLUMNS
 WHERE TABLE_NAME='Tenants' AND COLUMN_NAME='subscription_status';
```

La migración `20260901-004` es idempotente (`MODIFY COLUMN`), así que es segura de aplicar en cualquiera
de los dos casos.

### Hecho (2026-09-01)

**El punto único.** Había **17 `UPDATE Tenants SET subscription_status = ...`** repartidos entre webhooks,
crons, rutas de admin y servicios. Ninguno dejaba registro de cuándo ni por qué. Estampar las fechas en
los 17 serían 17 oportunidades de olvidarse una, así que se creó
`recordTenantLifecycleTransition` (`src/services/tenantLifecycle.service.ts`): el registro es
*consecuencia* de cambiar el estado, no un paso aparte que hay que acordarse de hacer.

- Aplica estado + fecha + evento **en una transacción**: si el UPDATE entrara y el INSERT no, quedaría un
  cambio de estado sin registro, justo lo que el historial existe para impedir.
- **Idempotente ante reentregas**: Paddle y el Marketplace repiten eventos. Se descarta sólo si el tenant
  YA está en el estado destino Y el último evento es del mismo tipo — así una reentrega no duplica, pero
  un ciclo real (baja → alta → baja) sí se registra dos veces.
- **Un tenant inexistente se ignora sin lanzar**: un webhook puede traer una suscripción de otro entorno
  que comparte la cuenta de facturación. Si tirara 500, el proveedor reintentaría para siempre un evento
  que nunca va a poder aplicarse. Un fallo real de base sí propaga, y ahí el reintento es lo correcto.
- `EXPIRED` también estampa `canceled_at` (motivo `contract_expired`): para el churn, un contrato vencido
  es una baja igual que una cancelación, y sin fecha no entraría en ninguna cohorte.

**Columnas Y tabla de eventos, que no es redundancia.** Las columnas (`activated_at`, `suspended_at`,
`canceled_at`, `cancellation_reason`) son el estado actual, que el panel lista y filtra; derivarlas del log
pediría una subconsulta por tenant en cada listado. `TenantLifecycleEvents` es la historia: un tenant que
se va y vuelve tiene una sola `activated_at` (la última) pero varios períodos, y el análisis de cohortes
necesita los períodos. Es la decisión **opuesta** a la de MEJ-11 (donde `displayStatus` se deriva) y por el
motivo opuesto: allá el valor se recalcula con una comparación de fechas y materializarlo habría exigido un
cron; acá el dato es un hecho con su momento, que no se puede recomputar después a partir del estado actual.

**Rutas enrutadas por el servicio:** webhook de Paddle (`canceled`, `past_due`), webhook de Marketplace
(`Unsubscribed`, `Suspended`, `Reinstated`), `/api/billing`, `/api/billing/subscription`, cron de
vencimiento de suscripción y cron de vencimiento de trial.

**Backfill:** los tenants existentes reciben `activated_at = created_at`. Es una aproximación —es la fecha
del registro, no la del onboarding efectivo ni la del primer pago— y para los tenants anteriores esa
distinción se perdió. Queda documentado en la migración para que nadie lea esas fechas como exactas. Sólo
se estampa a los vigentes: uno ya cancelado necesitaría además `canceled_at`, fecha que no existe en
ningún lado (el hueco que MEJ-12 viene a tapar).

9 tests en `__tests__/unit/tenantLifecycle.test.ts`. Se completó el mock de conexión de
`__tests__/integration/api-paddle.test.ts`, que no implementaba la API de transacciones.

### Criterio 3, completado (2026-09-01)

`src/lib/tenantLifecycleReport.ts` (fuera del componente, para poder probarlo sin montar la UI) +
`TenantManagementPanel.tsx`:

- **Columnas** "Fecha de Alta", "Fecha de Baja" y "Motivo de Baja", ocultas por defecto — la tabla ya traía
  10 y el selector de columnas persiste la elección.
- **Filtro por rango** sobre altas o bajas, que se acumula con el buscador ya existente. Compara por DÍA y
  no por instante: el control es un `<input type="date">`, así que "hasta el 30/09" tiene que incluir todo
  ese día; con timestamps, `to` valdría medianoche y dejaría afuera al tenant dado de baja esa tarde.
  Verificado rompiéndolo a propósito. Un tenant sin la fecha pedida queda excluido cuando hay algún
  límite: si se pregunta "bajas de septiembre", uno que nunca se dio de baja no es una respuesta vacía.
- **Exportación CSV** de lo que se está viendo (filtros incluidos), con permanencia en meses calculada
  alta→baja, o alta→hoy si sigue vigente. Campos escapados según RFC 4180 —un nombre de empresa con coma
  partía la fila en dos— y con BOM para que Excel en Windows no muestre "SuspensiÃ³n".

12 tests en `__tests__/unit/tenantLifecycleReport.test.ts`.

### Falta
- **`CANCELED_PENDING`** (`saasBilling.service.ts:217`) no está en ninguna definición del esquema y no se
  agregó a propósito: `listAllTenantsForSuperAdmin` mapea todo valor desconocido a `ACTIVE`, así que un
  tenant en ese estado se vería como activo. Ese camino además usa `WHERE id = ?` pasándole un `tenant_id`
  (columnas distintas) y vive dentro de un `catch` que se traga el error, así que hoy no hace nada.
  Necesita decidirse si el estado existe de verdad o si se borra el código.
- **Métricas derivadas** (churn mensual, LTV, retención por cohortes) no se calculan todavía: esta pasada
  deja el dato crudo que las habilita.
- Las otras ~10 escrituras de `subscription_status` (alta manual, extend-trial, cambio de tier desde
  SuperAdmin) siguen con `UPDATE` directo: no son transiciones de ciclo de vida, pero convendría revisarlas
  cuando se toque esa zona.

---

## MEJ-13 — Marketplace de add-ons y capacidades a la carta para tiers Professional y Business

**Módulo:** Facturación / Marketplace / TierLogic / Self-Service · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Propuesta

### Contexto

Actualmente los clientes en tiers **Professional** y **Business** están acotados estrictamente a las cuotas y funcionalidades predefinidas de su plan (`src/lib/tierLogic.ts`, `src/lib/routeTiers.ts`).
Si un tenant de tier Professional necesita conectar 1 suscripción Azure adicional (superando el límite base) o requiere una capacidad específica de tiers superiores (como el Simulador de Compromisos RIs, la auditoría profunda de Zombies o informes ejecutivos automatizados), hoy se ve forzado a realizar un upgrade integral al tier superior, lo cual genera fricción comercial.

### Propuesta

Construir un **Marketplace de Add-ons y Capacidades a la Carta** (`/settings/billing/marketplace` o `/marketplace`), donde el Owner de tenants Professional y Business pueda adquirir complementos modulares independientes con activación instantánea y facturación flexible.

### Arquitectura de Implementación con Paddle Billing

1. **Estructura Requerida en el Catálogo de Paddle (Dashboard Paddle Billing):**
   Para cada add-on o capacidad a la carta, se crea un **Product** en el dashboard de Paddle (*Catalog → Products & Prices*) con su matriz de precios recurrentes y de pago único:

   | Producto en Paddle | Tipo | Precios Recurrentes (Subscription) | Precios por Única Vez (One-time Pass) |
   | :--- | :--- | :--- | :--- |
   | **Suscripciones Azure Extra** | Cuota | • Mensual (`pri_sub_m`)<br>• Anual (`pri_sub_y`) | • Pase 1 Mes (`pri_sub_1m`)<br>• Pase 3 Meses (`pri_sub_3m`)<br>• Pase 6 Meses (`pri_sub_6m`)<br>• Pase 9 Meses (`pri_sub_9m`) |
   | **Asientos de Usuario Extra (+5)** | Cuota | • Mensual (`pri_usr_m`)<br>• Anual (`pri_usr_y`) | • Pase 1, 3, 6 y 9 Meses |
   | **Simulador de Compromisos RIs & SP** | Feature | • Mensual (`pri_sim_m`)<br>• Anual (`pri_sim_y`) | • Pase 1, 3, 6 y 9 Meses |
   | **Auditoría Avanzada de Zombies & Redes** | Feature | • Mensual (`pri_zom_m`)<br>• Anual (`pri_zom_y`) | • Pase 1, 3, 6 y 9 Meses |
   | **Informes Ejecutivos en PDF** | Feature | • Mensual (`pri_rep_m`)<br>• Anual (`pri_rep_y`) | • Pase 1, 3, 6 y 9 Meses |

   - **Precios Recurrentes (Subscription Items):** Se configuran en Paddle con `billing_cycle = { interval: 'month' | 'year', frequency: 1 }`. Al contratarse, se agregan a la suscripción base del cliente mediante `PATCH /subscriptions/{subscription_id}` con prorrateo y alineación de ciclo (*co-terming* automático de Paddle).
   - **Precios por Única Vez (One-time Passes):** Se configuran en Paddle con `billing_cycle = null` (non-recurring). Se compran mediante el overlay checkout de Paddle (`Paddle.Checkout.open`) enviando metadatos en `custom_data`:
     ```json
     {
       "custom_data": {
         "tenant_id": "81ebe027-e6af-4e09-bc73-58c9012c6408",
         "addon_key": "feature_simulator",
         "ttl_months": 3
       }
     }
     ```

2. **Mapeo Centralizado en la Plataforma (`src/lib/addonCatalog.ts`):**
   Las referencias a los IDs de Paddle se gestionan mediante variables de entorno en el catálogo centralizado:
   ```ts
   export const ADDON_CATALOG = {
       feature_simulator: {
           key: "feature_simulator",
           name: "Simulador de Compromisos RIs & Savings Plans",
           description: "Análisis financiero y simulación interactiva de reservas con curvas de retorno",
           prices: {
               monthly: process.env.PADDLE_PRICE_SIMULATOR_MONTHLY,
               annual: process.env.PADDLE_PRICE_SIMULATOR_ANNUAL,
               pass1m: process.env.PADDLE_PRICE_SIMULATOR_1M,
               pass3m: process.env.PADDLE_PRICE_SIMULATOR_3M,
               pass6m: process.env.PADDLE_PRICE_SIMULATOR_6M,
               pass9m: process.env.PADDLE_PRICE_SIMULATOR_9M,
           }
       },
       quota_subscriptions: {
           key: "quota_subscriptions",
           name: "Suscripción Azure Adicional",
           description: "Habilita la conexión y monitoreo de 1 suscripción Azure adicional",
           unit: "subscription",
           prices: {
               monthly: process.env.PADDLE_PRICE_SUB_MONTHLY,
               annual: process.env.PADDLE_PRICE_SUB_ANNUAL,
               pass1m: process.env.PADDLE_PRICE_SUB_1M,
               pass3m: process.env.PADDLE_PRICE_SUB_3M,
               pass6m: process.env.PADDLE_PRICE_SUB_6M,
               pass9m: process.env.PADDLE_PRICE_SUB_9M,
           }
       }
   };
   ```

3. **Procesamiento de Webhooks Paddle:**
   - **Webhook `transaction.completed` (Pases Temporales):** Lee `custom_data`, inserta/actualiza en la tabla `TenantAddons` con `status = 'active'`, `starts_at = NOW()` y `expires_at = NOW() + INTERVAL ttl_months MONTH`.
   - **Webhook `subscription.updated` / `subscription.canceled` (Recurrentes):** Sincroniza altas, renovaciones y bajas de los ítems de suscripción activos en `TenantAddons`.

4. **Motor de Autorización Dinámica (`src/lib/tierLogic.ts`):**
   - La verificación de acceso a features y límites de cuota (`hasFeatureAccess`, `getTenantQuotaLimits`) evalúa el tier base + los registros activos y vigentes en la tabla `TenantAddons` (`status = 'active' AND expires_at > NOW()`).

### Archivos Involucrados (Estimados)

- `migrations/YYYYMMDD-NNN-tenant-addons-catalog.sql` (tablas `TenantAddons`, `AddonCatalog`).
- `src/lib/addonCatalog.ts` (catálogo y mapeo de IDs de Paddle).
- `src/lib/tierLogic.ts` (`hasFeatureAccess`, `getTenantQuotaLimits`).
- `src/services/paddleBillingService.ts` y `src/app/api/billing/addons/route.ts` (checkout de Paddle para add-ons recurrentes y pases temporales).
- `src/app/[locale]/settings/billing/marketplace/page.tsx` (catálogo visual y gestión de add-ons).
- `src/components/billing/AddonStoreCard.tsx` y `AddonActiveManager.tsx`.

### Criterio de Aceptación

1. Los productos y precios se encuentran configurados en el catálogo de Paddle Billing.
2. Un Owner de tier Professional puede comprar una suscripción Azure extra o habilitar el Simulador de RIs por 3 meses desde el Marketplace.
3. El pago se procesa por Paddle Checkout y genera un ítem desglosado en el recibo.
4. La cuota o feature se activa de inmediato en la sesión del tenant.
5. Al vencer el TTL (ej. 3 meses), el add-on de compra única se deshabilita automáticamente sin afectar el plan base.

---

## MEJ-14 — Trazabilidad de ventas por comercial y cálculo automatizado de comisiones

**Módulo:** SuperAdmin / Comercial / Ventas & Comisiones · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Propuesta

### Contexto

Cuando un nuevo cliente adquiere un tenant, no existe un registro formal en base de datos del **ejecutivo comercial** (`sales_rep` / `commercial_id`) que originó o cerró la venta, ni de la **fecha formal de cierre de venta** (`sold_at`).
Asimismo, el cálculo de las comisiones pactadas con el equipo comercial se realiza de forma manual y externa, lo que genera demoras operativas, errores de cálculo y falta de visibilidad para la dirección comercial y los propios ejecutivos.

### Propuesta

Implementar un **Módulo de Trazabilidad Comercial y Liquidación Automatizada de Comisiones** (`/super-admin/comisiones`), con motor de reglas exacto (bajo Regla Cero con `Decimal.js`) según el compromiso de pago del cliente:

1. **Atribución Comercial del Tenant:**
   - Campos en `TenantSalesAttribution`: `tenant_id`, `sales_rep_id`, `sales_rep_name`, `commission_rate` (default 20.00%), `sold_at` (fecha formal de venta) y `contract_term` (`annual` | `monthly`).
   - Atribución automática por enlace/código de referido comercial durante el registro, o asignación manual por SuperAdmin.

2. **Motor de Reglas de Comisiones (Regla del 20% Anual de Referencia):**
   - La comisión total anualizada de referencia es el **20% del valor total que hubiera cobrado si la venta fuera anual** ($C_{anual} = 0.20 \times \text{ValorVentaAnual}$).
   - **Venta con Contrato y Pago Anual:**
     - El comercial tiene asignado el **20% por única vez sobre el valor neto anual cobrado**.
     - **Regla de Exigibilidad:** La liquidación se vuelve **aplicable/exigible a partir del 2do mes** de haber sido vendida la suscripción (período de retención y verificación superado).
   - **Venta con Contrato y Pago Mensual:**
     - **Mes 1:** Período inicial de onboarding y gracia; no se liquida de inmediato.
     - **Fin del Mes 2 (tras 2do cobro exitoso):** El comercial cobra el proporcional acumulado de los **dos primeros meses**, equivalente a $\frac{2}{12}$ del 20% anual ($\frac{2}{12} \times C_{anual}$).
     - **Mes 3 en adelante (cada mes cobrado con éxito):** Cada mes se devenga y liquida mensualmente $\frac{1}{12}$ del 20% anual ($\frac{1}{12} \times C_{anual}$) hasta completar los 12 meses (totalizando el 20% anualizado de la venta) mientras el tenant continúe activo y al día.
   - **Cancelaciones / Churn:** Si el tenant mensual cancela antes del mes 2, no se liquida comisión; si cancela en el mes 4, se detienen las liquidaciones futuras sin generar saldos negativos retroactivos.

3. **Gestión de Fechas de Pago y Estado de Liquidación en SuperAdmin (`/super-admin/comisiones`):**
   - **Campos de Control Financiero:**
     - `payment_due_date` (Fecha en que se le debe pagar al comercial, ej. día 10 del mes siguiente al devengamiento).
     - `paid_at` (Fecha efectiva en que se transfirió el pago).
     - `status`: `PENDING` (devengada pero aún no vencida) → `DUE` (exigible para pago) → `PAID` (pagada y archivada) → `CANCELLED` (por churn previo al 2do mes).
   - **Acción Operativa "Marcar como Pagado":**
     - Botón interactivo `<button className="... border-emerald-600 text-emerald-600 bg-white"> Marcar como Pagado </button>` con modal selector de fecha de pago, número de comprobante/transferencia y notas, actualizando el estado a `PAID` y registrando el `paid_by_admin_id`.
   - **Libro Mayor y Exportaciones:**
     - Libro mayor de comisiones (`SalesCommissionLedger`) con trazabilidad por factura/webhook cobrado.
     - Exportación de planillas de liquidación en CSV y PDF para contabilidad y nómina comercial.

### Archivos Involucrados (Estimados)

- `migrations/YYYYMMDD-NNN-sales-commissions-tables.sql` (tablas `SalesReps`, `TenantSalesAttribution`, `SalesCommissionLedger`).
- `src/services/salesCommissions.service.ts` (motor de cálculo y devengamiento ante webhooks de pago).
- `src/app/api/super-admin/commissions/route.ts` (API de consulta y liquidación de comisiones).
- `src/app/api/super-admin/commissions/[id]/pay/route.ts` (endpoint para marcar liquidación como pagada).
- `src/app/api/webhooks/paddle/route.ts` (disparo de eventos de devengamiento tras pago exitoso).
- `src/components/super-admin/SalesCommissionsDashboard.tsx` y `CommissionsLedgerTable.tsx`.

### Criterio de Aceptación

1. Cada tenant vendido tiene registrada su fecha de venta (`sold_at`) y el comercial asignado.
2. En ventas anuales, el 20% de comisión queda programado para liquidación a partir del 2do mes de la venta.
3. En ventas mensuales, se liquida $\frac{2}{12}$ del 20% anual tras el segundo mes cobrado, y $\frac{1}{12}$ cada mes subsiguiente mientras el cliente siga activo.
4. El panel de SuperAdmin muestra la fecha programada de pago (`payment_due_date`) y dispone del botón "Marcar como Pagado" con selector de fecha efectiva.

---

## MEJ-15 — Expansión Multi-Tenant por Contrato y Adición de Tenants con Capacidad Heredada por Tier

**Módulo:** Facturación / Multi-Tenant · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (fases 1 y 2)

### Contexto

Actualmente, las cuentas de cliente operan bajo el modelo de un único tenant de Microsoft Entra ID por contrato o suscripción activa de pago. Sin embargo, clientes corporativos y organizaciones medianas frecuentemente gestionan múltiples directorios de Azure / Microsoft Entra ID (por ejemplo, entornos de desarrollo/staging separados, subsidiarias regionales o unidades de negocio independientes) y requieren poder incorporar tenants adicionales bajo un mismo contrato comercial activo mediante un pago previo (add-on o slot adicional), sin tener que duplicar procesos de alta, facturación ni gestión de licencias.

### Propuesta y Fases de Implementación

#### 🟢 Fase 1: Arquitectura Multi-Tenant, Herencia de Tier y Aislamiento de Cuotas (Completada)
1. **Herencia Determinista de Tier y Funcionalidades:**
   - El tenant hijo hereda el plan contratado (`tier`), las políticas de remediación, exportaciones y estado de suscripción del tenant titular (`parent_tenant_id`).
   - Resuelto en base de datos (`migrations/20260825-001-multi-tenant-contracts.sql`) y middleware [`tierLimitsGuard.ts`](file:///Users/manuelchavez/Documents/FinOpsProyect/src/middleware/tierLimitsGuard.ts) mediante `COALESCE(t.tier, p.tier)`.
2. **Aislamiento de Cuotas y Capacidad por Tenant:**
   - Cada tenant vinculado opera con su propia capacidad de suscripciones y usuarios independientes según el Tier contratado (Pro: 2 subs/3 users; Business: 3 subs/5 users; Enterprise: ilimitado).
3. **Alta y Aprovisionamiento en UI / API:**
   - Endpoint [`/api/admin/tenants/contract-tenant`](file:///Users/manuelchavez/Documents/FinOpsProyect/src/app/api/admin/tenants/contract-tenant/route.ts) y modal [`AddContractTenantModal.tsx`](file:///Users/manuelchavez/Documents/FinOpsProyect/src/components/admin/AddContractTenantModal.tsx) en el panel de Cuentas Cloud (`/admin/config?tab=cloud`).

#### ✅ Fase 2 (2026-09-01): capacidad comprable en autoservicio

Implementada con una corrección importante sobre el diseño original de abajo.

**El plan original acumulaba capacidad para siempre.** Proponía, sobre `transaction.completed`:
`additional_tenant_slots = additional_tenant_slots + 1`. Pero los add-ons son mensuales y ese evento
dispara en CADA renovación: el cliente habría sumado un slot por mes. Se implementó al revés —
**se FIJA la capacidad desde la cantidad vigente en los ítems de la suscripción**, sobre
`subscription.created` / `subscription.updated`. Eso resuelve de una sola vez la reentrega de webhooks
(fijar dos veces el mismo número da lo mismo), la baja parcial y la cancelación (el ítem desaparece,
la cantidad queda en 0 y la capacidad vuelve al plan). No hace falta manejar refunds aparte.

- `src/lib/paddleAddons.ts` — mapa price_id → add-on (por entorno) y escritura de capacidad.
- `migrations/20260901-006-purchased-subscription-slots.sql` — `purchased_subscription_slots`. No se
  reusó `max_allowed_subscriptions` porque guarda un tope ABSOLUTO: comprar 2 slots en Professional
  (2+2=4) y luego subir a Business dejaría ese 4 por debajo de lo que ya corresponde. Guardando lo
  comprado aparte, el tope es `incluidas + compradas` y sobrevive a cualquier cambio de tier.
- `src/app/api/billing/addons/capacity/route.ts` — GET de capacidad y POST que hace
  `PATCH /subscriptions/{id}` en Paddle. **No es un checkout**: el overlay abre una compra nueva, y el
  add-on tiene que ser un ítem de la suscripción existente o el webhook nunca lo vería. El PATCH
  reemplaza la lista entera de ítems, así que se leen y se conservan los del plan — mandar sólo el
  add-on borraría la suscripción del cliente (hay un test que lo fija).
- `src/components/admin/panels/CapacityAddonsCard.tsx` — la tarjeta en `/admin/billing`.
- La capacidad la acredita el WEBHOOK, no la ruta: sólo sube cuando Paddle confirma.
- Se eliminó el `canAddDirectly: true` que devolvía la ruta vieja cuando faltaba configuración de
  Paddle: regalaba la capacidad ante un error de entorno. Ahora corta con 503.

**Requiere en Paddle:** dos productos con precio recurrente mensual y cantidad ajustable, sus price IDs
en `PADDLE_ADDITIONAL_TENANT_PRICE_ID` / `PADDLE_ADDITIONAL_SUBSCRIPTION_PRICE_ID`, y los eventos
`subscription.created` y `subscription.updated` habilitados. Sin esos IDs el webhook no toca la
capacidad de nadie — deliberado, para no pisar con ceros lo cargado a mano.

#### Diseño original de la Fase 2 (superado por lo de arriba)
1. **Gating de Slots en Backend ([`contract-tenant/route.ts`](file:///Users/manuelchavez/Documents/FinOpsProyect/src/app/api/admin/tenants/contract-tenant/route.ts)):**
   - Antes de insertar el nuevo tenant hijo, consultar:
     ```sql
     SELECT COUNT(*) AS active_children FROM Tenants WHERE parent_tenant_id = ? AND status = 'active';
     ```
   - Si `active_children >= parent.additional_tenant_slots`, denegar la creación retornando `HTTP 402 Payment Required` con payload `{ requires_slot_purchase: true, available_slots: 0 }`.
2. **Contador de Cupo y Checkout en UI ([`AddContractTenantModal.tsx`](file:///Users/manuelchavez/Documents/FinOpsProyect/src/components/admin/AddContractTenantModal.tsx)):**
   - Mostrar indicador de capacidad de contrato: *"Slots de tenants disponibles: X de Y"*.
   - Si $X = 0$, deshabilitar el formulario y renderizar botón destacado **`Comprar Slot Adicional con Paddle`** que abre el modal/overlay de Paddle Checkout para adquirir el add-on de tenant extra ($150 USD/mes o pase anual).
3. **Procesamiento de Webhook Paddle ([`paddle/route.ts`](file:///Users/manuelchavez/Documents/FinOpsProyect/src/app/api/webhooks/paddle/route.ts)):**
   - Al recibir el webhook `transaction.completed` / `subscription.updated` con el ítem de `additional_tenant_slot`, ejecutar:
     ```sql
     UPDATE Tenants SET additional_tenant_slots = additional_tenant_slots + 1 WHERE tenant_id = ?;
     ```
   - Habilitando al instante el slot en la cuenta del cliente para que pueda registrar su nuevo tenant Entra ID.

### Archivos Involucrados

- `migrations/20260825-001-multi-tenant-contracts.sql` (columnas `parent_tenant_id`, `contract_id`, `additional_tenant_slots` en tabla `Tenants`).
- `src/middleware/tierLimitsGuard.ts` (resolución de herencia con `COALESCE(t.tier, p.tier)`).
- `src/app/api/admin/tenants/contract-tenant/route.ts` (endpoint de creación y validación de slots).
- `src/components/admin/AddContractTenantModal.tsx` (modal de creación y disparador de checkout Paddle).
- `src/app/api/webhooks/paddle/route.ts` (incremento automático de slots ante evento de pago).

### Auditoría (2026-09-01): el índice decía "Hecha" y no lo estaba

El índice figuraba como **Hecha** desde el commit `91554d5` ("docs: mark MEJ-15 as implemented",
2026-08-27), pero el encabezado de esta misma sección siempre dijo *"Fase 1 Hecha / Fase 2 Propuesta"*.
Corregido a **Parcial (Fase 1)**.

**Fase 1: verificada, es real.** Los cuatro archivos existen, las columnas `parent_tenant_id`,
`contract_id` y `additional_tenant_slots` están en la base, y la herencia de tier funciona
(`COALESCE(t.tier, p.tier, 'Professional')` en `tierLimitsGuard.ts:103`).

**Fase 2: ausente, y peor que ausente — quedó a medio construir.** El circuito de cobro está abierto por
los dos extremos:

1. **Nada bloquea el alta gratuita.** `contract-tenant/route.ts:52` hace `SELECT ... additional_tenant_slots`
   y **nunca lo usa** (0 referencias a `parent.additional_tenant_slots`): va del chequeo de duplicados
   directo al INSERT. Un cliente puede sumar tenants hijos sin límite y sin pagar.
2. **Hay un endpoint de cobro que nadie llama.** `src/app/api/billing/addons/tenant/route.ts` —que esta
   entrada ni menciona en su lista de archivos— crea una transacción de Paddle para el add-on de slot.
   Ninguna vista lo invoca. Además, sin `PADDLE_API_KEY` o `PADDLE_ADDITIONAL_TENANT_PRICE_ID` responde
   `canAddDirectly: true`, o sea le dice explícitamente al cliente que siga adelante gratis.
3. **Un pago no acredita nada.** El webhook de Paddle no toca `additional_tenant_slots` en ninguna línea.
   Aunque el cliente pagara, el slot no se acreditaría.

`additional_tenant_slots` **no lo escribe nadie** en todo el repo: sólo aparece en `schema.sql` y en dos
`SELECT` que lo ignoran. Es una columna muerta que aparenta ser un control de cupo.

Nada de esto rompe al cliente —el alta funciona—, pero el add-on de tenant adicional no era cobrable
al momento de la auditoría.

**Cerrado el 2026-09-01** con la Fase 2 de más arriba: `paddleAddons.ts` acredita capacidad desde el
webhook, `billing/addons/capacity/route.ts` la cobra, la UI la ofrece y los cuatro price IDs viajan en
`extra_env_vars` (aplicados a producción el 2026-09-03, revisión `0000151`). Los tres agujeros de esta
auditoría —alta gratuita sin tope, endpoint huérfano, pago que no acredita— quedaron cubiertos.

Queda una verificación **del lado de Paddle**, no del código: los dos productos tienen que tener
**cantidad ajustable** y los eventos `subscription.created` / `subscription.updated` habilitados. Sin
cantidad ajustable, el `PATCH /subscriptions/{id}` con `quantity > 1` es rechazado por Paddle y la compra
falla en el último paso.

### Criterio de Aceptación

1. Los clientes en cualquier Tier pueden adquirir slots mediante Paddle Checkout o asignación comercial Enterprise.
2. Si un tenant no dispone de slots libres (`additional_tenant_slots`), la API y la UI bloquean el registro solicitando la compra del add-on.
3. Al confirmarse el pago por Paddle, el slot se acredita automáticamente y permite registrar el tenant hijo.
4. Cada tenant vinculado hereda el plan del contrato padre con sus propias cuotas aisladas de suscripciones y usuarios.
5. El selector global de tenants permite alternar entre todos los entornos vinculados del contrato de forma transparente.

---

## MEJ-16 — Gestión Avanzada de Compromisos (Reservas y Savings Plans)

**Módulo:** Compromisos / FinOps · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Propuesta

### Contexto

Actualmente, el módulo de compromisos (`/commitments` y `/intelligence/advisor`) muestra las recomendaciones básicas de Azure Advisor o inventarios estáticos. Sin embargo, los líderes de ingeniería y FinOps enfrentan tres problemas críticos al operar compromisos a escala en Azure:
1. No disponen de un simulador determinista de *Breakeven* para evaluar a cuántos meses de utilización una Reserva de 1 o 3 años supera en retorno a la tarifa bajo demanda (PAYG), ni de una sugerencia inteligente de "Mix Óptimo" de cobertura (ej. 60% Savings Plans para cómputo flexible, 30% RIs para bases de datos relacionales estables y 10% PAYG elástico para absorber picos).
2. Microsoft impone un límite estricto de cancelación/devolución de Reservas de **$50,000 USD anuales por Enrollment / Billing Account**. Si una empresa cancela reservas sin control para re-estructurarlas y supera este cupo, Azure bloquea devoluciones adicionales forzando a pagar el compromiso remanente.
3. No existen alertas proactivas a 90, 60 y 30 días del vencimiento de RIs/Savings Plans, lo que provoca que cuando un compromiso expira silenciosamente, las cargas de trabajo pasen de golpe a tarifa PAYG completa generando picos no presupuestados.

### Propuesta

1. **Simulador de Breakeven y Mix Óptimo de Compromisos (`/commitments/simulator`):**
   - Modelado de curvas de retorno de inversión calculando el punto de equilibrio en meses ($T_{breakeven} = \frac{\text{Costo Compromiso}}{\text{Tarifa Horaria PAYG}}$).
   - Recomendación del Mix Óptimo en 3 capas (Savings Plans para flexibilidad regional/SKU, RIs para cargas predecibles de base de datos como SQL/Cosmos/PostgreSQL, y PAYG para buffer elástico).
2. **Monitor de Límite Anual de Reembolso ($50,000 USD):**
   - Tracking del monto acumulado en devoluciones y cancelaciones de Reservas en los últimos 12 meses móviles mediante Azure Consumption / Reservations API.
   - Semáforo y barra de cupo restante (`$50k - devuelto`) con advertencia en caso de superar el 80% del límite anual.
3. **Alertas Escalonadas de Expiración Temprana (90d / 60d / 30d):**
   - Cron de evaluación diaria que cruza `expiryDate` de cada reserva activa, generando eventos en `SystemAlerts` y notificaciones multicanal (Email, Slack, Teams) para renovar a tiempo.

### Modelo de Implementación Detallado

- **Base de Datos y Esquema:**
  - Tabla `CommitmentSimulations` (`id`, `tenant_id`, `workload_type`, `payg_monthly`, `ri_1yr_monthly`, `ri_3yr_monthly`, `sp_monthly`, `breakeven_months_1yr`, `breakeven_months_3yr`, `recommended_mix_json`, `created_at`).
  - Tabla `ReservationExchangeLedger` (`tenant_id`, `reservation_id`, `refunded_amount_usd`, `refund_date`).
- **Backend y APIs:**
  - Endpoint `POST /api/commitments/breakeven`: calcula el cruce temporal de costos según los precios de catálogo obtenidos vía `@azure/arm-reservations` y `ConsumptionManagementClient`.
  - Endpoint `GET /api/commitments/exchange-quota`: consulta el historial de cancelaciones del Billing Account y calcula el cupo remanente de los $50,000 USD anuales.
- **Frontend y Visualización:**
  - Tablero `/commitments/simulator` con gráfico de curvas temporales acumuladas en `Recharts`, sliders interactivos para simular porcentaje de cobertura (0-100%) y desglose de ahorro neto estimado.
  - Indicador de estado del cupo anual de cancelaciones ($50k USD) en la vista principal de Reservas.
- **Caché y Background Jobs:**
  - Clave Redis `commitments:analysis:v1:{tenantId}` (TTL 12h) integrada al cron `prewarm-daily`.

### Archivos Involucrados (Estimados)

- `migrations/YYYYMMDD-NNN-commitments-advanced.sql`
- `src/services/azureCommitmentSimulator.service.ts`
- `src/app/api/commitments/breakeven/route.ts`
- `src/app/api/commitments/exchange-quota/route.ts`
- `src/components/dashboard/CommitmentSimulatorBoard.tsx`

### Criterios de Aceptación

1. El simulador calcula con precisión decimal el mes exacto de breakeven entre PAYG, 1 año y 3 años para cada familia de SKU.
2. El monitor de cupo refleja fielmente el consumo de la cuota anual de $50k USD de cancelaciones de Azure.
3. El sistema dispara alertas automáticas a los 90, 60 y 30 días previos a la expiración de cualquier reserva activa.

---

## MEJ-17 — AKS FinOps Cockpit (Costos por Namespace, Workload y Eficiencia de Contenedores)

**Módulo:** Cómputo / Kubernetes · **Impacto:** Alto · **Esfuerzo:** Alto · **Estado:** Propuesta

### Contexto

Actualmente, las instancias de Azure Kubernetes Service (AKS) aparecen en la factura de Azure y en `CostSnapshots` como un costo agregado opaco a nivel de Node Pools (Virtual Machine Scale Sets). Esto impide que los equipos de ingeniería y FinOps puedan atribuir los costos a microservicios específicos, equipos de desarrollo o namespaces (`showback` / `chargeback`).
Además, la gran mayoría de los clusters presentan un sobredimensionamiento masivo en los *Requests* y *Limits* de CPU/Memoria definidos en los manifiestos de Kubernetes en comparación con el consumo real medido por cAdvisor/Prometheus, generando desperdicio de capacidad en los nodos.

### Propuesta

1. **Desagregación de Costos por Namespace y Workload:**
   - Integración con el Azure Cost Management Kubernetes Add-on / OpenCost API para distribuir el costo real de los nodos de AKS entre Namespaces, Deployments, StatefulSets, DaemonSets y Pods individuales.
   - Atribución de costos compartidos (ej. `kube-system`, ingress controllers) proporcional o equitativamente entre los namespaces de negocio.
2. **Detección de Desperdicio en Contenedores (Requests vs Limits vs Real):**
   - Análisis de la brecha de eficiencia entre `CPU/Mem Request`, `CPU/Mem Limit` y `P95 Actual Usage`.
   - Recomendación determinista de ajuste de recursos en YAML para liberar capacidad en los nodos.
3. **Optimización de Node Pools y Azure Spot:**
   - Identificación de workloads stateless / tolerantes a interrupciones candidatos para correr en *Azure Spot Node Pools* con hasta un 80% de descuento.
   - Detección de subutilización en *User Node Pools* vs *System Node Pools* para consolidación de nodos.

### Modelo de Implementación Detallado

- **Base de Datos y Esquema:**
  - Tabla `AksClusterCostSnapshots` (`id`, `tenant_id`, `cluster_name`, `namespace_name`, `workload_name`, `workload_type`, `cost_usd`, `cpu_request_cores`, `cpu_usage_p95`, `memory_request_gb`, `memory_usage_p95`, `efficiency_score`, `snapshot_date`).
- **Backend y APIs:**
  - Endpoint `GET /api/intelligence/compute/aks/cost-breakdown`: integra con Azure Cost Allocation API para AKS y Azure Monitor Managed Prometheus / Log Analytics ContainerInsights (`Perf | where ObjectName == "K8SContainer"`).
  - Endpoint `GET /api/intelligence/compute/aks/workload-efficiency`: calcula el coeficiente de desperdicio de CPU/Memoria y genera el fragmento YAML recomendado de `resources.requests`.
- **Frontend y Visualización:**
  - Panel `/intelligence/computo/aks` con selector de Cluster y Namespace, Sunburst / Treemap de distribución de costo por Namespace/Pod, y tabla de recomendaciones de Rightsizing de Contenedores con badge Spot Candidate.
- **Caché y Background Jobs:**
  - Clave Redis `aks:efficiency:v1:{tenantId}:{clusterId}` con TTL 6h y soporte `async_poll` en cron de cómputo.

### Archivos Involucrados (Estimados)

- `migrations/YYYYMMDD-NNN-aks-finops.sql`
- `src/services/aksCostAllocation.service.ts`
- `src/app/api/intelligence/compute/aks/cost-breakdown/route.ts`
- `src/app/api/intelligence/compute/aks/workload-efficiency/route.ts`
- `src/components/dashboard/AksFinopsBoard.tsx`

### Criterios de Aceptación

1. El costo total del cluster de AKS se desagrega por Namespace y Deployment sumando exactamente el 100% de la factura de los nodos.
2. Se identifican contenedores con CPU/Memory request sobredimensionados (>50% de holgura vs P95 de uso).
3. Se generan recomendaciones concretas de Node Pools Spot y fragmentos YAML optimizados para despliegue.

---

## MEJ-18 — Cosmos DB & Cargas NoSQL FinOps Cockpit

**Módulo:** Bases de Datos / NoSQL · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Propuesta

### Contexto

Azure Cosmos DB es uno de los servicios de mayor volatilidad financiera en Azure debido a su modelo de facturación basado en Request Units (RU/s). Actualmente, la plataforma cuenta con métricas básicas pero carece de un cockpit de optimización profunda capaz de identificar colecciones con RU/s manuales sobredimensionadas, particiones calientes (*hot partitions*) que disparan consumo ineficiente o bases de datos de tráfico intermitente que deberían migrarse al modo *Serverless*.

### Propuesta

1. **Optimizador de RU/s (Manual vs Autoscale):**
   - Análisis de patrones de consumo de RU/s: si el uso pico es <60% del RU/s manual asignado, se recomienda reducción; si la variabilidad día/noche es >3x, se recomienda migrar a Autoscale con un Max RU/s óptimo.
2. **Detección de Particiones Calientes (*Hot Partitions*):**
   - Cruce de telemetría de Azure Monitor (`PartitionKeyStatistics` / `NormalizedRUConsumption`) para detectar colecciones donde >70% de las solicitudes impactan en una única partición física, generando cargos excesivos de RU/s y throttling HTTP 429.
3. **Matriz de Decisión Serverless vs. Provisioned:**
   - Evaluación del costo mensual proyectado: si una colección consume menos de ~500,000 RUs acumuladas al mes con tráfico esporádico, la matriz recomienda migrar a Cosmos DB Serverless, reduciendo el costo base fijo a $0.

### Modelo de Implementación Detallado

- **Base de Datos y Esquema:**
  - Tabla `CosmosDbFinopsAnalysis` (`id`, `tenant_id`, `account_name`, `database_name`, `container_name`, `mode`, `current_rus`, `recommended_rus`, `recommended_mode`, `is_hot_partition`, `monthly_savings_usd`, `analyzed_at`).
- **Backend y APIs:**
  - Endpoint `GET /api/intelligence/databases/cosmos-optimizer` que interactúa con `@azure/arm-cosmosdb` y Azure Monitor Metrics (`NormalizedRUConsumption`, `TotalRequests`, `DataUsage`).
- **Frontend y Visualización:**
  - Tablero en `/intelligence/bases-de-datos` tab Cosmos DB con tarjetas de diagnóstico, mapa de calor de particiones y calculadora de conversión Serverless.
- **Caché y Cron:**
  - Incorporado al cron `prewarm-databases` (`async_poll = true`) con clave Redis `cosmos:optimizer:v1:{tenantId}`.

### Archivos Involucrados (Estimados)

- `migrations/YYYYMMDD-NNN-cosmos-finops-tables.sql`
- `src/services/cosmosFinopsOptimizer.service.ts`
- `src/app/api/intelligence/databases/cosmos-optimizer/route.ts`
- `src/components/dashboard/CosmosFinopsOptimizerBoard.tsx`

### Criterios de Aceptación

1. Identifica colecciones con sobreaprovisionamiento de RU/s y calcula el ahorro estimado mensual.
2. Alerta particiones desbalanceadas con riesgo de sobrecosto por hot partition.
3. Proporciona recomendación cuantitativa clara entre Provisioned Autoscale y Serverless con ahorro neto proyectado.

---

## MEJ-19 — Mapa de Tráfico de Red, Egress y Fugas de Datos

**Módulo:** Redes / Egress · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Propuesta

### Contexto

Los costos de transferencia de datos en la nube (Egress, transferencias Inter-Availability Zone, tráfico Cross-Region, procesamiento en NAT Gateways y Private Endpoints) suelen ser "costos ocultos" no etiquetables fácilmente que representan entre el 15% y el 35% de la factura de red. Actualmente, la plataforma no dispone de un visualizador topológico de flujos de datos ni de una auditoría especializada en fugas de tráfico inter-zona/región.

### Propuesta

1. **Visualizador Topológico Inter-AZ y Cross-Region:**
   - Gráfico interactivo (Sankey / Network Graph) que mapea el flujo de Gigabytes y costo en USD entre Zonas de Disponibilidad (AZs), Regiones de Azure e Internet.
2. **Auditoría de Procesamiento de Datos en NAT Gateways y Private Endpoints:**
   - Análisis de consumo de `DataProcessed` ($0.045/GB en NAT Gateways y $0.01/GB en Private Endpoints) para detectar cargas que generan tráfico masivo continuo que sería más económico enrutar mediante VNet Peering directo o Service Endpoints.
3. **Análisis de Capacidad en ExpressRoute y VPN Gateways:**
   - Comparación de ancho de banda contratado vs. utilizado P95 en ExpressRoute Circuits y Virtual Network Gateways para detectar conexiones sobredimensionadas.

### Modelo de Implementación Detallado

- **Base de Datos y Esquema:**
  - Tabla `NetworkTrafficCostFlows` (`id`, `tenant_id`, `source_region_az`, `target_region_az`, `traffic_type`, `gigabytes_transferred`, `cost_usd`, `period_start`, `period_end`).
- **Backend y APIs:**
  - Endpoint `GET /api/intelligence/network/traffic-map` y `/api/intelligence/network/egress-audit` consultando FOCUS 1.0 `MeterCategory == 'Virtual Network'` y `MeterSubCategory in ('Data Transfer Out', 'Inter-Availability Zone Data Transfer', 'NAT Gateway Data Processing')` y Azure Network Watcher Flow Logs.
- **Frontend y Visualización:**
  - Panel `/intelligence/redes/trafico-egress` con visualización tipo Sankey Diagram, desglose por servicio emisor y recomendaciones de arquitectura.
- **Caché y Cron:**
  - Clave Redis `network:traffic-map:v1:{tenantId}` (TTL 12h).

### Archivos Involucrados (Estimados)

- `migrations/YYYYMMDD-NNN-network-traffic-tables.sql`
- `src/services/networkTrafficMap.service.ts`
- `src/app/api/intelligence/network/traffic-map/route.ts`
- `src/components/dashboard/NetworkTrafficMapBoard.tsx`

### Criterios de Aceptación

1. El diagrama Sankey representa visualmente los flujos de datos y costos entre AZs y regiones.
2. Detecta cargos anómalos de procesamiento de datos en NAT Gateways y Private Endpoints.
3. Identifica circuitos ExpressRoute / VPN con utilización P95 menor al 15% para downgrade de SKU.

---

## MEJ-20 — Shift-Left FinOps: Integración CI/CD y Gatekeeper de IaC

**Módulo:** Shift-Left / DevOps · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Propuesta

### Contexto

La gran mayoría de los costos innecesarios en Azure se originan en el momento en que los desarrolladores modifican plantillas de Infraestructura como Código (IaC) en Terraform o Bicep sin conocer el impacto financiero del cambio antes del despliegue. Actualmente, la plataforma opera de forma reactiva (detectando el costo una vez provisionado en Azure). Implementar Shift-Left FinOps permite evaluar el impacto en el Pull Request antes de realizar el merge.

### Propuesta

1. **PR Cost Estimator (GitHub Action / Azure DevOps Task / Webhook):**
   - Endpoint en la plataforma (`/api/v1/shift-left/estimate`) que recibe un `terraform plan` (JSON) o plantilla Bicep, calcula el delta de costo mensual proyectado ($\Delta\text{USD/mes}$) consultando el Azure Retail Prices API y comenta automáticamente el desglose en el Pull Request de GitHub/GitLab/Azure DevOps.
2. **Cloud Cost Budget Gates:**
   - Reglas de control presupuestario configurables por repositorio/proyecto: si el PR incrementa el costo en más de un umbral absoluto ($X USD/mes) o porcentual (+Y%), la acción falla con estado `action_required` o requiere aprobación explícita de un FinOps Champion / FinOps Admin.

### Modelo de Implementación Detallado

- **Base de Datos y Esquema:**
  - Tabla `IacCostEstimations` (`id`, `tenant_id`, `repository`, `pr_number`, `author`, `current_monthly_cost_usd`, `projected_monthly_cost_usd`, `delta_cost_usd`, `status`, `created_at`).
- **Backend y APIs:**
  - Endpoint `POST /api/v1/shift-left/estimate` protegido por API Key (`PublicApiKeys`), parser de recursos de Terraform/Bicep y motor de tarificación con Azure Retail Prices API (`src/services/azureRetailPricing.service.ts`).
- **Frontend y Visualización:**
  - Panel `/governance/shift-left` en la web con historial de PRs analizados, impacto acumulado prevenido y configuración de umbrales de Budget Gates.
- **Integraciones:**
  - GitHub Action oficial `finops-pr-cost-action` y Azure DevOps extension.

### Archivos Involucrados (Estimados)

- `migrations/YYYYMMDD-NNN-shift-left-tables.sql`
- `src/services/iacCostEstimator.service.ts`
- `src/app/api/v1/shift-left/estimate/route.ts`
- `src/components/dashboard/ShiftLeftGovernanceBoard.tsx`

### Criterios de Aceptación

1. El endpoint analiza un `terraform plan` y devuelve el delta de costo mensual exacto.
2. Se generan comentarios automatizados en el PR con tabla Markdown detallando el antes, después y delta.
3. Los Budget Gates bloquean el check si el incremento excede el umbral configurado por el tenant.

---

## MEJ-21 — Orquestación de Remediación Inteligente, Conectores ITSM y Generador de Policy-as-Code

**Módulo:** Gobernanza / Automatización · **Impacto:** Alto · **Esfuerzo:** Alto · **Estado:** Propuesta

### Contexto

Una vez detectado un hallazgo de desperdicio (recursos zombies, discos sin asociar, IPs públicas huérfanas, SKUs sobredimensionados), los equipos de operaciones requieren flujos de aprobación y ejecución seguros para mitigar el riesgo operativo:
1. Los avisos no deben quedar atrapados en la plataforma, sino integrarse con las herramientas de colaboración e ITSM empresariales (Microsoft Teams, Slack, Jira y ServiceNow).
2. Las acciones de remediación con un solo clic (*1-Click Remediation*) deben ser seguras e idempotentes, generando snapshots automáticos de discos o respaldos de plantillas ARM antes de ejecutar cualquier cambio destructivo para permitir un rollback inmediato.
3. Los hallazgos recurrentes deben poder transformarse de forma automática en definiciones descargables de *Azure Policy* (Policy-as-Code) para evitar que vuelvan a ocurrir.

### Propuesta

1. **Conectores ITSM y Alertas Empresariales:**
   - Envío automático de hallazgos y resúmenes de optimización mediante Adaptive Cards en Microsoft Teams, Webhooks interactivos en Slack y creación automática de Tickets/Incidencias en Jira Software / ServiceNow.
2. **1-Click Remediation con Rollback Automático:**
   - Ejecución de remediaciones seguras desde la UI: antes de eliminar un disco huérfano o apagar una VM, el motor toma un snapshot del recurso (`Microsoft.Compute/snapshots`) y guarda la definición JSON original en `RemediationRollbackLogs`. Botón de rollback directo disponible por 30 días.
3. **Generador de Azure Policy-as-Code:**
   - Generación instantánea de definiciones ARM / Terraform de *Azure Policy* basadas en las reglas violadas (ej. denegar creación de discos Premium sin tag de retención, prohibir IPs públicas directas en VMs o restringir SKUs permitidos).

### Modelo de Implementación Detallado

- **Base de Datos y Esquema:**
  - Tabla `ItsmIntegrations` (`id`, `tenant_id`, `provider`, `webhook_url`, `credentials_encrypted`, `events_subscribed`).
  - Tabla `RemediationRollbackLogs` (`id`, `action_id`, `resource_id`, `snapshot_id`, `rollback_payload_json`, `expires_at`, `status`).
- **Backend y APIs:**
  - Endpoint `POST /api/remediation/execute-with-backup`: orquesta la toma de snapshot y la acción destructiva con `@azure/arm-resources` y `@azure/arm-compute`.
  - Endpoint `POST /api/remediation/rollback/[id]`: restaura el recurso desde su snapshot y payload original.
  - Endpoint `POST /api/governance/generate-policy`: compila definiciones de Azure Policy en formato ARM JSON y Terraform `.tf`.
- **Frontend y Visualización:**
  - Modal de confirmación con checklist de snapshot previo, panel de integraciones ITSM y visualizador/descargador de Azure Policy en formato JSON/Terraform.

### Archivos Involucrados (Estimados)

- `migrations/YYYYMMDD-NNN-remediation-itsm-tables.sql`
- `src/services/remediationRollback.service.ts`
- `src/services/itsmNotifier.service.ts`
- `src/services/azurePolicyGenerator.service.ts`
- `src/app/api/remediation/rollback/route.ts`
- `src/components/admin/ItsmConfigPanel.tsx`
- `src/components/dashboard/PolicyAsCodeExportModal.tsx`

### Criterios de Aceptación

1. Las alertas de desperdicio se envían formateadas como Adaptive Cards en Teams y tickets en Jira/ServiceNow.
2. Las acciones de remediación crean un snapshot/backup verificable antes de modificar o eliminar el recurso.
3. La plataforma permite revertir (rollback) una remediación ejecutada restaurando el recurso desde su snapshot.
4. Los hallazgos de gobernanza se exportan directamente como código de Azure Policy listo para desplegar.

---

## Mejoras cerradas

_(mover aquí las entradas al completarlas, con el commit que las cierra, para conservar el contexto)_

| ID | Mejora | Cerrada en |
|---|---|---|
| **MEJ-10** ⚠️ | **REABIERTA en la auditoría del 2026-09-01 — ver MEJ-32.** Unificar catálogos de precios y marcar origen del ahorro: `resourceConfig` de `/api/dashboard/summary` y `ZombieResourcesTable` unificados con `baselineForResourceType` en `src/lib/realizedSavings.ts`. Eliminados `config.savings` y `fallbackSavings`. Tipado `savingsSource: 'cost_management' \| 'type_baseline' \| 'none'` en el payload y consumido con tooltip/`(est.)` en UI. | Sesión anterior |
| **MEJ-15** | **Expansión Multi-Tenant por Contrato**: Implementada la herencia de Tier (`parent_tenant_id`), cuotas aisladas por tenant (2 suscripciones/3 usuarios para Pro; 3 suscripciones/5 usuarios para Business; ilimitado para Enterprise), migración SQL `20260825-001-multi-tenant-contracts.sql`, guardia de middleware `tierLimitsGuard.ts` y suite de tests `contractMultiTenant.test.ts`. | Sesión anterior |
| **MEJ-22** | **Cambio de prioridad de tickets por agentes**: `PATCH /api/admin/support/tickets` acepta `priority`; la prioridad se cambia desde el Drawer y la cola global. Commit `c8227b8`. _(Corregido en la auditoría del 2026-09-01: la entrada decía "agentes con rol `support_agent`", pero ese rol no existe en el repo — la ruta autoriza con `requireSuperAdmin`.)_ | 2026-08-27 · commit `c8227b8` |
| **MEJ-23** | **Bug Power Schedules — horarios no aparecen tras guardar**: El endpoint `/api/governance/power-management` tiene caché de 300 s en servidor; `mutate()` devolvía datos viejos. Solución: actualización optimista del SWR en `VmPowerManagementPanel.tsx` inyectando la lista de schedules que devuelve el propio POST/DELETE, sin esperar la revalidación cacheada. | 2026-08-27 · commit `d7a4d63` |
| **MEJ-24** | **Eliminar `.onmicrosoft.com` del modal de correo laboral**: Referencia removida en `messages/es.json`, `en.json` y `pt-BR.json` para evitar confusión durante el onboarding. El modal conserva la restricción de proveedores gratuitos (Gmail, Outlook…). | 2026-08-27 · commit `b3c4544` |

---

## MEJ-22 — Cambio de prioridad de tickets por agentes de soporte

**Módulo:** Soporte / Mesa de ayuda · **Impacto:** Alto · **Esfuerzo:** Bajo · **Estado:** Hecha

### Contexto

Los agentes de soporte sólo podían leer y comentar tickets; cambiar la prioridad requería intervención de un Admin. En colas de alta rotación esto generaba cuellos de botella porque el agente que ve el ticket primero es quien mejor puede evaluar si escalar la prioridad.

### Solución implementada

- `PATCH /api/admin/support/tickets` extendido para aceptar el campo `priority` (`low` / `normal` / `high` / `urgent`) además de los campos de estado ya existentes.
- El guard de roles se relajó para permitir que `support_agent` (no sólo `Admin`/`Owner`) actualice prioridad.
- La cola global de tickets (`SupportQueueTable`) expone un selector de prioridad inline por fila.
- El Drawer de detalle de ticket muestra el mismo selector con persistencia inmediata.

### Archivos involucrados

- `src/app/api/admin/support/tickets/route.ts`
- `src/components/admin/panels/SupportQueueTable.tsx`
- `src/components/admin/drawers/SupportTicketDrawer.tsx`

---

## MEJ-23 — Bug: Horarios programados de VMs no se reflejan en la UI tras guardar

**Módulo:** Power Schedules · **Impacto:** Alto · **Esfuerzo:** Bajo · **Estado:** Hecha

### Contexto

Al programar un horario de apagado/encendido en **Control de Máquinas Virtuales y Horarios de Apagado**, la tabla "Horarios Programados" no mostraba el nuevo registro hasta que el usuario recargaba la página manualmente. El toast de éxito aparecía correctamente, pero la lista no se actualizaba.

### Causa raíz

El hook SWR en `VmPowerManagementPanel.tsx` leía de `/api/governance/power-management`, cuya implementación usa `getWithStaleWhileRevalidate` con TTL de **300 segundos**. Llamar `mutate()` tras el POST disparaba una revalidación que el servidor respondía con la respuesta cacheada anterior — la fila recién guardada en MySQL no aparecía hasta que el caché expiraba.

### Solución implementada

El endpoint `POST /api/power/schedule` ya devolvía `{ success: true, schedules: [...] }` con la lista completa y fresca de la DB. Se modificó `handleSaveSchedule` y `handleDeleteSchedule` para consumir ese payload e inyectarlo directamente en el SWR con `mutate(updater, { revalidate: false })`, evitando por completo la ruta cacheada.

### Nota para el futuro (trampa conocida)

> **No hacer**: confiar en `mutate()` sin argumentos para reflejar mutaciones que pasan por endpoints con `getWithStaleWhileRevalidate` en el servidor. Siempre inyectar el payload de la respuesta de la mutación directamente en el estado SWR.

### Archivos involucrados

- `src/components/governance/VmPowerManagementPanel.tsx`
- `src/app/api/power/schedule/route.ts` (referencia, sin cambios)
- `src/app/api/governance/power-management/route.ts` (referencia, sin cambios)

---

## MEJ-24 — Eliminar referencia a `.onmicrosoft.com` del modal de correo laboral

**Módulo:** Signup / UX · **Impacto:** Bajo · **Esfuerzo:** Bajo · **Estado:** Hecha

### Contexto

El modal "Usá tu correo laboral" (key `corporateEmailNotice.body`) mencionaba explícitamente que no se aceptan "direcciones `.onmicrosoft.com` del directorio de Azure". Esta restricción generaba confusión: algunos usuarios pensaban que el dominio personalizado de su empresa (que también usa Azure AD) podría estar bloqueado. La restricción real es contra proveedores de correo gratuito, no contra dominios corporativos alojados en Azure.

### Solución implementada

Removida la cláusula `ni direcciones .onmicrosoft.com del directorio de Azure` en los tres archivos de mensajes del proyecto (`es.json`, `en.json`, `pt-BR.json`). El texto conserva la restricción de proveedores gratuitos (Gmail, Outlook…), que es la restricción real que se valida en el backend.

### Archivos involucrados

- `messages/es.json`
- `messages/en.json`
- `messages/pt-BR.json`

---

## MEJ-25 — Desvincular (eliminar) una suscripción Azure desde Cuentas Cloud

**Módulo:** Configuración / Cuentas Cloud — Azure · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha · **Prioridad:** Alta

### Contexto

En `Configuración → Cuentas Cloud — Azure → "Suscripciones vinculadas e ingesta de costos"`
(`src/components/admin/panels/CloudAccountsPanel.tsx`, tabla alimentada por
`/api/admin/config/account-status`) la tabla es **de sólo lectura**: muestra nombre, oferta, estado,
recursos, gasto MTD y salud de ingesta, y no ofrece ninguna acción por fila. Hoy un Owner o un
SuperAdmin no tiene forma de sacar una suscripción de la plataforma desde la UI.

Duele en tres casos reales y frecuentes:

- Una suscripción que se dio de baja en Azure sigue apareciendo con su gasto histórico y **consume
  cuota del plan** (`planLimits.currentActiveSubscriptions` vs `maxAllowedSubscriptions`): el tenant
  ve "3 de 3 usadas" y se le ofrece un upgrade que no necesita.
- Suscripciones de prueba o de otro cliente que entraron por descubrimiento automático ensucian los
  totales de todos los cockpits.
- Un cliente que pide dejar de procesar los datos de una suscripción (por contrato o por privacidad)
  hoy sólo se atiende por base de datos.

**El punto clave, y por eso esto no es un DELETE:** la lista de suscripciones **no es una tabla de
vínculos**. Se deriva de lo ingerido — `getSubscriptionRollup` agrupa `CostSnapshots` del mes
(`src/services/tenantAccountStatus.service.ts:33`) — y el descubrimiento vuelve a encontrarlas en cada
sync, porque `getAllSubscriptionsForTenant` (`src/lib/azure.ts:143`) une tres fuentes: la Management
API de Azure, `TenantDelegations` y las `subscription_id` distintas que ya hay en `CostSnapshots`.
Borrar filas sin más hace que la suscripción **reaparezca en el siguiente ciclo de ingesta**.

### Propuesta

Una **exclusión persistente por tenant**, respetada en el único punto por el que ya pasan los 29
llamadores del descubrimiento:

1. **Datos** — migración `TenantExcludedSubscriptions` (`tenant_id`, `subscription_id`,
   `excluded_at`, `excluded_by_user_id`, `reason`, `purge_historical` BOOL), append-only y con
   `UNIQUE(tenant_id, subscription_id)` para que reactivar sea un DELETE de una fila.
2. **Choke point** — filtrar por esa tabla al final de `getAllSubscriptionsForTenant`. Es el lugar
   más barato: todo colector, cockpit y ruta de costos ya pasa por ahí, así que no hay que tocar 29
   archivos. La lista de la UI (`getSubscriptionRollup`) filtra con la misma tabla.
3. **API** — `DELETE /api/admin/config/account-status/subscriptions/[subscriptionId]` con
   `requireTenantRole(['owner'])` + SuperAdmin, entrada en el log de auditoría (quién, cuándo, motivo)
   y `invalidateCache` de las claves del tenant (`cost:mtd:v1:${tenantId}:*`,
   `real-consumption:v1:${tenantId}:*`, `costGroupsCacheKeys`). Un `POST` hermano para revincular.
4. **UI** — acción por fila en la tabla, con modal de confirmación que exija tipear el
   `subscriptionId` (es destructivo y afecta los totales de todo el tenant) y ofrezca la opción
   "conservar el histórico" (default) vs "purgar los datos ingeridos". La cuota del plan se recalcula
   excluyendo las desvinculadas.

### Decisión pendiente

Qué pasa con el histórico. Recomendado: **conservar** por defecto — el gasto de meses cerrados es
información contable y borrarlo cambia retroactivamente reportes ya exportados — y ofrecer la purga
explícita para el caso "esta suscripción nunca debió estar acá". Si se purga, hay que borrar de
`CostSnapshots` y `CostMeterSnapshots` en una sola transacción y dejar constancia en auditoría.

### Archivos involucrados (estimados)

- `migrations/YYYYMMDD-NNN-tenant-excluded-subscriptions.sql`
- `src/lib/azure.ts` (`getAllSubscriptionsForTenant`, `getStoredSubscriptionsForTenant`)
- `src/services/tenantAccountStatus.service.ts` (`getSubscriptionRollup` y el conteo de cuota)
- `src/app/api/admin/config/account-status/subscriptions/[subscriptionId]/route.ts` (nueva)
- `src/components/admin/panels/CloudAccountsPanel.tsx` + claves en `messages/{es,en,pt-BR}.json`

### Criterio de aceptación

1. Un Owner desvincula una suscripción y desaparece de la tabla, de los cockpits y del conteo de
   cuota del plan.
2. El siguiente ciclo de ingesta **no** la vuelve a traer.
3. Un usuario sin rol Owner no ve la acción y el `DELETE` directo le responde 403.
4. La desvinculación queda en el log de auditoría con usuario, fecha y motivo, y es reversible.

### Solución implementada

Exclusión persistente, respetada en el único punto por el que ya pasan los llamadores del
descubrimiento:

- `migrations/20260829-001-tenant-excluded-subscriptions.sql` — tabla `TenantExcludedSubscriptions`
  (`UNIQUE(tenant_id, subscription_id)`, quién y cuándo, motivo opcional).
- `src/lib/azure.ts` — `getExcludedSubscriptionIds()` y filtro al final de
  `getAllSubscriptionsForTenant`. Comparación en minúsculas: los GUID llegan con distinta
  capitalización según la fuente. Si la tabla todavía no existe, no excluye nada.
- `src/services/tenantAccountStatus.service.ts` — el rollup de la tabla de la UI filtra con la misma
  fuente, así que la suscripción desaparece de la lista sin borrar su histórico.
- `src/app/api/admin/config/account-status/subscriptions/[subscriptionId]/route.ts` — `DELETE`
  excluye y `POST` revincula, ambos con `requireTenantRole(['Owner'])` (SuperAdmin incluido por el
  helper), entrada en `AuditTrailLogs` (`UNLINK_SUBSCRIPTION` / `RELINK_SUBSCRIPTION`) e invalidación
  de `cost:mtd:v1:*`, `real-consumption:v1:*` y las claves de cost-groups del tenant.
- `src/components/admin/panels/CloudAccountsPanel.tsx` — acción por fila y modal que exige tipear el
  `subscriptionId`, con textos en `messages/{es,en,pt-BR}.json`.
- `__tests__/unit/excludedSubscriptions.test.ts` — cubre la exclusión case-insensitive, el caso sin
  exclusiones y la tolerancia a la tabla ausente.

**Purga del histórico: no implementada, a propósito.** Se conserva `CostSnapshots`, que era la
recomendación de la decisión pendiente. Si aparece el caso "esta suscripción nunca debió estar acá",
agregar el flag `purge_historical` y el borrado transaccional sobre `CostSnapshots` y
`CostMeterSnapshots`.

**Pendiente y ajeno a esta mejora:** el criterio 1 pedía que la desvinculada dejara de contar en la
cuota del plan. El conteo de `getTenantTierLimitStatus`
(`src/middleware/tierLimitsGuard.ts:134`) hace `COUNT(DISTINCT subscription_id) FROM
TenantSubscriptions`, pero esa tabla es la del **plan SaaS** (una fila por tenant, con los ids de
Paddle) y no tiene esa columna: la consulta falla, cae al fallback —que falla igual— y el conteo
queda en 0 para todos los tenants. Arreglarlo es cambiar la fuente del conteo, no filtrar excluidas;
va como mejora aparte porque toca el gating de cuotas de toda la plataforma.

### Esfuerzo

**Medio — 1 a 2 días.** El grueso es la migración, el filtro en el choke point y el modal con la
invalidación de cachés; lo que puede estirarlo es la purga opcional del histórico (transacción sobre
dos tablas grandes) y el ajuste del conteo de cuota, que hoy sale del rollup.
---

## MEJ-26 — Continuidad del Copilot entre páginas ("Nueva conversación")

**Módulo:** FinOps Copilot / IA · **Impacto:** Medio · **Esfuerzo:** Bajo · **Estado:** Hecha

### Contexto

Al implementar el historial multi-turno (2026-08-29, `src/lib/copilotHistory.ts`) quedó una decisión
consciente a medio camino: el Copilot ahora recuerda la conversación **dentro de una página**, pero
`GlobalCopilot.tsx` sigue borrando el hilo entero al navegar:

```tsx
// Reset chat history when page context changes
React.useEffect(() => { setMessages([]); }, [currentPage, pathname]);
```

No se quitó ese efecto en el mismo cambio porque **el Copilot no tiene botón de limpiar el chat**
(verificado: no hay ningún `setMessages([])` accionable por el usuario). Sin esa salida, quitar el
reset deja el historial creciendo sin techo contra la cuota mensual de IA del tenant, que es
exactamente el costo que este producto mide. El reset por navegación funciona hoy como corte natural
y gratis.

El costo de dejarlo así: una pregunta que cruza dos pantallas ("compará este rightsizing con las
anomalías que vimos recién") pierde todo el contexto al cambiar de vista.

### Propuesta

1. Botón "Nueva conversación" en el header del panel del Copilot (`setMessages([])`), que es lo que
   habilita todo lo demás.
2. Quitar el efecto de reset por `pathname` y dejar que el hilo sobreviva a la navegación.
3. Mostrar en la burbuja del usuario desde qué pantalla se preguntó cada turno, para que el usuario
   entienda por qué una respuesta vieja cita números que ya no están en pantalla.

El backend no necesita cambios: el saneo ya recorta a 8 turnos / 2000 chars por turno, así que el
techo de tokens por mensaje está puesto sin importar cuánto dure la charla.

### Riesgo a cuidar

Sólo el turno nuevo lleva `<context_data>` (decisión de 2026-08-29: repetir el payload en cada turno
viejo multiplica tokens y encima con datos vencidos). Con continuidad entre páginas eso se nota más:
las respuestas viejas citan datos de otra pantalla. El system prompt ya cubre el caso — "si un turno
viejo contradice esas cifras, mandan las actuales" — pero conviene verificarlo con una prueba real
antes de dar la mejora por cerrada.

### Solución implementada

- `src/components/GlobalCopilot.tsx`: se quitó el `useEffect` que hacía `setMessages([])` en cada
  cambio de `pathname`, y se agregó el botón "Nueva conversación" en el header del panel
  (`MessageSquarePlus`), deshabilitado mientras hay un stream en curso — vaciar el array debajo del
  reader dejaría la respuesta escribiendo sobre un mensaje que ya no existe.
- Auto-scroll del hilo en el mismo cambio: la respuesta llega token a token y el panel mide 620px de
  alto por defecto, así que se escribía fuera de la vista. Se sigue el final SOLO si el usuario está
  mirando el final (tolerancia de 80px, medida en `onScroll`): si subió a releer —normal en un
  reporte ejecutivo— arrastrarlo abajo en cada token sería peor que no hacer scroll. Preguntar
  vuelve a activar el seguimiento.
- `messages/{es,en,pt-BR}.json`: clave `Copilot.new_conversation`.

El punto 3 de la propuesta (mostrar en cada burbuja desde qué pantalla se preguntó) NO se
implementó: es la parte especulativa, y conviene decidirla viendo si en el uso real la confusión
aparece.

### Archivos involucrados

- `src/components/GlobalCopilot.tsx` (botón + quitar el `useEffect` de reset)
- `messages/{es,en,pt-BR}.json` (texto del botón)

### Criterio de aceptación

1. El usuario cambia de página y el Copilot conserva la conversación.
2. Hay un botón visible que la limpia.
3. Una repregunta después de navegar resuelve la referencia a lo hablado en la pantalla anterior.

---

## MEJ-27 — Tool-calling: el Copilot consulta los datos en vez de recibirlos

**Módulo:** FinOps Copilot / IA · **Impacto:** Alto · **Esfuerzo:** Alto · **Estado:** Propuesta

### Contexto

Surge de revisar [Azure-Samples/azure-search-openai-demo](https://github.com/Azure-Samples/azure-search-openai-demo)
(2026-08-29, a pedido) buscando qué del patrón RAG de Microsoft aplica a nuestro Copilot. **La mayor
parte no aplica**: todo el pipeline de Azure AI Search, indexación de documentos y multimodal
resuelve un problema que no tenemos (buscar en PDFs). Nuestros datos ya están estructurados en MySQL
y en las APIs de Azure.

Lo que sí aplica es su *agentic retrieval*: el modelo decide qué consultar antes de responder, en vez
de recibir un contexto fijo. Hoy `/api/intelligence/copilot` recibe UN payload —el de la página
activa, compactado por `compactPayloadString`— y nada más. Si la pregunta necesita datos de otra
pantalla, el modelo no tiene cómo obtenerlos: contesta con lo que hay o pide que se le repita.

### Propuesta

Exponer un conjunto ACOTADO de funciones (tool-calling del SDK `ai`) que el modelo pueda invocar
—costos por servicio, recomendaciones de rightsizing, anomalías, presupuesto vs. gasto— resueltas
server-side contra los servicios que ya existen.

### Por qué no se hizo al pasar

Es superficie de ataque nueva, no una feature más: significa que un LLM decide qué se ejecuta con las
credenciales del tenant. Antes de escribir la primera tool hay que definir:

- **RBAC de cada tool.** El Copilot es Professional+, pero los datos que devuelva cada función tienen
  su propio tier y su propio rol (`requireTenantRole`). Una tool no puede saltear el guard que ya
  protege su endpoint equivalente.
- **Sólo lectura, sin excepción.** Ninguna tool puede mutar (nada de remediación, borrado ni cambios
  de configuración disparados por el modelo).
- **`tenantId` fijado server-side**, jamás tomado de un argumento que proponga el modelo — es la
  frontera de aislamiento entre clientes.
- **Tope de invocaciones por mensaje**, o una charla puede disparar N llamadas pesadas a Azure y
  volverse un problema de costo y de throttling (mismo tipo de límite que ya tienen los crons).
- Cómo interactúa con la redacción DLP de `redactForTenant` (IA-5): hoy se redacta un payload; con
  tools hay que redactar cada resultado.

### Archivos involucrados (estimados)

- `src/app/api/intelligence/copilot/route.ts`
- Definición de tools nueva (p. ej. `src/lib/copilotTools.ts`) + los servicios que ya resuelven cada
  dominio.

### Criterio de aceptación

1. Una pregunta que cruza dominios se responde con datos que el Copilot fue a buscar solo.
2. Un usuario sin el rol/tier de un dominio no obtiene esos datos ni siquiera vía Copilot.
3. Ninguna tool escribe.

---

## MEJ-28 — Harness de evaluación de calidad de respuestas del Copilot

**Módulo:** FinOps Copilot / QA · **Impacto:** Medio · **Esfuerzo:** Alto · **Estado:** Propuesta

### Contexto

Del mismo repaso de `azure-search-openai-demo` (2026-08-29): ese proyecto tiene un flujo de
evaluación con ground truth y un modelo juez que califica cada respuesta, para no degradar la calidad
al tocar el prompt o cambiar de modelo.

Nosotros no tenemos nada equivalente, y el system prompt del Copilot ya es una pieza con reglas
finas: tope de ~150 palabras por defecto, ~450 en modo extendido, `EXECUTIVE_REPORT_MODE` con seis
secciones obligatorias, prohibición de inventar cifras, y desde 2026-08-29 las reglas de historial.
Cada vez que se toca cualquiera de esas reglas —o que un tenant cambia de proveedor, porque la ruta
es provider-agnóstica (google/openai/deepseek/azure/anthropic)— la única verificación es probar a
mano y mirar si "se ve bien".

### Propuesta

Set de preguntas fijas con payload de contexto congelado y respuesta esperada, más un evaluador que
califique cada respuesta (respeta el largo, cita cifras del payload, no inventa datos, rechaza lo que
no es FinOps, responde en el idioma pedido).

### Por qué no se hizo al pasar

Es un proyecto en sí, no un test:

- Necesita API keys de un proveedor en CI, con el costo por corrida que eso implica.
- Necesita construir y mantener el ground truth — es la parte cara y la que decide si sirve.
- Hay que decidir qué se hace con un resultado no determinista: un LLM juez no da el mismo puntaje
  siempre, así que el gate tiene que ser un umbral con tolerancia, no una igualdad.

Una alternativa mucho más barata para empezar, si se quiere algo ya: asertar reglas *deterministas*
sobre respuestas grabadas (largo máximo, que toda cifra de la respuesta exista en el payload, que una
pregunta fuera de dominio devuelva el rechazo esperado). No mide "calidad", pero atrapa las
regresiones groseras sin gastar un centavo en tokens ni pedir keys en CI.

### Archivos involucrados (estimados)

- Set de casos + runner (p. ej. `evals/copilot/`), fuera de la suite de `vitest` si consume API real.
- `src/app/api/intelligence/copilot/route.ts` (referencia: el system prompt es lo que se evalúa).

### Criterio de aceptación

1. Una corrida reporta un puntaje por dimensión sobre el set de casos.
2. Un cambio que rompe una regla del prompt (p. ej. respuestas que se van a 1000 palabras) se detecta
   antes de llegar a producción.
---

## MEJ-29 — Costo por recurso × servicio en Consumo Real

**Módulo:** Consumo Real / Costos · **Impacto:** Medio · **Esfuerzo:** Medio · **Estado:** Propuesta

### Contexto

Surge al arreglar (2026-08-30) el bug reportado en `intelligence/consumo-y-presupuesto`: la tarjeta
de un servicio decía "Costo Total MTD: $184.01" y su desglose mostraba un recurso en **$2,760.15**.
Eran dos defectos encadenados:

1. El costo month-to-date del recurso se sumaba una vez por cada fila de costo, y la consulta usa
   `granularity: "Daily"` — quedaba multiplicado por la cantidad de días facturados (15 días ×
   $184.01 = $2,760.15).
2. El filtro que asocia recursos a tarjetas era difuso y metía el MISMO recurso en varias: una
   cuenta de Cognitive Services caía en "Foundry Models" **y** en "Cognitive Services"; una storage
   account en "Storage" **y** en "Azure Blob Storage".

Ambos están corregidos. El segundo se resolvió asignando cada recurso a UNA sola tarjeta (la de mejor
coincidencia), porque **el dato exacto no existe**: `getMtdCostByResourceId` agrupa sólo por
`ResourceId` y devuelve el costo del recurso **sumado sobre todos los servicios**.

### Lo que queda impreciso

Un recurso que gasta genuinamente en dos servicios de Azure (una storage account facturada en
*Storage* y en *Bandwidth*, una VM en *Virtual Machines* y en *Managed Disks*) hoy aparece **completo
bajo una sola tarjeta** en vez de repartido. No contradice ningún total ni cuenta doble —eso ya se
arregló— pero atribuye a un servicio gasto que pertenece a otro.

### Propuesta

Obtener el costo por **(ResourceId × ServiceName)** y usarlo en el desglose, en vez del total por
recurso. Con ese dato cada tarjeta muestra exactamente su porción y un recurso puede figurar en
varias con el monto que le corresponde a cada una.

### El obstáculo real (leer antes de estimar)

La Query API de Cost Management admite **2 dimensiones de agrupación** y la foto compartida
(`fetchSubscriptionCosts` en `diagnosticsShared.ts`) ya usa las dos: `ResourceId` + `ResourceType`.
Agregar `ServiceName` no entra: hace falta una **consulta adicional por suscripción**.

Eso no es gratis. Esa caché compartida existe justamente porque las consultas por pestaña provocaban
429 y dejaban los cockpits en $0.00 (ver el commit `a149afa` y MEJ del cockpit de bases de datos).
Sumar una consulta por suscripción reabre ese riesgo, así que la mejora sólo tiene sentido si:

- la consulta nueva entra en la MISMA foto cacheada (mismo TTL de 10 min, mismo backoff), no como
  llamada suelta por request; y
- se mide el impacto en la cuota de Cost Management con el tenant de más suscripciones.

### Alternativa más barata

Si el costo de la consulta extra no se justifica, dejar el reparto actual pero **marcarlo en la UI**:
una nota al pie del desglose aclarando que un recurso se atribuye a su servicio principal. No arregla
la precisión, pero elimina la sorpresa.

### Archivos involucrados

- `src/app/api/intelligence/databases/diagnosticsShared.ts` (`fetchSubscriptionCosts`, la foto
  cacheada por suscripción — habría que versionar la clave)
- `src/services/realConsumptionService.ts` (`getRealConsumptionOverview`, el mapa
  `bestServiceForResource` que hoy resuelve la ambigüedad)
- `__tests__/unit/realConsumptionResourceCost.test.ts` (ya cubre las invariantes: un recurso no
  aparece dos veces y el desglose no supera el total de su tarjeta)

### Criterio de aceptación

1. Un recurso que gasta en dos servicios aparece en ambas tarjetas, con el monto de cada una.
2. La suma del desglose de cada tarjeta coincide con su total.
3. La cantidad de consultas a Cost Management por ciclo no aumenta respecto de hoy (la nueva viaja
   dentro de la foto compartida).



---

## MEJ-30 — Etiquetas en el pipeline de costos (`CostSnapshots.Tags` / `ResourceId`)

**Módulo:** Costos / Ingesta · **Impacto:** Alto · **Esfuerzo:** Alto · **Estado:** Hecha (pasos 1, 2 y 3)

### Contexto

Surge al arreglar (2026-08-31) el bug reportado: un Cost Group definido por **patrón de RG**
mostraba costos correctos, pero definido por **etiqueta** caía siempre a **$0.00**.

La causa no era el SQL: la columna `CostSnapshots.Tags` **no la escribe nadie**.

- `insertCostSnapshotRow` (`src/modules/storage/db.ts`) no incluye `Tags` ni `ResourceId` en su
  lista de columnas.
- `costExportIngestionService` tampoco: parsea la CSV del export pero sólo toma fecha,
  suscripción, resource group, servicio y costo — descarta las columnas `Tags` y `ResourceId`
  que el export de Azure sí trae.
- La consulta del sync diario (`getYesterdaysDetailedCosts`) agrupa por
  `['ServiceName','ResourceGroupName']` y `['ServiceName','Meter','ResourceLocation']`: nunca pide
  etiquetas.

Verificado en la base local: **20.394 filas, el 100% con `Tags`, `ResourceId` y
`allocation_tag_hash` en NULL.** Con la columna vacía, ningún predicado por etiqueta puede
coincidir. Es el mismo hueco que ya estaba documentado en `src/lib/azureResourceCounts.ts` para
`ResourceId` ("el sync agrega por resource group, así que `COUNT(DISTINCT ResourceId)` da 0 en la
mayoría de tenants").

### Qué se hizo como paliativo

`fetchResourceGroupsByTag` traduce la etiqueta al conjunto de Resource Groups que la portan
(consultando Resource Graph, donde las etiquetas SÍ están), y el costo se matchea por
`resource_group`, que es la dimensión por la que está agregado. El grupo dejó de dar $0.00.

**Su límite, informado en la respuesta con `tagMatchIsApproximate`:** si en un RG hay recursos con
la etiqueta y otros sin ella, se atribuye el RG completo. Es una sobreestimación, no un número
exacto.

### Hecho (2026-08-31): paso 1, vía export FOCUS

`costExportIngestionService` ya lee la CSV del export, así que persistir esas
columnas no suma ni una llamada a Azure. Implementado:

- `Tags` y `ResourceId` se parsean y se guardan. El id se busca bajo los tres
  nombres que usa Azure según el tipo de export: `ResourceId` (FOCUS),
  `InstanceId` e `InstanceName` (legacy).
- `parseExportTags` normaliza los dos formatos que emite Azure: JSON completo
  (`{"env":"prod"}`) y los pares sin llaves de los exports legacy
  (`"env": "prod","owner": "x"`). Devuelve null ante basura, para no hacer que
  MySQL rechace el INSERT entero por una columna JSON inválida y se pierda el
  costo de la fila.
- `ON DUPLICATE KEY UPDATE` usa `COALESCE(VALUES(Tags), Tags)`: una re-ingesta
  desde un export sin esa columna no borra las etiquetas ya guardadas.

**Hallazgo del camino: el parser de CSV estaba roto para cualquier campo con
comas.** Era `line.split(",")`, que alcanzaba mientras sólo se leían fecha,
suscripción, RG, servicio y costo. La columna de etiquetas viene entrecomillada
y CON comas (`"{""env"":""prod"",""owner"":""x""}"`), así que un split plano
producía 7 campos donde había 6, dejaba `""owner"":""ana""}"` en la posición del
costo — `NaN`, que el código convierte en 0 — y la fila se **descartaba en
silencio** por el `if (costDecimal.isZero()) continue`. O sea que cualquier
export con columna de tags antes del costo perdía filas, no sólo etiquetas. Se
reemplazó por `splitCsvLine`, consciente de comillas y del escape `""` (RFC
4180).

### Hecho (2026-09-01): pasos 2 y 3

**Corrección al diagnóstico anterior.** Este documento decía que el paso 2
estaba bloqueado por el límite de 2 agrupaciones de la Query API. El límite es
real, pero NO era el obstáculo principal: el verdadero problema es de **grano**.
`CostSnapshots.allocation_tag_hash` existe desde la migración
`20260728-001` y forma parte de su clave única justamente para admitir filas
particionadas por etiqueta, pero **ningún consumidor lo filtra** (verificado: la
columna no aparece en un solo `WHERE` de `src/`). Poblarlo habría hecho que toda
consulta que suma `CostSnapshots` contara el mismo gasto dos veces, en silencio.

También se corrige otra sospecha del camino: la query B de
`getYesterdaysDetailedCosts` agrupa por 3 dimensiones y parecía estar fallando
en silencio, porque no hay una sola fila con `MeterName` en `CostSnapshots`. No
falla: las filas `meter` y `category` van a `CostMeterSnapshots` y
`CostCategorySnapshots`, sus propias tablas. El sync ya lo dice
(*"Mismo costo, dos desgloses ... a su propia tabla para no duplicar sumas"*).

**Paso 2 — `CostTagSnapshots` (migración `20260901-003`).** El desglose por
etiqueta es un cuarto corte del mismo dinero, así que va a su propia tabla,
siguiendo exactamente la convención que ya usaban meter y category. La consulta
agrupa por `[TagKey, ResourceGroupName]` — 2 dimensiones, dentro del límite;
`ServiceName` se sacrifica porque ese desglose ya lo cubre `CostSnapshots`.

- `getYesterdaysTagCosts` reusa el scope de management group que el sync
  principal ya descubrió (`isMgScopeKnownUnusable`), sin pagar otro probe.
- El conjunto de claves se acota a las que **alguna regla usa de verdad** (las
  de los Cost Groups del tenant, más `CostCenter`), con tope de
  `MAX_TAG_KEYS_PER_RUN = 5`: cada clave es una consulta más por scope y por
  día.
- `hasRecentExportTagData` saltea el fetch entero para los tenants con export
  — criterio de aceptación 3.
- El valor de etiqueta va **hasheado** en la clave única: los valores los
  escribe el cliente y sin cota de longitud harían superar el límite de 3072
  bytes de InnoDB. Verificado con un valor de 500 caracteres.
- La llamada vive en su propio `try` dentro del cron: si falla, el log no dice
  "detailed fetch failed" mandando a leer el lugar equivocado.

**Paso 3 — preferir el dato exacto (`src/lib/costTagCoverage.ts`).** El problema
fino: una fila con `Tags` en NULL es ambigua — puede ser un recurso genuinamente
sin etiquetar o una fila que nunca tuvo la oportunidad de traerlas. La señal que
los separa ya existía sin columna nueva: **sólo el ingestor de exports escribe
`ResourceId`/`Tags`**, el sync deja ambos en NULL. Entonces
`ResourceId IS NOT NULL OR Tags IS NOT NULL` es procedencia.

Se mide sobre el costo y no sobre la cantidad de filas, y el umbral es "no queda
nada sin procedencia" en vez de un porcentaje: cualquier costo sin procedencia
es costo que el predicado exacto no puede ver, o sea una sub-cuenta silenciosa.
Un tenant a mitad de migración cae a aproximado, que es lo correcto.

Con dato exacto, `/api/cost-groups` **se saltea la llamada a Resource Graph**
(una llamada menos a Azure por grupo) y `tagMatchIsApproximate` queda en `false`.
Las tres fuentes quedan ordenadas de exacta a aproximada: `Tags` del export →
`CostTagSnapshots` → resolución por Resource Group. `/api/cost-centers` expone
`tagDataIsExact` para que un `allocationRate` de 0% no se presente como hallazgo
cuando en realidad el dato no llegó.

Verificado contra la base local: los 4 tenants actuales dan `exacto=false` (todo
su costo viene del sync), o sea **el comportamiento no cambia para nadie hoy**;
con filas de export da `true`, incluida una fila con `ResourceId` y sin `Tags`
(recurso genuinamente sin etiquetar); mixto vuelve a `false`. Y un Cost Group
resuelto por `CostTagSnapshots` dio **$75 exactos donde la aproximación por RG
habría atribuido $215**.

### Falta

- **Histórico**: lo ingerido antes de este cambio sigue sin etiquetas. Hay que
  decidir si se re-ingesta desde los exports (si existen) o si el análisis por
  etiqueta arranca desde una fecha.
- **La consulta a Azure del paso 2 no se pudo ejercitar contra un tenant real**
  desde el entorno local: se verificó el armado, el parseo defensivo de columnas
  (`TagValue` / nombre de la clave / descarte) y la persistencia, pero la
  primera corrida en producción hay que mirarla — el log
  `[cron-sync] tenant=… tag costs: claves=[…] filas=N` es el que lo dice.
- **MEJ-29** sigue con su propio obstáculo de agrupaciones; `CostTagSnapshots`
  no lo resuelve (ese pide costo por recurso × servicio, otro grano).
- Cuando las consultas sobre `CostSnapshots` se vuelvan grano-conscientes,
  `CostTagSnapshots` puede colapsarse ahí adentro vía `allocation_tag_hash`.

### Propuesta

Que el costo llegue con etiquetas y con `ResourceId`, para poder agrupar por etiqueta a nivel de
recurso:

1. **Vía export FOCUS (lo más barato y exacto).** El ingestor ya lee la CSV: agregar las columnas
   `Tags` y `ResourceId`/`InstanceId` al parseo y al INSERT. No suma ni una llamada a Azure.
2. **Vía Cost Management (para tenants sin export).** Requiere agrupar por `TagKey`, y ahí está el
   límite conocido: la Query API admite 2 dimensiones de agrupación y las consultas actuales ya las
   usan. Habría que decidir qué se sacrifica o emitir una consulta adicional, con el costo de
   throttling que eso implica (ver MEJ-29, mismo obstáculo).
3. Reescribir el predicado de Cost Groups y de Cost Centers para preferir el dato exacto y dejar la
   resolución vía Resource Graph sólo como respaldo.

### Nota sobre datos históricos

Poblar `Tags` de ahora en adelante no arregla el pasado: los meses ya ingeridos quedan sin
etiquetas. Conviene decidir si se re-ingesta el histórico desde los exports (si existen) o si el
análisis por etiqueta arranca desde una fecha.

### Archivos involucrados

- `src/services/costExportIngestionService.ts` (parseo e INSERT del export)
- `src/modules/storage/db.ts` (`insertCostSnapshotRow`, `insertCostTagSnapshotRow`)
- `src/modules/collectors/azure/billing/yesterdayBillingService.ts` (`getYesterdaysTagCosts`)
- `src/modules/collectors/azure/billing/billingTypes.ts` (`TagCostRow`)
- `migrations/20260901-003-cost-tag-snapshots.sql` (`CostTagSnapshots`)
- `src/services/costTagSync.service.ts` (qué claves pedir y a quién)
- `src/lib/costTagCoverage.ts` (procedencia y decisión de exactitud)
- `src/app/api/cron/sync/route.ts` (`syncTagCosts`)
- `src/app/api/cost-groups/route.ts` y `src/app/api/intelligence/cost-centers/route.ts`
- `src/lib/azureResourceCounts.ts` (`fetchResourceGroupsByTag`, el respaldo)
- `__tests__/unit/costTagCoverage.test.ts` y `__tests__/unit/costTagSync.test.ts` (13 tests)

### Criterio de aceptación

1. Un Cost Group por etiqueta devuelve el costo de los recursos etiquetados, no del RG completo.
2. `tagMatchIsApproximate` deja de venir en `true` para los tenants con datos exactos.
3. La cantidad de consultas a Cost Management por ciclo no aumenta para los tenants con export.

---

## MEJ-31 — Test de storage-history hardcodea meses absolutos contra reloj real

**Módulo:** Storage Efficiency / Tests · **Impacto:** Medio · **Esfuerzo:** Bajo · **Estado:** Hecha

### Contexto

Encontrado al implementar MEJ-06 (2026-09-01): la suite completa dio 1 test fallando,
`__tests__/unit/storageHistory.test.ts > devuelve 13 meses de histórico agrupados por mes`. Se
reprodujo igual en un `main` limpio sin ningún cambio de esta sesión — no es una regresión, es un
fallo latente que ya estaba ahí.

**No es el mismo bug que el de `realConsumption.test.ts` (commit `85cd74e`).** Aquel era una
aserción `toBeGreaterThan` demasiado estricta que fallaba un solo día al año (el último de agosto).
Este es peor: **rompe todos los meses, para siempre**, hasta que se corrija.

La causa: el test no usa `vi.useFakeTimers()` ni mockea la fecha. Mockea la respuesta de
`pool.query` con dos filas fijas —`{month: "2025-08", ...}` y `{month: "2025-09", ...}`— y después
compara contra `body.history.find(h => h.month === "2025-08")`, asumiendo que ese mes SIEMPRE va a
ser el más viejo de la ventana de 13 meses. Pero la ruta
(`src/app/api/intelligence/storage-efficiency/history/route.ts:251-256`) calcula esa ventana con
`new Date()` real:

```ts
const now = new Date();
for (let i = 12; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    // ...
}
```

El código de la ruta está bien —usa día `1` fijo, no `now.getDate()`, así que no tiene el bug
clásico de `setMonth` en fin de mes—. El problema es sólo del test: mientras "hoy" cae dentro de
agosto de 2026, el mes más viejo de la ventana ES "2025-08" y el test pasa. El 2026-09-01 la ventana
rodó a `2025-09..2026-09`, "2025-08" quedó afuera, y `itemAug` da `undefined`. El próximo mes va a
volver a fallar contra `"2025-09"` por el mismo motivo, y así cada mes en adelante.

### Propuesta

Fijar el reloj del test con `vi.useFakeTimers()` + `vi.setSystemTime(new Date("2026-08-15"))` (o
la fecha que sea) antes de armar el fixture, y calcular los meses esperados ("2025-08"/"2025-09")
en relación a esa fecha fija, no como strings sueltos. Restaurar con `vi.useRealTimers()` en
`afterEach`. Con eso el test es determinista sin importar cuándo corra CI.

### Por qué no se corrigió en el mismo commit que MEJ-06

Es un fix de una sola aserción, pero mezclarlo en el commit de MEJ-06 (que no toca nada de storage)
hubiese juntado dos cambios sin relación. Se documentó primero y se corrigió en un commit aparte.

### Solución implementada (2026-09-01)

`beforeEach`/`afterEach` fijan el reloj con `vi.useFakeTimers()` + `vi.setSystemTime(FAKE_NOW)`
(15 de agosto de 2026, lejos de cualquier borde de mes) y lo restauran con `vi.useRealTimers()`. Los
dos meses del fixture (antes `"2025-08"`/`"2025-09"` sueltos) se calculan con `monthKey(FAKE_NOW, N)`,
una función que replica **la misma fórmula que usa la ruta** (`new Date(year, month - i, 1)`), en vez
de escribir el resultado esperado a mano.

Verificado corriendo la suite con `FAKE_NOW` en cinco fechas distintas antes de dar el fix por
bueno: dentro del mismo mes, cruzando un año calendario (dic-2025 → ene-2026 dentro de la ventana de
13 meses) y en el último día de diciembre. Pasa en las cinco.

### Archivos involucrados

- `__tests__/unit/storageHistory.test.ts` (único archivo tocado)

### Criterio de aceptación

1. El test pasa corriendo en cualquier fecha real (verificar con `vi.setSystemTime` en dos meses
   distintos, ej. agosto y diciembre).
2. No se toca `src/app/api/intelligence/storage-efficiency/history/route.ts` — su lógica ya es
   correcta.

---

## MEJ-32 — Tres catálogos de precios duplicados y ya divergidos (MEJ-10 reabierta)

**Módulo:** Transversal / Ahorro · **Impacto:** Alto · **Esfuerzo:** Bajo · **Estado:** Propuesta

### Contexto

Surge de auditar (2026-09-01) las entradas marcadas "Hecha" contra el código, a pedido: el índice había
marcado MEJ-15 como completa sin estarlo y convenía revisar el resto.

MEJ-10 declara *"Eliminados `config.savings` y `fallbackSavings`"* y unificado todo en
`baselineForResourceType`. **`fallbackSavings` sigue existiendo y en uso**, y hay un tercer catálogo cuyo
propio comentario admite ser una copia:

| Catálogo | Ubicación |
|---|---|
| `AZURE_MONTHLY_BASELINE_BY_TYPE` (canónico) | `src/lib/realizedSavings.ts:26` |
| `fallbackSavings` | `src/components/dashboard/InteractiveDashboard.tsx:56`, usado en :173 |
| `SAVINGS_BY_ARM_TYPE` | `src/app/api/intelligence/applied-savings/route.ts:20` |

**Y ya divergieron**, justamente en los dos tipos de zombie más frecuentes:

| Recurso | Canónico | Los otros dos |
|---|---|---|
| `microsoft.compute/disks` | **19.71** (P10 128 GiB Premium SSD @ $0.154/GiB) | **15.00** |
| `microsoft.web/serverfarms` | **54.75** (App Service Plan B1) | **45.00** |

El resto de las entradas todavía coincide (snapshots 5.0, IPs 3.5, elastic pools 250.0, LB 18.0, app
gateways 180.0, NAT 32.0), así que la divergencia es reciente: alguien refinó el canónico —le puso la nota
con el SKU y el precio por GiB— y las copias quedaron con los números redondos viejos.

**Consecuencia:** el mismo disco sin asociar vale $19.71 en una pantalla y $15.00 en otra. Es el bug que
MEJ-10 decía haber eliminado.

### Propuesta

Borrar `fallbackSavings` y `SAVINGS_BY_ARM_TYPE` y hacer que los dos consumidores llamen a
`baselineForResourceType`. `SAVINGS_BY_ARM_TYPE` ya está indexado por slug de ARM type, que es la misma
clave que usa el canónico, así que el reemplazo es directo. `fallbackSavings` está indexado por clave de
audit (`unattachedDisks`), y el canónico ya trae esos alias (`unattacheddisks`, `stalesnapshots`), así que
también entra.

### Criterio de aceptación

1. `grep -rn "fallbackSavings\|SAVINGS_BY_ARM_TYPE" src/` no devuelve definiciones de catálogo.
2. Un disco sin asociar muestra el mismo monto en el Whiteboard, en Recursos Zombies y en Ahorro Aplicado.
3. Cambiar un precio en `realizedSavings.ts` se refleja en las tres vistas.

---

## MEJ-33 — Cerrar el lazo del desvío: dueño, estado persistente y seguimiento

**Módulo:** Anomalías / Gobernanza · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (pasos 1, 2 y 3)

### Contexto

Surge de un comentario público de una analista FinOps (LinkedIn, 2026-09-02), que es
la crítica más precisa que recibió la plataforma hasta ahora:

> "La proyección y las alertas ayudan mucho, pero si no hay una buena asignación y
> alguien responsable de actuar sobre el desvío, el dashboard termina mostrando un
> problema que nadie toma. Detectarlo es una parte, lograr que alguien accione y haga
> seguimiento es otra. ¿El desvío queda asociado automáticamente al equipo u owner
> responsable, o esa asignación depende del modelo de gobernanza de cada cliente?"

Al auditar el código la crítica resultó **literalmente cierta**, y con tres huecos
concretos:

1. **La notificación no tiene destinatario.** `createNotification()` sólo recibe
   `tenantId`, y la tabla `Notifications` no tiene columna de usuario. Un desvío le
   llega a todos, que operativamente es que no le llega a nadie.
2. **El estado no persiste.** `Anomalies` tiene columna `status` y el dashboard tiene
   el control para cambiarla, pero `AnomalyDashboard.tsx:106` sólo hace
   `setLocalAnomalies` — es estado local de React, y no existe endpoint `PATCH`.
   Marcar una anomalía como "en investigación" se ve en pantalla y **se pierde al
   recargar**; nadie más se entera. Es el peor de los tres: aparenta seguimiento.
3. **El vocabulario no coincide.** La base declara
   `enum('New','Investigating','Resolved','False Positive')` y la UI usa
   `'Open' | 'Postponed' | 'Dismissed' | 'Completed'`. Aunque persistiera, no
   encajarían.

### Por qué es factible: la cadena ya existe

Ninguna pieza hay que inventarla; están todas y **desconectadas**:

```
Anomalía → top_contributors[].resource_group   (ya se calcula, getAnomalyTopContributors)
         → CostGroupResourceGroups              (mapea RG → grupo de costo)
         → CostGroups.owner_user_id             (dueño ya modelado)
         → Users.email                          (a quién avisarle)
```

`SupportTickets.assigned_admin_email` ya tiene funcionando el patrón de asignación
más cola de trabajo, así que hay de dónde copiar.

### Propuesta

**Paso 1 — persistir el estado (lo que se implementa primero).** Alinear el
vocabulario, agregar el `PATCH` y guardar quién y cuándo cambió el estado. Sin esto
lo demás no tiene dónde apoyarse, y además hoy la UI miente.

**Paso 2 — asignación derivada de la gobernanza del cliente.** Resolver el dueño por
la cadena de arriba y, en su defecto, por la etiqueta `Owner`. Guardar
`assigned_to` y **por qué vía** se resolvió, para que la asignación sea auditable y
no una caja negra.

**Paso 3 — notificación dirigida.** Dar dimensión de usuario a `Notifications` para
que el desvío le llegue a su dueño, no al tenant entero.

### La decisión de producto que hay detrás

A la pregunta "¿automático o depende del modelo de gobernanza del cliente?", la
respuesta correcta es **las dos, y a propósito**:

- **Automático cuando el cliente definió su gobernanza** (Cost Groups con dueño, o
  etiqueta `Owner` poblada — que es justo lo que audita `/governance/tags`).
- **Explícitamente sin asignar cuando no la definió**, y mostrado como tal
  ("Sin dueño — N desvíos").

La plataforma **no debe inventar un dueño**: sería peor que no asignar, porque
alguien recibiría un desvío que no le corresponde y aprendería a ignorar las
alertas. Pero sí debe hacer visible que no lo hay — un desvío sin dueño es
precisamente el que nadie toma, y ese contador es el mejor argumento para que el
cliente complete su modelo de etiquetas.

### Hecho (2026-09-02): paso 1 — el estado persiste

Apareció un **cuarto hueco** que explica por qué los otros tres pasaron desapercibidos: la ruta
devolvía `id: i + 1` —un índice sintético, no el de la base— y `status: 'Open'` **fijo**. O sea que el
estado guardado ya se descartaba al LEER, y el cliente ni siquiera tenía con qué referenciar la
anomalía. El upsert de `persistAndNotifyAnomalies` sí lo preservaba correctamente (no lo pisa en el
`ON DUPLICATE KEY`); simplemente nunca volvía a la pantalla.

- `persistAndNotifyAnomalies` devuelve el `id` y el `status` REALES, reusando el `SELECT` que ya hacía.
- `PATCH /api/intelligence/anomalies` con `status_changed_by` / `status_changed_at`
  (`20260902-001`). El tenant va **en el `WHERE`**, no sólo en la validación de acceso: sin eso,
  conocer el número de id alcanzaría para editar la anomalía de otro cliente.
- Exige rol `Admin`/`Owner`/`Colaborador`: cambiar el estado es afirmar "me hago cargo", no mirar.
- La UI actualiza optimista y **revierte si el servidor rechaza** — dejar el estado aplicado tras un
  guardado fallido sería volver a mostrar algo que la próxima carga contradice, que es exactamente el
  bug que esto viene a arreglar.
- **Vocabulario unificado** al de la base (`New`, `Investigating`, `Resolved`, `False Positive`). Se
  eligió ése y no el de la UI (`Open`/`Postponed`/`Dismissed`/`Completed`) por dos motivos:
  `Investigating` significa "alguien lo tomó", que es el punto de esta mejora, mientras que
  "Postponed" es lo contrario; y `False Positive` es feedback sobre el Z-Score, algo que un
  "Dismissed" genérico no distingue. Las claves i18n se renombraron para que digan lo que son.

7 tests en `anomalyStatusPatch.test.ts`.

### Hecho (2026-09-02): paso 2 — asignación derivada de la gobernanza

`src/services/anomalyOwnerResolver.ts` resuelve el responsable en orden de MÁS a
MENOS explícito, y el primero que responde gana:

| Orden | Vía | Por qué está en ese lugar |
|---|---|---|
| 1 | `cost_group_membership` | Alguien asignó ese RG a un grupo a mano: es una decisión humana deliberada |
| 2 | `cost_group_pattern` | Regla por patrón de nombre de resource group |
| 3 | `cost_group_tag` | El RG lleva la etiqueta que define al grupo (usa `CostSnapshots.Tags`, que puebla MEJ-30) |
| 4 | `owner_tag` | La etiqueta `Owner` del recurso. No exige que sea usuario de la plataforma: si el cliente etiquetó un correo, ése es su modelo |

Se persiste `assigned_to`, `assigned_via` y `assigned_detail` (`20260902-002`). La
**vía** se guarda porque una asignación que el usuario no puede explicar es una que
va a ignorar.

**Sólo se mira el contribuyente principal.** `top_contributors` viene ordenado por
delta; si el RG que causó el pico no tiene dueño resoluble, el desvío queda sin
asignar aunque el segundo o el tercero sí lo tengan. Atribuirle el pico al dueño de
un contribuyente menor es decirle "tu recurso causó esto" cuando mayormente no fue
así.

**Se recalcula en cada corrida** a propósito: si el cliente asigna el resource group
a un Cost Group DESPUÉS de que saltó el desvío, la anomalía abierta encuentra dueño
sola, sin que nadie la vuelva a crear.

En la UI cada desvío muestra su responsable y la vía, o **"Sin asignar — definí un
dueño en Cost Groups o etiquetá el recurso con Owner"**. Ese texto es la mejora en
sí: no es un hueco visual, es el dato que le dice al cliente qué le falta completar.

Detalle encontrado al implementar: la clave i18n se armaba como
`` `status${anomaly.status}` ``, que con `'False Positive'` producía
`statusFalse Positive` — con espacio. Se reemplazó por un mapa explícito.

10 tests en `anomalyOwnerResolver.test.ts`.

### Hecho (2026-09-03): paso 3 — la notificación tiene destinatario

`Notifications` sólo tenía `tenant_id`: todo aviso le llegaba a TODOS los usuarios
del tenant, que operativamente es que no le llega a nadie. Era la mitad que
faltaba — los pasos 1 y 2 ya resolvían quién es el responsable, pero la
notificación seguía siendo un altoparlante.

`user_email` (`20260903-001`), con **NULL = difusión** a propósito:

- Las filas existentes quedan visibles para todos, sin backfill ni riesgo de
  esconderle a alguien un aviso que ya tenía.
- Un aviso de plataforma (mantenimiento, reporte listo) es legítimamente para
  todos; sólo lo que tiene dueño identificable se dirige.
- **Una anomalía sin dueño resoluble queda como difusión**, no oculta: un desvío
  sin dueño tiene que verlo alguien.

Se guarda el email y no un id de `Users` por el mismo motivo que `assigned_to`:
el dueño puede venir de la etiqueta `Owner` de un recurso y no ser todavía
usuario de la plataforma.

**El lado de lectura es donde estaba el riesgo** — filtrar mal muestra el aviso
de otra persona. El predicado
`(user_email IS NULL OR user_email = ?)` se define **una vez** y lo usan el
conteo y el listado: si divergieran, el badge mostraría un número que no se
corresponde con la lista. Sin identidad cae a sólo difusión, que es la opción
segura: preferimos ocultar un aviso dirigido antes que mostrarle a alguien el de
otro.

También se corrigió el camino legacy (`?sinceId=`) de `/api/notifications`, que
filtraba **sólo por tenant** y por lo tanto habría mostrado los avisos dirigidos
a cualquier otro usuario.

Verificado contra la base con tres avisos (uno de difusión y dos dirigidos):
`ana@x.com` ve el suyo y la difusión, `beto@x.com` ve el suyo y la difusión pero
**no el de Ana**, y sin identidad sólo llega la difusión. 6 tests en
`notificationTargeting.test.ts`, verificados rompiendo el filtro a propósito
(caen 4).

### Criterio de aceptación

1. Cambiar el estado de una anomalía sobrevive a un recargado de página y lo ven los
   demás usuarios del tenant.
2. La base y la UI usan el mismo vocabulario de estados.
3. Queda registrado quién cambió el estado y cuándo.
4. (Paso 2) Un desvío cuyo principal contribuyente cae en un Cost Group con dueño
   aparece asignado a ese dueño, indicando por qué vía se resolvió.
5. (Paso 2) Un desvío sin dueño resoluble se muestra como "Sin asignar", no como
   asignado a nadie en particular ni oculto.
