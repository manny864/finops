# Manual de Usuario - CSCloudSolutions FinOps Platform

Bienvenido a la Plataforma FinOps de CSCloudSolutions. Este manual está diseñado para ayudarte a navegar, comprender y aprovechar al máximo las capacidades de gobernanza, optimización y gestión financiera de recursos en la nube.

**Última actualización:** Agosto 2026

---

## Novedades recientes (Agosto 2026)

- **Whiteboard / Resumen Ejecutivo reconciliado:** incorpora costo actual MTD,
  forecast, recursos zombis, ahorro potencial, impacto ambiental, presupuestos,
  Top 4 servicios, gobernanza, Advisor y Quick Wins. **Actualizar** omite el
  caché; los paneles se pueden pinear en **Mi Dashboard** y **Optimizar** abre
  el modal de remediación con scripts CLI, PowerShell y Terraform.
- **Azure AI Document Intelligence:** nueva subpestaña con costo MTD, páginas
  procesadas, relación Prebuilt/Custom, training, gráficos por modelo, tabla
  filtrable y recomendaciones de Commitment Tier, F0 y arbitraje de modelos.
- **Nuevo módulo Azure Integration Services (iPaaS):** se habilitó `Intelligence → Azure Integration Services` con pestañas para Logic Apps, APIM, Service Bus, Event Grid, Event Hubs y ADF.
- **Conectores Enterprise en Logic Apps:** se agregó una sección dedicada para distinguir conectores Standard vs Enterprise y su impacto operativo/costo.
- **Configuración IA Enterprise (Azure IA):** la configuración global ahora permite definir **endpoint URL** y deployment del proveedor Azure IA para planes Enterprise.
- **Estándar de tablas FinOps/CMP (SaaS):** todas las tablas del nuevo estándar incluyen filtros base (**Recurso, Región, Tipo, Grupo de recursos**), ordenación (A-Z/Z-A/costo), paginado **15/30/45/60**, diseño responsive, ancho completo y columnas redimensionables.
- **Monitoreo y Seguridad homologados:** las vistas de Monitoreo y Seguridad ya usan el mismo patrón visual/operativo que Bases de Datos y Cómputo, con foco en lectura rápida para decisiones FinOps.
- **AI Cost Analytics corregido:** el panel de Microsoft Foundry/Azure OpenAI ahora prioriza consumo real, mantiene tendencia MTD desde el día 1 del mes y corrige inconsistencias de cache/fuentes.
- **Nuevo cron de precalentamiento de Seguridad:** `GET /api/cron/prewarm-security-finops` precalienta Defender + familias de Seguridad para acelerar carga en staging y producción.
- **Inteligencia de Bases de Datos robustecida:** Redis, MySQL, PostgreSQL, Cosmos DB, MongoDB y SQL/Managed Instance ahora muestran estado y métricas con fallback por métrica para evitar `N/A/unknown` por telemetría parcial de Azure.
- **Refresh visual de navegación y módulos FinOps:** tarjetas clave de Inteligencia, Consumo, Gobernanza, Cleanup, Overview y Copilot M365 migraron a iconografía Tabler y headers sin fondo azul para una lectura más limpia.

## 1. Introducción y Acceso

La plataforma es una solución SaaS B2B para **Microsoft Azure**.

- **Para Iniciar Sesión:** Ve a la pantalla principal y haz clic en "Iniciar Sesión con Microsoft". La autenticación se integra con **Entra ID (Active Directory)** y reconoce tu tenant automáticamente.
- **Modo Demo:** Si deseas probar la plataforma sin conectar tu propio entorno, puedes utilizar uno de los perfiles comerciales preconfigurados desde la pantalla principal, los cuales proveen datos y métricas simuladas.

---

## 2. Jerarquía de Roles (RBAC)

La plataforma mapea automáticamente tu perfil corporativo hacia uno de los siguientes roles internos:

1. **Admin (Propietario del Tenant):** Tiene acceso completo a la visibilidad financiera, modificación de configuraciones, y ejecución de acciones correctivas (como el apagado de máquinas o eliminación de recursos).
2. **Colaborador:** Acceso a inteligencia financiera y visibilidad. Puede sugerir cambios pero está restringido en áreas de administración de facturación y usuarios.
3. **Reader (Auditor):** Visibilidad exclusiva en paneles de control y reportes de solo lectura. No puede aplicar cambios ni ver datos sensibles de configuración.

---

## 3. Onboarding Inicial del Tenant

Para que un tenant opere correctamente con su suscripción Azure, el administrador del tenant debe completar este flujo con Service Principal:

1. **Preparar credenciales:** generar y validar **Client ID**, **Client Secret** y **Azure Tenant ID** del Service Principal con el script oficial.
2. **Cargar credenciales en la plataforma:** ir a `Onboarding de Clientes` (`/admin/onboarding`) y completar los campos requeridos del entorno.
3. **Ejecutar primera sincronización:** correr la sincronización inicial para poblar costos, inventario y métricas base.
4. **Validar resultados:** verificar que `Consumo Real` y dashboards de Inteligencia ya muestren datos del tenant.

### 3.1. Roles Azure que el script PowerShell asigna (por tier)

El script de onboarding asigna los roles RBAC al Service Principal a nivel **suscripción**, según el tier contratado:

| Tier | Roles built-in | Custom Role |
|---|---|---|
| **Professional** (piso de la plataforma) | Reader, Cost Management Reader, Monitoring Reader, Billing Reader | — |
| **Business** | Pro + Tag Contributor | VM start/stop/restart/deallocate + tags |
| **Enterprise** | Business + Tag Contributor | Business + disk/snapshot/NIC/PublicIP/NSG delete |

> **Importante:** Los 4 roles base de Professional son el mínimo absoluto para que la página **Consumo Real** muestre datos. Si falta `Cost Management Reader` o `Billing Reader`, Azure devuelve 0 filas silenciosamente.

> **AI Cost Analytics (Microsoft Foundry / Azure OpenAI):** no requiere rol adicional; usa los mismos 4 roles base de Professional.

> **Suscripciones EA/MCA:** Las suscripciones bajo Enterprise Agreement o Microsoft Customer Agreement requieren que el `Billing Admin` asigne adicionalmente `Enrollment Reader` o `Billing Account Reader` al SP en el scope de billing account. El script no puede hacerlo automáticamente — debe coordinarse con el cliente.

### 3.2. Verificación automática de permisos (post-onboarding)

Después de que el cliente ejecutó el script, **siempre validar** que los roles se asignaron correctamente. Hay dos formas:

**A. Endpoint diagnóstico** (recomendado):
```
GET /api/admin/check-sp-roles?tenantId=<tenant-id-del-cliente>
```

Respuesta resumida:
- `summary.okCount` = subs con TODOS los roles requeridos ✅
- `summary.partialCount` = subs con roles incompletos ⚠️
- `summary.noRolesCount` = subs sin ningún rol asignado al SP ❌
- `subscriptions[]` = detalle por sub con `assignedRoles` / `missingRoles`
- `globalHint` = instrucción accionable (qué role asignar y dónde)

**B. Manualmente en Azure Portal:**
Suscripción → **Access control (IAM)** → **Role assignments** → filtrar por el App Registration (`CSCloudSolutions-FinOps-Agent`) y verificar que aparezcan los roles del tier.

### 3.3. Troubleshooting: "Consumo Real no muestra datos"

Si la página `/intelligence/billing` está vacía, el toast indicará uno de estos escenarios:

| Error | Causa | Fix |
|---|---|---|
| `NO_COST_PERMISSION` | El SP ve la sub pero le falta `Cost Management Reader` | Asignar el rol al SP en esa sub |
| `NO_SUBSCRIPTION_ACCESS` | El SP no tiene `Reader` en la sub | Asignar `Reader` o re-ejecutar script |
| `SUBSCRIPTION_INACTIVE` | La sub no tiene consumo ni MTD ni en 30 días | Verificar que la sub correcta esté seleccionada |
| `NO_SUBSCRIPTIONS` | El SP no ve ninguna sub | Asignar `Reader` en al menos una sub |
| `NO_CONSUMPTION` | Subs OK pero sin consumo MTD | Esperar al cierre del ciclo o revisar otra sub |

Llamá a `/api/admin/check-sp-roles` para confirmar cuál escenario aplica antes de tocar Azure.

---

## 3. Navegación Principal

El sistema está dividido en cinco (5) pilares estratégicos en el menú lateral izquierdo:

### 3.1. Visibilidad
- **Dashboard:** Panel principal que resume el estado general de salud del Tenant. Incluye el Ahorro Potencial Total, Recursos Zombis detectados y una calificación de Gobernanza. El Histograma de costos vive ahora en la página **Gastos y Proyección** (ver abajo).
- **Gastos y Proyección (Pro+, `/intelligence/cost-projection`):** página que reúne el **Histograma de costos** (distribución diaria del gasto, seleccionable desde el último mes hasta **13 meses atrás** — todo el historial que permite consultar Azure Cost Management, cacheado en Redis para respuesta instantánea) y la **Proyección de Gastos**: calcula el gasto mensual promedio de los últimos 12 meses y proyecta 3/6/12/24 meses hacia adelante aplicando el **% de crecimiento anual** que ingreses (podés usar valores negativos para simular escenarios de optimización/ahorro). Muestra el promedio base, la tasa mensual equivalente y el total proyectado, junto a un gráfico de línea real vs. proyectado. La tarjeta de proyección también está en el dashboard con link "Ver detalle completo".
- **Azure Advisor:** Sincronización directa con las recomendaciones nativas de Microsoft Azure, clasificadas por Costo, Seguridad, y Excelencia Operativa. Las recomendaciones se muestran en el idioma activo seleccionado por el usuario en la plataforma.
- **Madurez FinOps:** Evaluación interactiva para determinar la madurez de la organización (Crawl, Walk, Run).

> **📅 Historial (botón "Historial"):** En las páginas de Dashboard, Descuentos por Compromiso, Rightsizing, Anomalías, Presupuestos y Alta Disponibilidad encontrarás un botón **Historial** en la esquina superior derecha. Al pulsarlo se abre un panel donde puedes **elegir un rango de fechas (hasta 1 año atrás)** y ver la evolución diaria de las métricas de esa página como **gráfico de líneas** y **tabla**. La plataforma guarda automáticamente una foto diaria de cada página (retención de ~13 meses), sin que debas hacer nada.

### 3.2. Inteligencia Financiera
- **Consumo Real y Presupuestos:** Monitoreo del gasto mensual contra los límites preestablecidos por departamento o centro de costos (Budget Burn).
- **Rightsizing:** Detección de Máquinas Virtuales subutilizadas con recomendaciones específicas de cambio de familia (SKU) para maximizar el retorno de inversión.
- **Rightsizing extendido (Pro):** verticales dedicadas para `VMSS`, `App Service`, `SQL Database` y `Storage` accesibles en `/intelligence/rightsizing/{vmss,appservice,sqldb,storage}`.
- **Storage Efficiency (Business):** análisis de cuentas de Storage con simulación de ahorro al mover blobs entre Hot/Cool/Archive (`/intelligence/storage-efficiency`).
- **Compute $/Core (Pro):** desglose del costo por núcleo vCPU para comparar familias de VM (`/intelligence/compute-efficiency`).
- **Cockpits de Cómputo (Business/Enterprise):** Módulos de optimización y gobernanza granular:
  - **Function Apps (`/intelligence/computo/fapps`):** Gobernanza serverless con detección precisa de planes (Consumption Y1, Elastic Premium, Dedicated y Flex Consumption), telemetría de invocaciones (`FunctionExecutionCount`), unidades en GB-s (`FunctionExecutionUnits`), auditoría de costos ocultos (Storage y Application Insights) y remediaciones con Azure CLI, Terraform y `host.json` (Sampling al 20%, Downgrade a Y1, Zombie Apps, Storage Polling).
  - **Web Apps & App Services (`/intelligence/computo/waas`):** Densidad de aplicaciones (App Density), recuento de Web Apps y Deployment Slots activos, workers dedicados y playbooks de consolidación (App Packing) y modernización a Premium v3.
  - **VMSS & Scale Sets (`/intelligence/computo/vmss`):** Autoscale por métricas/calendario, adopción de Spot instances y optimización de discos OS.
  - **Virtual Machines (`/intelligence/computo/avm`):** Cockpit resolutivo de cómputo con separación de costo de cómputo activo vs. almacenamiento persistente (fugas en VMs desasignadas), optimización de licencias Windows (AHUB), rightsizing a Serie B Burstable, programación de apagado 8x5 en Dev/Test y descarte de VMs abandonadas.
- **Alertas Self-Service (Pro):** creación/edición de reglas de alerta de presupuesto y anomalía sin intervención de soporte (`/intelligence/alerts`).
- **AI Analytics (Enterprise):** consumo de Microsoft Foundry / Azure OpenAI (tokens, modelos, $/1k tokens) en `/intelligence/ai-analytics`.
- **Bases de Datos (Business):** Visibilidad, métricas en tiempo real y diagnóstico de rendimiento para CosmosDB, Azure SQL, PostgreSQL, MySQL, MongoDB y Redis. Incluye la pestaña especial **redistest** para el monitoreo detallado de las 12 métricas críticas de Azure Cache for Redis mediante gráficos de área con agregación average.
- **MACC Tracker (Enterprise):** seguimiento del consumo de compromiso anual EA/MCA en `/intelligence/macc`.
- **Descuentos por Compromiso — Reservas Activas:** en `/intelligence/commitments`, además de la cobertura y utilización global, la tabla **Reservas Activas** replica el blade *Reservations* de Azure y muestra por reserva: **Nombre, Estado, Expiración, Alcance, Tipo, Nombre del producto, Región, Renovación, Cantidad**, y la **utilización del último día y de los últimos 7 días**.
  - Haz clic en el botón de **Renovación** para abrir el modal que permite **activar o deshabilitar la auto-renovación** de esa reserva (el cambio se aplica directamente en Azure; requiere rol **Admin/Owner** del tenant y permisos *Reservations Contributor/Owner* en Azure).
  - Haz clic sobre cualquiera de los **porcentajes de utilización** para abrir el modal con la utilización de **último día / 7 días / 30 días** y la **tendencia diaria** de la reserva.
- **Licencias M365:** Identificación de licencias de Microsoft 365 asignadas pero inactivas en los últimos 30 días, promoviendo su reasignación o cancelación.
- **Ingesta CSV:** Herramienta para cargar facturación histórica de nubes de terceros bajo el estándar FOCUS.
- **Simulador What-If (`/intelligence/simulator`):** simulá el impacto de escalar cómputo/storage, variar tráfico de red o activar Azure Hybrid Benefit sobre tu costo actual. Podés **guardar escenarios**, **compararlos lado a lado** (hasta 4 a la vez) y **descargarlos en CSV o PDF** (elegís el formato con el selector junto a los botones de descarga) — un escenario individual, todos los guardados, o la comparación completa con el delta de cada uno contra la línea base.

### 3.3. Limpieza de Nube (Hygiene)
- **Recursos Zombis:** Identificación proactiva de recursos huérfanos (Ej. Discos sin adjuntar, IPs públicas sin uso, App Service Plans vacíos) que generan gastos innecesarios.
- **Networking Zombies (Pro):** detección dedicada de Load Balancers vacíos, NSGs sin asociación y Public IPs huérfanas (`/cleanup/zombies/networking`).
- **Expiraciones TTL:** Control sobre entornos efímeros (como Sandboxes) que han superado su Tiempo de Vida estipulado.

### 3.4. Gobernanza
- **Cumplimiento de Etiquetas:** Auditoría de la infraestructura contra las políticas de etiquetado corporativas (Ej. CostCenter, Owner, Environment).
- **HA Recommendations (Business):** VMs en producción sin Availability Zone o Availability Set (`/governance/ha`).
- **Credenciales AAD por Expirar (Business):** alerta proactiva de App Registrations / Service Principals cuyos secretos o certificados expiran en los próximos 30/60/90 días (`/governance/credentials`). Cada credencial muestra su estado: **Vencida**, **Próxima a vencer** (≤ 30 días) o **Habilitada**. Con **"Crear alerta de vencimiento"** defines cuántos días antes quieres el aviso (1–365) y el canal (email, Slack o Teams vía webhook); el sistema evalúa a diario y envía como máximo una notificación por día mientras haya credenciales dentro del umbral (incluye vencidas). Las reglas también se administran en **Alertas (Self-Service)** con el tipo "Vencimiento de credenciales".
- **Horarios de Apagado (Power Schedules):** Creación de rutinas automáticas para el encendido y apagado de flotas de Máquinas Virtuales durante horarios no productivos (Ej. Apagar a las 8 PM, encender a las 6 AM). Dos modos:
  - **Fecha puntual (single):** ejecuta la acción (encender/apagar/reiniciar) una única vez en la fecha y hora indicada.
  - **Recurrente (range):** define un rango horario **"Desde – Hasta"** y los **días de la semana** en que se repite (ej. Lun–Vie, 08:00–20:00); crea automáticamente un horario de encendido a la hora "Desde" y uno de apagado a la hora "Hasta", ambos con los mismos días seleccionados.
  - La **zona horaria (GMT)** se detecta automáticamente según el navegador del usuario al abrir el formulario (se puede cambiar manualmente si se necesita otro huso).
  - **Tiempo de ejecución:** el sistema revisa los horarios pendientes cada **2 minutos** y, además, hace una verificación inmediata apenas guardás el horario. En condiciones normales la acción se ejecuta al instante o dentro de los 2 minutos siguientes a la hora programada; cada acción sobre la VM (encender/apagar/reiniciar) puede tardar entre 20 y 40 segundos adicionales en confirmarse contra Azure antes de reflejarse como completada.

### 3.5. Administración
- **Usuarios y Permisos:** Visualización del personal de la organización importado desde Entra ID.
- **Configuración:** Administración general del perfil del Tenant y preferencias de suscripciones.
- **Facturación (Cambio de Plan):** En `/admin/billing` el rol **Owner** puede cambiar de plan (Professional / Business) de forma autogestionada. Al seleccionar el nuevo plan, frecuencia (mensual/anual) y modo de prorrateo, el sistema muestra un **resumen previo** con el monto real calculado por Paddle antes de confirmar: **"Se cobrará ahora $X"** (upgrade) o **"Recibirás un crédito de $X"** (downgrade), el nuevo total recurrente y la fecha de próxima facturación. El cambio sólo se aplica al presionar **Confirmar cambio**.
- **Reporte Ejecutivo:** Generación automatizada de reportes periódicos en formato de alto nivel.
- **Invoicing Report (Business+):** export JSON / CSV / PBIT stub con detalle por `billing_profile`, `invoice_section` y `customer` en `/admin/report`. Incluye selector de período (mes puntual o **Últimos 3 meses**, opción por defecto) y selector de **suscripción por nombre** (no GUID); la tabla "Facturación por Suscripción" muestra una fila de **total** con la sumatoria de todas las suscripciones.
- **Azure Lighthouse Onboarding (Enterprise):** generación de ARM template para delegación cross-tenant en `/admin/onboarding/lighthouse`.
- **M365 Copilot (Enterprise):** configuración del tenant + chat asistido sobre datos FinOps en `/admin/copilot-m365`.

### 3.6. Soporte (todos los planes, desde Professional)

En **Soporte** (`/support`, ícono de salvavidas en el menú de Administración) cualquier usuario del tenant puede abrir tickets al equipo de CSCloudSolutions y seguir la conversación dentro de la plataforma:

- **Crear ticket:** asunto, categoría (Técnico / Facturación / Consulta / Pedido de feature), prioridad y mensaje inicial.
- **Hilo de conversación:** las respuestas del equipo de soporte aparecen identificadas con 🛟; puedes responder mientras el ticket no esté cerrado, y cerrarlo o reabrirlo tú mismo.
- **Adjuntos:** al crear o responder puedes adjuntar capturas o archivos (`jpg`, `jpeg`, `png`, `txt`, `json`; máx. 5 MB por archivo, 10 por ticket). Los adjuntos se conservan **60 días** y luego se eliminan automáticamente.
- **Acceso rápido y notificaciones:** el ícono de salvavidas junto a tu usuario (header) abre Soporte desde cualquier página. Cuando el equipo responde tu ticket, verás una notificación en la campanita 🔔 y un aviso en pantalla.
- **Cuotas y SLA por plan:**

| Plan | Tickets por mes | Primera respuesta (SLA) |
| --- | --- | --- |
| Professional | 20 | 24 h |
| Business | Ilimitados | 8 h |
| Enterprise | Ilimitados | 4 h |

El equipo de CSCloudSolutions gestiona internamente la cola global de soporte y responde dentro del mismo hilo del ticket del tenant.

---

## 3.7. Tu Perfil

Haciendo clic en tu **avatar** (círculo con tu inicial, arriba a la derecha) se abre el menú de perfil, disponible en móvil y escritorio:

- **Nombre completo:** editable con el ícono de lápiz (se guarda en tu usuario de la plataforma).
- **Correo electrónico** y **Rol** dentro del tenant.
- **Moneda:** selector de divisa de visualización (antes estaba suelto en el header).
- **Aspecto:** Claro, Oscuro o Automático (sigue el tema del sistema).
- **Cerrar sesión.**

---

## 3.8. Planes de Suscripción y Límites de Uso

La plataforma ofrece tres niveles de servicio (tiers) adaptados a cada escala organizacional:

| Plan | Suscripciones Azure | Usuarios por Tenant | Soporte Técnico | Capacidades Destacadas |
|---|---|---|---|---|
| **Professional** | Hasta 2 suscripciones | Hasta 3 usuarios | 20 tickets/mes (24 h) | Dashboard Ejecutivo, Consumo MTD, Anomalías, IA Copilot, Exportación FOCUS 1.1 |
| **Business** | Hasta 3 suscripciones | Hasta 5 usuarios | Prioritario (12 h) | Todo en Pro + Remediación Automática (Zombies/Tags), Simulador What-If, Cost Groups, Reportes Ejecutivos |
| **Enterprise** | Ilimitadas | Ilimitados | 24/7 Dedicado (SLA 99.9%) | Todo en Business + SSO SAML/OIDC (Okta, Auth0, Entra ID), Auditoría Avanzada, Soporte Personalizado |

---

## 4. FinOps Copilot (Asistente de IA)

La plataforma cuenta con un asistente inteligente integrado (**FinOps Copilot**), accesible a través de un ícono flotante en la esquina inferior de la pantalla.

- **Conciencia de Contexto (automática):** El Copilot lee automáticamente el contenido de la página donde te encontrás — no importa cuál sea, sin necesidad de que esa vista lo declare de antemano. Al abrir el widget, genera solo (sin que escribas nada) un **reporte ejecutivo** de lo que se está mostrando: contexto del módulo, hallazgos clave, oportunidades de ahorro priorizadas por impacto, riesgos y un plan de acción a 7 días.
- **Preguntas dirigidas:** Además del reporte automático, podés preguntarle directamente sobre lo que ves. Ej.: en *Presupuestos*: *"Resume el estado actual de nuestros presupuestos"*.
- **Sugerencias e información estratégica:** el Copilot provee exclusivamente análisis, recomendaciones de optimización y respuestas informativas para apoyar la toma de decisiones del equipo — no ejecuta acciones correctivas ni modificaciones directas sobre tu infraestructura.

---

## 5. Mejores Prácticas

- **Revisión Semanal:** Sugerimos acceder al **Dashboard** y la sección de **Recursos Zombis** al menos una vez por semana para capturar fugas financieras emergentes.
- **Automatización Temprana:** Activa **Horarios de Apagado** en tus entornos de Desarrollo (Dev/Test) como primera medida para asegurar ahorros del 60% en horas de cómputo inactivas.
- **Delegación de Responsabilidad:** Exige el cumplimiento de **Etiquetas (Tags)** a tus equipos de desarrollo para que el módulo de Showback/Chargeback pueda distribuir justamente la factura mensual.
- **Infraestructura y residencia de datos:**
  - **Región física activa:** Azure West US 2.
  - **Redis productivo:** Azure Managed Redis con HA habilitada.
  - **Edge/CDN:** se usa Cloudflare delante del origen de Azure.

> **Soporte:** Para cualquier asistencia adicional o reporte de incidencias operativas, por favor contacte al equipo administrativo a través de la sección de soporte.
