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
| [MEJ-01](#mej-01--atribución-de-ahorros-hechos-en-azure-vía-activity-log) | Atribuir a un autor los ahorros hechos fuera de la plataforma | Ahorro Capturado | Alto | Medio | Hecha |
| [MEJ-02](#mej-02--animaciones-de-recharts-que-dependen-de-requestanimationframe) | Centralizar el apagado de animaciones de Recharts | Transversal (gráficas) | Medio | Bajo | Parcial |
| [MEJ-03](#mej-03--auditar-las-intercepciones-demo-restantes-de-tenantprovider) | Auditar las intercepciones demo restantes — **las 33 vivas cubiertas**: 27 por comparación en runtime, 6 por typecheck, 2 muertas borradas | Demo / mocks | Alto | Medio | Hecha |
| [MEJ-04](#mej-04--persistir-el-desperdicio-detectado-como-métrica-propia) | Persistir el desperdicio detectado como métrica propia | Ahorro Capturado | Medio | Bajo | Hecha |
| [MEJ-05](#mej-05--atribuir-el-costo-de-recursos-hijos-a-su-recurso-padre) | Atribuir costo de recursos hijos al padre | Recursos | Medio | Medio | Hecha |
| [MEJ-06](#mej-06--prosa-generada-por-ia-sobre-el-motor-determinista-de-remediación) | Prosa de IA sobre el motor determinista de remediación | Azure Advisor | Bajo | Bajo | Hecha |
| [MEJ-07](#mej-07--migrar-las-posposiciones-históricas-a-la-dedupkey-estable) | Migrar posposiciones históricas a `dedupKey` | Azure Advisor | Bajo | Bajo | Propuesta |
| [MEJ-08](#mej-08--ponderación-configurable-entre-telemetría-y-autoevaluación) | Ponderación telemetría vs autoevaluación configurable | Madurez FinOps | Bajo | Bajo | Hecha |
| [MEJ-09](#mej-09--deuda-de-linting) | Deuda de linting (documento propio) | Transversal | Medio | Alto | En curso |
| [MEJ-11](#mej-11--módulo-de-comunicaciones-globales-a-usuarios-popups-banners-y-alertas) | Módulo de comunicaciones globales a usuarios (popups, banners y alertas) | SuperAdmin / Transversal | Alto | Medio | Hecha |
| [MEJ-12](#mej-12--trazabilidad-de-ciclo-de-vida-de-tenants-fechas-de-activación-suspensión-y-bajas) | Trazabilidad de ciclo de vida de tenants (fechas de activación y bajas) | SuperAdmin / Gobernanza | Alto | Bajo | Hecha |
| [MEJ-13](#mej-13--marketplace-de-add-ons-y-capacidades-a-la-carta-para-tiers-professional-y-business) | Marketplace de add-ons y features a la carta (Professional y Business) | Facturación / Marketplace | Alto | Medio | Hecha |
| [MEJ-14](#mej-14--trazabilidad-de-ventas-por-comercial-y-cálculo-automatizado-de-comisiones) | Trazabilidad de ventas por comercial y cálculo de comisiones (20%) | SuperAdmin / Comercial | Alto | Medio | Hecha |
| [MEJ-15](#mej-15--expansión-multi-tenant-por-contrato-y-adición-de-tenants-con-capacidad-heredada-por-tier) | Expansión multi-tenant por contrato y adición de tenants con capacidad heredada por tier | Facturación / Multi-Tenant | Alto | Medio | Hecha |
| [MEJ-16](#mej-16--gestión-avanzada-de-compromisos-reservas-y-savings-plans) | Gestión avanzada de compromisos (Reservas y Savings Plans) con simulador de Breakeven, Mix Óptimo, límite de devolución $50k USD y alertas de expiración | Compromisos / FinOps | Alto | Medio | Hecha |
| [MEJ-17](#mej-17--aks-finops-cockpit-costos-por-namespace-workload-y-eficiencia-de-contenedores) | AKS FinOps Cockpit (Costos por Namespace, Workload y Eficiencia de Contenedores con OpenCost/Add-on) | Cómputo / Kubernetes | Alto | Alto | Propuesta |
| [MEJ-18](#mej-18--cosmos-db--cargas-nosql-finops-cockpit) | Cosmos DB & Cargas NoSQL FinOps Cockpit — los tres criterios de aceptación cumplidos; sin verificar contra una cuenta real porque no hay ninguna | Bases de Datos / NoSQL | Alto | Medio | Hecha |
| [MEJ-19](#mej-19--mapa-de-tráfico-de-red-egress-y-fugas-de-datos) | Mapa de tráfico de red, egress y fugas de datos — piloto de flujos existentes, falta validar telemetría real antes del Sankey | Redes / Egress | Alto | Medio | Parcial |
| [MEJ-20](#mej-20--shift-left-finops-integración-cicd-y-gatekeeper-de-iac) | Shift-Left FinOps: Integración CI/CD y Gatekeeper de IaC (PR Cost Estimator y Budget Gates) | Shift-Left / DevOps | Alto | Medio | Hecha |
| [MEJ-21](#mej-21--orquestación-de-remediación-inteligente-conectores-itsm-y-generador-de-policy-as-code) | Orquestación de remediación con Rollback, conectores ITSM (Teams, Slack, Jira, ServiceNow) y generador de Azure Policy | Gobernanza / Automatización | Alto | Alto | Propuesta |
| [MEJ-22](#mej-22--cambio-de-prioridad-de-tickets-por-agentes-de-soporte) | Cambio de prioridad de tickets por agentes desde la cola global y el Drawer | Soporte / Mesa de ayuda | Alto | Bajo | Hecha |
| [MEJ-23](#mej-23--bug-horarios-programados-de-vms-no-se-reflejan-en-la-ui-tras-guardar) | Bug: Horarios programados de VMs no se reflejan en la UI tras guardar | Power Schedules | Alto | Bajo | Hecha |
| [MEJ-24](#mej-24--eliminar-referencia-a-onmicrosoftcom-del-modal-de-correo-laboral) | Eliminar referencia a `.onmicrosoft.com` del modal de correo laboral | Signup / UX | Bajo | Bajo | Hecha |
| [MEJ-25](#mej-25--desvincular-eliminar-una-suscripción-azure-desde-cuentas-cloud) | Desvincular (eliminar) una suscripción Azure desde Cuentas Cloud | Configuración / Cuentas Cloud | Alto | Medio | Hecha |
| [MEJ-26](#mej-26--continuidad-del-copilot-entre-páginas-nueva-conversación) | Continuidad del Copilot entre páginas + botón "Nueva conversación" | FinOps Copilot / IA | Medio | Bajo | Hecha |
| [MEJ-27](#mej-27--tool-calling-el-copilot-consulta-los-datos-en-vez-de-recibirlos) | Tool-calling: el Copilot consulta los datos en vez de recibirlos | FinOps Copilot / IA | Alto | Alto | Propuesta |
| [MEJ-28](#mej-28--harness-de-evaluación-de-calidad-de-respuestas-del-copilot) | Harness de evaluación de calidad de respuestas del Copilot | FinOps Copilot / QA | Medio | Alto | Propuesta |
| [MEJ-29](#mej-29--costo-por-recurso--servicio-en-consumo-real) | Costo por recurso × servicio en Consumo Real | Consumo Real / Costos | Medio | Medio | Hecha |
| [MEJ-30](#mej-30--etiquetas-en-el-pipeline-de-costos-costsnapshotstags--resourceid) | Etiquetas en el pipeline de costos (`CostSnapshots.Tags` / `ResourceId`) | Costos / Ingesta | Alto | Alto | Hecha |
| [MEJ-32](#mej-32--tres-catálogos-de-precios-duplicados-y-ya-divergidos-mej-10-reabierta) | Tres catálogos de precios duplicados y ya divergidos (MEJ-10 reabierta) | Transversal / Ahorro | Alto | Bajo | Hecha |
| [MEJ-33](#mej-33--cerrar-el-lazo-del-desvío-dueño-estado-persistente-y-seguimiento) | Cerrar el lazo del desvío: dueño, estado persistente y seguimiento | Anomalías / Gobernanza | Alto | Medio | Hecha |
| [MEJ-31](#mej-31--test-de-storage-history-hardcodea-meses-absolutos-contra-reloj-real) | Test de storage-history hardcodea meses absolutos contra reloj real (rompe todos los meses) | Storage Efficiency / Tests | Medio | Bajo | Hecha |
| [MEJ-34](#mej-34--perspectives-agrupación-multidimensional-del-gasto) | Perspectives: agrupación multidimensional del gasto — cinco criterios + selector transversal; ocho superficies adoptadas (FOCUS, Cost Groups y su detalle, Centros de Costo y sus recursos, Gastos y Proyección, pizarra ejecutiva, Almacenamiento y el simulador What-If); `ai-analytics` bloqueado por la ingesta | Asignación / Transversal | Alto | Alto | Parcial |
| [MEJ-35](#mej-35--suscripciones-a-reportes-cualquier-reporte-a-la-cadencia-que-elija-el-usuario) | Suscripciones a reportes, a la cadencia que elija el usuario, con link + gráfico + CSV — un solo cron evaluador; el gráfico va en HTML y no como imagen, con motivo | Reportes | Alto | Medio | Hecha |
| [MEJ-36](#mej-36--presupuestos-rollover-y-año-fiscal-no-calendario) | Presupuestos: rollover con tope y año fiscal no calendario — el ejercicio estaba cableado a enero en cuatro lugares y corría todos los acumulados anuales sin decirlo | Presupuestos | Medio | Bajo | Hecha |
| [MEJ-37](#mej-37--leaderboard-de-equipos-y-margen-bruto) | Leaderboard de equipos (ordenado por mejora, no por gasto), split COGS/OpEx **y margen bruto** — la fase 2 resultó estar casi entera: la ingesta por API Key ya existía y sólo faltaba el tipo REVENUE | Integración con el negocio | Medio | Bajo | Hecha |
| [MEJ-38](#mej-38--views-vistas-guardadas-y-con-alcance-por-equipo) | Views: el alcance por equipo aplicado en el SERVIDOR — permiso (default-deny, mapa por (ruta, método), un usuario con alcance no puede ser Admin/Owner) **y** `SavedViews`; la auditoría de la superficie encontró y cerró dos fugas por coincidencia de prefijo | Transversal / RBAC | Alto | Medio | Hecha |
| [MEJ-39](#mej-39--fin-de-soporte-eoleos-de-la-plataforma-azure) | Fin de soporte (EOL/EOS) con el costo de lo afectado — **fase 1 hecha**: catálogo curado de AKS + PostgreSQL + MySQL Flexible, semáforo y costo mensual; fase 2 (licencias en la nube) sin empezar | Gobernanza / Riesgo | Alto | Medio | Parcial |
| [MEJ-40](#mej-40--esr-y-riesgo-de-la-cartera-de-compromisos) | Concentración de vencimientos + ESR; se desbloqueó poblando `ListCost` de verdad | Compromisos | Alto | Medio | Hecha |
| [MEJ-41](#mej-41--whiteboard-selector-de-rango-temporal-30d90d-y-persistencia-en-base-de-datos) | Whiteboard: selector temporal (30D/90D) y persistencia/consulta de costos históricos en BD | Whiteboard / Resumen Ejecutivo | Alto | Medio | Hecha |
| [MEJ-42](#mej-42--capacidades-de-ia-fase-1-hecha-y-lo-encontrado-de-paso) | Capacidades de IA (propuesta 2026-10-07): fase 1, Managed Identity, soporte, Document Intelligence y fase 2 (tags) hechos y los cinco huecos de paso corregidos; quedan el rollout de Managed Identity, el aviso legal, prender soporte y Document Intelligence, lo que quedó afuera de la fase 2 y siete huecos nuevos | IA | Alto | Alto | En curso |

---

## MEJ-01 — Atribución de ahorros hechos en Azure vía Activity Log

**Módulo:** Ahorro Capturado · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (2026-09)

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
| `/api/intelligence/commitments` | "no se detectaron reservas activas" | objeto a mano en el interceptor, sin `reservationDetails`, `activeReservations`, `exchangeQuota` ni `breakevenSummary` (séptima, encontrada el 2026-09-23 al verificar MEJ-40) |

La séptima se corrigió con el mismo patrón: el interceptor pasó a devolver
`getMockDataForRoute('commitments', ...)` y las 14 recomendaciones escaladas por tier, que vivían
sueltas en `TenantProvider`, se mudaron a `mockData.ts`. Una sola fuente.

### Barrido completo de las 36 intercepciones (2026-09-24)

Se dejó de buscar de a una. Se extrajeron del código las **36 intercepciones que sirven
`getMockDataForRoute`** y se invocó el handler real de cada una con el tenant demo. **23 responden
200 bajo el arnés y se comparan**; 12 no lo alcanzan (400/401/403/500 por parámetros o mocks que
el arnés no arma) y quedan **listadas por nombre y motivo**, no olvidadas.

Aparecieron tres divergencias más — la octava, novena y décima:

| Ruta | Qué mostraba la demo | Causa |
|---|---|---|
| `/api/intelligence/cost-by-category` | gráfico de 6 meses y oportunidades **en blanco** | la copia traía los dos arrays vacíos; el generador de la ruta los trae completos |
| `/api/intelligence/chargeback` | total en **NaN** y etiquetas vacías | el mock servía `{department, cost}` y la página lee `.name` / `.value` |
| `/api/admin/billing-markup` | nada visible | faltaba `cspDetected`, que la ruta agrega encima del mock |

`cost-by-category` se resolvió como los siete anteriores: la ruta sirve su propio mock antes del
auth y la intercepción se borró junto con su `case` huérfano (79 líneas menos). Al hacerlo se vio
un cuarto defecto que la copia tapaba: las oportunidades del generador estaban escritas a mano y
**sin `params`**, y la clave `cc_rec_db_reservations_and_scale` pide `{topService}` — next-intl
tiraba `FORMATTING_ERROR` y esa recomendación no se leía. Ahora se construyen con
`getCategoryRemediationRule`, el mismo helper del camino real.

**Lo que impide la recaída**, que era la parte 2 de esta mejora: `formaMockInterceptor.test.ts` ya
no compara contra una lista escrita a mano. Lee `TenantProvider.tsx` y exige que **toda**
intercepción que sirva `getMockDataForRoute` esté verificada o listada con su motivo. Agregar una
nueva sin mirarla —que es exactamente como nacieron las diez divergencias— rompe el test.
Comprobado con dos mutantes: una intercepción nueva sin listar, y quitarle `detailed` al mock de
chargeback.

**Límite conocido del barrido:** compara claves, así que un array vacío en la respuesta de la ruta
no aporta las claves de sus elementos. Por eso `chargeback` apareció como "le falta `detailed`"
cuando además tenía mal `data[].name`/`data[].value`: con el arnés sin datos, `data` volvía vacío.

### Las 12 sin cobertura, una por una (2026-09-24)

Se diagnosticaron invocando cada handler y leyendo el cuerpo de la respuesta. **Cuatro eran del
arnés y se cerraron**; las otras ocho no lo son.

Lo que le faltaba al arnés, y ahora tiene: `initializeDatabase` en el mock de `db` (cinco rutas
morían ahí), `requireRequestIdentity` en el de `requestAuth`, un mock de `@/lib/cache` —sin él se
intentaba abrir Redis de verdad y varias rutas caían a su rama degradada—, la cabecera
`Authorization` y `x-tenant-id`, y sobre todo **el id real del tenant de demo Enterprise en vez del
literal `"demo"`**: varias rutas resuelven el tier buscando ese id, y con `"demo"` caían a
Professional y cortaban con 403 antes de llegar a su rama mock. Con eso entraron
`governance-policies`, `allocation-rules`, `network` y `tenant-health`. **Cobertura: 27 de 35.**

**Las ocho que quedan comparten una causa, y es del producto:** la ruta **no tiene rama
`isMockTenant`**, así que con un tenant de demo nunca produce un payload propio. En la demo el mock
del interceptor es la única fuente y **no hay contra qué compararlo**. Tres piden credenciales de
Azure antes de cualquier rama de demo (`budgets/burn` —que sí importa `isMockTenant`, pero recién
en la línea 94 y sólo para decidir si persiste—, `rates`, `rightsizing`); cuatro responden 200 con
el payload vacío de una base sin filas (`audit/full`, `audit/ttl`, `remediation/workflow`,
`billing/portal`). Cerrarlas de verdad es darle a cada ruta su rama mock y borrar la intercepción
—lo que se hizo con `billing`, `aks-chargeback` y `cost-by-category`—: es trabajo por ruta, no un
arreglo del test. La octava, `dashboard/summary`, sí es límite del arnés: agrega varias
sub-llamadas y bajo el arnés alguna falla siempre, así que responde degradada.

### Las 8 sin cobertura, revisadas a mano (2026-09-25)

El barrido automático no las alcanza, así que se compararon **leyendo la ruta contra el mock**, una
por una. La conclusión más útil es que **no todas eran el mismo problema**, y dos ni siquiera eran
un problema:

**Dos intercepciones estaban MUERTAS y se borraron.** `/api/audit/ttl` no la llama nadie —el panel
de TTL pega a `/api/cleanup/ttl`, que es otra ruta— y `/api/billing/portal` tampoco tiene ningún
componente que la invoque. La de `ttl` además servía un mock con forma
`auditResults.{expiringSoon,expired,missingTags}` mientras la ruta devuelve `{expiredResources}`:
una divergencia total que **nadie vio nunca porque no había a quién mostrársela**. Se fueron las dos
intercepciones y sus dos `case` huérfanos de `mockData.ts` (27 líneas).

**`budgets/burn` se ató por typecheck**, que es la única red posible cuando el handler no se puede
invocar. Se declaró `BudgetBurnResponse` en `budgetTypes.ts`, se anotó la ruta con él y el mock
lleva `satisfies MockContracts['budgets_burn']`. Comprobado con un mutante: agregar un campo al
contrato rompe el mock en compilación.

Eso destapó dos cosas. Una, que **el mock no traía las cinco proyecciones** que la ruta agrega a
cada fila de `burnData` —hoy no se nota porque el gráfico sólo lee `costCenter`/`budget`/`actual`,
pero la rama de respaldo de `BudgetCard` lee `item.forecastedBreachDate` de ahí—. La otra, **un
error mío**: escribí el tipo de `subBudgets` con el `BudgetProjection` completo y el typecheck lo
rechazó, porque la ruta elige cinco de sus siete campos y usa `budget`/`actual` en lugar de
`assignedAmount`/`currentSpend`. El tipo describe lo que la ruta devuelve, no lo que uno supondría.

**Las cinco restantes, atadas por typecheck (2026-09-25)**, con el mismo método que
`budgets/burn`. Cuatro cerradas y una abierta:

| Ruta | Qué destapó el typecheck |
|---|---|
| `intelligence/rates` | nada: `recommendations` y `reservations` ya coincidían |
| `remediation/workflow` | al mock le faltaba **`tenant_id`**; la ruta hace `SELECT *`, así que el contrato es la tabla |
| `intelligence/rightsizing` | al mock le faltaban los **cuatro campos de exención** que la ruta agrega a TODAS las filas, y `/intelligence/rightsizing` **filtra por `isExempted`**: en la demo el filtro "eximidas" no devolvía nunca nada. También tenía una clave `subscriptions` que la ruta no manda y nadie lee |
| `audit/full` | nada de contrato (ya tenía `AuditPayload`) |
| `dashboard/summary` | al mock le faltaban **ocho** campos; ninguno lo lee hoy ningún consumidor, y tenía un `complianceScore` que **la ruta no devuelve** |

De `remediation/workflow` salió además un arreglo de UI: `requested_at` es `timestamp NULL` en la
base y la página móvil de aprobaciones lo tipaba como `string`, así que un valor vacío habría dado
`new Date(null)` → 1970, una fecha falsa en vez de admitir que no la tiene.

**Un hallazgo que NO es divergencia de contrato:** `audit/full` corre **63 chequeos** del catálogo
KQL y el mock de la demo trae **8**. Los 55 restantes salen vacíos. No está "roto" —un tenant sano
también los tendría vacíos— pero al prospecto le muestra 8 tipos de desperdicio detectados cuando el
producto detecta 63. Es una decisión de contenido de la demo, no un bug, y queda anotada acá para
que se tome a propósito.

**`dashboard/summary`, la última, cerrada leyendo campo por campo** el objeto que arma la factory
del caché — 706 líneas de ruta, 241 de mock, `{success, ...data, fromCache}` con `data` construido
en varias etapas. Al mock le faltaban ocho campos: `costSource`, `detectedWasteUSD`,
`zombieMonthlyWasteUSD`, `environmentalImpactSource`, `degraded`, `degradedReason`,
`auditNoPermissions` y `azureNoAccess`. **Ninguno lo lee hoy ningún consumidor de esa ruta** —se
verificó uno por uno sobre los cuatro—, así que no había nada roto; lo que había era el riesgo de
que el día que la UI lea alguno, la demo lo muestre vacío sin que nada falle.

Y al revés: el mock traía un `complianceScore` que **la ruta viva no devuelve**, con un comentario
que decía "el frontend lo prefiere cuando viene presente (ver page.tsx)". El comentario quedó viejo:
el único que lee un `complianceScore` es `TagManager`, y lo saca de `/api/tags/compliance`, que es
otra ruta. Se borró.

**Con esto MEJ-03 queda cerrada**: las 33 intercepciones vivas están cubiertas —27 por la
comparación en runtime contra el handler real, 6 por typecheck— y `SIN_COBERTURA` quedó vacía. Se
deja la lista igual, para la próxima que el arnés no alcance y tampoco se pueda atar.

**Y una corrección al análisis anterior:** dar a estas rutas una rama `isMockTenant` y borrar la
intercepción, que es lo que hizo falta en las diez primeras, **acá no arreglaría nada**. En esas
diez había DOS copias del mock —la del generador de la ruta y la del interceptor— y el arreglo
colapsaba las dos en una. En estas cinco hay **una sola copia**, así que no hay divergencia entre
copias que eliminar; lo único que se lograría es ampliar la superficie que responde sin token, justo
lo que SEC-02 pidió no ampliar. El riesgo acá es otro: que la copia única se atrase respecto del
contrato vivo, y eso lo ataja el typecheck, no una rama nueva.

**Un chequeo nuevo que hacía falta:** un 200 degradado engaña igual que un 500. `{error}` o
`{degraded:true}` traen pocas claves, la comparación pasa sola y la ruta queda contada como
verificada sin haber devuelto su contrato. Ahora el test rechaza esos cuerpos — y lo primero que
hizo fue sacar a `dashboard/summary` de la lista de cubiertas, donde yo la había puesto.

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

### Las 4 que podían divergir, medidas (2026-09-22)

El handoff del 09-22 dejó anotadas cuatro intercepciones cuyo mock podía diferir
de lo que sirve la ruta: `billing`, `anomalies`, `ai-analytics` y
`aks-chargeback`. Se compararon **invocando el handler real** con el tenant demo,
que es lo único que responde por el contrato de verdad —tres de las cuatro arman
el payload sobre la marcha y no hay constante que mirar—. Resultado:

| Ruta | Diverge | Qué pasaba |
|---|---|---|
| `anomalies` | No | — |
| `aks-chargeback` | No | — |
| `ai-analytics` | **Sí, corregida** | Faltaban `summary.totalRequests`, `avgTokensPerRequest`, `avgInputPerRequest` y `avgOutputPerRequest`: las cuatro las lee `AIAnalyticsDashboard` y en la demo salían vacías. |
| `billing` | **Sí, abierta** | Ver abajo. |

La regla quedó fijada en `__tests__/unit/formaMockInterceptor.test.ts`: toda clave
que la ruta devuelve tiene que existir en el mock del interceptor. Se validó con
mutante (quitar una clave del mock lo pone en rojo nombrándola).

**`billing` sigue abierta y es una decisión, no una limpieza.** La ruta devuelve
el contrato nuevo (`services`, `top5ShareOfWallet`, `byRegion`, `overview`,
`period`…) que leen `RealConsumptionDashboard` y `BillingDashboard`; el
interceptor todavía sirve el viejo (`data[]`), así que **en la demo esa pantalla
está vacía**. Las dos salidas:

- **(a)** Servir el mock ANTES del auth en `/api/intelligence/billing` —como ya
  hace `aks-chargeback`— y sacar la intercepción. Una sola fuente y diff
  negativo, pero amplía lo que se responde sin token, que es justo lo que SEC-02
  de la auditoría 2026-09-21 dejó anotado para no ampliar.
- **(b)** Mover `getMockRealConsumptionOverview` (~400 líneas) a un módulo
  importable desde el cliente y usarlo en los dos lados. No amplía nada, pero es
  un archivo nuevo y un diff grande.

### Medición (2026-09-13): "redundante" no alcanza — y no hay ninguna sacable hoy

Se automatizó el criterio y **el resultado contradice la premisa de arriba**. Para poder sacar una
intercepción hacen falta DOS condiciones, no una:

1. Que la ruta devuelva el MISMO payload (`return NextResponse.json(getMockDataForRoute('<misma clave>', tenantId))`).
2. Que el short-circuit de `isMockTenant` esté **antes** de `requireTenantAccess`.

La segunda no estaba en el análisis original y es la que manda: **la demo no tiene token**. Si la ruta
autentica primero, sacar la intercepción cambia un panel con datos por un **401**.

Medido sobre los 37 mapeos vivos del interceptor:

| | Cantidad |
|---|---|
| Sacables hoy (cumplen 1 y 2) | **0** |
| Payload idéntico pero **bloqueadas** por auth-antes-que-mock | **21** |
| Resto (mock distinto, o sin mock propio) | 16 |

Las 21 bloqueadas incluyen `aks`, `alerts`, `macc`, `scorecard`, `zero-cost`, `allocation-rules`,
`compute-cost-per-core`, `forecast`, `tenant_health`, `m365_overview`, `cost_groups`, `network`, `tags`,
`tags_compliance`, `cost-projection`, `cost_centers`, `commitment-simulator`, `ttl_history`,
`ttl_unlabeled` y las dos de `governance-policies`. Se intentó sacar un subconjunto y **se revirtió**: el
payload es byte a byte el mismo —se verificó que el multiplicador coincide por los dos caminos, porque el
interceptor pasa el tier y la ruta el tenantId, y `MOCK_TENANT_TIER` los mapea al mismo valor en los tres
tiers— pero en demo no se puede llegar a él.

Llegar a estos números costó tres pasadas, y las tres primeras estuvieron mal por detectar de menos:

- El primer barrido buscaba el mock sólo entre **comillas simples**; media docena de rutas lo llaman con
  dobles y quedaron fuera.
- El segundo buscaba `requireTenantAccess|requireTenantRole` y no `requireTenantTier`, que es el que usan
  `tenant_health` y `m365_overview`. Con eso parecían sacables y no lo son.
- El tercero miraba el archivo entero en vez de **cada handler**. El interceptor NO filtra por método, así
  que atrapa GET y POST por igual: en `/api/cost-groups` el GET mockea antes del auth pero el POST no, y
  sacar esa intercepción cambiaría las escrituras de la demo por un 401.

El test lleva las tres correcciones. Si alguien repite el análisis a mano, que empiece por ahí.

### Qué queda realmente pendiente, y qué NO conviene hacer (2026-09-13)

**El riesgo grave ya está cerrado.** La fuga de mocks a un tenant REAL —lo que motivó esta entrada— está
mitigada por la guarda `__finopsDemoActive` (se escribe en cada render, se consulta en cada llamada) y
fijada por `demoFetchLeak.test.ts`. Lo que queda es prolijidad, no plata en juego.

**De las 37 intercepciones, la mayoría NO puede divergir:**

| | ¿Puede divergir? |
|---|---|
| 21 verbatim (misma función, misma clave) | no — una sola fuente |
| 7 sin mock en ningún lado (`audit_full`, `ttl`, `payments`, `chargeback`, `rates`, `rightsizing`, `approvals`) | no — el interceptor ES la única fuente |
| **~6 con dos mocks independientes** | **sí** |

Los que pueden divergir: `anomalies` (mock inline), `ai-analytics`, `billing`, `users` y `billing-markup`
(transforman la misma clave) y probablemente `aks_chargeback`. `cost-by-category` también podía —su mock
vive en `categoryConsumptionService`— pero ya está atado con `satisfies`.

**NO conviene mover el chequeo de mock antes del auth.** Destraba 21 intercepciones, pero ninguna de esas
21 puede divergir: son idénticas por construcción. Sería tomar una decisión sobre qué se sirve sin token
para resolver un problema que esas 21 no tienen.

**Lo que sí cierra el pendiente real:** comparar la FORMA del mock del interceptor contra la del mock de la
ruta, sólo para esas ~6. Acotado, no toca nada de lo que se sirve, y convierte el único modo de falla que
queda —cambiar el contrato de una ruta y degradar la demo en silencio— en un test rojo.

Ese modo de falla no se pudre con el tiempo: se dispara con una edición. Puede estar dormido meses y
aparecer recién cuando un prospecto mira la demo.

`__tests__/unit/demoInterceptorRedundante.test.ts` fija las cuatro reglas: falla si aparece una
intercepción sacable (para que se saque), si una URL genérica tapa a una más específica declarada después
(`/api/intelligence/aks` matchea `aks-chargeback`), o si una apunta a una ruta que no existe.

**El desbloqueo real no es borrar intercepciones: es mover el chequeo de mock antes del auth** en esas 8
rutas. Eso hace que el interceptor deje de hacer falta y encoge la superficie del parche a `window.fetch`,
que es el riesgo que esta entrada persigue. Pero cambia QUÉ se sirve sin token —fixtures de tres tenants
demo hardcodeados con datos falsos— así que es una decisión de producto, no una limpieza.

**Sobre la parte 2 (contratos tipados):** el doc dice que atar una clave es "una línea más el `satisfies`".
Eso vale sólo cuando ya existe un tipo de respuesta con nombre, y esa vía está agotada: de los 68 `case`,
2 están atados (los 2 que tenían tipo servido por un servicio) y **30 de los 37 mapeos no tienen ningún
tipo declarado**. Para el resto hay que escribir la interfaz a mano, que son 30 fuentes de verdad nuevas
sobre formas que ya existen — el mismo patrón de duplicación que MEJ-32 documenta como bug recurrente.

### Medición del 2026-09-22 — una intercepción muerta, y cuántas pueden divergir de verdad

**Se encontró una intercepción INALCANZABLE y se sacó:** `/api/admin/config/users`. La guarda de arriba
del interceptor (`Never intercept real admin/superadmin/tenants endpoints`) devuelve `originalFetch` para
esa URL **175 líneas antes** de la línea que intentaba mockearla. Nunca se ejecutó. La demo del panel de
usuarios no dependía de ella: la ruta hace su propio short-circuit de `isMockTenant` antes de
`requireTenantAccess` (`users/route.ts:65` contra `:87`). Quedan **36 intercepciones**.

Una intercepción muerta no es inofensiva: miente sobre cómo funciona la demo y manda a leer el mock
equivocado cuando una pantalla falla.

`demoInterceptorRedundante.test.ts` no la veía —chequeaba que la ruta existiera y que el mock fuera
redundante, pero no si el interceptor podía **llegar** a esa línea—. Se le agregó esa quinta regla, y se
validó con un mutante: reponer la línea pone el test en rojo nombrando el archivo y la línea.

**Cuántas pueden divergir de verdad: 4, no ~6.** Medido cruzando las 37 intercepciones contra el mock de
su ruta:

| | |
|---|---|
| 23 verbatim (misma clave de `getMockDataForRoute`) | no pueden divergir |
| 10 sin mock propio en la ruta | no pueden divergir: el interceptor es la única fuente |
| **4 con mock independiente en los dos lados** | **sí** |

Las cuatro: `/api/intelligence/billing` (la ruta usa `getMockRealConsumptionOverview`),
`/api/intelligence/anomalies` (`MOCK_CAUSES`), `/api/intelligence/ai-analytics` (`MOCK_PAYLOAD`) y
`/api/intelligence/aks-chargeback`.

**Lo que falta para cerrarlo**, y por qué no se hizo en esta pasada: comparar las formas exige importar el
mock de cada ruta, y los tres primeros son consts **no exportadas** dentro del archivo de la ruta
(`MOCK_CAUSES` está además adentro de una función). O sea que el test no es sólo un test: arrastra
exportar internals de tres rutas. Es un refactor chico pero es una decisión aparte, no una limpieza.

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

**Módulo:** Recursos · **Impacto:** Medio · **Esfuerzo:** Medio · **Estado:** Hecha (2026-09-13)

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

### Solución implementada (2026-09-13)

`src/lib/armResourceId.ts` resuelve la jerarquía por PARES `tipo/nombre` después de `/providers/`, no por
"el penúltimo segmento": el namespace (`Microsoft.Compute`) no es un par, y contarlo como tal haría que una
VM de primer nivel "tuviera padre" y mostrara su propio costo como ajeno. 8 tests, incluido el caso de
anidamiento de tres niveles y el de pares incompletos.

`searchLiveResources` resuelve el padre sólo para las filas SIN cargo propio medido y consulta sus costos en
una llamada aparte. `attributeResourceCost` —pura y exportada— decide qué se atribuye:

| cargo propio | padre con costo | resultado |
|---|---|---|
| medido | — | `cost_management`, su costo |
| ausente | sí | `parent`, **`monthlyCostUSD: 0`** + `billedIn` |
| ausente | no | `unmeasured`, sigue el "—" |

**El invariante es que `monthlyCostUSD` queda en 0 cuando el cargo va al padre.** El costo se cuenta UNA
vez, en el padre; sumarlo también en el hijo duplicaría el total de la tabla y los KPIs, que es el riesgo
que la propuesta marcaba. Hay un test que suma una página con tres hijos de la misma VM y verifica que el
total sea el de la VM sola.

Un `0` medido NO se confunde con "sin cargo": son ramas distintas y hay test.

La UI muestra `en res-virtualmachines-100 · $266.40` en gris y sin signo de suma, con el tooltip explicando
que el importe no se suma en esa fila. Claves i18n en los tres idiomas.

El mock de recursos suma una extensión de VM: sin eso sólo generaba recursos de primer nivel y la fila
"facturado en…" no aparecía nunca en la demo, que es donde un prospecto la vería. Verificado en el browser.


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

**Módulo:** Madurez FinOps · **Impacto:** Bajo · **Esfuerzo:** Bajo · **Estado:** Hecha (2026-09-13)

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

### Hecho (2026-09-13) — el backend, no la elección

`TenantGlobalSettings.maturity_score_policy` (`self_assessment` | `telemetry` | `blended_50_50`), migración
`20260913-002`. `applySelfAssessment` recibe la política y `getMaturityScorePolicy` la lee por tenant.

**El default reproduce exactamente el comportamiento anterior**, así que ningún tenant existente ve cambiar
su radar: la columna nace en `self_assessment` y el parámetro de la función tiene ese default.

Dos decisiones de diseño que conviene no revertir sin pensarlas:

- **La divergencia se anota con CUALQUIER política.** Que la autoevaluación y la telemetría no coincidan es
  la conversación FinOps útil, y no depende de cuál de las dos gane. Perderla al pasar a `telemetry`
  vaciaría el plan de acción justo para el cliente auditado, que es el que más lo mira. Hay un test que lo
  fija para las tres políticas.
- **`telemetryScore` queda siempre accesible**, gane quien gane, para que la UI pueda mostrar el contraste
  sin recalcular nada.

El lector cae a `self_assessment` ante fila ausente, valor desconocido o caída de la base: una caída de
MySQL no puede cambiarle los números a nadie en silencio. Tests en `azureMaturityService.test.ts` (8 casos)
y `maturityScorePolicy.test.ts` (4).

### Corrección: la columna estaba en la tabla equivocada

La primera versión puso `maturity_score_policy` en `TenantGlobalSettings`, que es donde parecería
corresponder por el nombre. **Está abandonada:** 0 filas, y NADA en la app la escribe. Sus cuatro columnas
están duplicadas en `Tenants`, que es la que el producto realmente usa:

| `TenantGlobalSettings` (muerta) | `Tenants` (viva) |
|---|---|
| `theme_preference` | `theme_preference` ← `saveThemePreference` |
| `organization_display_name` | `company_name` ← `superAdminTenants.service.ts:339` |
| `custom_logo_blob_url` | `logo_stored_name` |
| `is_master_notifications_enabled` | `notifications_enabled` |

La columna se movió a `Tenants` reescribiendo la migración (todavía no estaba pusheada), así que no queda
un add-and-drop en el historial. Con eso el write path ya existía: `/api/admin/config/general` +
`tenantConfiguration.service.ts` escriben `Tenants`, y sólo hubo que exponer un campo más.

`PUT /api/admin/config/general` acepta `maturityScorePolicy` y valida contra la lista ANTES de tocar MySQL:
un valor fuera del ENUM moriría en el driver con un error que no le dice nada al admin que lo mandó.

### Deuda que esto destapó, y no es de esta entrada

`TenantGlobalSettings` es un esquema duplicado y vacío que miente sobre lo que el producto hace: el
`COALESCE(gs.organization_display_name, t.company_name)` de `azureAdvisor.service.ts:694` **siempre cae a
la segunda rama**, y hace un `LEFT JOIN` en cada llamada del Advisor para nada. Borrar la tabla y
simplificar ese JOIN merece entrada propia; no se hizo acá porque un `DROP TABLE` no va mezclado con una
feature.

### Nota

**Nadie puede elegir la política todavía, porque NADA en la app escribe `TenantGlobalSettings`.** Buscada
en todo `src/`: aparece en tres archivos y los tres la LEEN (`azureAdvisor.service.ts` para el nombre
comercial, `azureMaturity.service.ts` para esta política). No hay un solo `INSERT` ni `UPDATE`.

O sea que `theme_preference`, `organization_display_name`, `custom_logo_blob_url` y
`is_master_notifications_enabled` tampoco son configurables desde el producto: la tabla se puebla a mano.
Eso es un hueco más grande que MEJ-08 y merece entrada propia. Hasta que exista ese camino de escritura,
la política se cambia con un UPDATE.

> **2026-10-04 — con pantalla.** La política se elige arriba del radar de Madurez FinOps (Admin u
> Owner; los demás ven cuál rige), y cada dimensión muestra las dos lecturas: *Equipo 70 · Azure 45*.
> Para eso `getLiveMaturityData` devuelve `scorePolicy` y `applySelfAssessment` suma `declaredScore`. La
> proyección optimista del cuestionario respeta la política: con «telemetría», el radar se movía con lo
> declarado y volvía atrás al revalidar; ahora no se mueve. La «Nota» de arriba quedó vieja: el camino de
> escritura existe desde la corrección (`PUT /api/admin/config/general`), sólo faltaba la pantalla.

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

**Módulo:** SuperAdmin / Transversal · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (2026-09)

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

**Módulo:** Facturación / Marketplace / TierLogic / Self-Service · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (2026-09)

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

**Módulo:** SuperAdmin / Comercial / Ventas & Comisiones · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (2026-09-13)

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

### Criterio 1 hecho (2026-09-13) — y corrección de estimación

Esta entrada figuraba como no empezada, pero ya existía el muñón de atribución: `TenantCommercialDeals` con
`sales_rep_name` y `sales_commission_percent`, escrita desde `superAdminTenants.service.ts`. Lo que faltaba
del criterio 1 —y es lo que bloqueaba todo lo demás— eran las DOS columnas de las que depende el
devengamiento:

- **`sold_at`** (migración `20260913-003`): desde dónde se devenga. **NULL para los tenants ya cargados**:
  no se inventa una fecha retroactiva, porque una comisión calculada sobre una fecha adivinada es peor que
  no calcularla — parece un dato. El panel muestra "sin registrar" en ámbar para esos.
- **`contract_term`** (`annual` | `monthly`): qué regla aplica. Anual liquida el 20% de una vez a partir del
  2do mes; mensual liquida 2/12 tras el segundo cobro y 1/12 por mes.

**`sold_at` no se pisa nunca en el update** (`COALESCE(TenantCommercialDeals.sold_at, VALUES(sold_at))`) y la
ruta de actualización comercial **no acepta el campo**: la fecha de venta es un hecho del pasado, y moverla
al editar el vendedor correría el inicio del devengamiento y recalcularía comisiones ya liquidadas.

`normalizeSoldAt` valida en Node y no en MySQL: una fecha inválida entra como `0000-00-00` o NULL según el
modo del servidor, y en los dos casos el devengamiento arrancaría desde una fecha que nadie eligió. Rechaza
además el 31 de febrero, que `new Date` acepta corriéndolo a marzo.

### Criterios 2 a 4 hechos (2026-09-13) — y por qué costó menos de lo estimado

**El motor ya existía, para otro beneficiario.** El programa de afiliados (migración `20260907-001`) tenía
ledger con estados, montos en `Decimal`, foto del porcentaje vigente, idempotencia por transacción de Paddle
y reversión ante reembolso. Lo único que cambia entre un afiliado y un comercial es CUÁNDO devenga, no cómo
se guarda ni cómo se liquida. Construir `SalesCommissionLedger` aparte, como pedía esta ficha, habría sido el
cuarto catálogo duplicado de la casa (ver MEJ-32) — y con un caso que una tabla aparte vuelve invisible:
alguien que es afiliado Y comercial cobrando por dos lados sin que ninguna consulta lo muestre junto.

Se unificó en `Commissions` (`beneficiary_type` + `beneficiary_id`), con los datos de afiliados migrados.
`AffiliateCommissions` queda intacta hasta verificar en producción que el libro nuevo cuadra: es plata
liquidada, el DROP va en una migración posterior.

**La cuenta del comercial mensual se simplifica sola.** 1/12 del 20% del valor anual, y el valor anual es el
cobro mensual × 12, así que la cuota ES el 20% del cobro mensual. No hace falta proyectar el año ni arrastrar
el redondeo de dividir por 12. El mes 1 no liquida y vence junto al mes 2 (los 2/12 del criterio 3), del 3 en
adelante cada cobro devenga su cuota, tope 12. Hay un test que verifica la propiedad: 12 cuotas suman
exactamente el 20% anual.

**`DUE` no necesita un cron.** Es derivable de `payment_due_date`, así que se promueve al listar el panel —
el único momento en que el estado importa. Un cron diario para un UPDATE derivable de una fecha sería una
pieza más que mantener y vigilar, con resultado idéntico.

**Un detalle de MySQL que costó una corrida fallida:** los nombres de constraint son únicos por BASE, no por
tabla. `fk_commission_tenant` ya lo usaba `AffiliateCommissions`, así que el `CREATE TABLE Commissions` moría
con `ER_FK_DUP_NAME`... y el runner de migraciones trata ese error como idempotente, así que no se creaba la
tabla y el fallo recién aparecía en el `INSERT` de abajo. Se verificó aplicando la migración contra la base
local, no sólo leyéndola.

**Lo que queda anotado:** el runner marca `ER_FK_DUP_NAME` como idempotente, lo cual es correcto para un
`ALTER ADD CONSTRAINT` repetido pero enmascara un `CREATE TABLE` que no se ejecutó.


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

**Módulo:** Compromisos / FinOps · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (2026-09)

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

> **Criterio 3, cerrado el 2026-10-04.** Figuraba «Hecha» sin el cron: lo de septiembre cubría
> simulador, cupo de devolución, ESR y concentración de vencimientos, pero nadie avisaba a 90/60/30
> días. Ahora `reservation-expiry-alerts` (diario, 09:03 UTC) lee las reservas con la misma fuente que
> la pestaña (`getActiveReservations`), ubica cada una en el escalón que le toca HOY y anota el aviso en
> `ReservationExpiryNotices` (tenant, reserva, vencimiento, escalón): no se repite y una corrida perdida
> se recupera en la siguiente. Avisa por la campanita y por `notifyTenant` —los canales del tenant—, sin
> regla que configurar: los escalones son los de la propuesta. Quedan afuera los tenants por Lighthouse
> (las reservas son de nivel tenant y la credencial sería la nuestra) y los que no tienen la pantalla.
> Los estados terminales se excluyen por `provisioningState`, verificado en learn.microsoft.com.
> Savings Plans no entran: el repo no lee `Microsoft.BillingBenefits`.

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

**Módulo:** Bases de Datos / NoSQL · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (2026-09-25)

> **Lo primero que apareció al abrirla no era una falta, era un defecto.** El tablero de Cosmos ya
> existía (1.097 líneas) y su bloque `metrics` se armaba con **constantes escritas en el código**
> —35% de RU normalizada, 0% de throttling, 100.000 requests, 4.000 RU/s, 50 GB— para cualquier
> cuenta de cualquier cliente, sin una sola llamada a Azure Monitor. La lista `COSMOS_METRICS` de la
> ruta era código muerto. El costo sí era real, así que la pantalla mezclaba un número verdadero con
> seis inventados. Y el modo se asumía `autoscale` para todo lo que no fuera serverless, con lo cual
> la regla de "manual sobredimensionado" **no podía dispararse nunca** con datos reales.
>
> Por eso el orden fue: primero medir de verdad (`cosmosMetrics.service.ts`), después decidir
> (`cosmosOptimizer.service.ts`). No se puede construir un optimizador de RU/s sobre RU inventadas.

### Hecho

**Telemetría real.** `NormalizedRUConsumption`, `ProvisionedThroughput`, `AutoscaleMaxThroughput`,
`TotalRequestUnits`, `TotalRequests` (y su filtrado por `StatusCode eq '429'`), `DataUsage`,
`IndexUsage` y `ServerSideLatency`, con los nombres verificados contra la referencia del tipo de
recurso. Cuatro de los once de la constante muerta **no existen** para
`Microsoft.DocumentDB/databaseAccounts`. Las llamadas van agrupadas por agregación porque Azure
rechaza el lote entero con 400 si una métrica no soporta la que se pide.

**`null`, no cero.** Los campos pasaron a `number | null` y el typecheck marcó los 21 lugares que
asumían número. Los agregados excluyen lo no medido y las recomendaciones no se emiten sin dato.

**Las tres decisiones**, todas con el número derivado de lo medido y de tarifas publicadas:

1. **Bajar RU/s manual** — dimensiona por el **p95 con 25% de margen**, no por el promedio:
   dimensionar por el promedio deja la base corta en cada pico. Nunca por debajo del mínimo de 400.
2. **Migrar a Autoscale** — el umbral de ~66% de uso medio **no es una constante elegida**: es el
   cociente entre las dos tarifas publicadas (0,012 / 0,008 = 1,5x). Se respeta el piso de
   facturación del 10% del techo.
3. **Serverless** — se decide con las RU realmente consumidas extrapoladas al mes, y el techo de
   5.000 RU/s se mide contra el **pico real** (aprovisionado × consumo máximo), no contra lo
   aprovisionado: una cuenta con 10.000 RU/s que nunca pasa de 2.000 entra de sobra.

**Particiones calientes** vía `NormalizedRUConsumption` dividida por `PhysicalPartitionId`. La
propuesta pedía `PartitionKeyStatistics`, que **no es una métrica** sino una categoría de log de
diagnóstico y exigiría que el cliente tenga el diagnostic setting configurado. Una sola partición
nunca se marca caliente —el 100% está ahí por definición— y "alto pero parejo" tampoco: eso es una
colección al límite de su throughput, que repartir la clave no arregla. Esta recomendación va con
ahorro **0 USD** a propósito: repartir la clave evita el 429, no baja la factura por sí solo, y
poner un número ahí sería volver al problema que este ciclo vino a corregir.

### Las tarifas, y el medidor que volvió a morder

Verificadas contra la Retail Prices API: `100 RU/s` a 0,008/hora, `AP1 100 RUs` (autoscale) a
0,012/hora, `1M RUs` (serverless) a 0,25. El almacenamiento estuvo a punto de salir en **cero**: el
medidor `Data Stored` del producto `Azure Cosmos DB` cotiza 0,00 —es la fila del tramo gratuito— y
el transaccional real es `General Purpose Storage Data Stored`, del producto `Azure DocumentDB`, a
0,115/GB-mes. Los medidores se eligen por el par (meterName, productName), nunca por el nombre solo.

### Lo que NO se hizo, y por qué

- **`CosmosDbFinopsAnalysis`**, la tabla que pedía la propuesta: los tres criterios de aceptación se
  cumplen sin persistir nada. La tabla serviría para historial, que nadie pidió todavía.
- **Endpoint `cosmos-optimizer` aparte**: la ruta `cosmos-metrics` ya devuelve las recomendaciones
  en el mismo payload que consume el board. Un endpoint nuevo sería una segunda fuente para el
  mismo dato.
- **Verificación contra datos reales**: `az cosmosdb list` no devuelve **ninguna** cuenta en las
  suscripciones accesibles. El camino vivo no se pudo ejercer. Lo que sí está cubierto es el punto
  donde un error sería invisible —si el parseo de la respuesta de Azure Monitor estuviera mal, todo
  saldría `null` y se leería como "este cliente no tiene datos"—: `leerSeries` se prueba contra una
  respuesta con la forma que documenta Azure, incluidos los intervalos sin dato, que Azure omite en
  vez de mandar en 0.

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

**Módulo:** Redes / Egress · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Parcial (núcleo 2026-09; P95 hecho 2026-09-27; piloto de Traffic Analytics solo lectura 2026-10-14)

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

### Lo que se implementó (2026-09-22)

**Sin tabla nueva, sin colector nuevo y sin cron nuevo.** El costo de
transferencia ya se ingiere: la query B del sync agrupa por `ServiceName` +
`Meter` + `ResourceLocation` y escribe en `CostMeterSnapshots` con `Quantity`.
Lo único que faltaba era clasificar esas filas. `NetworkTrafficCostFlows` no
hizo falta.

- `src/services/networkEgress.service.ts`: clasifica los medidores en salida a
  internet, entre zonas, entre regiones, entre continentes, NAT Gateway y
  entrada, con costo y GB por región y medidor.
- `GET /api/intelligence/network/egress` (mock antes del auth, sin intercepción
  en `TenantProvider` — el patrón al que llegó MEJ-03).
- Pestaña **Tráfico y egress** en el hub de redes, con el desglose y la
  sugerencia de arquitectura para los dos evitables.

**Dos correcciones de contrato sobre la propuesta de arriba, verificadas contra
la Retail Prices API real** (pública y sin auth), no asumidas:

- El servicio es **`Bandwidth`** (familia `Networking`), **no** `'Virtual
  Network'` como decía la propuesta. Filtrar por el nombre equivocado devuelve
  cero filas, y cero filas se lee igual que "este cliente no transfiere nada".
- El `Data Processed` del NAT Gateway vive en el servicio **`NAT Gateway`**, con
  su propio medidor por GB, no bajo Bandwidth.

Los `meterName` reales quedaron fijados en `networkEgress.test.ts`, que evalúa
el mismo `CASE` que se manda a MySQL leyéndolo del código en vez de copiarlo.
Eso cubre el orden de los `WHEN`: `Standard Inter-Availability Zone Data
Transfer Out` también matchea un `%data transfer out%` genérico, así que con el
orden al revés **todo el inter-AZ se contaría como salida a internet** y el
hallazgo que justifica la pantalla desaparecería dentro de otra categoría.

**Dos límites que la pantalla dice en vez de esconder:**

1. **Las filas de costo 0 no se ingieren** (el sync descarta `cost === 0`), así
   que los GB del tramo gratuito no están: el costo es exacto y el volumen es un
   piso.
2. **`UnitOfMeasure` llega vacío** en las filas de meter porque la query B no lo
   pide, así que los GB sólo se suman para los medidores que la Retail API
   confirma en `1 GB`. Los de China, que se cobran por Mbps/hora, quedan fuera
   del total de GB aunque su costo sí se cuente.

**Lo que falta, y por qué no se hizo de una:**

- **El Sankey (criterio 1).** Son seis categorías, y un diagrama de flujo para
  seis barras es una dependencia nueva para decir lo mismo. Tiene sentido cuando
  el desglose llegue a par origen-destino, que la ingesta hoy no da: Cost
  Management informa la región del cargo, no el destino del tráfico.
- ~~**Private Endpoints (parte del criterio 2).**~~ Verificado en el reintento:
  el procesamiento de Private Link vive en el servicio **`Virtual Network`**,
  como `Standard Data Processed - Egress` / `- Ingress`. Queda cubierto por la
  categoría *procesamiento*.

**Y ese reintento destapó un bug propio que estuvo unas horas en producción.**
`Data Processed` **no es del NAT Gateway**: lo usan siete servicios de la
familia `Networking`, y **`Azure Firewall` tiene un medidor con el nombre
exactamente igual**, `Standard Data Processed`. También `Load Balancer`
(`Standard`, `Gateway`, `Global`), `Application Gateway`
(`Small`/`Medium`/`Large`), `Azure DDOS Protection`, `Virtual WAN` y `Virtual
Network`. La primera versión filtraba sólo por el nombre del medidor, así que le
cargaba al NAT el costo de un firewall o un balanceador: plata real atribuida al
lugar equivocado, sin una sola excepción. Ahora el NAT se reconoce por
**servicio**, el resto cae en la categoría *procesamiento*, y la tabla muestra
el servicio junto al medidor para que dos `Standard Data Processed` no sean la
misma fila. Los siete casos están fijados en el test.
- ~~**ExpressRoute / VPN P95 (criterio 3).**~~ **Hecho el 2026-09-27**, ver abajo.
- **Network Watcher Flow Logs.** Dan GB, no costo, y el costo ya lo tenemos.

### Hecho — criterio 3: enlaces sobredimensionados (2026-09-27)

`src/lib/networkCapacityCatalog.ts`, `GET /api/intelligence/network/capacity`,
`/intelligence/redes/capacidad` como pestaña del hub. Ancho de banda contratado contra el P95 real
de los últimos 30 días; por debajo del 15%, el enlace se puede bajar de SKU.

**La regla que manda no es el cálculo, es la seguridad: sin métricas NO se recomienda achicar.** Un
enlace sin muestras no está ocioso — lo más probable es que falte el permiso de lectura o que el
recurso sea nuevo. Tratar la ausencia como 0% de uso recomendaría bajarle el SKU a un circuito que
quizás está saturado. Es el mismo criterio que MEJ-39, pero acá el error no confunde: **corta un
enlace**. Los no medidos se cuentan aparte y se dicen arriba de la tabla.

**Cuatro contratos verificados en learn.microsoft.com, y cada uno tenía una trampa:**

| | Lo verificado | Por qué importa |
|---|---|---|
| Percentiles | Azure Monitor **no** ofrece agregación por percentil — sólo Total, Average, Minimum y Maximum | Pedir P95 a la API no devuelve nada. Se calcula acá sobre las muestras horarias |
| Unidades | ExpressRoute informa en **Bits**PerSecond; VPN Gateway en **Bytes**PerSecond | Sin el ×8 el gateway sale ocho veces más ocioso, y hacia el lado que recomienda achicar |
| Capacidad ER | `serviceProviderProperties.bandwidthInMbps` **o** `properties.bandwidthInGbps` (ExpressRoute Direct) | Leer sólo la primera deja en cero justo a los circuitos de 10 y 100 Gbps |
| Throughput VPN | La clave es **generación + SKU**, no el SKU | `VpnGw2` rinde 1 Gbps en Generation1 y 1,25 en Generation2: 25% de diferencia |

Y una quinta que no es un contrato sino una confusión de tipos: un `virtualNetworkGateways` puede
ser un gateway de **ExpressRoute**, no de VPN. Se filtra por `gatewayType`, porque no tiene
throughput de VPN y su métrica de ancho de banda no significa lo mismo.

Se toma el **máximo entre entrada y salida**, no la suma: un circuito soporta su ancho de banda en
cada sentido, y sumarlos inflaría la utilización tapando justamente los que están de más.

#### Dos defectos que encontró el navegador y ningún test

Verificado en el navegador contra el servidor local con una sesión real — la primera vez en este
ciclo que se pudo. Encontró dos cosas que 3.705 tests no:

1. **Los tableros nuevos explotaban ante cualquier error de la API.** El `fetcher` de SWR no lanzaba
   con un 401/403/500, así que le entregaba el cuerpo `{error}` como si fueran datos: `error` queda
   en `null`, el componente cree que tiene respuesta y revienta al desestructurar —`Cannot read
   properties of undefined`—, dejando la pantalla en blanco. Pasaba en `NetworkCapacityBoard` y en
   `LifecycleBoard` (MEJ-39). Se arreglaron los tres fetchers nuevos y se agregó el guard de forma.
2. **El interceptor de demo se comía siete subrutas de red.** `TenantProvider` matcheaba
   `url.includes('/api/intelligence/network')`, así que en un tenant demo **egress, analytics,
   basic, hybrid, internet, load-balancing y service-cost** recibían el mock de la pantalla general
   en vez del propio. Es el mismo error de prefijo que el archivo ya documenta para
   `/perspectives` vs `/breakdown`, y llevaba meses ahí. Ahora la intercepción es por pathname
   exacto; el trinquete de `interceptacionDeFetch.test.ts` bajó de 51 a 50.

Y un tercero propio: el mock iba **después** del auth, así que un tenant demo recibía 401. El patrón
de MEJ-03 —que esta misma entrada cita para egress— es al revés.

Tests: `__tests__/unit/capacidadDeRed.test.ts` (20).

### Lo que sigue faltando

- **El Sankey (criterio 1)**, con el mismo argumento de antes: son seis categorías y el desglose por
  par origen-destino no existe en la ingesta.
- **Network Watcher Flow Logs**: dan GB, no costo.

### Piloto de telemetría existente (2026-10-14)

Se añadió una consulta **solo lectura** a los workspaces ya enlazados en Flow Logs activos con Traffic Analytics:
`GET /api/intelligence/network/traffic-pilot`. No habilita ni modifica Flow Logs, Traffic Analytics, Log Analytics
ni recursos de Azure. Consulta `NTANetAnalytics` para una ventana de 7 días (máximo 30) y agrega por subred,
región y tipo de flujo; no devuelve direcciones IP. La pestaña Egress muestra los pares y el estado de cobertura.

- Azure debe exponer los Flow Logs y `workspaceResourceId` mediante Resource Graph; cada workspace necesita
  permisos de lectura de Azure Resource Manager y consulta de Log Analytics. Los errores de permisos,
  workspaces inaccesibles y tablas/esquemas no disponibles se informan por separado; no se convierten en
  cero flujos.
- El resultado está limitado a los primeros 5 workspaces configurados y los 100 pares principales por
  workspace; los límites se marcan como cobertura/muestra parcial. El volumen de telemetría no se interpreta
  como costo facturado.
- **Pendiente de validar contra un tenant real con Traffic Analytics ya habilitado:** disponibilidad de la
  tabla y nombres de columnas para los esquemas del cliente, cobertura de subred/región, permisos requeridos,
  latencia y volumen de filas. Hasta completar esta validación no se debe construir ni presentar el Sankey como
  topología completa.
- Private Link sigue dentro de la categoría de procesamiento de costos: separar su volumen requiere verificar
  que los medidores existentes permitan atribuirlo al endpoint sin ambigüedad.
- Contratos consultados: [esquema de Traffic Analytics](https://learn.microsoft.com/en-us/azure/network-watcher/traffic-analytics-schema)
  y [acceso a la API de Azure Monitor Logs](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/access-api).

---

## MEJ-20 — Shift-Left FinOps: Integración CI/CD y Gatekeeper de IaC

**Módulo:** Shift-Left / DevOps · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (2026-09), ampliada el 2026-10-08

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

### Lo que se implementó (2026-09)

Los tres criterios, con Terraform. Migraciones `20260922-001-shift-left-estimaciones.sql`
(historial, append-only) y `20260922-002-budget-gates.sql` (umbral por repo);
endpoint `POST /api/v1/shift-left/estimate` con el scope nuevo `write:shift-left`;
GitHub Action composite en `integrations/github-action`; panel
`/governance/shift-left` (tier Enterprise) con el historial y el editor de umbrales,
que escribe por `PUT /api/governance/shift-left/gates` (rol Admin/Owner).

**Precedencia de los umbrales** *(corregida el 2026-10-08)*: falla el **más
estricto** de los dos. Esta entrada decía que el `threshold-usd` del workflow
«gana», y el código dejaba pasar el más laxo. Un equipo puede ser más estricto con
su propio repo; aflojar el umbral que fijó la plataforma exige pasar por ella. Sin
ninguno de los dos el gate queda en `NOT_EVALUATED`: informa y no bloquea. Si la plataforma no
responde, tampoco bloquea — es un control de costo, y voltear el PR de un
tercero por una caída nuestra es peor que dejar pasar uno caro.

**Lo que quedó fuera de la propuesta original**, y por qué no se hizo de una:

- **Umbral porcentual (+Y%).** *Hecho el 2026-10-08, con otro denominador.* Sobre un
  repo que hoy cuesta $0 —cualquier repo nuevo— un porcentaje de su propio costo no
  significa nada. Se resolvió como porcentaje de lo que **queda** del presupuesto
  mensual del centro de costos del repositorio.
- **Aprobación explícita de un FinOps Champion.** Hoy el gate falla el check y
  el desbloqueo es el del repo (otro commit, o un override de quien administre
  las branch protection rules de GitHub). Un flujo de aprobación propio duplica
  algo que GitHub ya hace mejor.
- **Bicep.** *Hecho el 2026-10-08*, a partir del what-if de ARM
  (`az deployment group what-if`), con un lector aparte y el mismo motor de tarificación.
- **Azure DevOps extension.** *Hecho el 2026-10-08, sin extensión del Marketplace:* una
  plantilla de pasos que usa el mismo script que GitHub y GitLab.


### Ampliación (2026-10-08)

Plan: [`docs/plan-ampliar-shift-left-2026-10-08.md`](plan-ampliar-shift-left-2026-10-08.md).
Commits `1f8ea61`, `cc56e98` y `2b523ab`. Técnico: LLD §45; arquitectónico: HLD §20.

**Lo que se hizo.**
- **Cobertura:** de 4 a **18 tipos de recurso** (VMs Linux y Windows, VMSS, AKS, App Service
  Plan, Redis, Firewall, Bastion, VPN Gateway, Application Gateway, Container Registry, NAT
  Gateway, Load Balancer, IPs públicas y discos), con lo que se cobra por consumo y lo no
  tarifable informado aparte, con su motivo, y notas de lo que el número no incluye.
- **Medidor correcto:** el estimador anterior usaba `getMonthlyCostEstimate`, que toma el
  primer medidor y, para una `Standard_D2s_v3` en `westus2`, devuelve la fila Spot de
  Windows (25,36 en lugar de 70,08). El estimador nuevo elige el medidor por reglas
  verificadas contra la API real. El helper **sigue igual** para sus otros usuarios
  (zombies, rightsizing y licencias).
- **Lenguajes y CI:** Terraform, OpenTofu y Bicep; GitHub, Azure DevOps y GitLab, con **un
  solo script** que se descarga de la plataforma con su SHA-256 fijado, reduce el plan a
  una lista de atributos permitidos (los secretos no salen del runner) y comenta el PR
  editando el comentario anterior.
- **Precio del cliente:** descuento por tenant sobre el precio de lista, con los dos números
  en el comentario. El gate se mide contra el número con descuento.
- **Budget Gate por presupuesto:** por monto, por % de lo que queda del presupuesto del
  centro de costos, o los dos; falla el más estricto, y un PR que ahorra nunca lo dispara.
- **Pantalla:** panel *Conectar tu pipeline*, desglose por recurso, evolución por repositorio,
  exportación a CSV y aviso (campanita y canales) al superar el gate, sólo en la transición.

**Lo que quedó fuera, y por qué:** las bases de datos administradas (medidores inconsistentes
entre SKUs), Pulumi, el descuento derivado de la facturación y los precios de reserva, el ranking
de gasto por tipo (los datos de producción no son accesibles desde desarrollo) y las instancias
adicionales de Bastion y el LTS de AKS Premium (no se pudo verificar cómo se cobran). **Sin
verificar:** el what-if de Bicep contra una corrida real, los endpoints de comentarios de
GitHub contra su documentación y la pantalla en un navegador.

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

**Módulo:** Consumo Real / Costos · **Impacto:** Medio · **Esfuerzo:** Medio · **Estado:** Hecha (2026-09)

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

**Módulo:** Transversal / Ahorro · **Impacto:** Alto · **Esfuerzo:** Bajo · **Estado:** Hecha (2026-09-04)

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

### Solución implementada (2026-09-04)

Los tres criterios se cumplen. Dos cosas que la propuesta no había previsto:

**El puente ya existía y no lo usaba nadie.** La propuesta decía "hacer que los dos consumidores llamen a
`baselineForResourceType`", pero las claves de audit **no matchean el slug ARM por substring**:
`appGateways` no encuentra `microsoft.network/applicationgateways`. Los alias que menciona la propuesta
(`unattacheddisks`, `stalesnapshots`) son sólo dos de 24 claves con costo.

Lo que sí existía es `mapAuditToUnifiedZombieList()` en `zombieAuditCatalog.ts` (línea 91), que resuelve
clave → `armType` → `baselineForResourceType` y ya devolvía `potentialSavings` y `savingsSource`.
**Exportada y sin un solo consumidor.** `InteractiveDashboard` ahora la llama en vez de recorrer
`auditResults` a mano.

Nota de dirección de dependencias: `zombieAuditCatalog` ya importa `realizedSavings`, así que el puente
tiene que vivir del lado del catálogo. Ponerlo en `realizedSavings` habría creado un ciclo.

**Había una tercera divergencia y un cuarto número suelto.** La propuesta anotó discos (15.00 contra 19.71)
y planes ASP (45.00 contra 54.75). Faltaban:

| | Copia | Canónico |
|---|---|---|
| VM apagada (`stoppedVirtualMachines`) | 30.00 | **23.36** (disco OS P10 $19.71 + IP $3.65) |
| Precio por GiB de disco, escrito a mano en el loop | 0.15 | **0.154** |

Y dos fallbacks inventados que se van con las copias:

- `SAVINGS_BY_ARM_TYPE` devolvía **10.0** para cualquier tipo no listado. El canónico devuelve 0 con
  `source: 'none'`, que es información: inventar diez dólares por recurso desconocido infla el ahorro
  reportado con un número que no sale de ninguna lista de precios.
- `fallbackSavings` le ponía **10.0** a `expiredTtlResources`. El mapeador usa el tipo **real** del item
  para esa clave, así que un disco con TTL vencido resuelve a 19.71 en vez de a un plano que no distingue
  un disco de una IP.

Tres claves de costo quedan sin línea base y las tres son correctas: `ttl` es un pseudo-tipo y resuelve por
el item, y `virtualhubs` y `dnszones` tampoco estaban en la copia, o sea que ya daban 0.

### Archivos

- `src/components/dashboard/InteractiveDashboard.tsx` — se va `fallbackSavings` (35 entradas)
- `src/app/api/intelligence/applied-savings/route.ts` — se va `SAVINGS_BY_ARM_TYPE` (24 entradas)
- `__tests__/unit/catalogoDeAhorro.test.ts` — 8 tests, incluido el que fija que un tipo desconocido
  devuelva 0 y no un número inventado

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

---

> **MEJ-34 a MEJ-37 salen del análisis del white paper de VMware Tanzu CloudHealth,
> _Cloud Financial Management_ (2022), cruzado contra lo desplegado el 2026-09-23.**
>
> Dos advertencias sobre la fuente, para que nadie la tome como evangelio. Es un
> documento **de producto**, así que sus "mejores prácticas" están moldeadas por lo
> que CloudHealth vende. Y está **muy centrado en AWS**: EC2, RIs convertibles,
> Savings Plans y el "Convertible RI Exchanger" ocupan media sección de descuentos
> que en un producto Azure-only no aplica. Lo que sí sirve es su esqueleto de madurez
> en cuatro fases —visibilidad, optimización, gobernanza y automatización, integración
> con el negocio— y unas pocas prácticas concretas.
>
> **El cruce dio bien en las tres primeras fases.** Amortización, presupuestos,
> chargeback, markup, rightsizing, zombis en cinco variantes, cobertura y utilización
> de compromisos, políticas, auto-block, anomalías por Z-Score y power schedules ya
> están. En varios puntos la plataforma está **por encima** del paper, que es de 2022
> y no contempla costo antes de provisionar (Shift-Left, MEJ-20), export FOCUS, API
> pública, MCP ni los módulos de IA.
>
> Las cuatro entradas de abajo son lo que faltaba, y **casi todo cae en la cuarta
> fase** —integración con el negocio—, que es justamente donde el paper pone el
> objetivo final de la disciplina.

## MEJ-34 — Perspectives: agrupación multidimensional del gasto

**Módulo:** Asignación / Transversal · **Impacto:** Alto · **Esfuerzo:** Alto · **Estado:** Parcial (2026-09-25)

### Hecho

Migración, evaluador, API y tablero con vista previa. **Los cinco criterios de aceptación se
cumplen** y están fijados en 17 tests. Queda pendiente el punto 4 de la propuesta —el selector de
Perspective como filtro transversal en los demás tableros—, que es lo que convierte a MEJ-34 en la
entrada estructural de MEJ-35, MEJ-37 y MEJ-38.

**Se evalúa en TypeScript, no en SQL.** La propuesta pedía generar un `CASE WHEN` para el `GROUP BY`
avisando de parametrizar para no abrir una inyección. Se evalúa sobre el agregado que
`CostSnapshots` ya devuelve: la cardinalidad está acotada, no hay SQL armado con valores que escribe
el usuario, y la vista previa del criterio 5 sale gratis porque es volver a evaluar en memoria.

### La restricción de datos que definió el diseño

Verificando **antes** de escribir apareció lo que importaba: `CostSnapshots.Tags` **sólo se llena
para los tenants con export FOCUS configurado**. Los que sincronizan por la Query API de Cost
Management lo tienen en NULL —lo dice el propio comentario de `allocationTags`: *"Azure no llena
etiquetas en el agregado"*— y su desglose por etiqueta vive en `CostTagSnapshots`, que es **el mismo
dinero visto por otra dimensión** y no se puede unir sin contar doble.

Para esos tenants una Perspective por etiqueta mandaría **todo** a "Sin asignar". Y eso no es un
problema de etiquetado del cliente sino un hueco nuestro. Por eso el reparto distingue **dos
motivos** y la pantalla los muestra separados:

- **`sin-regla`** — se evaluaron todas las reglas y ninguna coincidió. El "Sin asignar" legítimo.
- **`sin-datos`** — todas las reglas pedían un dato que la fila no tiene **ingerido**, con el nombre
  del dato que faltó y una línea que explica que configurar el export FOCUS lo completa.

Basta **una** regla evaluable para que la fila cuente como `sin-regla`: tuvo una oportunidad real.

### Tres cosas que sólo se vieron corriendo

1. **El typecheck no ve un bundle roto.** Se puso el acceso a datos en el mismo módulo que el
   evaluador, y como `mockData.ts` importa el evaluador —para que la demo reparta con la función de
   producción— el navegador arrastró `storage/db` → `migrations` → `fs` y **la aplicación entera
   dejó de compilar**. El acceso a datos vive ahora en `perspectivesData.service.ts`.
2. **El MySQL real rechazó la FK**: `Tenants.tenant_id` es `utf8mb4_unicode_ci` y una base creada
   desde cero con MySQL 8 usa `utf8mb4_0900_ai_ci`. Misma trampa que obligó a la migración
   `20260909-002` a modificar una decena de tablas; va `COLLATE` explícito.
3. **La vista previa de la demo no reaccionaba**: el mock devolvía siempre el reparto de la primera
   Perspective en vez de evaluar las reglas del cuerpo, así que cambiar de Perspective no cambiaba
   nada en pantalla. Es justo el criterio 5, y sólo se vio haciendo clic.

Verificado en el navegador con las dos Perspectives de demo sobre el mismo gasto: **Entorno** reparte
en Producción/Preproducción/Desarrollo con 86,14% de cobertura y **Centro de Costo** en
Ingeniería/Datos con 72,48%, y en las dos la suma de grupos más lo sin asignar da exactamente el
total.

### El selector transversal (2026-09-25)

Vive en la barra de alcance, al lado del de suscripción, y el alcance viaja en la URL
(`?perspective=<id>&pgroup=<grupo>`) con el mismo criterio que `?sub=`: se comparte por link y
sobrevive al refresh. Se dibuja sólo si el tenant tiene Perspectives, y no consulta nada para los
tenants que no son Enterprise —sin ese corte, cada carga de página terminaba en un 403—.

El grupo `Sin asignar` es seleccionable como cualquier otro: es donde mira quien está tratando de
subir la cobertura.

**Qué significa que una pantalla lo "honre", y por qué no lo honran todas todavía.** No alcanza con
leer el parámetro: la pantalla tiene que filtrar sus filas **y que sus totales sigan cuadrando**. En
un tablero que agrega en SQL —`cost-groups` hace `GROUP BY` con `COUNT(DISTINCT ...)`— eso es
trabajo propio y no una línea, porque el predicado de una Perspective se evalúa por fila y no se
traduce a un `WHERE` sin volver a la generación de SQL que se descartó a propósito. Un filtro que
dejara los totales descuadrados sería peor que no tenerlo: rompería el criterio 4, que es lo que
hace auditable a esta mejora.

**Lo adopta hoy el export FOCUS** (`/api/exports/focus?perspective=&pgroup=`), y se eligió justamente
porque filtra **fila por fila**: no hay agregación que pueda quedar descuadrada, y "entregale a
finanzas sólo la porción de Ingeniería" es un pedido real. Ahí apareció un detalle que no es obvio:
con filtro, el `limit` cuenta las filas que **salen** y no las que se leen — si contara las leídas,
pedir 100.000 filas de un grupo devolvería muchas menos sin decir por qué—, así que el offset avanza
por lo leído y el total por lo emitido.

**Decisión de diseño que conviene no repetir mal:** un `perspective=` que no resuelve —id de otro
tenant, o borrado— **no filtra nada** en vez de devolver vacío. Un export vacío se leería como "ese
grupo no tiene gasto", que es una afirmación falsa sobre la factura del cliente. Hay un test que lo
fija.

### Hecho (2026-09-25): `cost-groups`, el primer tablero que agrega en SQL

Es el caso difícil que el párrafo de arriba anticipaba, y se resolvió **moviendo la agregación de
SQL a TypeScript sólo cuando hay alcance activo**: la consulta pasa a traer el detalle
—`(balde CostCenter, suscripción, grupo de recursos, servicio, recurso, etiquetas)`— y el plegado
reproduce en memoria lo que hacía el `GROUP BY`, incluidos los descartes de `COUNT(DISTINCT ...)`
(el `NULL` no cuenta, el placeholder `mg-aggregated` tampoco). Sin alcance **la consulta de siempre
no se toca**: es el camino caliente y no debía pagar nada.

Medido contra la base local: 16.822 filas de `CostSnapshots` colapsan a 152 de detalle, y los dos
caminos dan el mismo costo y los mismos conteos. Ese cruce es la guarda contra la deriva entre las
dos formas de la consulta, y por eso las expresiones del balde y del costo son constantes
compartidas en vez de estar escritas dos veces.

**Un alcance sólo se aplica si se puede medir.** Cuando el costo del período llega sin procedencia
—sync por Cost Management, sin `Tags` ni `ResourceId`— el reparto se resuelve **aproximando por
Resource Group**, y una aproximación por RG no se puede recortar fila por fila. Filtrar igual daría
un tablero que suma menos que la factura sin decir por qué, así que se devuelve el tablero entero
con `summary.scopeApplied: false` y la pantalla lo dice. El tenant de demo cae en ese caso a
propósito: sus grupos son un agregado a mano, sin detalle por recurso.

Dos cosas más que el alcance apaga, y el motivo: **el enriquecimiento por Resource Graph** —cuenta
todos los recursos del RG, incluidos los que el alcance dejó afuera, y un conteo de más al lado de
un costo acotado no se puede leer— y **el caché**, porque su clave sería una por
(perspective, grupo, período) y `costGroupsCacheKeys` sólo invalida las tres sin alcance: un grupo
editado dejaría vistas acotadas viejas para siempre.

Tests: `__tests__/unit/costGroupsAlcancePerspectiva.test.ts`.

### Hecho (2026-09-25): `cost-centers`, y lo que el segundo tablero enseñó

Mismo patrón, ya barato de repetir: las tres piezas comunes —las cinco dimensiones que las reglas
miran, la traducción de una fila cruda a `FilaDeCosto`, y el parseo de la columna `Tags`— viven en
`perspectivesData.service.ts` (`DIMENSIONES_DE_ALCANCE`, `comoFilaDeCosto`, `etiquetasDeColumna`) y
las consumen el export FOCUS y los dos tableros. Lo que queda por tablero es el plegado, que es
propio de cada uno.

**El hallazgo: el presupuesto no se acota.** Un presupuesto está definido para el centro de costo
ENTERO. Compararlo contra una porción diría "gastaste 150 de 10.000" cuando los 10.000 cubren todo el
centro: un margen que no existe, y un `totalBudget` que no cuadra con el `totalSpend` acotado que
tiene al lado. Bajo alcance los presupuestos vienen en `null` y la pantalla dice por qué, en vez de
dejar las celdas vacías para que se lean como "sin presupuesto".

Es la forma general del problema: **una medida definida sobre el todo no se recorta junto con el
gasto.** Cualquier tablero que adopte el alcance tiene que revisar sus medidas una por una y decidir
cuáles sobreviven al recorte, cuáles se recalculan y cuáles se ocultan. Las que se ocultan hay que
decirlas.

Medido contra la base local: 73 filas de detalle contra 1 del agregado, mismos importes y mismos
conteos de Resource Group.

Tests: `__tests__/unit/costCentersAlcancePerspectiva.test.ts`.

### Hecho (2026-09-25): `cost-projection`, el primero que no es un balde

Serie temporal en vez de agrupación por centro de costo, y el cambio de forma trajo dos trampas que
los dos anteriores no tenían:

- **El backfill de Azure no se puede acotar, y encima GANA.** Cuando `CostSnapshots` no cubre los 13
  meses, la ruta rellena con `getHistoricalDailyCosts`, que devuelve totales diarios **sin dimensión
  de recurso** y pisa a la base en las fechas que se superponen. Bajo alcance eso daría una serie
  mitad recortada y mitad no, sin que nada lo indique. Con alcance el relleno no corre: una serie más
  corta y correcta es mejor que una larga y mezclada.
- **El servicio causante de un pico** sale del mismo universo que la serie. Si no, el tooltip nombra
  un servicio que en ese alcance no gastó nada — hay un test con un pico donde sin acotar domina SQL
  y acotado a Producción el causante es otro.

Es la ventana más ancha de las tres (13 meses): medido contra la base local, 13.940 filas de detalle
contra 358 del agregado diario, con los mismos importes día por día. Sigue acotado por el mismo
argumento de siempre —la cardinalidad es la de las combinaciones distintas de dimensiones, no la del
detalle por día— pero es el número a mirar si algún tablero futuro tiene una ventana mayor.

Lo consumen las dos tarjetas de Gastos y Proyección. **`BudgetCard` no lleva el alcance a propósito**:
compara la proyección contra un presupuesto, y un presupuesto no se acota — es la misma lección que
dejó `cost-centers`.

El aviso de "se pidió acotar y no se pudo" pasó a ser un componente, `AlcanceNoAplicado`, con una
sola clave de i18n en el namespace `Perspectives`. La cuarta copia del mismo párrafo era la señal.

Tests: `__tests__/unit/costProjectionAlcancePerspectiva.test.ts`.

### Hecho (2026-09-25): los drill-through, y por qué uno sí y el otro no

Un tablero que filtra con un modal que no es peor que ninguno de los dos, así que los dos
drill-through de lo anterior se revisaron juntos. Terminaron en respuestas distintas, y el motivo es
lo que importa.

**`/api/intelligence/cost-centers/resources` — acotado, y era el urgente.** No por cosmética: esa
lista alimenta `BulkTagModal`. Con el tablero acotado a un grupo, devolver los recursos del centro
entero dejaba al usuario **etiquetando en masa recursos de fuera de su alcance** — no es mostrar de
más, es actuar de más.

El recorte va por **identificador de recurso**, no por grupo de recursos: un grupo puede tener
recursos dentro y fuera del alcance a la vez, y recortar por grupo los mandaría a todos a etiquetar.
Se intersecta lo que devuelve Resource Graph contra los `ResourceId` con costo en alcance, sin
distinguir mayúsculas (Azure los devuelve en un caso y `CostSnapshots` en otro). Un recurso sin fila
de costo queda afuera: no hay con qué probar que está en el grupo, y para etiquetar conviene quedarse
corto. Si hay filas en alcance pero ninguna trae `ResourceId` no hay con qué intersectar, y entonces
no se recorta — la lista vacía se leería como "este grupo no tiene recursos".

**`/api/cost-groups/[name]` — resuelto aparte**, en la sección siguiente: al abrirlo resultó no ser
un drill-through sino un tablero completo, con **~10 agregaciones de `CostSnapshots` más tres
consultas KQL a Resource Graph**.

Tests: `__tests__/unit/costCentersRecursosAlcance.test.ts`.

### Hecho (2026-09-25): el detalle de un Cost Group, y el alcance como predicado

Es el caso que rompe el patrón de los tres tableros anteriores, y por un motivo medible: **su grano
no colapsa**. Plegar en TypeScript funciona porque el grano del alcance —(suscripción, grupo de
recursos, servicio, recurso, etiquetas)— agrupa mucho: contra la base local, 16.822 filas son 152
combinaciones. Pero el grano que este modal necesita incluye la FECHA, más medidor y familia de
servicio, y ahí 16.822 filas siguen siendo 16.822. Traerlas para plegar diez veces no escala.

**La salida fue invertir el planteo: en vez de llevar las filas al evaluador, llevar el resultado del
evaluador a SQL.** Las mismas 16.822 filas dan sólo **51 ternas** de (suscripción, grupo de recursos,
recurso) — `service_name` no entra porque ninguna regla lo mira, `matchea()` sólo lee etiquetas,
recurso, suscripción y grupo—. Se corre `evaluarFila` sobre ellas una vez y el resultado viaja como
un `IN` de ternas que se pega a `tagFilter`. Las diez agregaciones lo heredan **sin que ninguna se
toque**, y las tres consultas KQL se acotan con el mismo conjunto.

No es una segunda implementación del evaluador —lo que va a SQL es el resultado, no las reglas—, que
era la objeción que descartó generar `CASE WHEN` en primer lugar.

**Dos detalles que sólo aparecen midiendo.** El `COALESCE` en las tres columnas no es defensivo:
`NULL` nunca es igual a `NULL`, y como todo lo que ingesta el sync tiene `ResourceId` en NULL, sin él
el predicado no matchearía nada y el modal saldría vacío en vez de acotado. Y el riesgo real no era
el recorte sino **el orden de los parámetros**: las diez consultas los arman distinto —unas ponen
fechas antes del `WHERE`, otras después— y un `?` de más es un error de producción que el typecheck
no ve; hay un test que cuenta placeholders contra parámetros en todas.

**Cuándo se niega, que es lo que lo hace honesto.** Si una terna cae de los dos lados del alcance —el
mismo recurso con dos juegos de etiquetas en la ventana, porque cambió de entorno— SQL no puede
separar esas filas y recortar igual atribuiría el gasto de enero al grupo de junio. Igual si hay más
ternas que el tope (2.000, o 500 cuando hace falta el `IN` de identificadores en KQL). En los dos
casos se devuelve el tablero entero y se dice, como en el resto de MEJ-34.

Sobre las consultas KQL: acotarlas por `resourceGroup` es **exacto** cuando ningún grupo de recursos
está partido entre dentro y fuera —y eso lo garantiza la misma verificación de ambigüedad—. Cuando sí
lo está, se acota por `id`. El `limit 200` de la lista de recursos no cambió de significado porque
las dos consultas `summarize` siguen siendo consultas aparte, acotadas por el mismo predicado.

Verificado contra la base local: el predicado corre en 20 ms sobre 51 ternas, recorta de 16.822 filas
a 7.956, y las dos formas de consulta más riesgosas —la de `CASE WHEN` con placeholders antes del
`WHERE`, y la de `GROUP BY` con la fecha al final— se ejecutan sin error.

Tests: `__tests__/unit/recorteDeAlcance.test.ts`, `__tests__/unit/costGroupDetalleAlcance.test.ts`.

### Hecho (2026-09-25): el lote, y el error que se repitió tres veces

Con el predicado, adoptar un tablero pasó a ser una consulta de dimensiones y un fragmento pegado al
WHERE. Se empaquetó en `alcanceDeLaRuta(tenantId, searchParams, ventana)`, que devuelve el ` AND ...`
y sus parámetros: **la pizarra ejecutiva, el scorecard y el forecast por servicio** lo adoptaron así,
y `cost-projection` pasó del plegado al predicado.

**`cost-projection` se queda con los dos mecanismos, y a propósito.** El predicado es el camino bueno
—la agregación no sale de la base— pero se niega ante una terna ambigua, y con 13 meses de ventana un
recurso que cambió de etiqueta es más probable que en los otros tableros. El plegado, que ya estaba
escrito, queda de respaldo: la serie se acota siempre y sólo paga el detalle —13.940 filas medidas
contra la base local— cuando el predicado no alcanza.

**EL ERROR QUE SE REPITIÓ TRES VECES, Y QUE CONVIENE NO REPETIR UNA CUARTA.** Elegí las rutas de la
lista de "las que leen `CostSnapshots`" sin comprobar cuáles llama la UI. Resultado:

- **`/api/intelligence/forecast`**: el GET, que es el que la UI usa, lee Azure en vivo y no
  `CostSnapshots`. Lo que se acotó es el POST, que `docs/forecasting.md` documenta como API pero
  ninguna pantalla llama. Correcto, pero no mueve la aguja.
- **`/api/intelligence/scorecard`**: es la ruta legacy. La UI usa `/api/analytics/scorecard`, que sale
  de Cost Management y Resource Graph.
- **`/api/intelligence/whiteboard`**: es sólo el ensamblado. La UI llama a `/api/overview/whiteboard`,
  un proxy que reenviaba `tenantId`, `locale`, `mock` y `bust` — **y nada más**. El recorte quedaba
  escrito y sin forma de llegar. Ahí sí se arregló: el proxy reenvía los dos parámetros y saltea su
  propio caché, que es un segundo caché con su propia clave sin alcance.

La lección para el resto: **la lista de rutas que leen `CostSnapshots` no es la lista de tableros.**
Antes de tocar una, verificar quién la llama desde `src/components`, y si hay un proxy en el medio,
que reenvíe.

Tests: `__tests__/unit/forecastYScorecardAlcance.test.ts`, `__tests__/unit/whiteboardAlcance.test.ts`.

### Contexto

Hoy un Cost Group es **el valor del tag `CostCenter`** (`src/app/api/cost-groups/route.ts:5`),
más una heurística de patrones de nombre para agrupar los Resource Groups sin etiquetar.
Es **una sola dimensión**.

CloudHealth modela esto con *Perspectives*: **N dimensiones simultáneas** —producto,
equipo, dueño, entorno, unidad de negocio, función, centro de costo— donde un recurso
pertenece a **exactamente un grupo dentro de cada Perspective**, y a la vez a grupos de
Perspectives distintas. El mismo disco puede estar en "producción" de la Perspective
Entorno y en "ingeniería" de la Perspective Centro de Costo.

**Por qué es la entrada estructural y no una más.** En el paper, todo lo demás se filtra
por Perspective: los reportes, el alcance de las políticas, las recomendaciones de
rightsizing y el split COGS/OpEx. Acá pasaría lo mismo — y habilita filtrar por unidad de
negocio el cockpit de Cosmos (MEJ-18) y el mapa de egress (MEJ-19), que hoy sólo podrían
filtrar por suscripción.

Es también el prerrequisito de MEJ-37: sin poder separar COGS de OpEx no hay margen bruto.

### Adoptado — el tablero de Almacenamiento (2026-09-27)

Séptima superficie. Lo que tiene de distinto, y por qué costó más que las anteriores: **el costo
de storage no sale de una tabla, sale de tres**, y sólo una tiene con qué evaluar una Perspective.

| Tabla | Dimensiones | ¿Se puede recortar? |
|---|---|---|
| `CostSnapshots` | `subscription_id`, `resource_group`, `ResourceId`, `Tags` | **sí** |
| `CostMeterSnapshots` | `tenant_id`, `subscription_id` | no |
| `CostCategorySnapshots` | `tenant_id`, `subscription_id` | no |

Verificado contra `information_schema`, no supuesto. Las dos rutas —`storage-efficiency` y
`storage/service-cost`— **prefieren** las tablas sin dimensiones porque tienen mejor grano, y caen
a `CostSnapshots` como respaldo. Con un alcance activo eso se invierte: se va directo al respaldo.
Se pierde grano de medidor y se gana un número que es de quien dice ser. Servir el total de
medidores bajo alcance mostraría el gasto de todo el tenant; mezclar una mitad recortada con otra
que no lo está daría un número que no es de nadie.

**El caso que no se podía dejar pasar en silencio.** Si hay datos de storage pero **sólo** en la
tabla que no se puede recortar, la pantalla vacía diría "tu grupo no tiene storage" — falso. Por
eso `runQuery` devuelve `source: 'no-acotable'` y el tablero informa `alcanceAplicado: false`, que
es el mismo aviso que ya usan los otros. Como permiso, `exigirRecorte` corta con 403.

**Y la clave de caché.** Era `storage-service-cost:v3:{tenant}:{family}`, sin el alcance. Con el
recorte fuera de la clave, la porción del primero que entrara se le habría servido a todo el
tenant durante las 6 h del TTL. No es rendimiento: es la fuga, escrita en Redis. Ahora la clave
lleva Perspective y grupo.

Las dos rutas entran juntas al mapa de MEJ-38 a propósito: con una sola, la pantalla mostraría un
total acotado y un desglose por familia hablando de otro universo.

**De paso se arregló el test que cuidaba la consistencia página ↔ API.** Comparaba el último
segmento de la URL contra el nombre de la ruta, y pasaba de casualidad porque las cinco pantallas
anteriores se llamaban igual de los dos lados. La primera cuyo nombre no coincide con el de su API
lo rompió sin que hubiera nada mal. Ahora `PAGINAS_CON_ALCANCE_Y_SUS_RUTAS` declara qué rutas
necesita cada página y el invariante se comprueba de verdad.

**Cómo se eligió este tablero, que es el método que faltaba.** Cruzando las 245 páginas reales
contra las 41 rutas que agregan `CostSnapshots`: quedan **9 candidatos**, no 41. La diferencia es
la lección ya anotada acá —*la lista de rutas que leen `CostSnapshots` NO es la lista de
tableros*—, ahora aplicada con un script en vez de a ojo.

### Adoptado — el simulador What-If (2026-09-27)

Octava superficie, y la más barata de todas: **todo el simulador proyecta porcentajes sobre UN
número**, el gasto base de los últimos 30 días. Recortar ese número alcanza. Con el alcance puesto,
"¿qué pasa si mi equipo crece 20%?" se responde sobre el gasto de su equipo y no sobre el del
tenant — que es la pregunta que alguien con un equipo a cargo realmente se hace, y la que la
pantalla venía contestando mal sin avisar.

No entra en el mapa de MEJ-38 a propósito: la pantalla también lista los **escenarios guardados**
del tenant, que no se recortan. Un usuario acotado vería los de los demás.

Tests: `__tests__/unit/simuladorAlcance.test.ts` (5).

### Medido y BLOQUEADO — `intelligence/ai-analytics`

Se abrió y no se puede acotar todavía, por un motivo que no está en la pantalla sino en la ingesta.

Su fuente primaria es `AICostSnapshots`, que tiene `subscription_id`, `resource_group` y `tags`
—tres de las cuatro dimensiones— pero **no tiene `ResourceId`**: guarda `resource_name`, que no es
el id ARM contra el que matchean las reglas. Y el predicado de alcance se arma sobre la terna
`(subscription_id, resource_group, ResourceId)`, así que sobre esa tabla no compila.

Se descartó filtrar sólo por resource group: sería **más inclusivo que el alcance**, mostrando
recursos de IA que caen en un RG en alcance aunque la regla sea por etiqueta. Un recorte que muestra
de más no es un recorte.

**Para desbloquearlo hay que sumarle `ResourceId` a la ingesta de `AICostSnapshots`**, no tocar la
pantalla. Anotado acá para que el próximo no vuelva a medirlo.

Detalle que vale la pena: esa ruta ya agrupa por un `team` sacado a mano de `Tags.$.Team`. Es
exactamente lo que Perspectives generaliza, así que cuando se desbloquee, el agrupador hecho a mano
se puede retirar.

Quedan como candidatos medidos: `dashboard/summary` y `analytics/macc`.

Sobre los dos que quedan: `dashboard/summary` es **el más caro y no el más barato**, aunque parezca lo
contrario: su `actualCost` primario no sale de `CostSnapshots` sino de un auto-fetch al forecast
(Azure en vivo), y el ahorro y los zombies de otro a `audit/full`. Acotarlo exige acotar esos dos
antes. `analytics/macc` se descarta: un compromiso contractual es del tenant entero, y recortarlo
mentiría igual que recortar un presupuesto.

Tests: `__tests__/unit/almacenamientoAlcance.test.ts` (9).

---

### El hueco que bloqueaba toda la cadena (2026-09-27)

**No se podía crear una Perspective desde el producto.** El `POST` y el `DELETE` existían en la
API desde el principio y **no los llamaba nadie**: `PerspectivesBoard` sólo sabía listar (`GET`),
editar reglas de una existente (`PUT`) y previsualizar (`POST /breakdown`).

Peor: con cero Perspectives la pantalla renderizaba **únicamente** el párrafo *"Todavía no hay
Perspectives. Creá la primera…"*. El selector, el editor de reglas y los botones estaban todos
dentro del `else`, o sea que sólo aparecían **si ya existía una**. El texto invitaba a hacer algo
que la pantalla no permitía, y el único camino era pegarle a la API con `curl`.

Eso explica por qué la cadena entera —el selector transversal, MEJ-35, MEJ-37 y MEJ-38— no se podía
arrancar: nadie podía crear la primera.

Ahora el alta vive **fuera del condicional**, así que existe tanto con cero como con varias. Nace
**sin reglas** a propósito: con una regla vacía de arranque, la vista previa mostraría un grupo sin
nombre y el "sin asignar" al 100%, que se lee como que algo falló. El borrado pregunta antes, con el
nombre a la vista, porque se lleva las reglas por CASCADE y deja sin alcance a quien la tuviera
asignada.

**Y de paso, un segundo hueco en el interceptor de demo.** La intercepción de
`/api/intelligence/perspectives` matcheaba por URL **sin mirar el método**, a diferencia de otras
del mismo archivo que sí lo hacen. Un `POST`/`PUT`/`DELETE` recibía la LISTA como respuesta: `res.ok`
daba `true`, la pantalla decía *"creada"* y no aparecía nada. Es la falla que MEJ-03 persigue — no
rompe, miente. Ahora una escritura en demo contesta 403 con *"La demo no guarda cambios: las
Perspectives son de ejemplo"*, y la pantalla lo muestra.

Verificado en el navegador contra el servidor local: los cinco botones presentes, el alta habilita
el botón al escribir, y el aviso de la demo aparece sin falso éxito.

### Propuesta

1. **Perspectives definidas por reglas, no por lista manual.** Cada una es un conjunto
   ordenado de reglas que asignan un recurso a un grupo: por par tag clave/valor, por
   patrón de nombre, por suscripción, por resource group o por tipo de recurso.
2. **Primera regla que matchea gana**, y el orden se edita. Es lo que hace determinista
   la pertenencia única dentro de una Perspective sin pedirle al usuario que resuelva
   conflictos a mano.
3. **Grupo `Sin asignar` explícito y siempre visible**, con su costo. Una Perspective que
   cubre el 60% del gasto y no lo dice es peor que no tenerla: el reporte se lee como si
   fuera el total. El caso de Yelp que cita el paper es exactamente ese — dos Perspectives
   cubrían el 80% y la meta era 95%.
4. **Selector de Perspective transversal**, como filtro en los tableros que hoy filtran
   por suscripción.

### Modelo de Implementación Detallado

- **Base de Datos y Esquema:**
  - `Perspectives` (`id`, `tenant_id`, `name`, `description`, `created_at`).
  - `PerspectiveRules` (`id`, `perspective_id`, `group_name`, `match_type`
    ENUM('tag','name_pattern','subscription','resource_group','resource_type'),
    `match_key`, `match_value`, `sort_order`).
  - **Sin tabla de asignación materializada.** La pertenencia se evalúa contra
    `CostSnapshots` en la consulta: materializarla obliga a recalcular todo ante cada
    cambio de regla y a resolver qué pasa con el histórico, que es una discusión que no
    hace falta tener.
- **Backend y APIs:**
  - `src/services/perspectives.service.ts` con el evaluador de reglas y un `CASE WHEN`
    generado para el `GROUP BY`. Ojo con el costo: las reglas van parametrizadas, nunca
    interpoladas en el SQL.
  - `GET/POST/PUT/DELETE /api/intelligence/perspectives` y
    `GET /api/intelligence/perspectives/[id]/breakdown`.
- **Frontend y Visualización:**
  - `/intelligence/perspectives` para definirlas, con **vista previa del reparto antes de
    guardar**: cuánto gasto cae en cada grupo y cuánto queda sin asignar.
- **Caché y Cron:** `perspective:breakdown:v1:{tenantId}:{perspectiveId}:{periodo}`, TTL 6 h,
  invalidada al editar reglas.

### Archivos Involucrados (Estimados)

- `migrations/YYYYMMDD-NNN-perspectives.sql`
- `src/services/perspectives.service.ts`
- `src/app/api/intelligence/perspectives/route.ts`
- `src/components/dashboard/PerspectivesBoard.tsx`

### Criterios de Aceptación

1. Un recurso cae en **un solo grupo por Perspective**, y el que decide es la primera regla
   que matchea según el orden.
2. El mismo recurso puede estar en grupos de Perspectives distintas.
3. El costo **sin asignar** se muestra siempre, con su monto y su porcentaje.
4. La suma de los grupos más lo sin asignar **da exactamente** el total del período. Sin
   esto la pantalla no es auditable.
5. Cambiar el orden de las reglas cambia el reparto en la vista previa sin guardar nada.

---

## MEJ-35 — Suscripciones a reportes: cualquier reporte, a la cadencia que elija el usuario

**Módulo:** Reportes · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (2026-09-27)

### Contexto

Hoy hay dos entregas programadas y las dos son **fijas y de un solo tipo**: el export FOCUS
diario (`cron/focus-export-daily`) y el envío del reporte ejecutivo. No hay forma de que un
dueño de centro de costo diga "mandame el desvío de mi grupo los lunes".

El paper lo trata como la mecánica que sostiene la fase de integración con el negocio:
reportes suscribibles a la frecuencia que elija cada quien, con link, imagen y CSV de los
datos crudos. Es lo que hace que el dato llegue al que decide **sin que tenga que entrar
a buscarlo** — y en una herramienta de FinOps, el reporte que hay que ir a buscar no se mira.

### Propuesta

1. **Suscripción por reporte**: destinatarios, frecuencia (diaria, semanal con día,
   mensual con día del mes) y alcance (suscripción, Cost Group o Perspective de MEJ-34).
2. **El correo lleva las tres cosas**: link al reporte vivo, imagen del gráfico y CSV
   adjunto. El CSV no es un extra — es lo que permite que finanzas lo cruce con su modelo
   sin pedirle nada a nadie.
3. **Un solo cron evaluador** que resuelve qué suscripciones vencen en esta corrida, en vez
   de un cron por tipo de reporte. Hoy ya hay 26 jobs; sumar uno por reporte no escala.

### Modelo de Implementación Detallado

- **Base de Datos y Esquema:**
  - `ReportSubscriptions` (`id`, `tenant_id`, `report_type`, `scope_json`, `recipients_json`,
    `frequency` ENUM('daily','weekly','monthly'), `day_of_week`, `day_of_month`,
    `last_sent_at`, `active`, `created_by`).
  - `last_sent_at` es el que hace idempotente la entrega: el cron manda sólo si el período
    que corresponde es posterior. Sin eso, dos corridas del mismo día mandan dos veces.
- **Backend y APIs:**
  - `GET/POST/DELETE /api/reports/subscriptions`, con `requireTenantRole(['Admin','Owner'])`
    para crear: una suscripción manda correo a terceros y eso no es una acción de lectura.
  - Cron `report-subscriptions` cada hora, que reusa `sendEmailStrict` y los generadores
    que ya existen.
- **Frontend y Visualización:** panel de suscripciones en `/reports`, con "enviar ahora"
  para probar sin esperar a la cadencia.

### Archivos Involucrados (Estimados)

- `migrations/YYYYMMDD-NNN-report-subscriptions.sql`
- `src/services/reportSubscriptions.service.ts`
- `src/app/api/cron/report-subscriptions/route.ts`
- `src/components/reports/ReportSubscriptionsPanel.tsx`

### Criterios de Aceptación

1. Una suscripción semanal se manda **una sola vez** por semana aunque el cron corra 168 veces.
2. El correo trae link, imagen y CSV.
3. El alcance se respeta: quien se suscribe a su Cost Group no recibe el gasto de los demás.
4. Una suscripción de un usuario dado de baja no sigue mandando.

---

### Hecho (2026-09-27)

`migrations/20260927-003-report-subscriptions.sql`, `reportSubscriptions.service.ts` (puro),
`reportRenderers.service.ts` (registro de generadores), `reportDispatch.service.ts`,
`GET/POST/DELETE /api/reports/subscriptions`, `cron/report-subscriptions` cada hora, y una
pestaña en el hub de Reportes que ya existía. Los cuatro criterios cumplidos.

**El criterio 1 es el que manda.** El cron corre cada hora: una suscripción semanal lo ve 168
veces. `last_sent_at` se compara contra el **comienzo del período**, no contra "hace 7 días": con
una ventana móvil, una corrida que se atrasa una hora correría el horario de todas las siguientes
hasta desalinearse del día. Hay un test que simula las 168 corridas y exige exactamente un envío.

**La cadencia se evalúa en la zona del TENANT.** "Los lunes" tiene que ser el lunes del cliente:
lunes 00:30 en Buenos Aires es domingo 21:30 en UTC, y con la zona del servidor la semanal se
dispararía un día antes para medio mundo. Se usa `Intl` y no aritmética de offsets porque un offset
fijo se rompe dos veces al año con el horario de verano — el mismo motivo por el que
`Tenants.timezone` existe.

**Un día 31 no se saltea febrero**: se recorta al último día del mes. Sin eso, una suscripción "el
31" no llegaría nunca en los meses cortos, y **la ausencia de un correo no avisa** — es la falla
silenciosa peor de las dos posibles.

#### El gráfico va en HTML, no como imagen, y es una decisión con motivo

El criterio 2 pide "imagen del gráfico". Se entrega como barras hechas con celdas de tabla y
`background-color`, no como PNG. Tres razones, la última suficiente por sí sola:

1. Un PNG exige renderizar del lado del servidor —puppeteer o chartjs-node-canvas—: dependencias
   pesadas para mandar un mail, y el repo hoy no tiene ninguna (sólo `jspdf`).
2. La salida usual sin dependencia es un servicio externo tipo QuickChart, que implica **mandarle
   el costo del cliente a un tercero**. No se hace.
3. **Gmail no renderiza SVG inline y Outlook tampoco.** Una imagen que no se ve no es una imagen.

#### El error que sólo apareció al probar contra la base real

La primera versión de la migración ponía `COLLATE utf8mb4_unicode_ci` en `tenant_id` —por la FK— y
**no en `created_by`**. Pero `created_by` se compara con `Users.email` en el `LEFT JOIN` del cron, y
`Users.email` es `utf8mb4_unicode_ci` mientras que una tabla nueva en MySQL 8 nace
`utf8mb4_0900_ai_ci`: **ERROR 1267, Illegal mix of collations**. En el cron, en producción, y no al
desplegar.

Typecheck y 3.676 tests no lo vieron, y no podían: los tests mockean la base. Lo encontró correr la
consulta del cron contra MySQL de verdad. Es la tercera vez que este repo tropieza con la misma
colación y por eso queda escrito: **la regla no es "todas las columnas llevan COLLATE"** —107 de 113
columnas de riesgo no lo llevan y están bien— sino que lo necesitan **las que se comparan
columna contra columna entre tablas**. Contra un parámetro no hace falta: el literal adopta la
colación de la columna. Se descartó un test guardián general justamente porque nacería en rojo
sobre 107 filas legítimas.

#### Otras decisiones que quedaron fijadas en tests

- **Un reporte sin datos no se manda.** Un correo con la tabla vacía se lee como "tu equipo no gastó
  nada", que es una afirmación sobre la factura del cliente y casi siempre es falsa: lo normal es
  que la ingesta todavía no corrió. Se omite, pero el cron lo reporta y la corrida queda en
  `warning` — callar es más honesto que afirmar mal; callar en silencio no.
- **Un correo por destinatario**, no todos en el mismo: nadie se entera de a quién más le llega, y
  un rebote no se lleva puesto el envío del resto.
- **Si no salió ninguno, no se marca el período.** Marcarlo igual convertiría una caída de Graph en
  un período perdido, y nadie reclama un correo que no sabe que existía.
- **"Enviar ahora" no toca `last_sent_at`.** Si lo tocara, la prueba se comería el envío real de la
  semana. Y usa exactamente el mismo camino que el envío programado: si fueran dos, la prueba podría
  andar y el envío real no.
- **El correo de un solo grupo no informa el "sin asignar" del tenant** —no es información suya—,
  pero el de la vista completa sí, porque si no el total no cuadra con la factura.
- El cron se registró en `infra/terraform/environments/prod/cron-jobs.tfvars`. **El apply va por CI**,
  nunca local.

Tests: `__tests__/unit/suscripcionesCadencia.test.ts` (14) y `suscripcionesEnvio.test.ts` (13).

### Lo que queda

- **Un solo tipo de reporte por ahora** (`gasto-por-equipo`, que es el caso que la propuesta nombra:
  "mandame el desvío de mi grupo los lunes"). La arquitectura es un registro, así que sumar otro es
  registrar una función; lo que no se hizo es escribirlos.
- **El panel no valida la Perspective contra la lista**: se escribe el id a mano. Funciona, pero es
  el lugar obvio para un selector.

---

## MEJ-36 — Presupuestos: rollover y año fiscal no calendario

**Módulo:** Presupuestos · **Impacto:** Medio · **Esfuerzo:** Bajo · **Estado:** Propuesta

### Contexto

**Rollover no existe en el repo** (cero coincidencias al 2026-09-23) y el año fiscal
aparece sólo de forma incidental, no como configuración del tenant.

Son dos supuestos del código que no se cumplen en muchas empresas: que el presupuesto no
ejecutado se pierde a fin de mes, y que el año fiscal arranca en enero. Para un cliente
cuyo ejercicio empieza en abril, **todos los acumulados anuales de la plataforma están
corridos tres meses** — y no lo dice en ningún lado, que es lo peor de los dos.

### Propuesta

1. **Rollover opcional por presupuesto.** Lo no gastado en el mes se suma al siguiente,
   con tope configurable y sin arrastrar el sobregiro: un mes en rojo no debe endeudar al
   siguiente sin que alguien lo decida.
2. **Mes de inicio del año fiscal por tenant**, que gobierna los acumulados anuales y los
   cortes de los reportes.
3. **Mostrar el presupuesto efectivo y el base por separado.** Un presupuesto de 10.000 que
   hoy tolera 13.000 por arrastre tiene que decirlo, o el número se lee como que se gastó
   de menos.

### Modelo de Implementación Detallado

- **Base de Datos y Esquema:** en `CostCenterBudgets`, `rollover_enabled` TINYINT(1),
  `rollover_cap_usd` DECIMAL(12,4) NULL; en `Tenants`, `fiscal_year_start_month`
  TINYINT DEFAULT 1.
- **Backend:** el cálculo del arrastre va **en un solo helper** consumido por el panel, las
  alertas y los reportes. Si cada consumidor lo recalcula, divergen — es el patrón que
  MEJ-32 documenta como recurrente en este repo.
- **Frontend:** en el panel, el remanente arrastrado como línea aparte del presupuesto base.

### Criterios de Aceptación

1. Con rollover apagado el comportamiento es **idéntico al de hoy**.
2. El arrastre nunca supera el tope, y un mes sobregirado arrastra cero, no negativo.
3. Con año fiscal en abril, el acumulado anual de mayo cuenta dos meses y no cinco.
4. La UI distingue presupuesto base de presupuesto efectivo.

### Hecho (2026-09-26)

**El defecto medido antes de tocar nada.** El año fiscal estaba cableado a enero en **cuatro**
lugares: el `fiscalYearRange` del whiteboard —que alimenta el acumulado anual, su comparación contra
el año anterior y la proyección—, el período `fy` de `cost-groups`, y `getCurrentFY` y
`getPeriodComparison` del detalle. Para un cliente con ejercicio en abril, los cuatro estaban
corridos tres meses y ninguno lo decía.

**No todo "desde el 1 de enero" es un año fiscal**, y esa distinción decidió el alcance. El `ytd` del
Invoicing Report significa literalmente "año en curso desde el 1 de enero": es una opción con ese
nombre que el usuario elige, y hacerla seguir al ejercicio del cliente sería redefinir en silencio lo
que pidió. Queda como está.

**La proyección era el error silencioso de segundo orden.** No alcanzaba con mover el inicio del
rango: `costProjected` dividía el acumulado por los días **desde enero** y multiplicaba por 365. Con
ejercicio en abril eso infla el divisor y la proyección sale baja — un número tranquilizador y falso.
Ahora divide por los días del ejercicio y multiplica por su duración, que en un ejercicio que cruza
un febrero bisiesto son 366.

**Dos reglas del arrastre que no son obvias**, las dos con test:

- Un mes en rojo arrastra **cero, no negativo**. Endeudar al mes siguiente con el sobregiro del
  anterior es una decisión financiera que nadie tomó, y convierte un desvío puntual en una cadena de
  meses en rojo que no se puede leer.
- El tope se aplica **en cada paso** y no al final, que es lo que el panel muestra mes a mes.

El arrastre cuesta una consulta extra **sólo si alguien lo encendió**: con todos los presupuestos
apagados —el default— el tablero vale exactamente lo mismo que antes.

En la respuesta del tablero, `budget` pasa a ser el **efectivo** porque es contra lo que el mes se
mide, y `budgetBase`/`budgetRollover` viajan aparte. La pantalla muestra el arrastre como un badge
con su desglose: un presupuesto de 10.000 que este mes tolera 13.000 tiene que decirlo, o el mes se
lee como que se gastó de menos.

El mes de inicio vive en `/api/admin/tenant-settings` y no en una ruta propia — es otra preferencia
que gobierna dónde se corta un período, igual que la zona horaria. Ahí **se rechaza** un mes fuera de
rango en vez de caer a enero: el helper cae a enero porque lee de la base y prefiere el
comportamiento de siempre a un rango inventado, pero cuando hay alguien eligiendo, elegir mal tiene
que doler.

Verificado contra el MySQL local: la migración aplica, y los dos defaults dejan a los 3 tenants en
enero y a los 2 presupuestos sin arrastre — o sea que desplegarlo no mueve un solo número.

Tests: `__tests__/unit/anioFiscalYArrastre.test.ts` (el helper),
`__tests__/unit/anioFiscalEnLasRutas.test.ts` (el cableado, que era lo que estaba roto).

> **2026-10-04 — con pantalla.** El arrastre y su tope se editan en la tabla de Presupuesto por Grupos
> de Costos, y el año fiscal en Configuración → General. Al hacerlo salieron dos bugs: guardar el monto
> desde la tabla APAGABA el arrastre (el PUT pisaba los campos que no venían; ahora los conserva) y el
> campo arrancaba con el presupuesto efectivo, así que guardar inflaba la base con lo arrastrado. Cambiar
> el ejercicio invalida los cachés de Cost Groups, Centros de Costo y el Whiteboard (éste, de hasta 12 h).

---

## MEJ-37 — Leaderboard de equipos y margen bruto

**Módulo:** Integración con el negocio · **Impacto:** Medio · **Esfuerzo:** Bajo · **Estado:** Hecha (2026-09-27)

### Contexto

Es la única sección del paper sin ninguna contraparte en el repo: cero coincidencias de
gamificación o ranking. El documento le dedica dos casos de cliente, y el más concreto es
el de Segment — margen bruto cayendo, descubren que el driver era el **costo por millón de
llamadas a la API**, y con eso lo enderezan.

La plataforma ya tiene `unit-economics`; lo que falta es el otro lado: **comparar equipos
entre sí** y poder separar COGS de OpEx.

### Propuesta

1. **Leaderboard por grupo** —de una Perspective de MEJ-34— con gasto del período,
   variación contra el anterior, adherencia al presupuesto y ahorro capturado.
2. **Ordenar por mejora, no por gasto.** Un ranking por gasto absoluto premia al equipo
   chico y castiga al que corre producción; uno por variación y por ahorro capturado premia
   al que optimizó, que es el comportamiento que se busca.
3. **Marcar una Perspective como COGS/OpEx** y exponer el split, que es lo que permite
   llevar el costo de nube a un cálculo de margen bruto.

### Modelo de Implementación Detallado

- **Base de Datos:** ninguna tabla nueva. Sale de `CostSnapshots` más las reglas de MEJ-34
  y `CostCenterBudgets`; sólo se agrega `cogs_classification` ENUM('COGS','OPEX','UNCLASSIFIED')
  a nivel de grupo de Perspective.
- **Backend:** `GET /api/intelligence/leaderboard`, ~~tier Business~~ → **tier Enterprise**
  (corregido el 2026-09-27: ver abajo).
- **Frontend:** `/intelligence/leaderboard`, con el split COGS/OpEx como tarjeta aparte.

### Fase 2 — métricas de negocio para costo por cliente

Es lo que hace fuertes a CloudZero y Finout, y lo que el caso de Segment del paper de
CloudHealth describe: ingerir una métrica del negocio —clientes activos, transacciones,
llamadas a la API— y dividir el costo por ella. Hoy hay 0 coincidencias de costo por
cliente o por feature en el repo.

Va como fase 2 de esta entrada y no aparte porque comparte el eje: el margen bruto sale de
cruzar costo con negocio, y sin la métrica del negocio no hay margen que calcular. Alcanza
con un endpoint de ingesta (`POST /api/v1/business-metrics`, misma API Key pública) y una
serie temporal por tenant; el resto es dividir.

### Criterios de Aceptación

1. El ranking ordena por mejora y el criterio está escrito en pantalla.
2. Los grupos sin presupuesto aparecen igual, con la columna vacía, no excluidos.
3. El split COGS/OpEx suma el total, con `UNCLASSIFIED` visible.
4. **Nadie con acceso al tenant ve un ranking que no puede explicar**: cada fila lleva al
   desglose de ese grupo. Un leaderboard sin drill-down genera discusión, no optimización.

---

### Hecho — fase 1 (2026-09-27)

`src/services/leaderboard.service.ts` (puro), `GET/PUT /api/intelligence/leaderboard`,
`/intelligence/leaderboard`, migración `20260927-002-perspective-cogs.sql`. Los cuatro criterios
cumplidos.

**El orden, que es la mejora entera.** Se ordena por la baja porcentual contra el período anterior
y, a igual variación, por ahorro capturado. Las dos miran comportamiento y no tamaño. Y hubo que
resolver **dos casos que lo habrían roto**, los dos con test:

- **Un grupo sin período anterior no se rankea.** No mejoró ni empeoró: no hay contra qué
  compararlo. Ponerlo primero lo premiaría por haber nacido y ponerlo último lo castigaría por lo
  mismo. Aparece en la tabla, marcado, fuera del orden.
- **Un grupo por debajo del 1% del gasto no se rankea.** Sin ese piso, uno que pasó de 1 a 0,50
  dólares muestra −50% y le gana al equipo que recortó 50.000 con un −10%: el ranking premiaría al
  ruido. El umbral va en la respuesta, no escondido en el código, para que la pantalla lo diga.

**El presupuesto se cruza por NOMBRE, y es una convención, no un dato.** Un grupo de Perspective y
un centro de costo son cosas distintas y no hay clave que los una. Cuando no coincide, la columna
queda **vacía** en vez de mostrar el presupuesto de otro equipo, que sería peor que no mostrar
ninguno. Es el criterio 2 y está en el test.

**El ahorro capturado sale de remediaciones aprobadas Y con resultado de ejecución ARM**, no
aprobadas a secas: aprobar es una intención, y esta columna afirma que ya se hizo. El enum de
`status` no tiene un valor "ejecutada" —es `Pending/Approved/Rejected/Failed`—, así que la
evidencia de que corrió es que exista el resultado de la llamada.

Y se atribuye con **las mismas reglas** que el costo: las remediaciones entran a `repartir` como
filas de costo. Una segunda forma de decidir de qué equipo es un recurso sería una segunda forma de
equivocarse. Con una consecuencia que se asume explícita: `RemediationRequests` no guarda
etiquetas, así que **una Perspective cuyas reglas sean por tag no puede atribuir ahorro** y esos
montos caen en `sinAsignar`. Inventar la etiqueta desde el nombre del recurso pondría el ahorro en
el equipo equivocado.

**Tabla propia y no una columna.** Un grupo de Perspective no es una fila en ningún lado: existe
sólo como el `group_name` que repiten las reglas. Poner `cogs_classification` en `PerspectiveRules`
obligaría a repetir la clasificación en cada regla y a resolver qué pasa cuando dos reglas del
mismo grupo dicen cosas distintas — una inconsistencia que la base no podría impedir. Tampoco se
guarda una fila `UNCLASSIFIED`: sin fila ya está sin clasificar. Verificado contra MySQL real: el
upsert no duplica y borrar la Perspective cascadea la clasificación.

**Sin Perspective definida el tablero lo dice**, en vez de devolver una tabla vacía que se leería
como "nadie gastó".

No la ve un usuario con alcance asignado: un leaderboard es una comparación **entre** grupos y su
recorte es justamente no ver los otros. El default-deny de MEJ-38 la niega sin escribir nada.

**Corrección de tier (2026-09-27): Enterprise, no Business.** La propuesta decía Business y era
inconsistente consigo misma: este tablero rankea **los grupos de una Perspective**, y Perspectives
es Enterprise. Un tenant Business veía la entrada en el menú, la abría, encontraba *"todavía no hay
ninguna definida"* y un link a "Definir una" que `RouteTierGate` le bloqueaba. Un callejón sin
salida con una promesa que el tier no permite cumplir. Se subió en los tres lugares —`routeTiers`,
Sidebar y el `requireTenantTier` de la ruta— porque con uno solo la puerta queda entreabierta.

Tests: `__tests__/unit/leaderboardDeEquipos.test.ts` (19, la función pura y el margen) y
`leaderboardRuta.test.ts` (8, los cruces).

### Hecho — fase 2: margen bruto (2026-09-27)

**La fase 2 estaba casi entera y la entrada no lo sabía.** La propuesta pedía "un endpoint de
ingesta (`POST /api/v1/business-metrics`, misma API Key pública) y una serie temporal por tenant; el
resto es dividir". Al abrirlo:

| Lo que pedía la fase 2 | Estado real |
|---|---|
| Endpoint de ingesta con API Key | **ya existía** — `POST /api/unit-metrics/ingest`, scope `write:metrics` |
| Serie temporal por tenant | **ya existía** — `TenantUnitMetrics`, con upsert y validación por lote |
| Dividir costo por la métrica | **ya existía** — `calcUnitCost`, elasticidad, atribución por servicio |
| **Ingresos** | **no existía**: el ENUM de `metric_type` no tenía `REVENUE` |

O sea que el trabajo real era una línea de ENUM y el cálculo del margen, no un módulo. No se creó
`/api/v1/business-metrics`: habría sido un segundo endpoint de ingesta para la misma forma
—tenant, fecha, número— con su propia validación y su propio upsert.

**`REVENUE` es dinero, no un conteo, y eso tiene consecuencia.** Se excluye del selector de
denominador de Unit Economics: "costo por unidad de REVENUE" es una división válida —da uno menos el
margen— pero la pantalla la rotula "costo por unidad" y se leería como otra cosa. `ES_VOLUMEN` lo
deja explícito en vez de confiar en que nadie la elija.

**El margen se informa como RANGO cuando hay gasto sin clasificar**, y esa es la decisión que
importa. El `UNCLASSIFIED` del split no es neutro: si parte del gasto todavía no se clasificó, el
COGS está subestimado y **el margen sale mejor de lo que es**. Un margen optimista es el error que un
número financiero no puede cometer, así que al lado del margen va el peor caso —todo lo sin
clasificar contado como COGS— y cuánto gasto lo produce. Cierra el lazo con el criterio 3 de la
fase 1: el `UNCLASSIFIED` visible no era una formalidad.

Dos cosas que **no** se hacen, con test cada una:

- **Sin ingresos no se devuelve 0%.** Cero por ciento afirma que todo lo que entra se va en nube;
  lo que pasa es que nadie ingestó el dato. Es `null`, y la pantalla explica cómo mandarlo.
- **Un margen negativo no se recorta a cero.** Gastar más de lo que entra es un hecho, y es el
  hecho que esta pantalla existe para mostrar.

Verificado contra MySQL real: `REVENUE` se ingesta y la consulta exacta de la ruta devuelve la suma
del período.

Tests: 9 más en `__tests__/unit/leaderboardDeEquipos.test.ts` (19 en total).

### Lo que queda

- **La clasificación COGS/OpEx no tiene UI propia**: el `PUT` existe y está probado, pero se asigna
  por API. Es lo que más rinde de lo que falta, porque sin clasificar, el margen siempre se muestra
  como rango.
- **Costo por cliente o por feature**: la serie es por tenant, no por cliente. Para "cuánto me cuesta
  este cliente" haría falta una dimensión más en `TenantUnitMetrics`, y es una discusión de modelo
  que no hace falta tener para calcular margen.

---

> **MEJ-38 a MEJ-40 salen de revisar IBM Cloudability, Flexera One, ProsperOps y CAST AI
> el 2026-09-23**, con el mismo método que MEJ-34/37: leer la fuente y cruzarla contra el
> repo. Caveat de alcance: se leyeron **páginas de producto**, no documentación —
> `docs.apptio.com` está bloqueado— así que la comparación es de capacidades nombradas,
> no de profundidad.
>
> **El resultado más útil de la revisión es cuánto NO falta.** Cloudability tiene 22
> features listadas y el cruce dio que ya están casi todas: Commercial Billing (donde
> estamos por encima, con markup, MACC y facturación), Container Allocation
> (`aks-chargeback`), Cost Sharing, Sustainability, Tagging, True Cost (amortización en 6
> rutas), Anomaly Detection, Scorecards, Unit Economics, Rightsizing, y hasta Workload
> Planning — que es el simulador de escenarios What-If que ya existe. Su "AI usage por
> modelo, tipo y dirección de token" también está: `PlatformAiUsage` ya guarda
> `input_tokens` y `output_tokens`.
>
> **Flexera es el único que señala territorio nuevo**, y sólo en la franja donde ya hay un
> pie puesto con AHUB. Su producto es ITAM+FinOps unificado; la mayoría —inventario
> on-prem, reconciliación de derechos de uso, defensa ante auditorías de fabricante— no es
> este producto y no conviene perseguirlo.
>
> **ProsperOps y CAST AI quedan acotados por una decisión de producto, no por capacidad.**
> Los dos EJECUTAN: uno compra y vende compromisos, el otro reemplaza nodos y redimensiona
> pods. Acá el techo es el rol custom del onboarding y no se pide Contributor sobre la
> suscripción del cliente. De ellos se toman **métricas y recomendaciones, nunca
> ejecución** — y eso descarta de entrada una categoría entera de roadmap.

> **2026-10-04 — clasificación desde la tabla.** Columna *Clasificación* editable por Admin/Owner. Y
> la pantalla no mandaba el token de sesión: para cualquier tenant real el Leaderboard respondía 401;
> sólo el demo, que intercepta el fetch, lo mostraba.


## MEJ-38 — Views: vistas guardadas y con alcance por equipo

**Módulo:** Transversal / RBAC · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (2026-09-27)
**Depende de:** MEJ-34 (sin Perspectives no hay por dónde recortar).

### Contexto

Cloudability llama *Views* a lo que en el repo no existe (0 coincidencias de `savedView` o
equivalentes): que cada equipo, app o producto tenga su vista, y que **el dueño de un
centro de costo entre y vea sólo su porción**. Hoy el RBAC es por tenant: quien entra, ve
todo el tenant.

Es lo que convierte la plataforma de "una herramienta que mira el FinOps" en "una
herramienta que usa cada equipo" — y sin eso, las Perspectives de MEJ-34 sirven para que
el analista filtre, no para que el dueño se haga cargo.

### Propuesta

1. **Vista guardada** = nombre + Perspective + grupo + rango de fechas + filtros, reusable
   desde cualquier tablero que ya filtre por suscripción.
2. **Vista por defecto por usuario**, para que entre directo a lo suyo.
3. **Alcance como permiso, no como filtro** (ver abajo).

### La parte que importa: filtro no es permiso

Una vista que sólo recorta la UI es una comodidad. Si la API sigue devolviendo el tenant
entero y el recorte pasa en el navegador, **cualquiera con la sesión ve el gasto de los
demás cambiando un parámetro** — y en una plataforma que se vende por gobernanza, eso es
peor que no tener la feature.

El alcance tiene que aplicarse **del lado del servidor**: la asignación usuario → grupo de
Perspective vive en la base, y las rutas de costo filtran por ella. `requireTenantAccess`
sigue resolviendo la pertenencia al tenant; lo nuevo es un segundo recorte **dentro** del
tenant.

Cuidado con el efecto colateral: un usuario con alcance no puede ver los totales del
tenant, así que **los KPIs y porcentajes tienen que recalcularse sobre su porción**, no
mostrarse sobre el total. Un "35% del gasto" que en realidad es 35% de otra cosa es peor
que no mostrarlo.

### Modelo de Implementación Detallado

- **Base de Datos y Esquema:**
  - `SavedViews` (`id`, `tenant_id`, `user_id` NULL para compartidas, `name`,
    `perspective_id`, `group_name`, `filters_json`, `is_default`).
  - `UserScopes` (`tenant_id`, `user_email`, `perspective_id`, `group_name`) — la tabla que
    convierte la vista en permiso. Sin fila, el usuario ve el tenant completo, que es el
    comportamiento de hoy y el default seguro para no romper a nadie al desplegar.
- **Backend y APIs:**
  - Helper `alcanceDelUsuario(request, tenantId)` en `requestAuth.ts`, consumido por las
    rutas de costo. **Va en el helper y no en cada ruta**: un recorte que cada ruta
    implementa por su cuenta es un recorte que alguna ruta nueva va a olvidar.
  - `GET/POST/DELETE /api/intelligence/views`.
- **Frontend:** selector de vista en el shell, al lado del de suscripción.

### Criterios de Aceptación

1. Un usuario con alcance recibe **de la API** sólo su porción: cambiar el parámetro en el
   navegador no le muestra más.
2. Los KPIs se calculan sobre la porción visible, y la pantalla dice sobre qué alcance está.
3. Un usuario sin fila en `UserScopes` ve exactamente lo que ve hoy.
4. Una vista compartida es visible para todo el tenant; una personal, sólo para su dueño.

### Diseño cerrado (2026-09-25)

Con seis superficies de MEJ-34 ya acotadas, se cerró el contrato antes de seguir sumando tableros.
Las decisiones de abajo son lo que faltaba para que "filtro" pueda volverse "permiso".

#### 1. Son DOS alcances, no uno, y no pueden compartir significado

| | alcance como **preferencia** | alcance como **permiso** |
|---|---|---|
| de dónde sale | `?perspective=` en la URL | fila en `UserScopes` |
| quién lo elige | el usuario, cuando quiere | nadie: se lo asignaron |
| pantalla que no puede acotar | muestra todo y lo dice | **niega** |

Es lo que existe hoy contra lo que MEJ-38 necesita, y el mismo parámetro no puede significar las dos
cosas. **El permiso gana**: con una fila en `UserScopes`, el selector deja de ser libre y queda fijo
en el grupo asignado. Y el aviso de "no se pudo acotar" —hoy informativo— pasa a ser un 403 para ese
usuario, porque mostrar el tablero entero es exactamente la fuga que la mejora viene a evitar.

#### 2. Default-deny. No se audita ruta por ruta

**304 de las 467 rutas** llevan auth de tenant. Auditarlas una por una para agregarles el recorte es
garantía estadística de olvidar alguna, y el repo ya tiene el precedente escrito: `routeTiers.ts`
documenta cómo un bloqueo por tier se volvía **decorativo** porque varias pantallas son alias que
sirven el mismo componente desde otra URL, y se entraba por la vieja.

Así que se invierte la carga: **una ruta que no declaró saber acotar no le responde a un usuario con
alcance.** Lo que se mantiene a mano es la lista de las que SÍ saben —hoy seis— y crece cuando un
tablero lo adopta. Olvidarse de una ruta nueva falla cerrado, no abierto.

#### 3. Dónde vive el corte

**No hay `middleware.ts` en este proyecto** (verificado), así que el corte va en `requireTenantAccess`,
que ya lo llaman las 304 y ya recibe el `request` —o sea el `pathname`—:

1. `requireTenantAccess` busca la fila de `UserScopes` y la cuelga de la identidad que devuelve.
2. Si hay alcance y `request.nextUrl.pathname` no está en `SCOPE_AWARE_ROUTES`, lanza `AuthError(403)`.
3. Una ruta entra a ese mapa cuando llama a `alcanceDeLaRuta` y puede acotar. Si obtiene
   `aplicado: false` teniendo un alcance de PERMISO, lanza — no muestra el tablero entero.

Cero código por ruta y nada que recordar: el default es negar. El mapa vive al lado de `ROUTE_TIERS`
y con la misma disciplina, porque es el mismo problema.

#### 4. Las escrituras son un capítulo aparte

**136 de las 304 tienen POST/PATCH/PUT/DELETE.** El default-deny de lectura no las cubre: una ruta
puede estar en el mapa porque su GET sabe acotar y tener un POST que no. Por eso **el mapa es por
(ruta, método)**, y toda ruta de escritura que reciba identificadores de recurso tiene que validarlos
contra el alcance antes de actuar.

No es teórico: ya pasó. El etiquetado en masa de Centros de Costo entregaba recursos de fuera del
alcance para etiquetar, y se arregló el 2026-09-25 intersectando por identificador de recurso.

#### 5. Las claves de API: resuelto por construcción

Era el agujero que parecía peor —las claves son **por tenant, no por usuario**, así que una clave
saltearía el recorte entero por `/api/mcp`, `/api/v1/*` y el feed de Power BI—. Verificado: los dos
endpoints que las emiten exigen `requireTenantRole(['Admin','Owner'])`
(`/api/admin/mcp-keys` y `/api/admin/public-api-keys`).

Entonces la regla que lo cierra es una sola: **un usuario con alcance no puede ser `Admin` ni
`Owner`**, y el endpoint que asigna alcance lo rechaza. Que un Admin emita una clave y se la pase a
alguien acotado es un problema fuera de banda —equivale a prestarle su contraseña—, no un agujero del
sistema.

#### 6. La navegación tiene que acompañar, o la feature es hostil

Un usuario acotado que encuentra 403 en media plataforma está peor que sin la feature. El Sidebar ya
oculta por tier con `ROUTE_TIERS`; tiene que ocultar por alcance con el mismo mapa. Es la mitad de
UX del default-deny y no es opcional.

#### 7. Las tres decisiones, resueltas (2026-09-26)

**a) No hay día uno. La feature se despliega apagada.** `UserScopes` vacía significa que nadie
cambia —el criterio 3— así que no hay que elegir entre "lanzar pobre" y "esperar". Lo que era una
decisión de release pasa a ser una decisión por usuario, y el Admin la toma informado: el endpoint
que asigna devuelve `screensWhenScoped`, o sea cuántas pantallas le quedan a esa persona. Asignar a
ciegas sería asignar sin saber qué se está quitando.

**b) Reader y Colaborador. Los otros cuatro roles no existen.** Medido contra la base: las únicas
filas de `Users.role` son `Admin` (3), `Owner` (2), `Reader` (2) y `Colaborador` (2).
`FinOpsManager`, `Operator`, `Contributor`, `FinOps` y `Viewer` aparecen sólo en listas de guardas y
**nunca se asignaron a nadie**. Así que la regla es corta: no pueden tener alcance `Admin` ni
`Owner`, y quedan Reader y Colaborador, que son los dos roles no privilegiados que existen de
verdad. La comparación va en minúsculas porque las guardas mezclan `Admin` y `ADMIN`.

**c) Un alcance por usuario**, con `UNIQUE (tenant_id, user_email)`. Una Perspective ya asigna cada
recurso a exactamente un grupo, así que Perspective + grupo es la unidad natural; con varias filas
"su porción" pasaría a ser una unión y habría que decidir sobre qué base se calculan los
porcentajes. **Levantar el UNIQUE más adelante es una migración y un `OR` en el predicado; bajarlo
después de haber permitido varias, no.** Verificado contra el MySQL local: el segundo `INSERT` del
mismo usuario actualiza en vez de duplicar. **Corrección de seguridad en rama (2026-10-16):**
el endpoint impide borrar una Perspective mientras haya alcances asignados (409);
primero se reasignan o retiran explícitamente. El borrado toma un bloqueo del padre en
transacción para serializar nuevas asignaciones mediante la FK existente. La cascada
del esquema no se modifica, incluida la purga de un tenant. Pendiente rollout.

#### 8. Lo construido

- `migrations/20260926-001-user-scopes.sql`.
- `src/services/userScope.service.ts` — lectura y escritura. **Corrección de seguridad en rama
  (2026-10-16):** `alcanceDelUsuario` registra y propaga errores SQL; el guard devuelve503,
  sin eliminar el recorte. Solo una consulta exitosa sin fila significa acceso sin alcance.
  El rollout exige UserScopes migrada y accesible.
- `src/lib/scopeAwareRoutes.ts` — las dos listas y el matcher por (ruta, método).
- `requestAuth.aplicarAlcance()` — el corte, envolviendo los seis `return identity` que tenía
  `requireTenantAccess`. Está separado en su propia función exportada para poder probarlo sin
  fabricar un JWT.
- `perspectivesData.filtroDeLaRequest()` y `exigirRecorte()` — el permiso gana sobre la URL, y un
  recorte que no se puede aplicar corta.
- `GET/POST/DELETE /api/admin/user-scopes` y `GET /api/me/scope`.
- El Sidebar oculta lo que no está declarado; el selector de Perspective queda fijo y con candado.

Tests: `__tests__/unit/alcanceComoPermiso.test.ts`.

#### 9. Auditoría de la superficie (2026-09-27) — la lista de permitidos se ampliaba sola

El mecanismo estaba bien: el default niega y las rutas conscientes cortan. **El mapa no.** La
coincidencia era por prefijo —copiada de `ROUTE_TIERS`, donde tiene sentido— y en una lista de
permitidos significa que declarar una ruta habilita todo lo que cuelgue debajo, **incluso lo
escrito después, incluso lo que no sabe recortar**. Dos rutas entraron así:

| Ruta | Entraba por | Qué devolvía |
|---|---|---|
| `/api/intelligence/perspectives/breakdown` | `/api/intelligence/perspectives` | el gasto de **todos los grupos** del tenant |
| `/api/cost-groups/<x>/resource-groups` | `/api/cost-groups` | el inventario de rg de cualquier grupo |

La primera es la que duele: `/api/intelligence/perspectives` está en la lista del shell y su
comentario dice, textual, que entra porque *"no devuelve un solo importe"*. El prefijo le
regalaba la subruta que devuelve todos. **El razonamiento que justificaba la entrada era correcto
y aun así el resultado era una fuga**, porque el criterio se escribió sobre una ruta y la
coincidencia operaba sobre un subárbol.

Ahora la coincidencia es **por segmentos**, con `:param` valiendo por exactamente uno. Una subruta
nueva nace negada, que es la premisa del archivo, y habilitarla exige escribirla — que es el
momento en que alguien se pregunta si sabe recortar. Superficie resultante: **22 rutas de 469**.

**El hallazgo de fondo, que no era una fuga sino un ascenso.** `TenantProvider` resuelve el rol
del usuario con `GET /api/admin/config/users`, y su manejo de error decía:

```js
if (isAdmin || accounts[0].tenantId === selectedTenant.id || …) setUserRole('Admin');
```

Ese respaldo se escribió para "el Owner todavía no está en la tabla `Users`", que es una **ausencia
de dato**. Un 403 es lo contrario: el servidor miró quién sos y te lo negó. Estaba latente porque
esa ruta sólo pedía pertenencia al tenant y nadie recibía 403 — **y MEJ-38 es justo lo que lo
activa**, porque el default-deny se la niega a los usuarios acotados. O sea que el cliente le
asignaba rol `Admin` al usuario que el servidor acababa de rechazar, contradiciendo el invariante
que esta misma mejora declara (un usuario con alcance no puede ser `Admin`/`Owner`). El servidor
seguía enforceando, así que no había escalamiento real de permisos; lo que había era una UI que
mostraba un producto que no le correspondía. Ahora un 403 aplica `Reader` y nunca asciende.

**Lo que quedó negado a propósito**, y no por olvido: `dashboard/summary` (gasto del tenant
entero), `notifications` (avisos con importes de centros ajenos), `search` (inventario y pantallas
que no tiene), `copilot` (responde sobre todo el tenant) y `tags/apply-bulk` (escritura). Cada una
está fijada en el test, así que habilitarla exige cambiarlo.

**Un falso positivo propio, anotado para no repetirlo.** El primer barrido dio 42 rutas negadas y
eran 9: el mapa sólo actúa sobre rutas que pasan por `requireTenantAccess`, y `fx/rates`,
`profile`, `onboard` y las de `leads`/`pricing` no tienen guard de tenant, así que el alcance ni
las toca. **El login y el menú de perfil nunca estuvieron en riesgo.** La lista de rutas que una
pantalla llama no es la lista de rutas que el alcance niega — el mismo error de método que ya
había costado tres rutas equivocadas en MEJ-34.

`ExecutiveSummaryBoard` dejó de pedir `dashboard/summary` cuando hay alcance: era el respaldo de
los KPIs (`data?.summary?.x ?? summaryData?.y ?? 0`), hablaba del tenant entero y con el 403
dejaba las tarjetas en **0 sin decir por qué**.

Tests: `__tests__/unit/superficieDelAlcance.test.ts` (23).

#### 10. `SavedViews` — la mitad de comodidad (2026-09-27)

`migrations/20260927-001-saved-views.sql`, `GET/POST/DELETE /api/intelligence/views`, y un selector
en el shell pegado al de Perspective.

**Aplicar una vista es escribir los mismos parámetros de URL que el usuario podría poner a mano.**
Reusa `setScope` de `usePerspectiveScope` en vez de tener camino propio, y eso es deliberado: si una
vista pudiera llevar a un estado que la URL no alcanza, sería un permiso disfrazado de comodidad.
Son dos tablas y no una por lo mismo — una vista se elige y se deja de elegir; un alcance no.

**El dueño se guarda como cadena vacía, no como NULL.** En MySQL un UNIQUE deja pasar todos los
NULL que quieras porque `NULL != NULL`, así que `UNIQUE (tenant_id, user_email, name)` con NULL
para las compartidas habría permitido diez vistas compartidas llamadas "Q3" — el mismo `NULL !=
NULL` que ya obligó a envolver en `COALESCE` el predicado de MEJ-34. Verificado contra MySQL real:
con `''` el segundo insert devuelve `ERROR 1062`.

**Crear o borrar una compartida exige Admin/Owner**; la propia, sólo pertenecer al tenant. Una vista
compartida la ve —y la pierde— todo el tenant, así que no es una escritura personal. Borrar la de
otro usuario da 403, y un id inexistente pasa igual por el guard antes de contestar 404: si no, el
404 le confirmaría a cualquiera qué ids existen en un tenant ajeno.

**`is_default` no tiene restricción en la base.** "A lo sumo una en true por usuario" no se expresa
con un UNIQUE común, y un trigger costaría más de mantener que la única escritura que lo toca. Lo
garantiza el endpoint, apagando las demás **en la misma transacción** — hay test de que si la
escritura falla se hace rollback y no quedan dos.

Del lado del cliente, la predeterminada se aplica una sola vez y sólo si la URL no dice otra cosa,
con un `ref` que no es decorativo: sin él `setScope` cambia la URL, el efecto vuelve a correr y se
navega en círculo.

El selector **no se dibuja** para un usuario con alcance asignado, y la ruta tampoco le responde
(no está en `RUTAS_CON_ALCANCE`). Su recorte no se elige, no se guarda y no se cambia.

Verificado contra MySQL real, con tres vistas: Ana ve la suya y la compartida, y **cero** filas de
Beto.

Tests: `__tests__/unit/vistasGuardadas.test.ts` (14).

#### 11. Lo que queda

La lista de rutas que saben acotar tiene once entradas de las 304 posibles: crece con MEJ-34, no
con esto. Un usuario acotado tiene, a propósito, un producto chico.

Sin probar: el camino del usuario acotado **en el navegador**. No hay bypass de auth en desarrollo,
así que exige credenciales reales. La auditoría estática cubre más que un paseo —mira las cinco
páginas y las 469 rutas, no las que uno se acuerde de clickear— pero no ve un `useEffect` que
dispare una llamada sólo bajo cierto estado.

#### 8. Orden de implementación

1. `UserScopes` + el endpoint que asigna alcance (rechazando `Admin`/`Owner`).
2. `requireTenantAccess` devuelve el alcance; `SCOPE_AWARE_ROUTES` con las seis de hoy; 403 por
   defecto. **Un usuario sin fila no cambia en nada** — ése es el criterio 3 y es lo que hace que el
   despliegue sea seguro.
3. El Sidebar oculta lo que no está en el mapa.
4. Las escrituras de las seis, validando identificadores.
5. Recién entonces, `SavedViews` — que es comodidad y no permiso, y por eso va última.

> **2026-10-04 — asignación desde Usuarios, vistas compartidas y predeterminadas, y menú por hubs.**
> `PAGINAS_CON_ALCANCE` declaraba sólo las direcciones viejas y el menú ya era por hubs: un usuario
> acotado veía únicamente el Whiteboard. Ahora declara las pestañas de los hubs, `entradaConAlcance`
> manda cada hub a su primera pestaña permitida y `RouteTabsNav` esconde las que no saben acotar. El
> selector de vistas no mandaba el token, así que en tenants reales las vistas no cargaban ni se
> guardaban. Con una predeterminada personal y otra compartida, gana la personal.

---

## MEJ-39 — Fin de soporte (EOL/EOS) de la plataforma Azure

**Módulo:** Gobernanza / Riesgo · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (fase 1, 2026-09-27)

### Contexto

Es lo único que Flexera señala y que acá no está resuelto. Hoy el ciclo de vida se calcula
para **un solo producto**: versiones de OpenShift, en `getOpenShiftLifecycleStatus`
(`src/lib/aroUtils.ts:14`). El patrón existe; falta el catálogo.

Azure publica fechas de retiro para casi todo: versiones de AKS, de SQL Server, runtimes de
App Service, series de VM, versiones de PostgreSQL y MySQL Flexible Server, api-versions de
ARM.

**Por qué es costo y no sólo riesgo.** Quedarse en una versión retirada tiene dos finales, y
los dos se pagan: una migración de urgencia sin presupuestar, o Extended Security Updates,
que en el caso de SQL Server y Windows Server tiene precio de lista. Un cliente que ve la
fecha con seis meses de anticipación lo planifica; uno que se entera cuando le cortan el
soporte, no.

### Propuesta

1. **Inventario contra fechas de retiro**, con el costo de los recursos afectados al lado:
   "estos 14 recursos corren algo que Azure retira en menos de 90 días, y representan
   $X/mes".
2. **Semáforo por ventana** — retirado, <90 días, <365 días, soportado — reusando la forma
   que ya tiene el panel de ARO.
3. **Alerta** enganchada al motor que ya existe, no una nueva.

### Modelo de Implementación Detallado

- **Fuente de las fechas, a verificar antes de codear.** Hay dos caminos y conviene medir
  cuál cubre más antes de elegir: las *health advisories* de Azure Service Health, que
  incluyen retiros de servicio, o una tabla curada en el repo para las escaleras de versión
  conocidas. **El contrato exacto de la API de Service Health hay que confirmarlo en
  `learn.microsoft.com`** — es justo el tipo de cosa que devuelve vacío en vez de fallar si
  se la pide mal.
  - Una tabla curada tiene la ventaja de ser auditable y la desventaja de envejecer. Si se
    elige, el archivo lleva fecha de última revisión visible en la UI: un catálogo de fechas
    sin fecha propia es una trampa.
- **Base de Datos:** ninguna tabla nueva si se usa catálogo en repo
  (`src/lib/azureLifecycleCatalog.ts`, mismo patrón que `zombieAuditCatalog.ts`).
- **Backend:** `GET /api/governance/lifecycle`, cruzando Resource Graph (versiones y SKUs,
  que ya se leen) contra el catálogo.
- **Frontend:** `/governance/lifecycle`.

### Fase 2 — posición de licencias en la nube

`hybrid-benefit` ya detecta dónde se puede aplicar AHUB. El paso siguiente, que es el
producto **Cloud License Management** de Flexera, es saber **qué software licenciable corre**
en las VMs —SQL Server, Windows Server— y si hay cobertura. Comparte pantalla y catálogo con
la fase 1, por eso va acá y no como entrada aparte.

### Criterios de Aceptación

1. Un recurso en versión retirada aparece con su fecha y con su costo mensual.
2. El catálogo muestra cuándo se revisó por última vez.
3. Un tipo de recurso sin datos de ciclo de vida se marca **"sin datos"**, no "soportado".
   Asumir soporte por ausencia de dato es exactamente el error que hay que evitar.

---

### Hecho — fase 1 (2026-09-27)

`src/lib/azureLifecycleCatalog.ts` (catálogo curado + evaluador puro),
`GET /api/governance/lifecycle`, `/governance/lifecycle`. Los tres criterios cumplidos.

**Se eligió catálogo curado sobre Service Health**, como la entrada anticipaba. El costo de la
decisión está asumido y mitigado: `CATALOGO_REVISADO_EL` va en el payload y en la pantalla, porque
un catálogo de fechas sin fecha propia calla igual cuando está al día que cuando quedó viejo.

**Contratos verificados antes de escribir una línea**, que en Azure no es ceremonia: un campo
equivocado devuelve vacío, no un error.

| Familia | Campo | Cómo se verificó | Granularidad |
|---|---|---|---|
| AKS | `properties.kubernetesVersion` | referencia ARM | `major.minor` |
| PostgreSQL Flexible | `properties.version` | referencia ARM: *"Major version of PostgreSQL database engine"* | **sólo mayor** (`"14"`) |
| MySQL Flexible | `properties.version` | `az graph query` contra el tenant real | **completa** (`"8.0.21"`) |

**Las dos bases usan el mismo nombre de campo y NO la misma granularidad.** Comparar la cadena
cruda contra el catálogo habría fallado en una de las dos sin tirar ningún error: por eso existe
`normalizar()`.

**`microsoft.sql/servers` se dejó afuera a propósito.** Su `properties.version` devuelve `"12.0"`
—verificado contra el tenant real— y vale `"12.0"` para todos: es la versión del *servidor lógico*,
que no se retira nunca. Cruzarla contra un calendario de retiros habría producido una respuesta con
forma de dato y sin significado, que es peor que no tenerla. El EOL de SQL vive en el nivel de
compatibilidad de cada base y en SQL Server sobre VM: otro contrato, otra verificación.

**El criterio 3, que es el que da nombre a la mejora.** Hay tres formas de no saber y las tres
terminan en `"sin-datos"`, nunca en `"soportado"`: la versión no se pudo leer; la versión es
*posterior* al catálogo (el viejo es el catálogo, no el recurso); y el tipo no está en el catálogo.
Sólo se afirma `"retirado"` sin fecha cuando la versión está por debajo de la más antigua que la
fuente publica, y eso se declara por familia (`menoresRetiradas`) en vez de asumirse.

> El repo **ya tenía el error cometido**: `getOpenShiftLifecycleStatus` (`src/lib/aroUtils.ts:14`)
> abre con `if (!version || version === "unknown") return "active_support"`. Un cluster cuya versión
> no se pudo leer se pinta igual que uno al día. No se tocó —es de ARO y tiene su propio tablero—
> pero queda anotado: una pantalla de riesgo que ante la duda tranquiliza es peor que no tenerla.

**El costo, que es lo que lo hace FinOps y no un inventario.** Sale de `getMtdCostByResourceId`,
el dato exacto por `ResourceId`, no un prorrateo. Y `null` no es `0`: uno es "no se pudo atribuir",
el otro "costó cero". Colapsarlos bajaría el total y el riesgo se vería más chico — el mismo error
que MEJ-40 ya había evitado en la concentración de vencimientos. Lo no valorizado se informa aparte.

**Detalle de la fuente que hay que respetar:** AKS publica el fin como mes (`"Mar 2026"`) y aclara
que significa el **último** día del mes. En el catálogo van resueltos a `2026-03-31`. Tomarlo como
el día 1 adelantaría todos los vencimientos un mes.

**Verificado contra Azure real, no contra el log.** Corriendo el catálogo sobre el inventario del
tenant: `cscs-finops-prod-westus2-mysql` en `8.0.21` → normaliza a `8.0` → **próximo**, fin de
soporte estándar 2027-01-31 (127 días), extendido pago hasta 2029-05-31. Es la base de datos de la
propia plataforma, y es un hallazgo real, no un caso de prueba.

Un usuario con alcance asignado (MEJ-38) no ve esta pantalla: no está en `RUTAS_CON_ALCANCE`, así
que el default-deny la niega sola. Es lo correcto —el inventario de toda la plataforma no es su
porción— y no hizo falta escribir nada.

Tests: `__tests__/unit/finDeSoporte.test.ts` (20) y `finDeSoporteRuta.test.ts` (7).

### Lo que queda

- **Fase 2, posición de licencias en la nube**: sin empezar.
- **Más familias**: runtimes de App Service, series de VM, `api-version` de ARM. Cada una exige
  verificar su contrato; agregarla por analogía es exactamente lo que esta entrada prohíbe.
- **La revisión del catálogo no está automatizada.** Hoy depende de que alguien mire las fechas y
  actualice `CATALOGO_REVISADO_EL`. La pantalla lo expone, que es el mínimo honesto, pero un
  recordatorio o un chequeo en CI sería mejor.

---

## MEJ-40 — ESR y riesgo de la cartera de compromisos

**Módulo:** Compromisos · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (2026-09-23)

> **Corrección del 2026-09-23.** Esta entrada se escribió con "Esfuerzo: Bajo" sobre la premisa
> de que *"los datos ya están"*. **La premisa era falsa para la mitad del ESR**: no había ningún
> precio de lista guardado. Se corrigió a Medio y se implementaron las dos mitades el mismo día;
> la segunda exigió arreglar antes un defecto de conformidad FOCUS que ya estaba en producción.

### Hecho — concentración de vencimientos

Une `reservationDetails` (Microsoft.Capacity: nombre, vencimiento, estado) con
`activeReservations` (Cost Management agrupado por `ReservationName`: costo). Función pura en
`src/services/commitmentRisk.service.ts`, sin llamadas nuevas a Azure ni tablas nuevas, más un
aviso arriba del tablero de compromisos.

Decisiones que quedaron fijadas en `__tests__/unit/concentracionVencimientos.test.ts`:

- **Ponderado por valor, no por cantidad.** Tres reservas chicas en enero contra una grande en
  marzo: contando reservas el riesgo sería enero, contando valor es marzo con el 70%.
- **Lo que no se pudo valorizar se informa, no se suma como cero.** Sumar 0 bajaría el porcentaje
  y el riesgo se vería más chico de lo que es, que es el error que una pantalla de riesgo no puede
  cometer. El aviso dice cuántas reservas quedaron sin costo y cuántas sin fecha.
- **La ventana de 3 meses es corrida, no el trimestre de calendario.** Un acantilado entre
  diciembre y enero sigue siendo un acantilado. Y dos meses separados por uno vacío **no** son una
  ventana contigua, o cualquier cartera repartida parecería concentrada.
- Las reservas ya vencidas se ignoran: el golpe ya pasó.

### Hecho — el ESR, y el defecto que había que arreglar antes

El bloqueo era real: **`CostSnapshots` no tenía `ListCost`**, el costo a precio público contra el
que se mide el ahorro. Sin denominador, cualquier ESR mide otra cosa.

Y detrás había un defecto de conformidad ya en producción: `src/lib/focus/mapper.ts` hacía
`rec.ListCost = billed`, con lo cual en el export FOCUS **`ListCost` y `BilledCost` eran siempre el
mismo número**. La especificación define `ListCost` justamente para que `ListCost − EffectiveCost`
sea el ahorro, así que **cualquier consumidor del export que lo calculara obtenía cero**, tuviera
el cliente los descuentos que tuviera. Un cero silencioso, que es peor que un error.

**De dónde salieron los datos: ya venían y se tiraban.** El export FOCUS de Azure trae `ListCost`
(columna 30) y `ContractedCost` (columna 25) — verificado en la referencia del dataset en
learn.microsoft.com, versiones 1.0 y 1.2-preview. La ingesta los descartaba. No hizo falta ninguna
API nueva ni tarifar nada contra la Retail API.

**Se descartó el atajo de la Retail API a propósito.** `ActiveReservationDetail` trae `productName`,
`region` y `quantity`, así que se podía tarifar cada reserva en vivo. Pero `productName` es un
`skuDescription` y mapearlo a `armSkuName` es **exactamente la suposición que falló tres veces el
2026-09-22** — unidad equivocada, medidor equivocado, campo de filtro equivocado, las tres
devolviendo HTTP 200 con el número mal. El KPI de ahorro no se construye sobre un mapeo sin
verificar.

Lo que se hizo, en orden:

1. **Migración `20260923-001`**: `ListCost` y `ContractedCost` en `CostSnapshots`, las dos NULL.
   NULL significa "no sabemos el precio de lista de esta fila", que es el caso real de las filas
   que entran por la Query API de Cost Management, que no devuelve precio público. Con `DEFAULT 0`
   esas filas entrarían al promedio como 100% de descuento.
2. **Ingesta del export** (`costExportIngestionService.ts`): las columnas de costo se buscan por
   nombre exacto. La búsqueda laxa de antes (`includes("cost")`) devolvía la primera columna que
   contuviera la palabra —en FOCUS, siempre `BilledCost`— y ese mismo número se escribía **también**
   en `EffectiveCost`: las dos columnas quedaban idénticas y el descuento por compromiso, que es lo
   único que las separa, desaparecía de la base. `cost_usd` conserva el valor que ya venía tomando,
   para que el arreglo no mueva ningún tablero.
3. **Mapper FOCUS**: usa la columna real. El fallback a `billed` se mantiene porque la
   especificación es explícita —*"The ListCost column MUST be present in a FOCUS dataset and MUST
   NOT be null"*, FOCUS 1.1 `columns/listcost.md`— así que emitir vacío sería tan no conforme como
   el cero de antes. Lo que cambia es que el fallback pasa a ser la excepción.
4. **`src/services/savingsRate.service.ts`**: `ESR = (ListCost − EffectiveCost) / ListCost`, con una
   sola consulta agregada y sin llamadas nuevas a Azure. **Sólo entra lo que tiene precio de lista**
   y se informa qué porcentaje del gasto del período se pudo evaluar. Cuando no hay nada medible
   devuelve `null`, no `0`: 0% afirma "no estás ahorrando nada", que es justo lo que decía el export
   roto.

**La trampa del desperdicio, y hasta dónde está cubierta.** Numerador y denominador salen del mismo
conjunto de filas, así que si el export incluye las filas de compromiso no utilizado, su costo ya
está dentro de `EffectiveCost` y hunde el ESR como corresponde — sobre-comprometerse no mejora el
número. **Esto no está verificado contra datos reales**: el contenedor `finops-cost-exports` existe
y la cadena de conexión está configurada en producción, pero mi identidad no tiene rol de plano de
datos sobre el blob, así que no pude listar si algún tenant ya tiene exports cayendo ahí. Si no hay
ninguno, `ListCost` queda NULL, el ESR no se dibuja y eso es correcto: es un paso de configuración
del export, no un hueco de código.

`CommitmentDiscountStatus` sigue vacío y **no se puede llenar hoy**: la propia referencia de Azure
lo marca como *"Currently null/empty"* en 1.2-preview. No es una omisión nuestra.

### Encontrado de paso — la pantalla se caía entera

Verificando el ESR en el navegador, el tablero de compromisos moría con *"Rendered more hooks than
during the previous render"* al cambiar de tenant: había un `useMemo` **después** de los cortes
tempranos (`if (isLoading)`, `if (error)`, `if (!metrics)`), así que durante la carga corrían 34
hooks y con los datos 35. Venía de antes de MEJ-40.

Lo que importa es por qué nadie se enteró: **eslint lo detectaba**. `react-hooks/rules-of-hooks`
estaba en `"warn"` dentro del bloque de deuda cosmética de `eslint.config.mjs`, y CI corre
`eslint --quiet`, que descarta las advertencias. El linter sabía y el gate lo tiraba a la basura.
Se subió esa regla —sólo esa— a `error`, con 0 violaciones en el repo, así que no rompe nada hoy y
la próxima sí frena el merge.

### Contexto

La mejor relación valor/esfuerzo de las seis herramientas revisadas, y es **presentación,
no motor**: los datos ya están.

ProsperOps construyó su producto alrededor de tres siglas, y llama a la primera "el KPI
central de optimización tarifaria de FinOps":

- **ESR** (Effective Savings Rate) — cuánto se ahorra de verdad contra pagar todo a demanda.
- **CLR** (Commitment Lock-in Risk) — cuánto compromiso ata y por cuánto tiempo.
- **EAR** (Effective Avoidance Rate) — el equivalente del lado de workload.

En el repo, `coverage`, `utilization` y `onDemand` aparecen 33, 22 y 17 veces: **el cálculo
está, lo que falta es consolidarlo en una tasa**. Sus testimonios hablan de "pasamos de 37%
a 49% de ESR": un número único que el cliente sigue mes a mes. Hoy la pantalla de
compromisos da piezas y le pide al cliente que arme el juicio.

Y **no hay medida de concentración de vencimientos**: los 8 hits de `ladder` en el repo son
escalones de DTU para rightsizing de SQL, sin relación. Que toda la cartera venza el mismo
mes es riesgo real y hoy no se ve.

### Propuesta

1. **ESR como número de cabecera** de `/intelligence/commitments`.
2. **Concentración de vencimientos**: qué porcentaje del valor comprometido vence en el
   mismo mes y en el mismo trimestre, con el calendario al lado.
3. **Comparación contra el mes anterior**, que es lo que convierte la métrica en seguimiento
   en vez de en una foto.

### La trampa del cálculo, que es lo que hace que sea "effective"

ESR **tiene que descontar el compromiso desperdiciado**. Si se calcula sólo sobre las horas
efectivamente cubiertas, sobre-comprometerse mejora el número: se compra de más, se usa
poco, y la tasa sube porque el denominador no ve el desperdicio. Ese es precisamente el
incentivo perverso que la palabra *effective* existe para cerrar.

```
ESR = (costo_a_demanda_equivalente − costo_real_pagado) / costo_a_demanda_equivalente
```

donde `costo_real_pagado` **incluye el compromiso no utilizado**. Un ESR que sube mientras
la utilización baja es un ESR mal calculado, y conviene dejarlo fijado en un test.

### Modelo de Implementación Detallado

- **Base de Datos:** ninguna tabla nueva. Sale de lo que ya consulta
  `/api/intelligence/commitments`.
- **Backend:** `calcularESR()` y `concentracionDeVencimientos()` en el servicio de
  compromisos, en `Decimal` como el resto de los cálculos de plata.
- **Frontend:** dos KPIs arriba del tablero de compromisos y un calendario de vencimientos.

### Criterios de Aceptación

1. Con cobertura 0 el ESR es 0, y con cobertura total a precio de reserva da la tasa de
   descuento real.
2. **Subir el compromiso sin subir el uso BAJA el ESR.** Es el test que prueba que el
   desperdicio entra en la cuenta.
3. La concentración se expresa sobre el valor comprometido, no sobre la cantidad de
   compromisos: diez reservas chicas que vencen juntas no son el mismo riesgo que una grande.
4. Sin compromisos, la pantalla lo dice y no muestra 0% como si fuera un resultado.

---

## MEJ-41 — Whiteboard: Selector de rango temporal (30D/90D) y persistencia en base de datos

**Módulo:** Whiteboard / Resumen Ejecutivo · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Hecha (2026-10-01)

### Contexto y Problema Detectado

En la Pizarra Ejecutiva (`/overview/whiteboard`), el header contaba con un control `<select>` que ofrecía tres opciones:
- Mes en curso (`MTD`)
- Últimos 30 días (`30D`)
- Últimos 90 días (`90D`)

Sin embargo, al seleccionar `30D` o `90D`, la interfaz permanecía estática y no mostraba los datos del período seleccionado.

Al auditar el flujo de datos de extremo a extremo, se identificaron cuatro desconexiones críticas:

1. **Frontend desvinculado (`ExecutiveSummaryBoard.tsx`):**
   El componente mantenía un estado local `const [timeRange, setTimeRange] = useState("MTD");`, pero `timeRange` nunca se concatenaba en la URL de `useSWR` (`/api/overview/whiteboard?tenantId=...`) ni en `refrescarDeVerdad`. Al cambiar el selector, SWR no detectaba cambio de clave y no disparaba ninguna petición de red.

2. **Proxy ciego al rango (`/api/overview/whiteboard/route.ts`):**
   La ruta proxy no leía `searchParams.get("timeRange")`, no lo reenviaba a `/api/intelligence/whiteboard` en `fetchWhiteboardFromIntelligence`, y la clave de caché en Redis (`whiteboard:v4:...`) no incluía el rango, provocando que cualquier petición sirviera la misma respuesta MTD cacheada.

3. **Backend hardcodeado a MTD (`/api/intelligence/whiteboard/route.ts`):**
   El motor de inteligencia tampoco leía `timeRange`. Además, su lógica de agregación ejecutaba `getCurrentMonthAmortizedCosts` (que sólo consulta el mes en curso a Azure) y un fallback SQL en `CostSnapshots` rígidamente acotado a `DATE(COALESCE(date, ChargePeriodStart)) >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`. Aunque la base de datos contenía snapshots de meses y semanas anteriores, el backend los descartaba.

4. **Modo Demo estático (`mockData.ts`):**
   El payload generado para tenants mock (`white_board`) sólo devolvía números fijos MTD sin escalar según el horizonte temporal.

### Persistencia de Datos Históricos (hasta 90 días y 13 meses)

Existía la duda de si los datos históricos se almacenaban en la base de datos local. **La respuesta es sí, los datos sí se persisten en la tabla `CostSnapshots`**:
- **Cron diario (`/api/cron/sync`):** Todas las noches sincroniza el costo y desglose del día anterior (`yesterdayStr`) mediante `getYesterdaysDetailedCosts` e inserta filas en `CostSnapshots`.
- **Backfill histórico (`historicalGapBackfill.ts`):** Ejecuta un barrido de hasta 13 meses (`AZURE_COST_HISTORY_MAX_MONTHS = 13`) poblando `CostSnapshots` con granularidad diaria y por servicio.

**¿Por qué no se consulta Azure Cost Management en vivo para 30D y 90D?**
La Query API de Azure Cost Management tiene un límite estricto de cuota (rate-limiting con HTTP 429) por cada ámbito de suscripción/tenant. Lanzar una consulta agregada de 30 o 90 días en tiempo real dentro del request path de un usuario bloquea el endpoint durante 10 a 25 segundos y frecuentemente satura la cuota de Azure, derivando en errores Cloudflare 524.

Por diseño arquitectónico de alta resiliencia:
- Para `MTD`: Se intenta la consulta en vivo de Cost Management del mes en curso y, si falla o degrada, se hace fallback a `CostSnapshots`.
- Para `30D` y `90D`: La consulta se resuelve **directamente contra la base de datos local `CostSnapshots`** mediante los índices optimizados `(tenant_id, date)`:
  - `30D`: `DATE(COALESCE(date, ChargePeriodStart)) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`
  - `90D`: `DATE(COALESCE(date, ChargePeriodStart)) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`
Esto garantiza que la Pizarra Ejecutiva responda en menos de 50 ms sin depender de llamadas síncronas costosas a Azure, garantizando la retención y disponibilidad de los últimos 90 días.

### Cambios Implementados

1. **Frontend (`ExecutiveSummaryBoard.tsx`):**
   - Se inyecta `&timeRange=${timeRange}` en la clave y URL de `useSWR` y en `refrescarDeVerdad`.
   - Se adapta la etiqueta del KPI principal dinámicamente (`kpiCurrentCost` en MTD, `last30` en 30D, `last90` en 90D).
   - El KPI de costo y widgets derivados leen `summary.costPeriodUSD ?? summary.costMtdUSD`.
2. **Proxy API (`/api/overview/whiteboard/route.ts`):**
   - Recibe `timeRange = searchParams.get('timeRange') || 'MTD'`.
   - Incluye `timeRange` en `cacheKey` de Redis (`whiteboard:v4:${tenantId}:${locale}:${timeRange}:${...}`).
   - Reenvía `timeRange` en `fetchWhiteboardFromIntelligence`.
3. **Intelligence API (`/api/intelligence/whiteboard/route.ts`):**
   - Recibe `timeRange` (`MTD`, `30D`, `90D`).
   - Clave de caché en Redis segmentada por `timeRange`.
   - `getCurrentMonthCostAggregation` acepta `timeRange` y aplica la ventana de fecha correspondiente (`INTERVAL 30 DAY`, `INTERVAL 90 DAY` o `DATE_FORMAT(..., '%Y-%m-01')`).
   - `WhiteboardSummaryMetrics` devuelve `timeRange` y `costPeriodUSD`.
4. **Mock Data (`src/lib/mockData.ts`):**
   - Ajusta los costos y métricas mock según el multiplicador del rango (1x en MTD/30D, ~2.8x en 90D).
5. **Directiva (`directivas/whiteboard_overview_sop.md`):**
   - Se actualizó el SOP con las especificaciones de persistencia y rango temporal.

---

## MEJ-42 — Capacidades de IA: fase 1 hecha y lo encontrado de paso

**Módulo:** IA · **Impacto:** Alto · **Esfuerzo:** Alto · **Estado:** En curso (fase 1 hecha el 2026-10-07; puntos 1 a 5, Managed Identity, soporte, Document Intelligence y la fase 2 el 2026-10-08)

El análisis, el plan por PRs, lo implementado y lo que queda están en
[`propuesta-capacidades-ia-2026-10-07.md`](propuesta-capacidades-ia-2026-10-07.md), secciones 6.9 y 10.
Esta entrada no lo repite: guarda sólo lo que apareció de paso, porque no era parte de la fase.

**Hecho**, en la rama `feat/ia-fase1-anomalias`: la sugerencia de etiquetas endurecida (`41dbe9e`), los
hechos de causa raíz por medidor (`b11beda`), la explicación con IA bajo el gate único (`c98e3ea`) y el
mapeo de columnas de CSV con IA (`7ebbb71`). Los hechos y la explicación se montaron primero en
`AnomalyDashboard.tsx`, que no se ve (punto 4); `16276bc` los pasó al panel que sí se ve. Después, en la
misma rama: interruptor por feature (`37009a1`), telemetría por feature (`e1b963b`), los puntos 1 a 5 de
abajo y los subencargados (`24fa317`). Managed Identity y el módulo Terraform `ai_services` (PR 2) están en
`feat/ia-fase0-managed-identity`, apagados hasta el rollout (sección 10.6 de la propuesta). El triaje y los
borradores de soporte (PR 8) están en `feat/ia-fase3-soporte`, apagados hasta medir el volumen de tickets
(sección 10.7). Document Intelligence para gasto externo (PR 9) está en
`feat/ia-fase4-document-intelligence`, apagado hasta validar la demanda y el precio (sección 10.8). La
normalización de valores de etiquetas (PRs 6 y 7) está en `feat/ia-fase2-tags`, encendida por defecto
(sección 10.9); lo que quedó afuera, en la 10.10.

### Encontrado de paso y corregido

1. **`/api/intelligence/upload` no validaba el plan** — corregido en `8390af8`. La ruta exige Business en
   el servidor con `assertTenantTier`, el corte por plan de `requireTenantTier` sin el corte por alcance
   (MEJ-38), que les cerraría la carga a los usuarios acotados.
2. **`getAssessment` no pasaba por el gate** — corregido en `7200145`. El reporte de la carga es la feature
   `billing-upload-assessment` (Business, encendida por defecto, 4000 tokens de salida). Si el gate niega,
   la carga devuelve el resumen por servicio calculado sin IA y el motivo. El reporte sale en el idioma de
   la UI y en la moneda del archivo; si el archivo no la indica, no la inventa.
3. **Sin detalle por medidor para los tenants que cargan sólo por exports** — corregido en `cf440f9`. La
   ingesta de exports escribe `CostMeterSnapshots` con la misma clave y el mismo upsert que el sync por API.
4. **El triaje no se guardaba** — corregido en `9da7e97`. El panel que se ve mandaba `Open`, `Postponed`,
   `Dismissed` y `Completed` a una columna `ENUM('New','Investigating','Resolved','False Positive')`; con
   `sql_mode` estricto esas escrituras fallaban siempre y el error se tragaba, así que no hubo datos que
   migrar. Queda un solo endpoint de triaje (`PATCH /api/intelligence/anomalies`) y un solo vocabulario
   (`ANOMALY_STATES`), y el panel muestra el responsable.
5. **El gate admitía la explicación con IA desde Professional** — corregido en `331f936`. Pide Enterprise,
   como la pantalla y el pricing, que desde Professional venden sólo las alertas.

### Encontrado de paso y sin corregir

6. **Los exports FOCUS guardan mal el servicio y la suscripción.** En `costExportIngestionService.ts`,
   `srvIdx` toma el primer encabezado que contiene `service`, y en FOCUS `ServiceCategory` va antes que
   `ServiceName`: el servicio guardado es la categoría ("Compute", "Databases"). `subIdx` busca
   `subscriptionid` y FOCUS trae `SubAccountId`, así que la suscripción queda en `'default'`. Corregirlo
   cambia la clave única de las filas ya guardadas de `CostSnapshots` y `CostMeterSnapshots`: la próxima
   ingesta duplicaría el mes reexpuesto. Hace falta borrar las filas FOCUS del tenant antes de reingerir.
7. **`ai-report`, `assessment` y `executive-report` llaman a `getAssessment` sin plan ni cupo.** Respetan
   el interruptor global y el del tenant y tienen rate limit, pero no tier ni cupo mensual, y piden el
   reporte en español y en USD.
8. **La página de subencargados y el documento descargable no coinciden en Microsoft Graph.** La página
   lo ubica en Estados Unidos y la Unión Europea; el generador (`scripts/generate-trust-center-docs.js`),
   sólo en Estados Unidos. Lo decide legal.
9. **El escáner de Tag Governance no pagina.** `scanTagGovernanceLive` consulta Resource Graph con
   `limit 1000` para recursos y `limit 500` para grupos de recursos, sin `$skipToken`. En un tenant más
   grande, el % de cumplimiento, los valores no conformes y el historial diario salen de una parte de los
   recursos, sin aviso. La fase 2 lo heredó.
10. **El % de cumplimiento cuenta sólo recursos.** `overallCompliancePercentage` divide los recursos que
    cumplen por los escaneados; los grupos de recursos no entran. El tooltip de **Cumplimiento Global de
    Tags** dice que es un porcentaje ponderado de recursos y grupos de recursos. Hay que decidir si los
    grupos cuentan y después corregir el cálculo o el texto.
11. **Tags Faltantes Frecuentes tiene un valor por defecto.** Si no falta ninguna etiqueta,
    `mostFrequentMissingTag` vale `CostCenter & Role`, aunque el tenant cumpla todo o sus políticas sean
    otras.
12. **`?mock=true` abre la demo en `/api/governance/tags`.** Con ese parámetro, el GET devuelve el escaneo
    de la demo y el POST simula el éxito, los dos sin sesión. No expone datos de clientes ni escribe en
    Azure, pero un POST real con `?mock=true` contesta que aplicó las etiquetas sin hacer nada. Además, sin
    `tenantId` el tenant es `default`. Alcanza con mirar sólo `isMockTenant`.
