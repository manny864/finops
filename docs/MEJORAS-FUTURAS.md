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
| [MEJ-11](#mej-11--módulo-de-comunicaciones-globales-a-usuarios-popups-banners-y-alertas) | Módulo de comunicaciones globales a usuarios (popups, banners y alertas) | SuperAdmin / Transversal | Alto | Medio | Propuesta |
| [MEJ-12](#mej-12--trazabilidad-de-ciclo-de-vida-de-tenants-fechas-de-activación-suspensión-y-bajas) | Trazabilidad de ciclo de vida de tenants (fechas de activación y bajas) | SuperAdmin / Gobernanza | Alto | Bajo | Propuesta |
| [MEJ-13](#mej-13--marketplace-de-add-ons-y-capacidades-a-la-carta-para-tiers-professional-y-business) | Marketplace de add-ons y features a la carta (Professional y Business) | Facturación / Marketplace | Alto | Medio | Propuesta |
| [MEJ-14](#mej-14--trazabilidad-de-ventas-por-comercial-y-cálculo-automatizado-de-comisiones) | Trazabilidad de ventas por comercial y cálculo de comisiones (20%) | SuperAdmin / Comercial | Alto | Medio | Propuesta |
| [MEJ-15](#mej-15--expansión-multi-tenant-por-contrato-y-adición-de-tenants-con-capacidad-heredada-por-tier) | Expansión multi-tenant por contrato y adición de tenants con capacidad heredada por tier | Facturación / Multi-Tenant | Alto | Medio | Hecha |
| [MEJ-16](#mej-16--gestión-avanzada-de-compromisos-reservas-y-savings-plans) | Gestión avanzada de compromisos (Reservas y Savings Plans) con simulador de Breakeven, Mix Óptimo, límite de devolución $50k USD y alertas de expiración | Compromisos / FinOps | Alto | Medio | Propuesta |
| [MEJ-17](#mej-17--aks-finops-cockpit-costos-por-namespace-workload-y-eficiencia-de-contenedores) | AKS FinOps Cockpit (Costos por Namespace, Workload y Eficiencia de Contenedores con OpenCost/Add-on) | Cómputo / Kubernetes | Alto | Alto | Propuesta |
| [MEJ-18](#mej-18--cosmos-db--cargas-nosql-finops-cockpit) | Cosmos DB & Cargas NoSQL FinOps Cockpit (Optimizador de RU/s, Detección de Hot Partitions y Matriz Serverless) | Bases de Datos / NoSQL | Alto | Medio | Propuesta |
| [MEJ-19](#mej-19--mapa-de-tráfico-de-red-egress-y-fugas-de-datos) | Mapa de tráfico de red, egress y fugas de datos (Inter-AZ, Cross-Region, NAT Gateway, Private Endpoints y ExpressRoute/VPN) | Redes / Egress | Alto | Medio | Propuesta |
| [MEJ-20](#mej-20--shift-left-finops-integración-cicd-y-gatekeeper-de-iac) | Shift-Left FinOps: Integración CI/CD y Gatekeeper de IaC (PR Cost Estimator y Budget Gates) | Shift-Left / DevOps | Alto | Medio | Propuesta |
| [MEJ-21](#mej-21--orquestación-de-remediación-inteligente-conectores-itsm-y-generador-de-policy-as-code) | Orquestación de remediación con Rollback, conectores ITSM (Teams, Slack, Jira, ServiceNow) y generador de Azure Policy | Gobernanza / Automatización | Alto | Alto | Propuesta |

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

## MEJ-11 — Módulo de comunicaciones globales a usuarios (popups, banners y alertas)

**Módulo:** SuperAdmin / Transversal · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Propuesta

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

---

## MEJ-12 — Trazabilidad de ciclo de vida de tenants (fechas de activación, suspensión y bajas)

**Módulo:** SuperAdmin / Gobernanza / Facturación · **Impacto:** Alto · **Esfuerzo:** Bajo · **Estado:** Propuesta

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

**Módulo:** Facturación / Multi-Tenant · **Impacto:** Alto · **Esfuerzo:** Medio · **Estado:** Fase 1 Hecha / Fase 2 Propuesta

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

#### ⏳ Fase 2: Gating Estricto de Slots y Checkout Autoservicio con Paddle (Pendiente de Monetización)
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
| **MEJ-10** | **Unificar catálogos de precios y marcar origen del ahorro**: `resourceConfig` de `/api/dashboard/summary` y `ZombieResourcesTable` unificados con `baselineForResourceType` en `src/lib/realizedSavings.ts`. Eliminados `config.savings` y `fallbackSavings`. Tipado `savingsSource: 'cost_management' \| 'type_baseline' \| 'none'` en el payload y consumido con tooltip/`(est.)` en UI. | Sesión anterior |
| **MEJ-15** | **Expansión Multi-Tenant por Contrato**: Implementada la herencia de Tier (`parent_tenant_id`), cuotas aisladas por tenant (2 suscripciones/3 usuarios para Pro; 3 suscripciones/5 usuarios para Business; ilimitado para Enterprise), migración SQL `20260825-001-multi-tenant-contracts.sql`, guardia de middleware `tierLimitsGuard.ts` y suite de tests `contractMultiTenant.test.ts`. | Sesión anterior |
