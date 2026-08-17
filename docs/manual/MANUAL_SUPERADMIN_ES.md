<div class="cover">
<img src="../../public/CSCloudSolutions.png" alt="CSCloudSolutions" class="cover-logo" width="360" />
<h1 class="cover-title">Manual de SuperAdmin</h1>
<p class="cover-sub">FinOps SaaS · CSCloudSolutions</p>
<p class="cover-meta">Versión 2.0 · Agosto 2026</p>
<p class="cover-copyright">© 2026 CSCloudSolutions. Todos los derechos reservados.</p>
</div>

# 📘 Manual de SuperAdmin — FinOps SaaS (CSCloudSolutions)

**Versión:** 2.0 (detallada)
**Idioma:** Español
**Última actualización:** Agosto 2026
**Audiencia:** exclusivo equipo interno de CSCloudSolutions (SuperAdmin). Incluye todo el contenido del Manual de Usuario más los flujos de administración de la plataforma (alta de tenants, onboarding de clientes, gestión comercial).

---

## Novedades recientes (Agosto 2026)

- **Cockpits FinOps de Cómputo y Eficiencia Serverless:** incorporación de tableros resolutivos para **Function Apps** (`/intelligence/computo/fapps`) con telemetría de invocaciones, GB-s, auditoría de dependencias (Storage/App Insights) y remediación con playbooks de sampling y downgrade; **App Services** (`/intelligence/computo/waas`) con densidad de apps y consolidación; y **VMSS** (`/intelligence/computo/vmss`) con autoscale y Spot pricing.
- **Estandarización de Popovers Responsivos (`InfoTooltip`):** popovers con fondo azul institucional `#1B2A41` 100% responsivos para evitar pérdida de texto en cualquier viewport.
- **Nuevo panel SuperAdmin:** `Alertas Partner Center` (`/superadmin/partner-alerts`) para monitorear estados PAL/CPOR por tenant y detectar eventos recientes.
- **Nuevo módulo Azure Integration Services (iPaaS):** se incorporó `Intelligence → Azure Integration Services` con tabs de Logic Apps, APIM, Service Bus, Event Grid, Event Hubs y ADF, incluyendo sección de Conectores Enterprise para Logic Apps.
- **Automatización operativa PAL:** al aprobar asociación de partner, se registran eventos y se habilita reintento automático (cron) con actualización de estado y detalle.
- **IA Enterprise (Azure IA):** configuración global extendida para guardar y probar **endpoint URL** + deployment, además de la API key, con compatibilidad de fallback.
- **Directiva transversal de tablas FinOps/CMP:** queda formalizada para presentes y futuras tablas (filtros base, orden A-Z/Z-A/costo, paginado 15/30/45/60, responsive full-width y resize de columnas).
- **Seguridad y Monitoreo estandarizados:** módulos alineados al mismo estilo de Bases de Datos y Cómputo, incluyendo paginado y filtros por recurso/región/tipo/grupo.
- **Nuevo cron operativo de Seguridad:** `prewarm-security-finops` agregado al mapa de jobs de Terraform (staging/prod) para precalentar `defender` y `security/service-cost`.
- **AI Cost Analytics hardening:** correcciones de consumo real, tendencia MTD diaria y robustez de fuente de datos/cache para Microsoft Foundry.
- **Hardening de métricas de Bases de Datos:** Redis, MySQL, PostgreSQL, Cosmos DB, MongoDB y SQL/Managed Instance ahora usan fallback por métrica para evitar paneles en `N/A/unknown` con telemetría parcial de Azure.
- **Refresh visual FinOps con Tabler:** módulos clave de Inteligencia, Consumo, Gobernanza, Cleanup, Overview y Copilot M365 se estandarizaron sin fondo azul en iconos.
- **Pipeline de staging endurecido:** deploy con resolución dinámica de suscripción/RG/app/job, seguimiento correcto de migraciones por `job-execution-name` y health check compatible con redirects (`200/307/308`).

## Directiva operativa de cambios (obligatoria)

Para tareas asistidas por agente en este repositorio:

- **No hacer `push` a `staging` ni a `main` sin instrucción explícita del usuario.**
- **No hacer merge a `main` sin instrucción explícita del usuario.**
- El modo por defecto es **solo commits locales** hasta nueva autorización explícita.

## Cómo usar este manual

Cada sección explica **qué es** la funcionalidad, **quién puede usarla** (rol y tier de suscripción), y el **flujo de uso paso a paso** — botones concretos, rutas de URL, campos de formulario y qué esperar como resultado. Si sos usuario no técnico, podés saltar directo a la sección que te interesa: cada una es autocontenida.

---

## 📑 Índice

1. [Primeros pasos](#1-primeros-pasos)
2. [Roles y permisos](#2-roles-y-permisos)
3. [Navegación principal](#3-navegación-principal)
4. [Sección Visibilidad](#4-sección-visibilidad)
5. [Sección Inteligencia Financiera](#5-sección-inteligencia-financiera)
6. [Sección Limpieza de Nube](#6-sección-limpieza-de-nube)
7. [Sección Gobernanza](#7-sección-gobernanza)
8. [Sección Administración](#8-sección-administración)
9. [FinOps Copilot (asistente de IA)](#9-finops-copilot-asistente-de-ia)
10. [Seguridad de la cuenta (MFA)](#10-seguridad-de-la-cuenta-mfa)
11. [Funciones avanzadas e integraciones](#11-funciones-avanzadas-e-integraciones)
12. [Mejores prácticas](#12-mejores-prácticas)

---

## 1. Primeros Pasos

### 1.1. Acceso e inicio de sesión

La plataforma es un SaaS B2B. La autenticación se integra con **Microsoft Entra ID** (Azure Active Directory):

1. Entrá a la URL de la plataforma.
2. Hacé clic en **"Iniciar sesión con Microsoft"**.
3. Autenticate con tu cuenta corporativa. La plataforma reconoce automáticamente tu tenant de Azure y tu identidad.
4. **Modo Demo:** si querés probar la plataforma sin conectar tu entorno real, elegí uno de los perfiles comerciales preconfigurados desde la pantalla principal — vienen con datos y métricas simuladas realistas, para que puedas explorar cada módulo sin riesgo. Hay cuatro tenants de demo (uno por tier).

### 1.2. El asistente de onboarding (primera vez)

Si sos administrador y es la primera vez que tu organización usa la plataforma, al iniciar sesión se abre automáticamente el **Asistente de Configuración** (`/onboarding`), un wizard de 5 pasos lineales con barra de progreso:

| Paso | Qué hacés | Resultado |
|---|---|---|
| **1. Bienvenida y datos de la empresa** | Confirmás nombre de la empresa, moneda de visualización (USD/EUR/GBP) y zona horaria | Se guardan tus preferencias iniciales |
| **2. Conectar Azure** | Cargás y validás **Client ID + Client Secret + Azure Tenant ID** del Service Principal. | La plataforma confirma precondición de ingesta |
| **3. Primera sincronización de datos** | Presionás **"Ejecutar Sincronización"** | Trae el primer set de costos desde Azure (puede tardar hasta 60 segundos) |
| **4. Crear tu primer presupuesto** | Completás nombre, límite mensual ($) y umbral de alerta (%) | Se crea tu primer presupuesto activo |
| **5. Configurar notificaciones** | Presionás **"Configurar"** (abre `/admin/notifications` en pestaña nueva) | Agregás al menos un canal (email, Slack o Teams) para recibir alertas |

Podés **saltar (skip)** cualquier paso y volver más tarde — el wizard vuelve a aparecer hasta que completes o saltees los 5. El progreso (%) se calcula como `(completados + saltados) / 5 × 100`. Si preferís el formulario de configuración avanzada en lugar del wizard, `/admin/onboarding` sigue disponible en paralelo.

### 1.3. Onboarding de un nuevo cliente (flujo SuperAdmin)

Si sos SuperAdmin de CSCloudSolutions dando de alta un tenant nuevo:

1. **Registrar el Tenant:** andá a `/admin/tenants` → **Gestión de Tenants** → ingresá el Entra ID del tenant del cliente, el nombre comercial y el Tier inicial.
2. **Generar credenciales:** una vez creado en la base, andá a `/admin/onboarding` → **Onboarding de Clientes**. Ahí aparecen los campos **Client ID** y **Client Secret** para pegar las credenciales del Service Principal generadas por el script de PowerShell que le compartís al cliente.
3. **Etiquetar origen comercial y comisión (opcional):** en el panel expandido de cada tenant en el Directorio de Entornos, completás **"Origen comercial / Referido por"** y **"Comisión (%)"** para cálculo interno de comisiones — solo visible para SuperAdmin.
4. **Asociación de partner (PAL / CPOR):** luego de cargar credenciales, el bloque de aprobación/rechazo queda visible hasta estado **vinculado (LINKED)**. Si quedó en `FAILED` o `DECLINED`, podés reintentar sin reset manual.

**Roles Azure que asigna el script, por tier contratado:**

| Tier | Roles built-in | Rol personalizado |
|---|---|---|
| Professional (piso de la plataforma) | Reader, Cost Management Reader, Monitoring Reader, Billing Reader | — |
| Business | Professional + Tag Contributor | Start/Stop/Restart/Deallocate de VM + tags |
| Enterprise | Business + Tag Contributor | Business + eliminar disco/snapshot/NIC/IP pública/NSG |

> ⚠️ **Los 4 roles base de Professional son el mínimo absoluto** para que la página Consumo Real muestre datos. Si falta `Cost Management Reader` o `Billing Reader`, Azure devuelve 0 filas sin avisar.

> ℹ️ **AI Cost Analytics (Microsoft Foundry / Azure OpenAI)** usa los mismos roles base (`Reader`, `Cost Management Reader`, `Monitoring Reader`, `Billing Reader`): **no requiere un rol adicional**.

> ⚠️ **Suscripciones EA/MCA** (Enterprise Agreement / Microsoft Customer Agreement) requieren que el Billing Admin del cliente asigne además `Enrollment Reader` o `Billing Account Reader` al Service Principal a nivel de billing account — el script no puede hacer esto automáticamente, hay que coordinarlo con el cliente.

**Verificar que los permisos quedaron bien asignados**, después de que el cliente corrió el script:

- **Opción rápida (recomendada):** `GET /api/admin/check-sp-roles?tenantId=<tenant-id>` — devuelve cuántas suscripciones tienen todos los roles ✅, cuáles están incompletas ⚠️ y cuáles no tienen ningún rol ❌, con el detalle de qué falta en cada una.
- **Opción manual:** en Azure Portal → Suscripción → **Access control (IAM)** → **Role assignments** → filtrar por el App Registration `CSCloudSolutions-FinOps-Agent` y confirmar que aparecen los roles del tier contratado.

**Troubleshooting — "Consumo Real no muestra datos":**

| Mensaje de error | Causa | Solución |
|---|---|---|
| `NO_COST_PERMISSION` | Falta `Cost Management Reader` | Asignar el rol al SP en esa suscripción |
| `NO_SUBSCRIPTION_ACCESS` | Falta `Reader` | Asignar `Reader` o re-ejecutar el script |
| `SUBSCRIPTION_INACTIVE` | La suscripción no tiene consumo ni en el mes actual ni en los últimos 30 días | Verificar que sea la suscripción correcta |
| `NO_SUBSCRIPTIONS` | El SP no ve ninguna suscripción | Asignar `Reader` en al menos una |
| `NO_CONSUMPTION` | Todo OK pero sin consumo en el mes en curso | Esperar al cierre del ciclo o revisar otra suscripción |

**Troubleshooting — "AI Cost Analytics (Microsoft Foundry) muestra 0 tokens / $0":**

Aunque los modelos (p.ej. gpt-5.1, gpt-5.3-codex) tengan consumo real en Microsoft Foundry, el panel puede quedar en cero por varios motivos. Usá el **endpoint de diagnóstico** (no requiere acceso a la base de datos ni a los logs del cron):

- `GET /api/intelligence/ai-analytics/diagnostics?tenantId=<tenant-id>` — devuelve, paso a paso: filas actuales en `AICostSnapshots`, suscripciones visibles (con el truncado por tier), cuentas `Microsoft.CognitiveServices/accounts` encontradas y su `kind`, las **métricas realmente disponibles** por cuenta, una **prueba en vivo** de cada métrica de token (cantidad de series + suma) y las filas que produciría el colector, más una **conclusión** que indica la causa probable.

| Conclusión del diagnóstico | Causa | Solución |
|---|---|---|
| `No hay suscripciones visibles` | El SP no tiene `Reader`, o el tier trunca las suscripciones | Asignar `Reader` / revisar tier |
| `No se encontró ninguna cuenta CognitiveServices` | El recurso Foundry es de otro tipo o está en una suscripción fuera del límite de tier | Verificar el tipo/suscripción del recurso Foundry |
| `Las cuentas AI NO exponen métricas de token` | Los modelos Foundry no emiten `ProcessedPromptTokens`/`GeneratedTokens` a Azure Monitor | El costo llega por el fallback `CostSnapshots` (Cost Management, con 8–24 h de latencia) |
| `Las métricas existen pero devuelven 0` | Latencia de Azure Monitor (~15 min) o consumo fuera de la ventana ayer+hoy | Reintentar en unos minutos y re-ejecutar el cron `/api/cron/sync` |
| `El colector produce filas` | Todo OK; falta persistir | Ejecutar el cron `/api/cron/sync` (invalida el cache automáticamente) |

> ℹ️ **Fix 2026-08-05:** el colector ahora pide cada métrica de token **por separado** a Azure Monitor. Antes las pedía en un solo batch y, si una no existía para el recurso (p.ej. `ProcessedInferenceTokens` en Azure OpenAI clásico), Azure rechazaba **todo** el batch con 400 y el panel quedaba en cero.

---

## 2. Roles y Permisos

La plataforma separa **dos conceptos independientes**, que se combinan pero no se reemplazan entre sí:

### 2.1. Rol (qué podés HACER)

| Rol | Capacidad |
|---|---|
| **SuperAdmin** | Administración total de CSCloudSolutions: crear tenants, configurar pasarelas de pago. Rol interno, no de cliente. |
| **Owner** | Dueño del tenant. Acceso completo, incluyendo cambio de plan y facturación. |
| **Admin** | Visibilidad financiera completa, modificación de configuraciones, acciones correctivas (apagar VMs, eliminar recursos). |
| **Colaborador** | Ve inteligencia financiera y visibilidad; puede sugerir cambios pero no administra facturación ni usuarios. |
| **Reader** | Solo lectura en dashboards y reportes. No aplica cambios ni ve configuración sensible. |

### 2.2. Permisos de dominio (qué páginas VES)

Además del rol, cada usuario puede tener asignados uno o más **permisos de dominio**, que determinan qué secciones del menú lateral ve — independientemente de su rol:

| Permiso | A quién le sirve | Qué habilita ver |
|---|---|---|
| **FinOps** | Analista FinOps | Páginas de costos y recomendaciones |
| **CloudAdmin** | Administrador de nube | Páginas de ejecución/escritura sobre infraestructura |
| **Security** | Auditor de seguridad | Auditoría de cumplimiento, credenciales, gobernanza |
| **ProductOwner** | Líder de proyecto/producto | Visibilidad por Centro de Costos o aplicación |

**Cómo se combinan:** un usuario con rol **Reader** y permiso **FinOps** puede *ver* las páginas de FinOps, pero no modificar ni eliminar nada en ellas — el rol sigue mandando sobre las acciones. El filtrado por permisos es opcional: si a un usuario no le asignás ningún permiso, ve todo lo que su rol y tier le permitan (comportamiento por defecto, sin restricción de dominio). Los roles **Admin/Owner** siempre ven todo lo que su tier permite, sin importar los permisos asignados. El **Dashboard** (`/`) y **Soporte** (`/support`) están siempre visibles para todos.

**Cómo asignar permisos:** andá a `/admin/users` → seleccioná el usuario → activá/desactivá los toggles de permisos en la tabla, o asignalos al dar de alta un usuario nuevo manualmente. (Nota: los usuarios importados en bloque desde Entra ID quedan sin permisos asignados por defecto — asignalos después desde la tabla principal.)

> ⚠️ Los permisos de dominio **no** habilitan acciones de escritura en el backend — eso lo sigue controlando exclusivamente el rol. Un usuario con permiso `CloudAdmin` pero rol `Reader` puede *ver* esas páginas, pero cualquier acción de escritura le devolverá error 403 si su rol no lo autoriza.

---

## 3. Navegación Principal

El menú lateral izquierdo agrupa todo en 5 pilares (secciones colapsables — se expande automáticamente la sección de la página activa):

- **Visibilidad** — dashboards, académia, madurez FinOps
- **Inteligencia Financiera** — billing, presupuestos, optimización
- **Limpieza de Nube** — recursos zombis, TTL
- **Gobernanza** — tags, políticas, aprobaciones
- **Administración** — usuarios, configuración, facturación, API

Un **buscador** en la parte superior del sidebar te permite encontrar páginas por nombre o contenido sin navegar manualmente por las categorías.

### 3.1. Botón "Historial" — evolución temporal de cualquier métrica

En Dashboard, Descuentos por Compromiso, Rightsizing, Anomalías, Presupuestos y Alta Disponibilidad vas a encontrar un botón **Historial** arriba a la derecha. Al abrirlo:

1. Elegís un rango de fechas (hasta **1 año atrás**).
2. Ves la evolución diaria de esa página como **gráfico de líneas** y **tabla**.

La plataforma guarda automáticamente una foto diaria de cada página (retención ~13 meses) — no necesitás activar nada, ya está corriendo en segundo plano.

### 3.2. Tu perfil

Hacé clic en tu **avatar** (círculo con tu inicial, arriba a la derecha) para abrir:

- **Nombre completo** — editable con el ícono de lápiz.
- **Correo y rol** dentro del tenant (solo lectura).
- **Moneda de visualización** — selector de divisa.
- **Aspecto** — Claro / Oscuro / Automático (sigue el tema del sistema operativo).
- **Cerrar sesión.**

---

## 4. Sección Visibilidad

### 4.1. Dashboard (White Board)

Tu panel ejecutivo de entrada. Resume Ahorro Potencial Total, Recursos Zombis detectados y calificación de Gobernanza de un vistazo.

**Cómo usarlo:**
1. Seleccioná el período arriba (mes actual, últimos 3/12 meses).
2. Filtrá por suscripción si tenés varias conectadas.
3. Anclá/desanclá tarjetas según lo que quieras ver siempre a mano (ícono de pin en cada tarjeta).
4. Cada tarjeta bloqueada por tu tier actual aparece con blur — hacé clic para ver un modal de upgrade con el detalle de qué desbloquea.

### 4.2. Gastos y Proyección (`/intelligence/cost-projection`, tier Professional+)

Combina dos herramientas en una página:

- **Histograma de costos:** distribución diaria del gasto, con selector de rango desde el último mes hasta **13 meses atrás** (todo lo que permite consultar Azure Cost Management), cacheado en Redis para respuesta instantánea.
- **Proyección de Gastos:** calculá cuánto vas a gastar a futuro.
  1. El sistema toma el promedio mensual de los últimos 12 meses como base.
  2. Ingresás un **% de crecimiento anual esperado** (podés poner valores negativos para simular un escenario de optimización/ahorro).
  3. Elegís el horizonte: 3, 6, 12 o 24 meses.
  4. El resultado muestra: promedio base, tasa mensual equivalente, y el total proyectado, con un gráfico de línea real vs. proyectado.

Hay una tarjeta resumen de esto mismo en el Dashboard con el link **"Ver detalle completo"**.

### 4.3. Azure Advisor

Sincronización directa con las recomendaciones nativas de Microsoft, clasificadas en Costo, Seguridad y Excelencia Operativa. Las recomendaciones se muestran en el idioma que tengas activo en la plataforma (no en el idioma original de Azure).

**Cómo usarlo:** filtrá por categoría, revisá el impacto potencial de ahorro de cada recomendación, y aplicala directamente desde la plataforma o cerrala con una justificación si no aplica a tu caso.

### 4.4. Madurez FinOps

Evaluación interactiva que ubica a tu organización en Crawl / Walk / Run según 5 pilares (visibilidad, optimización, gobernanza, inteligencia, operaciones). Respondé el cuestionario y obtené un score por pilar más un roadmap de mejora personalizado.

### 4.5. Academia FinOps

Centro de aprendizaje interactivo sobre FinOps y optimización Azure — cursos estructurados, videos, glosario y recursos descargables.

> ⚠️ **Gate obligatorio:** los usuarios nuevos deben completar la Academia antes de acceder al resto de la plataforma (con un disclaimer explicando por qué). El progreso se registra **por usuario**, no por organización — cada persona nueva del tenant tiene que completarlo, y una vez completado no se puede volver a ejecutar. Visible para todos los roles excepto SuperAdmin.

### 4.6-4.10. Progreso Histórico, TOP Gastos, Recursos, Green FinOps, Ahorro Capturado, Fugas Financieras (Professional/Business+)

- **Progreso Histórico:** gráficos de tendencia mensual, hitos de ahorro alcanzados, comparativas mes a mes y año a año. Podés añadir anotaciones manuales sobre eventos que expliquen un cambio (ej. "migración a reservas").
- **TOP Gastos:** ranking de tus mayores fuentes de gasto por servicio, suscripción o grupo de recursos, con drilldown a nivel de recurso individual.
- **Recursos** (Business+): inventario completo — filtrado y búsqueda avanzada, etiquetado en masa, exportación.
- **Green FinOps** (Professional+): estimación de huella de carbono por servicio, comparativa de regiones más eficientes, recomendaciones de sostenibilidad.
- **Ahorro Capturado** (Professional+): tracking de ahorros reales ya conseguidos vía RIs, Savings Plans y Hybrid Benefit, con cálculo de ROI.
- **Fugas Financieras** (Professional+): identifica dinero mal gastado (recursos abandonados, sobre-dimensionamiento, redundancia innecesaria) con calendario de remediación.

---

## 5. Sección Inteligencia Financiera

### 5.1. Consumo Real (`/intelligence/billing`, Professional+)

El dashboard de facturación detallada, en tiempo real desde Azure.

**Cómo usarlo:**
1. Filtrá por período, suscripción y grupo de recursos.
2. Hacé zoom en un servicio específico para ver su desglose.
3. Descargá la factura o exportá los datos a Excel desde el botón correspondiente.
4. Creá alertas de umbral desde la misma página (te lleva al formulario de Alertas Self-Service con el contexto precargado).

### 5.2. Presupuestos (`/intelligence/budgets`, Professional+)

1. **Crear presupuesto:** nombre, período (mensual/trimestral/anual), límite en $.
2. **Umbral de alerta:** definís en qué % del presupuesto querés ser notificado (ej. 75%).
3. El sistema hace seguimiento automático — ves consumo real vs. presupuesto en tiempo real, con histórico de períodos anteriores.

### 5.3. Cost Groups (`/intelligence/cost-groups`, Business+)

Agrupación personalizada de costos según tu propia lógica de negocio (por proyecto, línea de negocio, aplicación o ambiente).

1. Creás un grupo con reglas de naming (qué recursos entran, por patrón de nombre o tag).
2. Asignás recursos manualmente si hace falta ajustar.
3. Al hacer clic en un grupo se abre un modal con pestañas: **Costos**, **Acciones**, **Recursos**, **Gobernanza** — cada una con el detalle correspondiente a ese grupo.
4. Comparás grupos entre sí desde la vista de lista.

### 5.4. Reservas Activas — Descuentos por Compromiso (`/intelligence/commitments`, Enterprise+)

Además de cobertura y utilización global, la tabla **Reservas Activas** replica el blade *Reservations* de Azure: Nombre, Estado, Expiración, Alcance, Tipo, Producto, Región, Renovación, Cantidad, y utilización del último día y de los últimos 7 días.

- Clic en el botón de **Renovación** → modal para **activar/deshabilitar la auto-renovación** de esa reserva. El cambio se aplica directamente en Azure — requiere rol Admin/Owner del tenant **y** permisos `Reservations Contributor/Owner` en Azure.
- Clic sobre cualquier **porcentaje de utilización** → modal con detalle de último día / 7 días / 30 días y tendencia diaria.

### 5.5. Savings Plan vs Reserva (`/intelligence/commitment-simulator`, Professional+)

Simulá ambas opciones de compra con tus números reales y compará ahorro a 1 y 3 años antes de comprometerte.

### 5.6. Simulador What-If (`/intelligence/simulator`, tier según config — guardado/comparación históricamente Enterprise)

Simulá el impacto de escalar cómputo/storage, variar tráfico de red, o activar Azure Hybrid Benefit sobre tu costo actual, **antes de aplicar el cambio real**.

**Flujo completo:**
1. Movés los sliders: escala de cómputo, escala de storage, % de incremento de tráfico de red, activar/desactivar AHB.
2. Presionás **"Ejecutar Simulación"** — ves el desglose: costo base, costo proyectado, delta y % de cambio.
3. **Guardar el escenario:** botón **"Guardar actual"** → le ponés nombre y notas opcionales. El escenario queda congelado con esos números (no se recalcula después, aunque tu costo base real cambie con el tiempo — así podés comparar escenarios guardados en distintos momentos entre sí de forma consistente).
4. Repetís el proceso 2-3 veces con distintos sliders para tener varios escenarios guardados.
5. **Comparar:** marcás 2 a 4 escenarios con los checkboxes → botón **"Comparar"** → se abre un modal lado a lado con cada escenario como tarjeta, marcando cuál es la línea base.
6. **Exportar:** elegís el formato (CSV, PDF o Markdown) junto a los botones de descarga — podés exportar un escenario individual, todos los guardados, o la comparación completa con el delta de cada uno contra la base.
7. **Borrar:** ícono de tacho en cada fila (solo el creador del escenario o un Admin/Owner pueden borrarlo).

> El mix de cálculo asumido es Azure-first: 60% del costo es cómputo, 25% storage, 15% red; AHB aplica un descuento flat del 18% sobre el total si está activado.

### 5.7-5.29. Resto de módulos de Inteligencia Financiera

| Módulo | Tier | Para qué sirve y cómo se usa |
|---|---|---|
| **Presupuesto por Centro de Costos** | Enterprise | Definís centros de costo, asignás recursos (manual o en masa), y el sistema prorratea el gasto automáticamente para generar chargeback interno por departamento. |
| **Análisis de Red** | Business | Costo de ancho de banda, gateways, load balancers e IPs públicas; identifica picos de transferencia e IPs ociosas para dar de baja. |
| **Hybrid Benefit (AHB)** | Business | Muestra qué VMs podrían usar licencias con Software Assurance y cuánto ahorrarías activándolo; tracking de qué ya lo usa. |
| **Control AKS** | Enterprise | Nodos activos, utilización real vs. sobre-aprovisionamiento, costo por pod, recomendaciones de auto-scaling. |
| **AKS Chargeback** | Enterprise | Asignás namespaces a equipos y el sistema calcula cuánto gasta cada equipo en el clúster, para facturación interna. |
| **Container Apps** | Business | Control de costos de Azure Container Apps: costo mensual por app, entorno, CPU/memoria y réplicas. Detecta oportunidades de *scale-to-zero* (apps con réplica mínima ≥ 1 que podrían apagarse sin tráfico) y estima el ahorro potencial. También disponible como tarjeta en el White Board. |
| **Log Analytics** | Business | Control de costos de Log Analytics Workspaces: costo mensual, retención e ingesta estimada por workspace. Detecta ingesta masiva innecesaria (workspaces sin tope diario), retención excesiva y oportunidades de *Commitment Tier*, con ahorro potencial estimado. También disponible como tarjeta en el White Board. |
| **Unit Economics** | Enterprise | Definís tu propia métrica unitaria (costo por transacción, por usuario, por MB procesado) y el sistema calcula el costo unitario automáticamente sobre tus datos de Azure. |
| **Usuarios y Licencias** (fusión con "Licencias") | Professional | 3 pestañas: **Dashboard** (KPIs M365/Entra ID), **Actividad de Usuarios** (tabla filtrable), **Optimización de Licencias** (recursos sin Hybrid Benefit vía Resource Graph + métricas por SKU vía Microsoft Graph). |
| **Ingesta CSV** | Business | Subís un CSV con facturación de terceros bajo el estándar FOCUS para analizarlo junto a tus datos de Azure. |
| **Alertas Self-Service** | Business/Professional | Creás reglas de alerta de presupuesto o anomalía vos mismo, sin pedirle nada a soporte — condición + canal de notificación. |
| **Scorecard** | Business | Puntuación 0-100 de tu salud financiera con indicadores individuales (ahorro, cobertura de reserva, eficiencia); podés fijar metas. |
| **Salud del Tenant** | Business | Estado general — problemas detectados, consistencia de facturación, cobertura de reservas, cumplimiento de políticas. |
| **Rightsizing** (+ verticales VMSS/App Service/SQL/Storage) | Enterprise | Analiza 30 días de uso real y recomienda el SKU óptimo; muestra ahorro estimado antes de aprobar el cambio. Verticales dedicadas en `/intelligence/rightsizing/{vmss,appservice,sqldb,storage}`. |
| **Storage Efficiency** | Business | Simula el ahorro de mover blobs entre tiers Hot/Cool/Archive antes de aplicarlo. |
| **Compute $/Core** | Professional | Desglose de costo por núcleo vCPU para comparar familias de VM entre sí. |
| **Detección de Anomalías** | Enterprise | Identifica picos o caídas anormales de gasto automáticamente y te permite crear alertas ajustando la sensibilidad. |
| **Índice de Optimización (COIN)** | Enterprise | Puntuación 0-100 compuesta, comparable contra benchmarks de industria. |
| **Eficiencia de Cómputo** | Enterprise | Utilización real de CPU/memoria/disco por VM, con recomendación de resize y ahorro calculado. |
| **Optimización de Tarifas** | Enterprise | Compara tus tarifas actuales contra benchmarks de mercado para preparar una negociación con Microsoft. |
| **Costo Cero** | Todos | Qué recursos son gratis en tu suscripción (free tier, créditos) para maximizar su uso. |
| **Prorrateo (Allocation)** | Enterprise | Reglas de distribución de costos compartidos entre múltiples áreas (por uso real, proporcional o fijo). |
| **MACC Tracking** | Enterprise | Seguimiento del compromiso mínimo anual (EA/MCA) — consumido vs. comprometido, con proyección de cumplimiento. |
| **AI Cost Analytics** | Enterprise | Costo por modelo de IA y consumo de tokens en Microsoft Foundry / Azure OpenAI, con recomendaciones de optimización de llamadas. |

---

## 6. Sección Limpieza de Nube

### 6.1. Recursos Zombis (`/cleanup/zombies`, Professional+; remediación Business+)

Detecta recursos huérfanos que generan gasto innecesario: discos sin adjuntar, IPs públicas sin uso, App Service Plans vacíos, VMs sin conectar hace 30+ días.

**Flujo de uso:**
1. Listado con filtro por tipo de recurso.
2. Revisás el último uso registrado de cada recurso.
3. Opcional: hacé un snapshot del recurso antes de tocar nada (por si necesitás recuperarlo después).
4. **Eliminar** — requiere rol Business+ y permisos Azure de eliminación (ver tabla de roles del script en la sección 1.3).
5. Podés crear una **política de auto-limpieza** para que recursos zombis de cierto tipo se marquen o eliminen automáticamente a futuro.

### 6.2. Networking Zombies (`/cleanup/zombies/networking`, Professional+; remediación Business+)

Igual que arriba pero enfocado en recursos de red: Load Balancers vacíos, NSGs sin asociación, Public IPs huérfanas, gateways VPN sin conexiones activas.

### 6.3. Expiraciones TTL (Business+)

Control de entornos efímeros (sandboxes, ambientes de prueba) con fecha de expiración.

1. Creás una política TTL: qué tipo de recurso, cuántos días de vida.
2. Etiquetás los recursos afectados con la fecha de expiración (manual o automático por regla).
3. El sistema te alerta antes de la eliminación automática.
4. Consultás el histórico de qué se eliminó y cuándo.

---

## 7. Sección Gobernanza

### 7.1. Cumplimiento de Etiquetas (`/governance/tags`, Professional+; remediación Business+)

1. Definís las etiquetas obligatorias de tu organización (ej. `CostCenter`, `Owner`, `Environment`).
2. El sistema audita toda tu infraestructura y te muestra qué recursos no las tienen.
3. Con **auto-tagging** (Business+) podés aplicar etiquetas faltantes automáticamente según reglas.
4. Generás reportes de compliance para mostrar a auditoría interna.

### 7.2. Reporte de Gobernanza (`/governance/reporting`, Enterprise+)

Dashboard ejecutivo unificado: estado de compliance general, hallazgos de seguridad y etiquetado, recomendaciones priorizadas, y evolución histórica. (Esta página fusiona lo que antes era "Estado de Gobernanza" como una sección adicional dentro del mismo reporte.)

### 7.3. Horarios de Apagado — Power Schedules (`/governance/power`, Business+)

Rutinas automáticas de encendido/apagado de VMs fuera de horario productivo.

**Dos modos:**
- **Fecha puntual (single):** ejecuta la acción (encender/apagar/reiniciar) **una única vez** en fecha y hora exacta.
- **Recurrente (range):** definís un rango horario **"Desde–Hasta"** y los días de la semana (ej. Lun-Vie 08:00-20:00). El sistema crea automáticamente un horario de encendido a la hora "Desde" y uno de apagado a la hora "Hasta", con los mismos días.

**Detalles operativos importantes:**
- La zona horaria se detecta automáticamente por tu navegador al abrir el formulario — podés cambiarla manualmente si necesitás otro huso.
- El sistema revisa horarios pendientes cada **2 minutos**, más una verificación inmediata al guardar. La acción sobre la VM tarda entre 20 y 40 segundos adicionales en confirmarse contra Azure.

### 7.4. Alta Disponibilidad (`/governance/ha`, Business+)

Detecta VMs en producción sin Availability Zone o Availability Set asignado — riesgo de punto único de falla.

### 7.5. Credenciales por Expirar (`/governance/credentials`, Business+)

Alerta proactiva de App Registrations / Service Principals cuyos secretos o certificados vencen en 30/60/90 días. Cada credencial muestra estado: **Vencida**, **Próxima a vencer** (≤30 días) o **Habilitada**.

**Cómo crear una alerta:**
1. Botón **"Crear alerta de vencimiento"**.
2. Definís cuántos días antes querés el aviso (1-365).
3. Elegís el canal: email, Slack o Teams (vía webhook).
4. El sistema evalúa a diario y envía **máximo una notificación por día** mientras haya credenciales dentro del umbral (incluye las ya vencidas).

Estas reglas también se administran desde **Alertas Self-Service**, bajo el tipo "Vencimiento de credenciales".

### 7.6. Políticas Auto-Block (Enterprise+)

Políticas automáticas que bloquean acciones antes de que sucedan: crear VMs por encima de cierto tamaño, crear recursos sin etiqueta obligatoria, superar un gasto diario máximo por suscripción, o crear recursos fuera de un horario permitido.

### 7.7. Aprobaciones (Business+)

Flujo de aprobación para cambios de infraestructura: un usuario solicita el cambio, un especialista lo revisa y aprueba/rechaza con comentarios, y queda todo auditado (quién aprobó qué y cuándo).

---

## 8. Sección Administración

### 8.1. Soporte (`/support`, todos los planes desde Professional)

Cualquier usuario del tenant puede abrir tickets a CSCloudSolutions y seguir la conversación dentro de la plataforma.

**Cómo crear un ticket:**
1. Completás asunto, categoría (Técnico / Facturación / Consulta / Pedido de feature), prioridad y mensaje inicial.
2. Podés adjuntar capturas o archivos (`jpg`, `jpeg`, `png`, `txt`, `json`; máx. 5 MB por archivo, 10 por ticket) — se conservan 60 días y luego se borran automáticamente.
3. Las respuestas del equipo aparecen identificadas con 🛟 en el hilo. Podés responder mientras esté abierto, y cerrarlo/reabrirlo vos mismo.
4. **Acceso rápido:** ícono de salvavidas junto a tu usuario en el header, abre Soporte desde cualquier página. Cuando te responden, ves una notificación en la campanita 🔔.

**Cuotas por plan:**

| Plan | Tickets/mes | SLA primera respuesta |
|---|---|---|
| Professional | 20 | 24 h |
| Business | Ilimitados | 8 h |
| Enterprise | Ilimitados | 4 h |

### 8.2. Usuarios y Permisos (`/admin/users`)

Ver sección 2 para el detalle de rol vs. permisos. Desde acá agregás usuarios, editás su rol, activás/desactivás sus permisos de dominio, o los desactivás por completo.

### 8.3. Configuración (`/admin/config`)

Administración general del perfil del tenant: nombre, logo, idioma por defecto para nuevos usuarios, zona horaria para reportes, ciclo de facturación.

### 8.4. Facturación — Cambio de Plan (`/admin/billing`, Professional+, rol Owner)

**Límites por Plan:**
| Plan | Suscripciones Azure Permitidas | Usuarios por Tenant | Soporte / SLA |
|---|---|---|---|
| **Professional** | Hasta 2 suscripciones | Hasta 3 usuarios | 20 tickets/mes (24 h) |
| **Business** | Hasta 3 suscripciones | Hasta 5 usuarios | Prioritario (12 h) |
| **Enterprise** | Ilimitadas | Ilimitados | Dedicado 24/7 (SLA 99.9%) |

**Procedimiento de cambio:**
1. Elegís el nuevo plan (Professional / Business / Enterprise).
2. Elegís frecuencia (mensual/anual) y modo de prorrateo.
3. El sistema te muestra un **resumen previo** con el monto real calculado por la pasarela de pago antes de confirmar: *"Se cobrará ahora $X"* (upgrade) o *"Recibirás un crédito de $X"* (downgrade), el nuevo total recurrente y la fecha de próxima facturación.
4. El cambio **solo se aplica** al presionar **Confirmar cambio** — hasta ese momento podés cancelar sin costo.

### 8.5. Configuración de Notificaciones (`/admin/notifications`, Professional+)

Tres canales soportados: **Slack**, **Microsoft Teams**, **Email (SMTP)**.

**Configurar Slack:**
1. Andá a `https://api.slack.com/apps` → creá o elegí una app → **Incoming Webhooks**.
2. **"Add New Webhook to Workspace"** → elegís el canal de destino.
3. Copiás la URL del webhook (empieza con `https://hooks.slack.com/services/...`).
4. En la plataforma: **Notificaciones** → **Agregar canal** → **Slack** → pegás la URL → guardar.

**Configurar Microsoft Teams:**
1. En el canal de Teams → **⋯** → **Connectors** → buscá "Incoming Webhook".
2. Configurá el webhook y le ponés un nombre.
3. Copiás la URL generada.
4. En la plataforma: **Notificaciones** → **Agregar canal** → **Microsoft Teams** → pegás la URL → guardar.

**Configurar Email:**
- Usa SMTP. Si tu organización no especifica un servidor propio, se usa la configuración SMTP por defecto de la plataforma.
- Podés definir destinatarios múltiples y, opcionalmente, sobrescribir host/puerto/usuario/contraseña SMTP por canal.

**Filtro de severidad:** cada canal puede filtrar qué recibe — `info`, `warning`, `error`, o combinaciones (ej. `warning,error` para no recibir informativos).

**Probar el canal:** botón de test en cada canal configurado — envía una notificación de prueba antes de depender de él en producción.

**Disponibilidad por tier:** Professional permite 2+ canales; Enterprise permite canales ilimitados + overrides de SMTP por canal.

**Si no llegan las notificaciones**, revisá en este orden: canal habilitado (`enabled = true`) → filtro de severidad coincide con el nivel de la alerta → probaste el canal desde la UI → hay al menos un canal configurado para el tenant. El log de envíos (con errores) queda disponible para diagnóstico.

### 8.6. Reporte Ejecutivo (Business+)

Generación automatizada de reportes periódicos de alto nivel, pensados para presentar a dirección — resumen ejecutivo descargable.

### 8.7. Operaciones SaaS (SuperAdmin) (`/superadmin/ops`)

Centro de operaciones global para monitoreo del SaaS:

1. Visualizás estado general de la plataforma y alertas sin reconocer.
2. Revisás salud de componentes y ejecución de crons (última corrida, edad, resumen, estado).
3. Verificás cobertura de canales de notificación por tenant SuperAdmin.
4. Podés disparar notificaciones operativas a los canales configurados cuando detectás degradación.

### 8.8-8.18. Resto de módulos de Administración

| Módulo | Tier | Uso |
|---|---|---|
| **Onboarding de Clientes** | Admin | Ver sección 1.3 — alta de tenants y credenciales del Service Principal. |
| **Gestión de Tenants (Comercial)** | SuperAdmin | `/admin/tenants`: alta manual, tier/status, etiqueta de vendedor/referido y comisión (%) por tenant. |
| **Operaciones SaaS** | SuperAdmin | `/superadmin/ops`: estado de componentes + estado de crons + envío de notificaciones operativas. |
| **Azure Lighthouse Onboarding** | Enterprise | Generación de plantilla ARM para delegación cross-tenant, en `/admin/onboarding/lighthouse`. |
| **Configuración de IA** | Professional | Habilitar/deshabilitar funciones de IA, elegir modelo, ajustar sensibilidad de detecciones y qué datos se comparten. |
| **Invoicing Report** | Enterprise | Export en JSON/CSV/PBIT stub con detalle por billing profile, invoice section y customer, en `/admin/report`. |
| **Workbooks** | Enterprise | Reportes personalizados: layout propio, gráficos, tablas de datos, exportables a PDF y compartibles por link. |
| **Auditoría** | Professional | Log completo de quién cambió qué y cuándo, filtrable por usuario/acción/fecha, exportable para compliance. |
| **MCP API Keys** | Enterprise | Claves de API para integraciones tipo MCP — generar, rotar y revocar. |
| **API Pública** | Enterprise | REST API documentada (OpenAPI/Swagger), con rate limits y monitoreo de uso. |
| **Power BI Templates** | Enterprise | Plantillas `.pbit` descargables, preconectadas a tus datos del SaaS. |
| **FOCUS 1.1 Export** | Professional | Exportación de tus datos en el formato estándar FOCUS, programable para generación diaria automática. |
| **SSO SAML** | Enterprise | Configurás tu Identity Provider, mapeás atributos (roles, emails), testeás y activás para toda la organización. |
| **Partner Markup (CSP)** | Enterprise | Márgenes configurables por servicio para partners CSP, aplicados automáticamente en la facturación. |
| **M365 Copilot** | Enterprise | Configuración del tenant + chat asistido sobre tus propios datos FinOps, en `/admin/copilot-m365`. |

---

## 9. FinOps Copilot (asistente de IA)

Ícono flotante en la esquina inferior de la pantalla, disponible en Professional+.

- **Conciencia de contexto automática:** el Copilot lee el contenido de la página donde estás — no necesitás decirle en qué módulo estás. Al abrirlo, sin que escribas nada, genera un **reporte ejecutivo** de lo que se está mostrando: contexto del módulo, hallazgos clave, oportunidades de ahorro priorizadas por impacto, riesgos y un plan de acción a 7 días.
- **Preguntas dirigidas:** además del reporte automático podés preguntarle directamente. Ej. en Presupuestos: *"Resumime el estado actual de nuestros presupuestos"*.
- **Sugerencias e información estratégica:** el Copilot provee exclusivamente análisis, recomendaciones de optimización y respuestas informativas para apoyar la toma de decisiones del equipo — no ejecuta acciones correctivas ni modificaciones directas sobre tu infraestructura.

---

## 10. Seguridad de la cuenta (MFA)

Autenticación de dos factores basada en TOTP (Google Authenticator, Microsoft Authenticator, Authy, etc.), opcional por usuario, requerida solo para **operaciones sensibles** (eliminar un tenant, cancelar suscripción, cambiar configuración de facturación).

**Cómo activarla:**
1. Andá a tu perfil → **Configuración de Seguridad** → **"Habilitar 2FA"**.
2. El sistema te muestra un código QR — escaneálo con tu app de autenticación.
3. Ingresás el código de 6 dígitos que te muestra la app para confirmar.
4. Recibís **10 códigos de recuperación** — descargalos y guardalos en un lugar seguro. Se muestran una sola vez.

**Cuándo se te va a pedir:** al intentar una operación marcada como sensible, aparece un modal pidiéndote el código de 6 dígitos (o un código de recuperación si perdiste el acceso al autenticador). Cada código de recuperación se usa una sola vez; si gastás los 10, tenés que deshabilitar y volver a habilitar el 2FA para generar un set nuevo.

**Si perdés el acceso a tu autenticador:** usá cualquiera de tus 10 códigos de recuperación para entrar y volver a configurar el 2FA desde cero. Si además perdiste los códigos de recuperación, un Admin puede forzar la desactivación de tu MFA (queda registrado en el log de auditoría).

---

## 11. Funciones Avanzadas e Integraciones

Esta sección es para usuarios técnicos (Cloud Admin, DevOps) que necesitan integrar la plataforma con otras herramientas o configurar accesos avanzados.

### 11.1. SSO SAML (`/admin/sso`, Enterprise, vía WorkOS)

Permite que los usuarios de un cliente Enterprise inicien sesión con su propio Identity Provider (Okta, Auth0, AD FS) en lugar de — o además de — Microsoft Entra ID.

**Configuración por cliente:**
1. Andá a **Admin → SSO SAML** (solo visible en tier Enterprise).
2. Conseguí el `workos_org_id` y `workos_connection_id` desde el dashboard de WorkOS (CSCloudSolutions crea la Organization/Connection ahí si no existen).
3. Completá el formulario: **Domain** (ej. `acme.com`), **WorkOS Organization ID**, **WorkOS Connection ID** → activá el toggle **Enable SSO** → guardá.
4. Botón **"Generar Admin Portal"** → se abre un link de WorkOS en pestaña nueva; el IT admin del cliente recibe un email para configurar su propio IdP.
5. (Opcional) Botón **"Probar SSO"** → te redirige al IdP para validar que el login funcione antes de anunciarlo a los usuarios finales.

**Cómo inicia sesión el usuario final:** en la pantalla de login, elige "Login with SSO" en vez de "Iniciar sesión con Microsoft" → el sistema lo redirige a su propio IdP → tras autenticarse, vuelve automáticamente al dashboard.

> ⚠️ Solo se admite **una conexión de IdP por tenant** por diseño actual. SSO convive con el login de Microsoft Entra ID (MSAL) sin reemplazarlo — ambos métodos funcionan en simultáneo, así que no perdés el acceso existente al activar SSO. La sesión SSO dura 12 horas.

**Errores comunes:** "SSO not configured" (faltan credenciales de plataforma), "SSO not enabled for this tenant" (el toggle está apagado), "Missing workos_connection_id" (todavía no se generó el portal ni el cliente configuró su IdP).

### 11.2. Auditoría — uso avanzado (`/admin/audit`, Professional+)

Además del log filtrable (por email, tipo de acción, status y rango de fechas, 10 filas por página), tenés 4 formatos de exportación: **CSV (página actual)**, **CSV completo filtrado (streaming)**, **JSON**, **NDJSON**.

**Casos de uso típicos:**
- **Auditoría de compliance (SOC2):** exportá el rango trimestral completo con el botón de export filtrado.
- **Investigar un incidente:** filtrá por el email del usuario sospechoso + status `FAILURE`.
- **Monitoreo operacional:** filtrá por tipo de acción `DELETE` + rango de fechas reciente para ver qué se borró.

> ⚠️ El export completo tiene un tope de **100.000 filas** — para datasets más grandes, acotá el rango de fechas y exportá por partes. La retención de logs es indefinida por ahora (no hay purga automática todavía).

### 11.3. API REST Pública v1 (`/admin/api-keys`, Enterprise)

Acceso programático de solo lectura a tus datos (costos, presupuestos, recomendaciones, anomalías) para conectar BI tools o scripts propios.

**Cómo generarla y usarla:**
1. **Admin → API Pública** → generar una nueva key, eligiendo solo los **scopes** que necesitás (`read:cost`, `read:resources`, `read:budgets`, `read:recommendations`, `read:anomalies`) — pedí el mínimo necesario, por ejemplo `read:cost` si es solo para alimentar un dashboard de BI.
2. Autenticá cada request con el header `X-API-Key: pak_live_xxx` (o `Authorization: Bearer pak_live_xxx`).
3. Ejemplos de endpoints: `GET /cost/summary?from=...&to=...&groupBy=service`, `GET /cost/timeseries?granularity=daily|monthly`, `GET /resources?type=...&limit=100`, `GET /budgets`, `GET /recommendations`, `GET /anomalies?severity=low|medium|high`.
4. Documentación interactiva (Swagger) disponible en `/api/v1/docs`.

> ⚠️ Límite por defecto: **60 requests/minuto** por key (headers `X-RateLimit-*` te muestran cuánto te queda; al agotarse, error 429). Si necesitás más para un batch job, pedilo desde Admin → API Pública o por soporte (hasta 1000 req/min). Los valores monetarios siempre viajan como **strings** (ej. `"1234.56"`), no como números — parseálos como texto para no perder precisión.

### 11.4. Exportación de facturas Showback/Chargeback en PDF (`/admin/report`, Business+)

Generá y enviá por email facturas de showback/chargeback a cada cliente o centro de costo interno.

- **Descargar una factura individual:** desde el reporte de facturación, elegís el cliente/centro y el período → descarga el PDF directamente.
- **Descargar todas a la vez:** mismo flujo sin elegir un cliente específico → se descarga un ZIP con todas las facturas del período.
- **Enviar por email:** completás el email y nombre del destinatario → se envía automáticamente con el PDF adjunto vía Microsoft 365 (requiere que CSCloudSolutions tenga configurado el envío de correo para tu tenant — si no está disponible verás un error claro pidiendo contactar soporte).

Cada envío y descarga queda registrado en el log de auditoría.

### 11.5. FOCUS 1.1 Export — uso avanzado

Más allá de la descarga manual desde `/admin/focus-export` (ver sección 8.7), podés automatizar la extracción con una MCP API Key propia (generada en `/admin/mcp-keys`):

```
curl -H "Authorization: Bearer mcp_xxx" \
  ".../api/exports/focus?tenantId=...&format=ndjson"
```

Formatos disponibles: CSV, JSON, NDJSON. Tope de **500.000 filas** por exportación (default 100.000). Útil para alimentar automáticamente herramientas FinOps externas (Power BI, CloudHealth, etc.) sin intervención manual.

### 11.6. Página de Estado (Status Page)

Página pública (sin login) donde vos y tus usuarios pueden consultar en cualquier momento si la plataforma está operativa: `/es/status` (o `/en/status`, `/status`). Muestra el estado de API, base de datos, sincronización con Azure, proveedor de IA y facturación, más un historial de incidentes. Útil para compartir con tu equipo si algo parece no funcionar — antes de abrir un ticket, revisá si ya hay un incidente reportado ahí.

### 11.7. Facturación con Paddle — detalle técnico

El cambio de plan (ver sección 8.4) tiene 3 modos de prorrateo posibles al hacer upgrade/downgrade:

- **Prorrateo inmediato:** se cobra o acredita la diferencia ahora mismo.
- **Prorrateo en el próximo ciclo:** el cambio de precio completo se cobra recién en la próxima renovación.
- **Sin cobro inmediato:** el cambio de plan aplica sin generar ningún cargo hasta el ciclo siguiente.

Desde `/admin/billing` también accedés al **portal de gestión de pago** (actualizar tarjeta) y al **historial de facturas** descargables.

### 11.8. Trial gratuito de 7 días (autoservicio)

Si te registraste vos mismo desde la página de precios (sin pasar por onboarding de un SuperAdmin), tu cuenta arranca con un **trial de 7 días** sobre el plan que elegiste. Vas a ver un banner de estado del trial en la parte superior de la plataforma:

- 🔵 Azul: 5 días o más restantes.
- 🟡 Amarillo: entre 3 y 4 días restantes.
- 🔴 Rojo: 2 días o menos — este no se puede descartar.

Podés upgradear a plan pago en cualquier momento desde **Facturación** — el trial se convierte inmediatamente en suscripción activa. Si el trial expira sin upgrade, la cuenta queda en modo de acceso limitado hasta que actives un plan pago.

---

## 12. Mejores Prácticas

- **Revisión semanal:** entrá al **Dashboard** y a **Recursos Zombis** al menos una vez por semana para capturar fugas financieras antes de que se acumulen.
- **Automatizá temprano:** activá **Horarios de Apagado** en tus entornos de Desarrollo/Testing como primera medida — es común ver ahorros del 60% en horas de cómputo inactivas sin ningún otro cambio.
- **Exigí cumplimiento de tags:** sin etiquetas consistentes, el módulo de chargeback/showback no puede distribuir la factura mensual de forma justa entre equipos — es la base de todo lo demás.
- **Usá el Simulador What-If antes de comprometerte:** antes de comprar una Reserva o Savings Plan, simulá el escenario y guardalo — te da un número concreto para justificar la decisión ante finanzas.
- **Configurá al menos un canal de notificación** desde el primer día (Slack/Teams si tu equipo ya vive ahí, o email si preferís simplicidad) — las alertas de presupuesto no sirven si nadie las ve a tiempo.

---

## Soporte y contacto

Para cualquier asistencia adicional, abrí un ticket desde **Soporte** (`/support`) dentro de la plataforma, o escribí a **soporte@cscloudsolutions.com.ar**.

---

**Manual de SuperAdmin — FinOps SaaS**
**Versión 2.0 | Español | Julio 2026**
