<div class="cover">
<img src="../../public/CSCloudSolutions.png" alt="CSCloudSolutions" class="cover-logo" width="360" />
<h1 class="cover-title">Manual de Usuario</h1>
<p class="cover-sub">FinOps SaaS · CSCloudSolutions</p>
<p class="cover-meta">Versión 2.0 · Agosto 2026</p>
<p class="cover-copyright">© 2026 CSCloudSolutions. Todos los derechos reservados.</p>
</div>

# 📘 Manual de Usuario — FinOps SaaS (CSCloudSolutions)

**Versión:** 2.0 (detallada)
**Idioma:** Español
**Última actualización:** Agosto 2026
**Audiencia:** usuarios técnicos (Cloud Admin, DevOps, FinOps Analyst) y no técnicos (finanzas, gerencia, product owners)

---

## Novedades recientes (Agosto 2026)

- **Nuevo módulo Azure Integration Services (iPaaS):** se incorporó el hub `Intelligence → Azure Integration Services` con pestañas de Logic Apps, APIM, Service Bus, Event Grid, Event Hubs y ADF.
- **Conectores Enterprise en Logic Apps:** se añadió una sección dedicada para distinguir conectores Standard vs Enterprise y su impacto operativo/costo.
- **IA Enterprise (Azure IA):** la configuración global de IA ahora soporta **endpoint URL** + deployment para Azure IA en lugar de depender sólo del nombre del recurso.
- **Estándar de tablas FinOps/CMP (SaaS):** todas las tablas del nuevo estándar incluyen filtros base (**Recurso, Región, Tipo, Grupo de recursos**), ordenación (A-Z/Z-A/costo), paginado **15/30/45/60**, diseño responsive, ancho completo y columnas redimensionables.
- **Monitoreo y Seguridad homologados:** las vistas de Monitoreo y Seguridad ya usan el mismo patrón visual/operativo que Bases de Datos y Cómputo, con foco en lectura rápida para decisiones FinOps.
- **AI Cost Analytics corregido:** el panel de Microsoft Foundry/Azure OpenAI ahora prioriza consumo real, mantiene tendencia MTD desde el día 1 del mes y corrige inconsistencias de cache/fuentes.
- **Nuevo cron de precalentamiento de Seguridad:** `GET /api/cron/prewarm-security-finops` precalienta Defender + familias de Seguridad para acelerar carga en entornos staging y producción.
- **Inteligencia de Bases de Datos robustecida:** Redis, MySQL, PostgreSQL, Cosmos DB, MongoDB y SQL/Managed Instance ahora muestran estado y métricas con fallback por métrica para evitar `N/A/unknown` por telemetría parcial de Azure.
- **Refresh visual de navegación y módulos FinOps:** tarjetas clave de Inteligencia, Consumo, Gobernanza, Cleanup, Overview y Copilot M365 migraron a iconografía Tabler y headers sin fondo azul para una lectura más limpia.

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
4. **Modo Demo:** si querés probar la plataforma sin conectar tu entorno real, elegí uno de los perfiles comerciales preconfigurados desde la pantalla principal — vienen con datos y métricas simuladas realistas, para que puedas explorar cada módulo sin riesgo. Las credenciales de la demo son `demo` / `demo`.

### 1.2. El asistente de onboarding (primera vez)

Si sos administrador y es la primera vez que tu organización usa la plataforma, al iniciar sesión se abre automáticamente el **Asistente de Configuración** (`/onboarding`), un wizard de 5 pasos lineales con barra de progreso:

| Paso | Qué hacés | Resultado |
|---|---|---|
| **1. Bienvenida y datos de la empresa** | Confirmás nombre de la empresa, moneda de visualización (USD/EUR/GBP) y zona horaria | Se guardan tus preferencias iniciales |
| **2. Conectar Azure** | Pegás **Client ID**, **Client Secret** y **Azure Tenant ID** del Service Principal y presionás **"Validar"**. | El sistema confirma que la conexión mínima está lista para avanzar |
| **3. Primera sincronización de datos** | Presionás **"Ejecutar Sincronización"** | Trae tu primer set de datos de costos desde Azure (puede tardar hasta 60 segundos) |
| **4. Crear tu primer presupuesto** | Completás nombre, límite mensual ($) y umbral de alerta (%) | Se crea tu primer presupuesto activo |
| **5. Configurar notificaciones** | Presionás **"Configurar"** (abre `/admin/notifications` en pestaña nueva) | Agregás al menos un canal (email, Slack o Teams) para recibir alertas |

Podés **saltar (skip)** cualquier paso y volver más tarde — el wizard vuelve a aparecer hasta que completes o saltees los 5. El progreso (%) se calcula como `(completados + saltados) / 5 × 100`. Si preferís el formulario de configuración avanzada en lugar del wizard, `/admin/onboarding` sigue disponible en paralelo.

### 1.3. Verificación de la conexión con Azure

Cuando conectás Azure en el paso 2 del asistente (o desde `/admin/onboarding`), el Service Principal necesita tener asignados ciertos roles para que la plataforma pueda leer tus datos de costos.

**Roles Azure necesarios, por tier contratado:**

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

### 1.4. Nota operativa

La gestión comercial y de partnership (PAL/CPOR) es administrada internamente por CSCloudSolutions y no requiere acciones del usuario final del tenant.

---

## 2. Roles y Permisos

La plataforma separa **dos conceptos independientes**, que se combinan pero no se reemplazan entre sí:

### 2.1. Rol (qué podés HACER)

| Rol | Capacidad |
|---|---|
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

Tu panel ejecutivo de entrada. Reúne Costo Actual MTD, forecast, Recursos Zombis, Ahorro Potencial e Impacto Ambiental, junto con presupuestos, servicios dominantes, gobernanza, Advisor y Quick Wins.

**Cómo usarlo:**
1. Revisá la barra de sincronización y usá **Actualizar** para omitir el caché y consultar el ciclo vigente.
2. Compará el gasto MTD con los presupuestos por centro de costos y ajustá la tasa del forecast a 12 meses.
3. Anclá/desanclá widgets desde el ícono de pin para llevarlos a **Mi Dashboard**.
4. En **Top Quick Wins**, elegí **Optimizar** para abrir el modal de remediación con scripts CLI, PowerShell y Terraform.

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

Sincronización directa con las recomendaciones nativas de Microsoft, clasificadas en Costo, Seguridad, Confiabilidad, Rendimiento y Excelencia Operativa. Las recomendaciones se muestran en el idioma que tengas activo en la plataforma (no en el idioma original de Azure).

**Cómo usarlo:** filtrá por categoría, revisá el impacto potencial de ahorro de cada recomendación, ejecutá la remediación o gestioná su ciclo de vida:
- **Posponer por 30 o 90 días:** Si la optimización requiere validación previa o una ventana de mantenimiento futura. La recomendación desaparece de las listas activas y no suma a los ahorros pendientes ni cuenta como abierta en el **Índice de Optimización (COIN)**. Al expirar los días, la plataforma la reabre automáticamente si sigue sin resolverse.
- **Descartar (Permanente):** Si la recomendación no aplica a la arquitectura de tu organización. Pasa al estado *Descartada* de forma indefinida y no vuelve a mostrarse en las listas activas.

> ℹ️ **Aclaración sobre el alcance del descarte frente al Portal de Azure:**
> - **Sincronización Azure → Plataforma:** Si suprimes una recomendación directamente en el Portal de Microsoft Azure, nuestra plataforma la detecta automáticamente y la oculta de la interfaz.
> - **Gestión Plataforma → Azure:** Al suprimir o descartar desde la plataforma FinOps, la acción se registra y gobierna en la base de datos del tenant bajo el principio de menor privilegio (sin requerir permisos de escritura sobre Azure). Por este motivo, la recomendación **podría seguir mostrándose en el Portal de Azure**, mientras que en la plataforma FinOps queda formalmente suprimida, auditada y fuera de los cálculos de ahorro.

### 4.3.1. Azure AI Document Intelligence

En `Inteligencia Financiera → Azure AI → Document Intelligence` podés revisar costo MTD, páginas procesadas, uso Prebuilt/Custom y horas de entrenamiento. Usá MTD/30D/90D, filtrá la tabla por modelo, Resource Group o suscripción y abrí **Optimizar** para evaluar Commitment Tier, F0 o migración Custom→Prebuilt. Un tenant real sin cuentas muestra el estado vacío y nunca datos demo.

### 4.4. Madurez FinOps

Evaluación interactiva que ubica a tu organización en Crawl / Walk / Run según 5 pilares (visibilidad, optimización, gobernanza, inteligencia, operaciones). Respondé el cuestionario y obtené un score por pilar más un roadmap de mejora personalizado.

### 4.5. Academia FinOps

Centro de aprendizaje interactivo sobre FinOps y optimización Azure — cursos estructurados, videos, glosario y recursos descargables.

> ⚠️ **Gate obligatorio:** los usuarios nuevos deben completar la Academia antes de acceder al resto de la plataforma (con un disclaimer explicando por qué). El progreso se registra **por usuario**, no por organización — cada persona nueva del tenant tiene que completarlo, y una vez completado no se puede volver a ejecutar.

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
| **Cockpits de Cómputo (VMs, VMSS, App Services, Function Apps)** | Business/Enterprise | Módulos de optimización y gobernanza granular: **Virtual Machines** (`/intelligence/computo/avm`) con separación de costo de cómputo vs almacenamiento persistente (fugas en VMs desasignadas), AHUB, rightsizing a Serie B, schedules 8x5 y descarte de VMs abandonadas; **Function Apps** (`/intelligence/computo/fapps`) con telemetría de invocaciones, GB-s, auditoría de logs y playbooks de sampling/downgrade; **App Services** (`/intelligence/computo/waas`) con densidad de apps y consolidación; y **VMSS** (`/intelligence/computo/vmss`) con autoscale y Spot instances. |
| **Detección de Anomalías** | Enterprise | Identifica picos o caídas anormales de gasto automáticamente y te permite crear alertas ajustando la sensibilidad. |
| **Índice de Optimización (COIN)** | Enterprise | Puntuación 0-100 compuesta, comparable contra benchmarks de industria. |
| **Eficiencia de Cómputo** | Enterprise | Utilización real de CPU/memoria/disco por VM, con recomendación de resize y ahorro calculado. |
| **Optimización de Tarifas** | Enterprise | Compara tus tarifas actuales contra benchmarks de mercado para preparar una negociación con Microsoft. |
| **Costo Cero** | Todos | Qué recursos son gratis en tu suscripción (free tier, créditos) para maximizar su uso. |
| **Prorrateo (Allocation)** | Enterprise | Reglas de distribución de costos compartidos entre múltiples áreas (por uso real, proporcional o fijo). |
| **MACC Tracking** | Enterprise | Seguimiento del compromiso mínimo anual (EA/MCA) — consumido vs. comprometido, con proyección de cumplimiento. |
| **AI Cost Analytics** | Enterprise | Costo por modelo de IA y consumo de tokens en Microsoft Foundry / Azure OpenAI, con recomendaciones de optimización de llamadas. |
| **Bases de Datos** | Business | Visibilidad, métricas en tiempo real y diagnóstico de rendimiento para CosmosDB, Azure SQL, PostgreSQL, MySQL, MongoDB y Redis. Incluye la pestaña especial **acfr** para el monitoreo detallado de las 12 métricas críticas de Azure Cache for Redis mediante gráficos de área con agregación average. |

---

## 6. Sección Limpieza de Nube

### 6.1. Recursos Zombis (`/cleanup/zombies`, Professional+; remediación Business+)

Detecta recursos huérfanos y subutilizados en 25 tipos de infraestructura Azure (discos no adjuntos, IPs públicas huérfanas, NICs sin VM, App Service Plans vacíos, Elastic Pools sin bases, VMSS ociosos, snapshots antiguos y VMs desasignadas con storage activo).

**Capacidades y Flujo:**
1. **Omni-Scan 25 Resource Types:** Análisis exhaustivo en Azure Resource Graph.
2. **Clasificación Hard vs Soft Waste:** Diferenciación visual entre desperdicio monetario directo (Hard Waste) y desalineación de gobernanza/etiquetas (Soft Waste).
3. **Resolución de Suscripciones:** Muestra siempre el nombre amigable de la suscripción (ej. `CSCS-LandingZone`).
4. **Tabla Personalizable:** Columnas con manejadores de ancho interactivos (`col-resize`) y selector desplegable `Personalizar Columnas` (`IconColumns`) persistente por navegador.
5. **Remediación Segura:** Creación de snapshots preventivos y ejecución de playbooks CLI/PowerShell.

### 6.2. Networking Zombies (`/cleanup/networking-zombies`, Professional+; remediación Business+)

Auditoría especializada en infraestructura de red:
- **Gateways VPN / ExpressRoute Ociosos:** Detección de gateways sin conexiones activas ni túneles IPsec configurados.
- **IPs Públicas Huérfanas:** Identificación de IPs asignadas sin asociación a NICs ni balanceadores (excluyendo Network Watchers del sistema).
- **Private Endpoints Desconectados:** Diagnóstico de endpoints privados con estado `Disconnected` o apuntando a recursos eliminados.
- **NAT Gateways y Firewalls:** Detección de NAT Gateways sin subredes y Firewalls/Application Gateways sin reglas de ruteo ni backend pools.

### 6.3. Expiraciones TTL — Time-To-Live (`/cleanup/ttl`, Business+)

Control automatizado del ciclo de vida de recursos efímeros (ambientes de prueba, laboratorios de desarrollo y sandboxes):
1. **Políticas TTL Centralizadas:** Definición de vida útil máxima por tipo de recurso y ambiente.
2. **Etiquetado `ExpireOn`:** Aplicación optimista de etiquetas de expiración con validación de fechas.
3. **Semáforos de Vencimiento:** Indicadores en tiempo real (`CRITICAL` vencidos, `WARNING` próximos a vencer en menos de 72h, `ACTIVE` vigentes).
4. **Prórrogas Interactivas:** Extensión rápida de tiempo de vida (+7d, +14d, +30d) para recursos que requieren mayor tiempo de prueba.
5. **Auditoría Inmutable:** Historial inalterable de desaprovisionamientos ejecutados en `TtlDeletions`.

### 6.4. Backups Huérfanos (`/cleanup/backup-orphans`, Professional+; remediación Business+)

Gestión de almacenamiento, costos devengados y cumplimiento legal de copias de seguridad en **Recovery Services Vaults**:
1. **Detección de Protected Items Desvinculados:** Identificación de instancias protegidas cuyo recurso original ya fue eliminado de Azure pero continúan devengando tarifas de almacenamiento y costos base.
2. **Cálculo de Costo Compuesto:** Desglose del costo mensual exacto sumando la tarifa base por tipo de ítem (`AzureIaasVM`, `AzureWorkload`, `AzureStorage`, `AzureDisk`) y el consumo de almacenamiento en bóveda a \$0.0224/GB/mes.
3. **Purga Segura con Soft Delete:** Modal de confirmación estricta con verificación por nombre y alerta sobre la ventana preventiva de 14 días de Soft Delete antes del borrado definitivo.
4. **Exenciones por Compliance Legal:** Drawer lateral para registrar tickets de auditoría (SOX, fiscal, regulatorio) con retenciones de 1 a 10 años o indefinidas, excluyendo el ítem del desperdicio activo.
5. **Transferencia a Archive Tier:** Movimiento a capa de almacenamiento frío para obtener hasta un 85% de reducción en el costo de retención a largo plazo.

---

## 7. Sección Gobernanza

### 7.1. Gobernanza de Etiquetas — Azure Tag Governance Engine (`/governance/tags`, Professional+)

Panel integral de auditoría, inferencia inteligente y propagación de metadatos corporativos en Azure.

**Capacidades principales:**
- **Auditoría Dual de Cumplimiento:** Dos vistas especializadas para auditar tanto **Recursos Individuales** como **Grupos de Recursos (Resource Groups)**.
- **4 Políticas Obligatorias:** Evaluación automática en tiempo real de las 4 etiquetas estructurales de FinOps:
  - `Environment` (Entorno: prod, staging, dev, qa, test, sandbox)
  - `Role` (Función o rol arquitectónico del recurso)
  - `CostCenter` (Centro de costos contable)
  - `Department` (Área o unidad de negocio responsable)
- **Inferencia Inteligente con IA (1-clic):** Motor que analiza la tipología, el nombre del recurso y el contexto de la suscripción para sugerir etiquetas faltantes automáticamente. Al presionar el botón "IA Sugerir", las recomendaciones se completan al instante en modo borrador.
- **Herencia Masiva desde RG (Merge Seguro):** Con el botón "Heredar de RG", los recursos hijos adoptan los tags presentes en su Grupo de Recursos contenedor sin sobreescribir ni borrar los tags existentes.
- **Edición y Caché Optimista:** Modificación en línea de tags individuales con persistencia inmediata en caché local y sincronización asíncrona hacia Azure Resource Manager.
- **Estándar CMP y Personalización:** Tablas con redimensionamiento dinámico de columnas (`col-resize`, 100px - 600px), selector desplegable de visibilidad de columnas en `z-[100]` y persistencia automática por tenant en `localStorage`.

### 7.2. Reporte de Gobernanza (`/governance/reporting`, Enterprise+)

Dashboard ejecutivo unificado. En el centro está el **Score de Seguridad Financiera**, un índice 0-100 que
pondera cuatro pilares: cumplimiento de Azure Policy (40%), higiene de etiquetas obligatorias (30%), higiene de
asignaciones RBAC (20%) y control de recursos zombis (10%).

**Cuando un pilar no se puede medir** —porque el Service Principal no tiene permisos, o porque no hay
políticas asignadas— no cuenta como 0 ni como 100: se marca "no medible" y su peso se reparte entre los
demás. Podés ver el desglose completo con "Ver desglose por pilar", que muestra el peso nominal y el efectivo
de cada uno.

**Qué más encontrás:**
- Cumplimiento de Azure Policy con detalle desplegable de los recursos no conformes.
- Inventario de recursos por tipo y por región, con los que quedan fuera del top agrupados en "Otros" para que
  la suma cierre con el total.
- Asignaciones RBAC por tipo de principal, con **auditoría de SIDs huérfanos**: asignaciones cuyo usuario o
  aplicación ya no existe en el directorio. No le dan acceso a nadie hoy, pero si Azure reutiliza ese
  identificador el permiso revive sobre otro principal.
- Exportación a **PDF ejecutivo** y a **CSV** con el dataset completo.

### 7.3. Control de Máquinas Virtuales — Horarios de Apagado (`/governance/power`, Business+)

Rutinas automáticas de encendido y apagado de VMs fuera de horario productivo, más control manual en vivo.

**Dos modos de programación:**
- **Hora única:** ejecuta la acción (encender / apagar / reiniciar) una sola vez en la fecha y hora exactas.
- **Recurrente:** elegís la hora y los días de la semana. El patrón "desde–hasta" se arma con dos reglas: una
  de encendido y otra de apagado sobre los mismos días.

**Smart Shutdown.** Antes de cada apagado programado, el sistema consulta el CPU real de la VM en los últimos
30 minutos. Si está por encima del umbral (5% por defecto, calibrable), **pospone el apagado** y lo registra
como omitido en vez de tumbar una máquina que está trabajando. El umbral se ajusta desde el botón "Calibrar
Umbral": muy alto apaga máquinas con trabajo en curso, muy bajo hace que el ruido del sistema operativo cancele
todos los apagados y el ahorro nunca se materialice.

**Ahorro fuera de horario.** El primer KPI muestra el gasto mensual que ya recuperás con los horarios activos,
y cuánto más hay disponible en las VMs encendidas sin programar. El cálculo usa la ventana real de cada VM
—desde su apagado hasta su próximo encendido—, no una constante: un fin de semana sin encendido programado
extiende el apagado del viernes hasta el lunes.

**Control en vivo.** La tabla inferior lista todas tus VMs con su estado, tamaño, CPU actual y gasto. Podés
seleccionar varias y aplicar Apagar / Encender / Reiniciar en lote. El badge de estado cambia de inmediato
mientras Azure procesa la operación, y se corrige solo si algo falla o si Smart Shutdown omitió el apagado.

**Detalles operativos:**
- La zona horaria se guarda como nombre IANA, así que el horario sigue disparando a la hora local correcta
  cuando cambia el horario de verano.
- El sistema revisa horarios pendientes cada pocos minutos, más una verificación inmediata al guardar.
- Si Azure Monitor no devuelve métricas de una VM, la columna de CPU muestra **"s/d"** en vez de 0%: un cero se
  leería como "ociosa" y podría llevarte a apagar una máquina sin telemetría.

### 7.4. Recomendaciones de Alta Disponibilidad (`/governance/ha`, Business+)

Detecta máquinas virtuales, bases de datos y recursos cloud sin redundancia zonal, geográfica ni respaldo.

**Cada brecha te dice qué SLA tenés hoy y cuál alcanzarías**, traducido a minutos de caída mensual — porque
"99,9%" no significa nada hasta convertirlo en 43,2 minutos al mes, y 99,99% en 4,3. El drawer "Ver
Arquitectura" muestra la topología, la comparación de SLA y el costo adicional estimado antes de que decidas.

**Qué se detecta:** VMs sin zona ni Availability Set, recursos sin backup, bases sin failover group ni
geo-redundancia, App Service Plans con una sola instancia e IPs públicas en SKU Basic.

**Sobre las IPs Basic:** figuran con SLA 0, no 99,9. Microsoft no publica SLA para esa SKU — no es que sea
bajo, es que no existe.

**Sobre los backups:** un backup no mejora la disponibilidad, mejora el RPO (cuántos datos perdés si algo
falla). Por eso en esas filas el SLA actual y el proyectado coinciden: no te prometemos una mejora que no
ocurre.

**Qué se puede remediar desde acá:** sólo la migración de SKU de IP pública y la asociación de una política de
backup, que son operaciones idempotentes en Azure. Distribuir en zonas o habilitar geo-redundancia exige
recrear el recurso o elegir una región secundaria: para esos casos el botón "Remediar" te da el blueprint del
cambio con el comando exacto, para que lo planifique tu equipo de infraestructura.

**Exenciones.** Si una carga no productiva no amerita redundancia, la eximís con una justificación. Deja de
contar en los KPIs pero sigue visible con el botón de historial, y la justificación queda registrada con tu
usuario — alguien va a tener que defenderla en la próxima auditoría.

### 7.5. Credenciales por Expirar — Entra ID (`/governance/credentials`, Business+)

Inventario de secretos y certificados de App Registrations y Service Principals, con dos pestañas.

**Pestaña Credenciales.** Cada fila muestra el estado —**Vigente** (más de 30 días), **Próximo a Vencer**
(30 días o menos) o **Expirado**—, la fecha de vencimiento, los días restantes exactos y el App ID con botón
de copiado. Los días se recalculan en cada consulta: una credencial pasa de vigente a por vencer sin que nadie
la toque.

**Rotación de secretos.** El botón "Rotar" genera un secreto nuevo vía Microsoft Graph con la vigencia que
elijas (6, 12 o 24 meses).

> **Importante:** la rotación **no revoca el secreto anterior**, y es a propósito. Revocar en el mismo paso
> dejaría fuera de servicio todo lo que todavía lo usa, que es justamente el incidente que este módulo
> previene. El orden correcto es: rotás, migrás los consumidores al secreto nuevo, y recién entonces eliminás
> el viejo desde el portal de Entra ID.
>
> El valor del secreto **se muestra una sola vez**. Microsoft Graph no lo devuelve de nuevo y la plataforma no
> lo guarda en ningún lado. Copialo en ese momento y almacenalo en Azure Key Vault.

Los certificados no se rotan desde acá: se renuevan subiendo la clave pública, que es un procedimiento
distinto.

**Pestaña Alertas Configuradas.** Reglas de aviso previo al vencimiento. Cada regla admite **varios umbrales**
(por ejemplo 60, 30 y 7 días), y cada uno dispara un aviso independiente — un solo recordatorio a 7 días rara
vez alcanza para coordinar una rotación con todos los equipos consumidores. Elegís los canales (Email, Teams,
Slack, Webhook) y los destinatarios, y podés habilitar o deshabilitar cada regla con un interruptor.

### 7.6. Políticas Auto-Block (`/governance/policies`, Enterprise+)

Prevención de costos desde el aprovisionamiento con Azure Policy: restricciones que impiden que el gasto
indeseado llegue a existir.

**Qué ves:** el cumplimiento global de tu entorno, el desglose por categoría de recurso, el estado de cada
iniciativa de gobernanza y la tabla de políticas activas con su efecto (`Deny`, `Modify`, `Audit`,
`DeployIfNotExists`), su alcance y cuántos recursos incumple cada una.

Todo sale de Azure Policy en vivo. **Si tu entorno no tiene políticas asignadas, verás 0 evaluaciones** y un
mensaje que lo explica — no un porcentaje estimado.

**Desplegar una política.** El asistente te deja elegir el alcance (management group o suscripción) y una de
las plantillas predefinidas: restringir tamaños de VM, bloquear IPs públicas en sandbox, heredar etiquetas,
exigir CostCenter, restringir regiones o auditar storage sin HTTPS. Cada plantilla explica qué costo evita.

> Una política `Deny` **bloquea altas nuevas pero no revierte lo ya desplegado**. Los recursos que existían
> antes de la asignación van a aparecer como no conformes hasta que los corrijas a mano o con una política
> `Modify`. Azure tarda hasta 30 minutos en completar la primera evaluación.

**Remediar.** El botón de remediación crea una tarea de Azure Policy que corrige los recursos existentes.
Sólo aparece en políticas `Modify` y `DeployIfNotExists`: son los únicos efectos que Azure puede aplicar
retroactivamente. Sobre `Deny` o `Audit` no se ofrece, porque la tarea terminaría con cero recursos corregidos.

**Ver recursos no conformes** abre un panel lateral con el detalle de cada infracción y su motivo.

### 7.7. Aprobaciones de Remediación (`/governance/approvals`, Business+)

Flujo de control sobre los cambios de infraestructura que proponen los motores de optimización. Funciona bajo
el **principio de cuatro ojos**: quien solicita el cambio no puede aprobarlo.

**Peticiones pendientes.** Cada tarjeta muestra el recurso, la acción propuesta, quién la solicitó, el ahorro
mensual que libera y las advertencias que correspondan —si la VM se reinicia, si la acción es irreversible—.

**Aprobar ejecuta el cambio en Azure de inmediato.** No es un cambio de estado en una lista: la plataforma
llama a Azure Resource Manager y el resultado real queda en el historial. Si Azure rechaza la operación, la
petición figura como **Fallida** con la respuesta literal del error, no como aprobada.

**Controles de seguridad:**
- **Snapshot previo.** Al borrar un disco podés pedir un snapshot de respaldo. Si el snapshot falla, el borrado
  **no se ejecuta**: pediste una red de contención y sin ella la acción no avanza.
- **"Aprobar todo lo seguro"** sólo alcanza a las acciones no destructivas y que no reinician servicio. Borrar
  un disco o redimensionar una VM productiva exige una decisión consciente, no un clic masivo.
- **Rechazar exige un motivo**, que se le notifica al solicitante. Sin él, la misma petición vuelve la semana
  que viene.

**Historial de decisiones.** Traza completa de auditoría: quién resolvió, cuándo, qué respondió Azure y —si se
creó— el identificador del snapshot de respaldo. El KPI de "Ahorro Liberado" suma **sólo lo que Azure
confirmó**: una aprobación que falló no liberó un peso y no se cuenta.


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

**Qué ves en la pantalla:**

- **Cuatro indicadores arriba:** tickets abiertos (incluye los que esperan tu respuesta), en curso,
  resueltos, y el SLA de primera respuesta de tu plan.
- **Solución de problemas:** un acordeón con las preguntas frecuentes y un buscador. Muchas consultas
  se resuelven acá sin abrir un ticket.
- **Tabla de tus tickets** con número, asunto, categoría, prioridad, estado, última actualización y
  **SLA restante** con cuenta regresiva. Podés reordenar el ancho de las columnas arrastrando el borde
  derecho de cada cabecera, elegir cuáles ver con *Personalizar columnas*, y paginar de 15 en 15 (o
  30/45/60). Esas preferencias quedan guardadas en tu navegador.
- **Conversación en panel lateral:** el botón *Ver conversación* abre el hilo a la derecha sin perder la
  tabla. Podés adjuntar varios archivos a la vez, arrastrándolos; las imágenes se ven en el hilo con
  vista previa ampliable y los logs se descargan.

**Sobre el SLA restante:** el contador mide el tiempo hasta la **primera respuesta** del equipo. Una vez
que te respondemos deja de correr, aunque el ticket siga abierto. Si el ticket queda esperando tu
respuesta, tampoco corre: la pelota está de tu lado.

**Módulo afectado (opcional):** al crear el ticket podés indicar de qué módulo se trata (Defender,
Recursos zombis, Prorrateo, Alertas, Horarios de apagado, Gobernanza de tags). No es obligatorio, pero
acelera la derivación al equipo correcto.

### 8.2. Usuarios y Permisos (`/admin/users`)

Ver sección 2 para el detalle de rol vs. permisos. Desde acá agregás usuarios, editás su rol, ajustás su
alcance de módulos o les quitás el acceso. Sólo Admin y Owner del tenant entran a esta pantalla.

**Cuatro indicadores arriba:** usuarios registrados (y cuántos admite tu plan), administradores y
owners, lectores, y el **cumplimiento de 2FA** de tu equipo.

**Agregar un usuario — ya no hace falta copiar GUIDs.** Escribí el nombre o el email de la persona: la
plataforma busca en tu directorio de Entra ID y muestra las coincidencias. Al elegir una, el campo
*Entra ID (OID)* se completa solo y queda marcado con un tilde verde. Después elegís el rol base y el
alcance de páginas (*Acceso total*, *Sólo Visibilidad y FinOps*, o *Sólo Limpieza y Gobernanza*).

Las sugerencias avisan cuando alguien **ya está agregado** al tenant o cuando su **cuenta está
deshabilitada** en Entra ID.

**Sincronizar desde Entra ID** abre un panel con dos formas de dar de alta en bloque:

1. **Por usuarios:** el listado del directorio, con selección múltiple y rol por persona.
2. **Por grupo de seguridad:** elegís un grupo (por ejemplo `FinOps-Engineers`) y un rol por defecto, y
   se aprovisionan todos sus miembros de una vez. El rol **Owner no se puede asignar por grupo**: la
   transferencia de propiedad se hace usuario por usuario, a propósito. Si el grupo tiene más miembros
   que los que admite tu plan, los que exceden se omiten y te lo informa.

**La tabla de usuarios** muestra nombre con iniciales, email, el OID abreviado con botón de copiado, el
rol (editable en un clic desde la misma celda), el alcance de páginas, el estado de 2FA y el último
acceso. Igual que el resto de las tablas: columnas redimensionables, selector de columnas visibles,
paginado 15/30/45/60 y preferencias guardadas en tu navegador.

**Estado de 2FA — tres valores, no dos:**

| Badge | Qué significa |
|---|---|
| **2FA activo** | La persona tiene un segundo factor registrado en Entra ID. |
| **Pendiente** | Entra ID confirmó que **no** tiene segundo factor registrado. |
| **Sin dato** | Entra ID todavía no respondió por ese usuario. **No** significa que le falte 2FA. |

El indicador de cumplimiento se calcula sólo sobre los usuarios con dato conocido, y te dice cuántos
quedaron sin dato. Si la plataforma no tiene el permiso de Graph para leer el reporte de métodos de
autenticación, la columna queda en "Sin dato" para todos — no en 0% de cumplimiento. El botón
*Actualizar 2FA* vuelve a consultar Entra ID cuando lo necesitás.

**Permisos granulares** (botón *Permisos* en cada fila) abre un panel lateral con un interruptor por
módulo: Visibilidad, Inteligencia financiera, Limpieza de nube, Gobernanza, Seguridad, y Administración
y soporte. Apagar un módulo lo saca del menú de ese usuario **y** le bloquea el acceso si intenta
entrar escribiendo la URL. Debajo podés limitar a qué suscripciones de Azure tiene visibilidad: si no
marcás ninguna, ve todas las del tenant.

### 8.3. Configuración (`/admin/config`)

Administración general del perfil del tenant: nombre, logo, idioma por defecto para nuevos usuarios, zona horaria para reportes, ciclo de facturación.

### 8.4. Facturación — Cambio de Plan (`/admin/billing`, Professional+, rol Owner)

**Límites por Plan:**
| Plan | Suscripciones Azure Permitidas | Usuarios por Tenant | Soporte / SLA |
|---|---|---|---|
| **Professional** | Hasta 2 suscripciones | Hasta 3 usuarios | 20 tickets/mes (24 h) |
| **Business** | Hasta 3 suscripciones | Hasta 5 usuarios | Prioritario (12 h) |
| **Enterprise** | Ilimitadas | Ilimitados | Dedicado 24/7 (SLA 99.9%) |
Permite visualizar el plan activo, cuotas contratadas, método de pago y gestionar upgrades/downgrades hacia planes Business o Enterprise.

**Procedimiento de cambio:**
1. Elegís el nuevo plan (Professional / Business / Enterprise).
2. Elegís frecuencia (mensual/anual) y modo de prorrateo.
3. El sistema te muestra un **resumen previo** con el monto real calculado por la pasarela de pago antes de confirmar: *"Se cobrará ahora $X"* (upgrade) o *"Recibirás un crédito de $X"* (downgrade), el nuevo total recurrente y la fecha de próxima facturación.
4. El cambio **solo se aplica** al presionar **Confirmar cambio** — hasta ese momento podés cancelar sin costo.

#### 8.4.1. Control de Cuotas de Suscripciones Azure y Modal de Upgrade
La plataforma valida de manera automática el total de suscripciones Azure conectadas:
- **Professional:** Hasta 2 suscripciones Azure vinculadas.
- **Business:** Hasta 3 suscripciones Azure vinculadas.
- **Enterprise:** Suscripciones ilimitadas con gestión multicuenta.

Si intentás registrar una suscripción que supere la cuota de tu plan, se abrirá automáticamente el **Modal Dinámico de Upgrade**, permitiéndote pasar a un nivel superior en un solo clic mediante Paddle.

### 8.5. Configuración de Notificaciones (`/admin/notifications`, Professional+)

Tres canales soportados: **Slack**, **Microsoft Teams**, **Email (SMTP)**.

#### 8.5.1. Centro Global de Notificaciones (Campanita en Barra Superior)
- **Campana Interactiva:** Ícono `IconBell` con badge en azul corporativo (`#0078D4`) indicando alertas sin leer.
- **Filtros Dinámicos:** Clasificación en *Todas*, *No Leídas*, *Info*, *Advertencias* y *Críticas*.
- **Acciones Rápidas:** *"Marcar todo como leído"* y enlaces directos hacia las anomalías, reportes o tickets de soporte involucrados.

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

### 8.7-8.17. Resto de módulos de Administración

| Módulo | Tier | Uso |
|---|---|---|
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

Si te registraste vos mismo desde la página de precios (sin pasar por un onboarding asistido por el equipo de CSCloudSolutions), tu cuenta arranca con un **trial de 7 días** sobre el plan que elegiste. Vas a ver un banner de estado del trial en la parte superior de la plataforma:

- 🔵 Azul: 5 días o más restantes.
- 🟡 Amarillo: entre 3 y 4 días restantes.
- 🔴 Rojo: 2 días o menos — este no se puede descartar.

Podés upgradear a plan pago en cualquier momento desde **Facturación** — el trial se convierte inmediatamente en suscripción activa. Si el trial expira sin upgrade, la cuenta queda en modo de acceso limitado hasta que actives un plan pago.

### 11.9. Infraestructura y residencia de datos

- **Región física activa:** Azure West US 2.
- **Redis productivo:** Azure Managed Redis con HA habilitada.
- **Edge/CDN:** se usa Cloudflare delante del origen de Azure.

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

**Manual de Usuario — FinOps SaaS**
**Versión 2.0 | Español | Julio 2026**
