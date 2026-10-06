<div class="cover">
<img src="../../public/CSCloudSolutions.png" alt="CSCloudSolutions" class="cover-logo" width="360" />
<h1 class="cover-title">Manual de SuperAdmin</h1>
<p class="cover-sub">FinOps SaaS · CSCloudSolutions</p>
<p class="cover-meta">Versión 2.1 · Octubre 2026</p>
<p class="cover-copyright">© 2026 CSCloudSolutions. Todos los derechos reservados.</p>
</div>

# 📘 Manual de SuperAdmin — FinOps SaaS (CSCloudSolutions)

**Versión:** 2.1 (detallada)
**Idioma:** Español
**Última actualización:** Octubre 2026
**Audiencia:** exclusivo equipo interno de CSCloudSolutions (SuperAdmin). Incluye todo el contenido del Manual de Usuario más los flujos de administración de la plataforma (alta de tenants, onboarding de clientes, gestión comercial).

---

## Novedades recientes (Septiembre – Octubre 2026)

Todo lo que cambió para el usuario de un tenant está en el **Manual de Usuario** y se incluye acá en las secciones 3 a 12 (Perspectives y alcance por equipo, Leaderboard y margen bruto, suscripciones a reportes, año fiscal y arrastre de presupuesto, fin de soporte, Shift-Left, Cosmos DB, egress y capacidad de enlaces, Azure Virtual Desktop, Almacenamiento, Marketplace, app móvil). Lo que cambió del lado de la operación de la plataforma:

- **Programa de Afiliados con panel propio para el partner (17):** el afiliado entra con un enlace personal de sólo lectura, sin cuenta de ningún tenant; la comisión de un referido dura **el primer año** de cada cliente (12 meses corridos desde su primer cobro) y no para siempre.
- **Atribuir un cliente a un afiliado a mano (17.2):** para el que trajo un afiliado y se registró sin el link. Rigen las reglas del alta, no es retroactiva y queda registrado quién la hizo.
- **Corridas de pago (17.6):** las comisiones exigibles de afiliados y comerciales se liquidan en lotes por moneda, con orden de pago en CSV y confirmación con comprobante.
- **Comisiones comerciales (20):** fecha de venta y plazo del contrato por tenant, y el calendario de devengo del comercial (anual o mensual) sobre el mismo libro mayor que los afiliados.
- **Consumo de plataforma (22):** tokens de IA que absorbe la casa y llamadas a las APIs de Azure, con el porcentaje de throttling por servicio y por tenant.
- **Embudo de registro (21), Unidades de precio (23), Prueba de carga (24) e IA — Configuración global (25):** documentados por primera vez en este manual.
- **Anomalías con responsable y seguimiento (18) y suscripciones fuera del tope de un plan (19):** lo que ve el cliente y cómo explicárselo.
- **Enlaces que salen de la plataforma:** el enlace del panel del partner y el resto de los enlaces que mandamos por correo usan la URL pública configurada (`NEXT_PUBLIC_APP_URL`), no el host con el que entró quien los pidió.
- **Avisos de vencimiento de reservas (MEJ-16):** un cron diario nuevo, `reservation-expiry-alerts` (09:03 UTC), avisa a cada tenant a los 90, 60 y 30 días del vencimiento de sus reservas, por la campanita y por sus canales de notificación (5.4.4). Lo que ya avisó queda anotado en `ReservationExpiryNotices`, así que no se repite. Corre desde el 06/10, después del `terraform apply` del 05/10.
- **Lo que era sólo por API ya tiene pantalla:** alcance por usuario (8.2), vistas compartidas y predeterminadas (3.4), clasificación COGS/OpEx (5.2), arrastre de presupuesto y año fiscal (5.1.5), y la política del puntaje de madurez (MEJ-08, 4.4). Shift-Left tiene entrada en el menú, y un usuario acotado ve los hubs que le corresponden en vez de sólo el Whiteboard.
- **Pantallas que no mandaban la sesión:** Leaderboard, Fin de soporte, Capacidad de red, Vistas guardadas, Suscripciones a reportes, el historial de inicios de sesión de M365, la barra de impersonación y el aviso de borrado terminado llamaban a la API sin el token y, para cualquier tenant real, recibían 401; en el demo funcionaban porque se interceptan. Ya lo mandan, y un test (`fetchConSesion.test.ts`) impide que vuelva.
- **Afiliados al 15 % por defecto (17.1)** y **portal del partner en su idioma (17.5)**: el enlace ya no fuerza español y el panel tiene selector de idioma.
- **Infraestructura:** el `terraform apply` a producción se hace **sólo por CI** (workflow `terraform.yml`, confirmación `APPLY-PROD`), nunca desde una máquina local; los valores de entorno de producción viven en el secreto `TF_VARS_PROD`.

**Novedades de agosto 2026**

- **Cockpits FinOps de Cómputo y Eficiencia Serverless:** incorporación de tableros resolutivos para **Virtual Machines** (`/intelligence/computo/avm`) con separación de costo de cómputo vs almacenamiento persistente (fugas en VMs desasignadas), AHUB, rightsizing a Serie B, schedules 8x5 y descarte de VMs abandonadas; **Function Apps** (`/intelligence/computo/fapps`) con telemetría de invocaciones, GB-s, auditoría de dependencias (Storage/App Insights) y remediación con playbooks de sampling y downgrade; **App Services** (`/intelligence/computo/waas`) con densidad de apps y consolidación; y **VMSS** (`/intelligence/computo/vmss`) con autoscale y Spot pricing.
- **Estandarización de Popovers Responsivos (`InfoTooltip`):** popovers con fondo azul institucional `#1B2A41` 100% responsivos para evitar pérdida de texto en cualquier viewport.
- **Nuevo panel SuperAdmin:** `Alertas Partner Center` (`/superadmin/partner-alerts`) para monitorear estados PAL/CPOR por tenant y detectar eventos recientes.
- **Nuevo módulo Azure Integration Services (iPaaS):** se incorporó `Intelligence → Azure Integration Services` con tabs de Logic Apps, APIM, Service Bus, Event Grid, Event Hubs y ADF, incluyendo sección de Conectores Enterprise para Logic Apps.
- **Automatización operativa PAL:** al aprobar asociación de partner, se registran eventos y se habilita reintento automático (cron) con actualización de estado y detalle.
- **IA Enterprise (Azure IA):** configuración global extendida para guardar y probar **endpoint URL** + deployment, además de la API key, con compatibilidad de fallback.
- **Directiva transversal de tablas FinOps/CMP:** queda formalizada para presentes y futuras tablas (filtros base, orden A-Z/Z-A/costo, paginado 15/30/45/60, responsive full-width y resize de columnas).
- **Seguridad y Monitoreo estandarizados:** módulos alineados al mismo estilo de Bases de Datos y Cómputo, incluyendo paginado y filtros por recurso/región/tipo/grupo.
- **Nuevo cron operativo de Seguridad:** `prewarm-security-finops` agregado al mapa de jobs de Terraform (staging/prod) para precalentar `defender` y `security/service-cost`.
- **Key Vault Hardening y Aislamiento de Red:** Key Vault de producción protegido mediante Private Endpoint (`cscs-finops-prod-wus2-kv-pe`) en la subnet `snet-pe`, firewall en `default_action = Deny` y apertura efímera automatizada en GitHub Actions.
- **Prewarm Diario Exhaustivo (4:00 AM) y Arquitectura Async Poll:** Despliegue del cron `prewarm-daily` (`0 4 * * *`, 07:00 UTC) para pre-calcular y cachear en Redis (TTL 26h) la auditoría KQL completa, zombies, whiteboard, MTD/históricos, inventario, tags, madurez FinOps y scorecards. Migración de los Container App Jobs `prewarm-databases` y `prewarm-compute` al protocolo `async_poll = true` para evitar timeouts de 240s en Ingress.
- **Corrección de Facturación en Azure SQL Elastic Pools:** Se asigna costo `$0.00 (En Pool)` a bases de datos miembro de un Elastic Pool, evitando la multiplicación errónea del costo de cómputo/DTU por cada base de datos individual y reflejándolo con exactitud a nivel del recurso Pool.
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
13. [Comunicaciones globales](#13-comunicaciones-globales)
14. [Ciclo de vida de tenants](#14-ciclo-de-vida-de-tenants)
15. [Azure Marketplace](#15-azure-marketplace)
16. [Onboarding por Azure Lighthouse (Enterprise)](#16-onboarding-por-azure-lighthouse-enterprise)
17. [Programa de Afiliados](#17-programa-de-afiliados)
18. [Anomalías de gasto: quién las atiende](#18-anomalías-de-gasto-quién-las-atiende)
19. [Suscripciones fuera del tope de tu plan](#19-suscripciones-fuera-del-tope-de-tu-plan)
20. [Comisiones comerciales](#20-comisiones-comerciales)
21. [Embudo de registro](#21-embudo-de-registro)
22. [Consumo de plataforma](#22-consumo-de-plataforma)
23. [Unidades de precio](#23-unidades-de-precio)
24. [Prueba de carga](#24-prueba-de-carga)
25. [IA — Configuración global](#25-ia--configuración-global)

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
5. **Impersonación Segura de Sesiones de Cliente:** desde la tabla de Tenants (`/admin/tenants`), cada fila cuenta con el botón de acción **"Impersonar"** (`IconUserCheck`). Al hacer clic:
   - Se crea una cookie HTTP-only cifrada `saas_impersonation_session` con validez de 4 horas.
   - El SuperAdmin visualiza la interfaz completa tal como la ve el tenant cliente con sus suscripciones y roles.
   - La barra flotante superior fija en `z-[90]` muestra el estado activo de delegación y permite salir en cualquier momento con **"Salir de Impersonación"** retornando al panel SuperAdmin.
   - Cada acción ejecutada queda registrada en `AuditTrailLogs` con trazabilidad inmutable (`isImpersonated: true`, `executedBySuperAdmin`).

**Roles Azure que asigna el script, por tier contratado:**

| Tier | Roles built-in | Rol personalizado (*CSCloudSolutions Remediation Role*) |
|---|---|---|
| Professional (piso de la plataforma) | Reader, Cost Management Reader, Monitoring Reader, Billing Reader, Security Reader y, a nivel tenant, Reservations Reader | — (sólo lectura) |
| Business | Professional + Tag Contributor | Encender, apagar, reiniciar y desasignar VMs; escribir etiquetas; gestionar presupuestos de Azure; y **eliminar** los recursos huérfanos que detecta Limpieza de Nube (VMs, discos, snapshots, planes de App Service, NICs, IPs públicas, NSGs y los demás tipos de red de Networking Zombies) |
| Enterprise | Business + Monitoring Contributor | Business + crear grupos de recursos |

Además, el script concede a la identidad **permisos de lectura de Microsoft Graph** en todos los planes (`Directory.Read.All`, `Reports.Read.All`, `User.Read.All` y `Organization.Read.All`) y, según el plan: `Application.ReadWrite.OwnedBy` (Business+, para rotar secretos: sólo alcanza a las App Registrations de las que la identidad es *owner*), `AuditLog.Read.All` (Enterprise, actividad de inicio de sesión para *Usuarios y Licencias*) y `ExternalConnection.ReadWrite.OwnedBy` (Enterprise, conector de Copilot M365).

**Reservations Reader** se asigna sobre `/providers/Microsoft.Capacity`, a nivel tenant y no por suscripción: sin él, las reservas no aparecen en Optimización y Ahorro ni llegan sus avisos de vencimiento. Asignarlo exige ser *Reservations Administrator*, u Owner / User Access Administrator sobre ese alcance; si el script lo marca como `[FAIL]`, lo tiene que asignar alguien con ese permiso.

> ⚠️ **Reader, Cost Management Reader, Monitoring Reader y Billing Reader son el mínimo absoluto** para que la página Consumo Real muestre datos. Si falta `Cost Management Reader` o `Billing Reader`, Azure devuelve 0 filas sin avisar. `Security Reader` suma la lectura de la postura de seguridad (Defender/WAF).

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

- **Visibilidad** — Whiteboard, Academia FinOps, Azure Advisor, Madurez FinOps, Progreso Histórico, TOP Gastos, Recursos, Green FinOps, Ahorro Capturado y Fugas Financieras.
- **Inteligencia Financiera** — Consumo y Presupuesto, Leaderboard de equipos, Perspectives, Optimización y Ahorro, Bases de Datos, Cómputo, Almacenamiento, Redes, Usuarios y Licencias, Azure AI, Azure Integration Services, Monitoreo, Seguridad y Analítica Avanzada.
- **Limpieza de Nube** — Recursos Zombis, Networking Zombies, Expiraciones TTL y Backups Huérfanos.
- **Gobernanza** — Cumplimiento Etiquetas, Alertas Self-Service, Horarios de Apagado, Políticas (Auto-Block), Reporting de Gobernanza, Alta Disponibilidad, Fin de soporte, Shift-Left (PRs), Credenciales por Expirar y Aprobaciones.
- **Administración** — Soporte, Usuarios y Accesos, Configuración, Reportes y Exportación, Integraciones y API, Facturación y Auditoría y Marketplace.

**Qué ves depende de tres cosas:** tu **plan** (cada pantalla indica desde cuál está disponible), tu **rol** (qué podés hacer) y tus **permisos de dominio** (qué páginas se te muestran). Lo que tu plan no incluye aparece marcado con un candado y un aviso de upgrade, o se puede sumar suelto desde el **Marketplace** (8.10).

Un **buscador** en la parte superior del sidebar te permite encontrar páginas por nombre sin navegar por las categorías, y sólo lista lo que vos podés abrir.

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

### 3.3. Hubs con pestañas

Muchas entradas del menú son **hubs**: una pantalla con pestañas que agrupa las vistas de un mismo tema. Entrás por el hub y te movés entre sus pestañas sin volver al menú; la pestaña activa queda en la URL, así que podés compartir el link exacto. Son hubs, entre otros, **Consumo y Presupuesto**, **Optimización y Ahorro**, **Bases de Datos**, **Cómputo**, **Almacenamiento**, **Redes**, **Monitoreo**, **Seguridad**, **Azure AI**, **Azure Integration Services**, **Analítica Avanzada** y, en Administración, **Usuarios y Accesos**, **Configuración**, **Reportes y Exportación**, **Integraciones y API** y **Facturación y Auditoría**.

Las URLs anteriores a los hubs (por ejemplo `/intelligence/billing` o `/admin/users`) siguen funcionando: abren la misma pantalla o te redirigen a su pestaña, así que los marcadores viejos no se rompen.

### 3.4. La barra de alcance: suscripción, Perspective y Vistas

En el encabezado hay tres selectores que acotan lo que muestran los tableros:

- **Alcance (tenant y suscripción).** Elegís todo el tenant o una suscripción de Azure. Si tu organización tiene más de un tenant, también cambiás de tenant desde acá.
- **Perspective y grupo.** Aparece sólo si tu plan es Enterprise y el tenant tiene Perspectives definidas (5.3). Elegís una Perspective y un grupo —por ejemplo *Equipos → Ingeniería*— y los tableros que lo admiten muestran sólo esa porción del gasto. La elección viaja en la URL: se comparte por link y sobrevive a un refresco.
- **Vistas** (ícono de marcador). Con una Perspective elegida, *Guardar la vista actual…* recuerda la combinación —Perspective y grupo— con el nombre que le pongas, y la volvés a aplicar en un clic desde el mismo selector. Al guardarla podés marcarla para **abrirla por defecto al entrar** —se aplica sola si la URL no indica otra cosa— y, si sos Admin u Owner, **compartirla con todo el equipo**. La estrella de cada vista la marca o desmarca como predeterminada. Las compartidas las ve todo el tenant y sólo Admin y Owner las cambian o las borran. Si hay una predeterminada tuya y otra del equipo, gana la tuya. El selector se muestra sólo cuando hay vistas guardadas o una Perspective activa para guardar.

> Si tu cuenta tiene un **alcance asignado** por un Admin (8.2), el selector de Perspective queda fijo en tu grupo, con candado, y el de Vistas no se muestra: tu recorte no se elige, no se guarda y no se cambia.

### 3.5. Atajos y app móvil

- **Paleta de comandos:** `⌘K` (Mac) o `Ctrl+K` (Windows/Linux) abre un buscador de pantallas, acciones rápidas y también de recursos de tu entorno (escribí al menos dos caracteres).
- **Manual:** el ícono de ayuda (**?**) del encabezado abre este manual en PDF, en el idioma que tengas activo.
- **Celular:** en pantallas angostas la plataforma ofrece una experiencia móvil dedicada (11.12).

---

## 4. Sección Visibilidad

### 4.1. Dashboard (White Board)

Tu panel ejecutivo de entrada. Reúne Costo Actual, forecast, Recursos Zombis, Ahorro Potencial e Impacto Ambiental, junto con presupuestos, servicios dominantes, gobernanza, Advisor y Quick Wins.

**Cómo usarlo:**
1. Elegí el **período** en el selector del encabezado: **Mes Actual (MTD)**, **Últimos 30 días** o **Últimos 90 días**. El mes en curso se consulta en vivo a Azure Cost Management (con la base de la plataforma como respaldo si Azure no responde); los rangos de 30 y 90 días se leen del histórico que la plataforma guarda cada noche, así que responden al instante y no gastan cuota de consultas de Azure. La tarjeta de costo principal cambia de rótulo según el rango.
2. Revisá la barra de sincronización y usá **Actualizar** para omitir el caché y consultar el ciclo vigente.
3. Compará el gasto con los presupuestos por centro de costos y ajustá la tasa del forecast a 12 meses.
4. Anclá/desanclá widgets desde el ícono de pin para llevarlos a **Mi Dashboard**.
5. En **Top Quick Wins**, elegí **Optimizar** para abrir el modal de remediación con scripts CLI, PowerShell y Terraform.

El Whiteboard respeta el **alcance** de la barra superior (3.4): con una Perspective y un grupo elegidos, los números son los de esa porción del gasto.

### 4.2. Gastos y Proyección (pestaña del hub Consumo y Presupuesto, tier Enterprise)

Esta pantalla vive como pestaña del hub **Consumo y Presupuesto** y se describe en 5.1.6. El Dashboard muestra una tarjeta resumen de lo mismo con el link **"Ver detalle completo"**.

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

Ubica a tu organización en **Gatear / Caminar / Correr** —el modelo Crawl-Walk-Run de la FinOps Foundation— en seis dimensiones: Visibilidad e Información, Optimización de Tasa, Optimización de Uso, Gobernanza y Asignación, Automatización y Cultura FinOps. El radar muestra el puntaje de cada una (Gatear por debajo de 40, Caminar de 40 a 75, Correr por encima de 75), con la hoja de ruta de los próximos hitos.

Cada dimensión tiene **dos lecturas**: la **telemetría** que la plataforma mide en tu Azure y la **autoevaluación** que el equipo completa con **Retomar Evaluación** (una pregunta por dimensión). Cuando están las dos, la fila las muestra juntas (*Equipo 70 · Azure 45*), y si se separan más de 20 puntos el plan de acción lo marca: o el equipo se está dando por maduro sin evidencia, o hay capacidades implementadas que nadie documentó.

**Cómo se calcula el puntaje.** Arriba del radar se elige qué lectura manda. La eligen Admin y Owner; los demás ven cuál está activa.

| Opción | Qué hace | Para quién |
|---|---|---|
| **Manda la autoevaluación del equipo** (por defecto) | El puntaje de cada dimensión es lo que declaró el equipo | Un equipo en adopción, que quiere medir su propia lectura |
| **Manda la telemetría de Azure** | El puntaje es lo medido; lo declarado queda como contraste | Un cliente auditado, donde lo declarado no alcanza |
| **Promedio 50/50** | La mitad de cada lectura | Un punto intermedio |

Cambiarla recalcula el radar en el momento y no borra ninguna respuesta.

### 4.5. Academia FinOps

Centro de aprendizaje interactivo sobre FinOps y optimización Azure — cursos estructurados, videos, glosario y recursos descargables.

> ⚠️ **Gate obligatorio:** los usuarios nuevos deben completar la Academia antes de acceder al resto de la plataforma (con un disclaimer explicando por qué). El progreso se registra **por usuario**, no por organización — cada persona nueva del tenant tiene que completarlo, y una vez completado no se puede volver a ejecutar.

### 4.6-4.10. Progreso Histórico, TOP Gastos, Recursos, Green FinOps, Ahorro Capturado, Fugas Financieras (Professional/Business+)

- **Progreso Histórico:** gráficos de tendencia mensual, hitos de ahorro alcanzados, comparativas mes a mes y año a año. Podés añadir anotaciones manuales sobre eventos que expliquen un cambio (ej. "migración a reservas").
- **TOP Gastos:** ranking de tus mayores fuentes de gasto por servicio, suscripción o grupo de recursos, con drilldown a nivel de recurso individual.
- **Recursos** (Business+): inventario completo — filtrado y búsqueda avanzada, etiquetado en masa, exportación. Un recurso hijo sin cargo propio (por ejemplo, la extensión de una VM) no suma su costo dos veces: se muestra en gris como *en <recurso padre> · $monto*, y el importe cuenta una sola vez, en el padre.
- **Green FinOps** (Professional+): estimación de huella de carbono por servicio, comparativa de regiones más eficientes, recomendaciones de sostenibilidad.
- **Ahorro Capturado** (Professional+): tracking de ahorros reales ya conseguidos vía RIs, Savings Plans y Hybrid Benefit, con cálculo de ROI. El historial incluye también lo que tu equipo ahorró **directamente en Azure**, sin pasar por la plataforma (un disco borrado desde el portal, una VM apagada por CLI): se detecta porque el gasto del recurso cae y, cuando el Activity Log de Azure todavía conserva el evento (90 días), se muestra quién lo hizo y cuándo.
- **Fugas Financieras** (Professional+): identifica dinero mal gastado (recursos abandonados, sobre-dimensionamiento, redundancia innecesaria) con calendario de remediación.

---

## 5. Sección Inteligencia Financiera

Acá está el análisis de costos y de optimización de Azure. Casi cada entrada del menú es un **hub con pestañas** (3.3). El plan mínimo figura junto a cada nombre; si el tuyo no lo incluye, la pantalla lo avisa y te ofrece el upgrade o el módulo suelto del Marketplace (8.10).

| Hub | Plan | Para qué sirve |
|---|---|---|
| **Consumo y Presupuesto** | Professional+ | Gasto real, presupuestos, grupos de costos y proyección |
| **Leaderboard de equipos** | Enterprise | Qué equipo mejoró, costo de venta y margen bruto |
| **Perspectives** | Enterprise | Repartir el gasto por tus propias dimensiones |
| **Optimización y Ahorro** | Enterprise | Rightsizing, tarifas, compromisos, Hybrid Benefit, costo cero |
| **Bases de Datos** | Business+ | Cosmos DB, SQL, PostgreSQL, MySQL, MongoDB, Redis y Fabric |
| **Cómputo** | Business+ | VMs, VMSS, App Service, Functions, AVD, contenedores, Kubernetes y OpenShift |
| **Almacenamiento** | Enterprise | Storage Accounts, discos, backups y Data Lake |
| **Redes** | Business+ | Análisis de red, conectividad, balanceo, egress y capacidad de enlaces |
| **Usuarios y Licencias** | Enterprise | Licencias M365 y actividad de usuarios |
| **Azure AI** | Enterprise | Costo y consumo de los servicios de IA de Azure |
| **Azure Integration Services** | Enterprise | Logic Apps, APIM, Service Bus, Event Grid, Event Hubs y ADF |
| **Monitoreo** | Enterprise | Application Insights, Log Analytics, Monitor, Sentinel y alertas |
| **Seguridad** | Enterprise | Defender, Sentinel, Key Vault, Entra ID, WAF y DDoS |
| **Analítica Avanzada** | Enterprise | Unit Economics, prorrateo, scorecard, anomalías, salud, What-If y MACC |

### 5.1. Consumo y Presupuesto (`/intelligence/consumo-y-presupuesto`)

Siete pestañas: **Consumo Real**, **Por Categoría**, **Presupuestos**, **Grupos de Costos**, **Presupuesto por Grupos de Costos**, **Gastos y Proyección** e **Ingesta CSV**.

#### 5.1.1. Consumo Real (Professional+)

El dashboard de facturación detallada, en tiempo real desde Azure.

**Cómo usarlo:**
1. Filtrá por período, suscripción y grupo de recursos.
2. Hacé zoom en un servicio específico para ver su desglose por recurso.
3. Descargá la factura o exportá los datos a Excel desde el botón correspondiente.
4. Creá alertas de umbral desde la misma página (te lleva al formulario de Alertas Self-Service con el contexto precargado).

> Si un recurso gasta en dos servicios de Azure (una storage account en *Storage* y en *Bandwidth*, una VM en *Virtual Machines* y en *Managed Disks*), aparece **completo bajo su servicio principal** en vez de repartido. El desglose nunca suma más que el total de su tarjeta, pero un recurso puede estar atribuido a un servicio que no es el único donde gasta.

#### 5.1.2. Por Categoría (Business+)

Distribución del costo por categorías FinOps (Cómputo, Storage, Redes, AI, etc.), para responder "¿en qué familia de servicios se me va la factura?" sin recorrer servicio por servicio.

#### 5.1.3. Presupuestos (Professional+)

1. **Crear presupuesto:** nombre, período (mensual/trimestral/anual), límite en $.
2. **Umbral de alerta:** definís en qué % del presupuesto querés ser notificado (ej. 75%).
3. El sistema hace seguimiento automático — ves consumo real vs. presupuesto en tiempo real, con histórico de períodos anteriores.

#### 5.1.4. Grupos de Costos — Cost Groups (Business+)

Agrupación personalizada de costos según tu propia lógica de negocio (por proyecto, línea de negocio, aplicación o ambiente).

1. Creás un grupo con reglas de naming (qué recursos entran, por patrón de nombre o tag).
2. Asignás recursos manualmente si hace falta ajustar.
3. Al hacer clic en un grupo se abre un modal con pestañas: **Costos**, **Acciones**, **Recursos**, **Gobernanza** — cada una con el detalle correspondiente a ese grupo.
4. Comparás grupos entre sí desde la vista de lista. Entre los períodos disponibles está el **Año Fiscal** de tu tenant (5.1.5).

Esta pantalla y su detalle respetan el **alcance de Perspective** de la barra superior (3.4).

#### 5.1.5. Presupuesto por Grupos de Costos (Enterprise)

Definís centros de costo, asignás recursos (manual o en masa) y el sistema prorratea el gasto automáticamente para generar **chargeback interno** por departamento, contra el presupuesto mensual de cada centro.

**Arrastre de presupuesto (rollover).** Un presupuesto puede arrastrar al mes siguiente lo que no se gastó, con un tope. El mes se mide contra la suma del presupuesto base más lo arrastrado, y la tarjeta lo muestra con una insignia y su desglose: *«Presupuesto base X más Y arrastrados de meses anteriores del ejercicio»*. Reglas que conviene saber:

- Un mes en rojo arrastra **cero**, nunca un saldo negativo: un sobregiro puntual no endeuda a los meses siguientes sin que nadie lo decida.
- El tope se aplica **en cada paso**, mes a mes.
- Con el arrastre apagado —el valor por defecto— el tablero es idéntico al de siempre.
- Se enciende por centro de costo desde la tabla: el lápiz de la columna de presupuesto abre el monto **base** junto con **Arrastrar lo no gastado** y su **Tope (USD)** (vacío = sin tope). Lo cambian Admin y Owner. Por API es `PUT /api/intelligence/cost-centers` con `rolloverEnabled` y `rolloverCapUsd`, y un guardado que no los manda conserva lo que había.

**Año fiscal.** Los acumulados anuales —el del Whiteboard, el período *Año Fiscal* de Cost Groups y la proyección— cuentan desde el mes en que empieza el **ejercicio de tu tenant**, que por defecto es enero. Si el tuyo empieza en otro mes (por ejemplo abril), lo elegís en **Configuración → General → Año fiscal** (Admin u Owner), y los tableros lo toman en el momento. Por API es `PUT /api/admin/tenant-settings` con `fiscalYearStartMonth`, de 1 a 12. La proyección anual divide por los días del ejercicio y no por los días desde enero, de modo que no sale baja cuando el ejercicio no es el calendario.

**Bajo un alcance de Perspective** (3.4) el presupuesto **no se recorta**: está definido para el centro entero, y compararlo contra una porción mostraría un margen que no existe. La pantalla lo avisa en vez de dejar la celda vacía.

#### 5.1.6. Gastos y Proyección (Enterprise)

Combina dos herramientas en una página:

- **Histograma de costos:** distribución diaria del gasto, con selector de rango desde el último mes hasta **13 meses atrás** (todo lo que permite consultar Azure Cost Management), cacheado en Redis para respuesta instantánea.
- **Proyección de Gastos:** calculá cuánto vas a gastar a futuro.
  1. El sistema toma el promedio mensual de los últimos 12 meses como base.
  2. Ingresás un **% de crecimiento anual esperado** (podés poner valores negativos para simular un escenario de optimización/ahorro).
  3. Elegís el horizonte: 3, 6, 12 o 24 meses.
  4. El resultado muestra: promedio base, tasa mensual equivalente, y el total proyectado, con un gráfico de línea real vs. proyectado.

Hay una tarjeta resumen de esto mismo en el Dashboard con el link **"Ver detalle completo"**. Las dos tarjetas respetan el alcance de Perspective; la comparación contra el presupuesto no (5.1.5).

#### 5.1.7. Ingesta CSV (Business+)

Importación manual o programada de archivos de costos bajo el estándar **FOCUS** y de exports de Azure: subís el CSV de facturación de terceros y lo analizás junto a tus datos de Azure.

### 5.2. Leaderboard de equipos (`/intelligence/leaderboard`, Enterprise)

**Quién mejoró, no quién gasta menos.** El tablero compara los **grupos de una Perspective** (3.3 y 5.3) y los ordena por mejora, que es el comportamiento que se busca premiar: un ranking por gasto absoluto castigaría al equipo que corre producción y premiaría al chico.

| Columna | Qué muestra |
|---|---|
| **Equipo** | El grupo de la Perspective |
| **Gasto** | Lo gastado en el período |
| **Variación** | Contra el período anterior |
| **Presupuesto usado** | Cuánto del presupuesto consumió |
| **Ahorro capturado** | Remediaciones aprobadas **y ejecutadas** en Azure para ese grupo |
| **Clasificación** | COGS, OpEx o Sin clasificar. Admin y Owner la cambian ahí mismo; para los demás es de sólo lectura |

**Cómo se ordena.** Por la baja porcentual contra el período anterior y, a igual variación, por ahorro capturado. Dos casos quedan **fuera del orden** pero a la vista, con su motivo: un grupo *sin período anterior con el que comparar* (no mejoró ni empeoró) y uno *muy chico para rankear sin que sea ruido* (por debajo del 1% del gasto: uno que pasa de 1 a 0,50 dólares no le gana al que recortó miles). Cada fila tiene **Ver desglose** para llegar al detalle de ese grupo: un ranking que no se puede explicar genera discusión, no optimización.

Tres cosas que aclaran los números:

- **El presupuesto se cruza por nombre.** Un grupo de Perspective y un centro de costo son cosas distintas; si el nombre del grupo coincide con el de un centro de costo, se muestra su presupuesto, y si no, la celda queda vacía en vez de mostrar el de otro equipo.
- **El ahorro capturado sale de lo ejecutado**, no de lo aprobado a secas. Como las remediaciones no guardan etiquetas, en una Perspective definida por etiquetas ese ahorro cae en *sin asignar*.
- **El gasto sin asignar** (ninguna regla lo alcanza) entra en el total, pero no en ningún equipo, y se informa aparte.

**Costo de venta y gasto operativo.** Una tarjeta reparte el gasto en **COGS**, **OpEx** y **Sin clasificar**, y la suma cierra con el total. Cada grupo se clasifica en la columna **Clasificación** de la tabla (COGS, OpEx o Sin clasificar): la eligen Admin y Owner, y el split y el margen se recalculan al instante. Para los demás roles la columna es de sólo lectura. Por API es `PUT /api/intelligence/leaderboard` (`perspectiveId`, `groupName`, `classification`).

**Margen bruto.** Cuando cargás **ingresos**, la tarjeta calcula *ingresos − COGS*. Se mandan con `POST /api/unit-metrics/ingest`, con una API Key pública con el permiso `write:metrics` y `metricType` = `REVENUE` (11.11). Reglas de honestidad del cálculo:

- **Sin ingresos no hay margen**, no un 0%: la tarjeta explica cómo mandarlos.
- **Si hay gasto sin clasificar, el margen es un rango**: junto al mejor caso se muestra el peor (todo lo sin clasificar contado como COGS), porque un COGS subestimado hace que el margen salga mejor de lo que es.
- Un **margen negativo** se muestra tal cual: gastar más de lo que entra es justo lo que esta pantalla existe para mostrar.

Sin Perspectives definidas el tablero lo dice y te lleva a **Definir una**. No lo ven los usuarios con alcance asignado: un ranking compara grupos entre sí y su recorte es precisamente no ver a los demás.

### 5.3. Perspectives (`/intelligence/perspectives`, Enterprise)

Una **Perspective** reparte el gasto por una dimensión de tu negocio —equipos, productos, entornos, centros de costo— sin tocar las etiquetas de Azure. Cada una es un conjunto **ordenado** de reglas que asignan un recurso a un grupo.

Tres propiedades que la hacen auditable:

1. **Un recurso cae en un solo grupo por Perspective**, y decide la **primera regla que coincide**: el orden importa y se edita.
2. **El mismo recurso puede estar en grupos de Perspectives distintas.** El mismo disco puede ser «Producción» en *Entornos* e «Ingeniería» en *Centros de Costo*.
3. **La suma de los grupos más lo *Sin asignar* da exactamente el total del período.** El grupo *Sin asignar* se muestra siempre, con su monto y su porcentaje: una Perspective que cubre el 60% del gasto y no lo dice se leería como si fuera el total.

**Crear una Perspective.**
1. En **Nueva Perspective** escribí el nombre (por ejemplo *Equipos*, *Productos* o *Entornos*) y presioná **Crear**. Nace **sin reglas**, a propósito: con una regla vacía el reparto mostraría un grupo sin nombre y el 100% sin asignar, que se lee como que algo falló.
2. Agregá reglas con **Agregar regla**. Cada regla tiene un **Grupo** (el nombre del equipo, producto o entorno) y un criterio:

   | Tipo de regla | Qué compara |
   |---|---|
   | **Etiqueta** | Clave y valor de una etiqueta del recurso (el valor admite `*`) |
   | **Patrón de nombre** | El nombre del recurso |
   | **Suscripción** | La suscripción de Azure |
   | **Grupo de recursos** | El grupo de recursos |
   | **Tipo de recurso** | El tipo de recurso de Azure |

3. Ordenalas con **Subir** y **Bajar**: gana la primera que coincide.
4. **Ver reparto** calcula, sin guardar nada, cuánto del gasto del período cae en cada grupo y cuánto queda *Sin asignar*, con el porcentaje de cobertura. Cambiar el orden de las reglas cambia el reparto en la vista previa.
5. **Guardar** aplica las reglas.

**Eliminar** una Perspective pide confirmación con su nombre a la vista: se borran también sus reglas, y quien la tenga asignada como alcance deja de tenerlo.

**«Sin asignar» y «Sin datos para evaluar» no son lo mismo.** *Sin asignar* es el gasto al que ninguna regla alcanzó: es lo que te falta etiquetar o regla por escribir. *Sin datos para evaluar* aparece cuando las reglas necesitan un dato que la plataforma todavía no ingiere para esas filas —por ejemplo, reglas por etiqueta sobre un tenant cuya sincronización de costos no trae etiquetas a nivel de recurso—: no es un problema de tu etiquetado. Configurar el **export FOCUS de Azure** completa esas etiquetas.

**Dónde se aplica.** Con una Perspective y un grupo elegidos en la barra superior (3.4), acotan su contenido: Cost Groups y su detalle, Presupuesto por Grupos de Costos y su inventario de recursos, Gastos y Proyección, el Whiteboard, Almacenamiento, el simulador What-If y el export FOCUS (`/api/exports/focus?perspective=&pgroup=`, útil para entregarle a finanzas sólo la porción de un equipo). Cuando una pantalla **no puede acotar** con exactitud, no te muestra una porción dudosa: lo avisa (*«No se pudo acotar por Perspective… los números de abajo son los del tablero completo»*).

**Alcance asignado a una persona.** Un Admin puede dejar a un usuario *acotado* a un grupo (8.2). Para esa persona el recorte no es una preferencia: lo aplica la API, así que cambiar un parámetro en el navegador no le muestra más, y las pantallas que no saben acotar le responden con un acceso denegado en lugar de mostrarle el tablero entero.

En la demo las Perspectives son de ejemplo y no se guardan cambios.

### 5.4. Optimización y Ahorro (`/intelligence/optimizacion-y-ahorro`, Enterprise)

Siete pestañas: **Rightsizing**, **Optimización de Tarifas**, **Beneficios Híbridos**, **Reservas de Instancias (RIs)**, **Saving Plan**, **Costo Cero** e **Índice de Optimización**.

#### 5.4.1. Rightsizing

Analiza 30 días de uso real y recomienda el SKU óptimo; muestra el ahorro estimado antes de aprobar el cambio. Verticales dedicadas en `/intelligence/rightsizing/{vmss,appservice,sqldb,storage}`.

#### 5.4.2. Optimización de Tarifas

Oportunidades de tarifa —planes de ahorro, Spot y descuentos por volumen—, comparando tus tarifas actuales contra benchmarks de mercado para preparar una negociación con Microsoft.

#### 5.4.3. Beneficios Híbridos (AHB)

Muestra qué VMs podrían usar licencias con Software Assurance (Windows Server y SQL Server) y cuánto ahorrarías activándolo; tracking de qué ya lo usa.

#### 5.4.4. Reservas de Instancias (RIs) — Descuentos por Compromiso

Además de cobertura y utilización global, la tabla **Reservas Activas** replica el blade *Reservations* de Azure: Nombre, Estado, Expiración, Alcance, Tipo, Producto, Región, Renovación, Cantidad, y utilización del último día y de los últimos 7 días.

- Clic en el botón de **Renovación** → modal para **activar/deshabilitar la auto-renovación** de esa reserva. El cambio se aplica directamente en Azure — requiere rol Admin/Owner del tenant **y** permisos `Reservations Contributor/Owner` en Azure.
- Clic sobre cualquier **porcentaje de utilización** → modal con detalle de último día / 7 días / 30 días y tendencia diaria.
- Las **reservas huérfanas** —siguen facturando sin consumo real— se marcan con una alerta para que revises si el recurso existe o cancelás la reserva.

Arriba del tablero, tres lecturas de la cartera:

- **Tasa efectiva de ahorro (ESR).** Cuánto ahorrás de verdad contra pagar todo a precio de lista: `(precio de lista − costo efectivo) / precio de lista`, en los últimos 30 días. El costo efectivo **incluye el compromiso que no se usó**, así que comprar de más no mejora el número. Se calcula sólo sobre el gasto que tiene precio de lista, y la pantalla dice sobre qué porcentaje: lo que no se pudo valorizar queda afuera en lugar de contarse como cero descuento. Si el tenant todavía no tiene el **export FOCUS** de costos configurado, no hay precio de lista y el ESR no se dibuja.
- **Vence junto.** Qué parte del valor comprometido vence en el mismo mes o en una ventana de tres meses corridos: si toda la cartera vence a la vez, el gasto vuelve a precio de lista de golpe. Se pondera por **valor**, no por cantidad (diez reservas chicas no pesan como una grande), y avisa cuántas reservas quedaron sin costo o sin fecha para no minimizar el riesgo.
- **Límite anual de devolución (US$ 50.000).** Microsoft limita las cancelaciones y reembolsos de reservas a **US$ 50.000 por año** y por Billing Account, en una ventana móvil de 12 meses. Una barra muestra cuánto del cupo consumiste y cuánto queda, y avisa al pasar el 80%.

**Simulador de punto de equilibrio y mix óptimo.** Elegí el tipo de carga (**Mix General**, **Cómputo Flexible** o **Bases de Datos**) y tu gasto mensual a demanda (PAYG): el simulador calcula en qué mes una reserva de **1 año** (~38% de descuento de referencia) o de **3 años** (~62%) supera a pagar a demanda, cuánto ahorrás por mes después de ese punto, y sugiere un **mix en 3 capas**: Savings Plans para la flexibilidad, reservas para las cargas estables como las bases de datos, y un colchón de pago a demanda (*PAYG elástico*) para absorber los picos.

**Avisos de vencimiento (90, 60 y 30 días).** Cada día la plataforma revisa la fecha de vencimiento de cada reserva activa y avisa cuando una entra en la ventana de **90 días**, de nuevo a los **60** y de nuevo a los **30**: una vez por escalón, aunque el control corra todos los días, y si un día no corre, el aviso sale al siguiente. Llega a la **campanita** de todo el tenant y a los **canales de Notificaciones** que tengas configurados (Slack, Teams, correo o webhook, 8.5), con el nombre, la fecha y si la reserva **se renueva sola**. Es **crítico** cuando una reserva sin renovación automática está a 30 días o menos; una con renovación automática avisa como informativa, porque no deja de cubrir. Si la reserva se renueva o se extiende, la escalera vuelve a empezar con la nueva fecha. Usa la misma lectura que esta tabla: si acá no ves tus reservas —falta el rol *Reservations Reader* (1.3)—, tampoco llegan avisos. No aplica a los tenants conectados por Azure Lighthouse, porque las reservas son de nivel tenant y Lighthouse delega por suscripción.

#### 5.4.5. Saving Plan

Comparador **Savings Plan vs Reserva**: simulá ambas opciones de compra con tus números reales y compará el ahorro a 1 y a 3 años antes de comprometerte. Los Savings Plans for Compute son compromisos flexibles de gasto por hora.

#### 5.4.6. Costo Cero

Inventario de recursos zombis, huérfanos y apagados que generan costos residuales, y qué recursos son gratis en tu suscripción (free tier, créditos) para aprovecharlos al máximo.

#### 5.4.7. Índice de Optimización (COIN)

Indicador consolidado de eficiencia y aprovechamiento del gasto: puntuación 0-100 compuesta, con el porcentaje de adopción de las recomendaciones, el embudo de estados (pendientes, aceptadas, implementadas, pospuestas, descartadas), el desglose por los 5 pilares del Well-Architected Framework y la serie histórica contra el benchmark de excelencia.

### 5.5. Bases de Datos (`/intelligence/bases-de-datos`, Business+)

Visibilidad, métricas y recomendaciones de costo para las bases de datos de Azure. Siete pestañas:

| Pestaña | Qué cubre |
|---|---|
| **CosmosDB** | Consumo de RUs, particionamiento y costos |
| **Azure SQL / Managed Instance** | DTUs, vCores, Elastic Pools y Managed Instances |
| **PostgreSQL** | Costos, IOPS y escalado en Flexible Server |
| **MongoDB** | Clusters Mongo y compatibilidad API en Cosmos DB for MongoDB |
| **Azure Cache for Redis** | Memoria, tasa de aciertos y dimensionamiento; incluye el monitoreo detallado de las 12 métricas críticas de Azure Cache for Redis |
| **MySQL** | Cómputo, almacenamiento y alta disponibilidad en Flexible Server |
| **Microsoft Fabric** | Capacidades F-SKU, almacenamiento OneLake y consumo analítico |

Como en el resto de los cockpits, si Azure no devuelve una métrica la plataforma muestra **«sin dato»** y no un cero: un cero se leería como «ocioso» y llevaría a achicar algo que quizá está trabajando.

**Cosmos DB: telemetría real y optimizador de RU/s.** Cada cuenta se mide con las métricas reales de Azure Monitor (RU normalizada, rendimiento aprovisionado, solicitudes y las limitadas con error 429, almacenamiento, latencia) y el tablero emite tres decisiones, siempre con el ahorro derivado de lo medido y de las tarifas publicadas:

1. **Bajar el RU/s manual** cuando está sobredimensionado: se dimensiona por el **percentil 95 de uso con 25% de margen** —no por el promedio, que deja la base corta en cada pico— y nunca por debajo del mínimo de 400 RU/s.
2. **Migrar a Autoscale** cuando el uso medio es bajo respecto del techo: el umbral (~66%) sale del cociente entre las dos tarifas publicadas, no es un número elegido.
3. **Pasar a Serverless** cuando la cuenta consume poco y de forma intermitente: se decide con las RU realmente consumidas extrapoladas al mes, y el techo de 5.000 RU/s se mide contra el **pico real**, no contra lo aprovisionado.

Además detecta **particiones calientes** (una partición física que concentra el consumo mientras las demás sobran). Esa recomendación va con ahorro **cero** a propósito: repartir mejor la clave evita los errores 429, no baja la factura por sí solo, y poner un número ahí sería inventarlo.

### 5.6. Cómputo (`/intelligence/computo`, Business+)

Eficiencia y costos de las plataformas de cómputo. Nueve pestañas:

| Pestaña | Qué cubre |
|---|---|
| **Eficiencia de Cómputo** (Enterprise) | Costo unitario por core, benchmark regional y optimización de compromisos. En la tabla **Por SKU y Arquitectura**, *vCPU/VM* y *RAM/VM* son la ficha de **una** instancia del SKU, *Instancias* dice cuántas tenés y los ratios *$/Core* y *$/GiB* dividen el costo total por la flota de ese SKU |
| **Kubernetes** (Enterprise) | Clústeres AKS: nodos activos, utilización real vs. sobre-aprovisionamiento, costo de infraestructura y de planos de control, costo por pod, recomendaciones de auto-scaling y **chargeback por namespace** (asignás namespaces a equipos y se calcula cuánto gasta cada uno, para facturación interna) |
| **Estructura de Contenedores** | Azure Container Apps, Registries y Environments: inventario financiero, forecast y rightsizing; costo mensual por app, CPU/memoria y réplicas, y oportunidades de *scale-to-zero* (apps con réplica mínima ≥ 1 que podrían apagarse sin tráfico) |
| **Web Apps & App Services** | Cockpit de App Service Plans y Web Apps con densidad de apps, consolidación y detección de instancias subutilizadas |
| **Function Apps** | Invocaciones, GB-s, auditoría de logs, planes dedicados y flexibles, y playbooks de sampling/downgrade |
| **Azure Virtual Machines** | Costo de cómputo separado del almacenamiento persistente (fugas en VMs desasignadas), AHUB, rightsizing a Serie B, schedules 8x5, descarte de VMs abandonadas y oportunidades de Spot y Savings Plans |
| **Azure Virtual Desktop** | Ver abajo |
| **Virtual Machine Scale Sets** | Elasticidad, políticas de autoescalado y Spot instances |
| **Azure Red Hat OpenShift** | Gobernanza de costos, capacidad de nodos y TCO de clústeres ARO |

**Azure Virtual Desktop.** Inventario de **Host Pools** y sus **Session Hosts** (la VM subyacente y su costo real), con KPIs de host pools, session hosts, sesiones activas, costo de cómputo mensual y costo del **storage de perfiles FSLogix** (detectado por el nombre del recurso: Azure no ofrece un vínculo directo). Por usuario muestra horas de conexión, pico de usuarios simultáneos y **costo por usuario** de los últimos días; además lista los *application groups*, los *workspaces* y las asignaciones de usuarios, y marca el host pool al que nadie llega. Un host pool cuyos grupos de aplicaciones no están publicados en ninguna workspace se marca **INALCANZABLE**: nadie puede conectarse a él aunque siga costando. Las recomendaciones de remediación traen el botón **Ver remediación**.

### 5.7. Almacenamiento (`/intelligence/almacenamiento`, Enterprise)

Visibilidad y optimización de costos de los servicios de almacenamiento. Cuatro pestañas: **Storage Accounts**, **Managed Disk**, **Backups** y **Data Lake Gen2**.

Cada una es un *cockpit* con el mismo esquema: KPIs de costo MTD, forecast de fin de mes, ahorro potencial, variación contra el mes anterior, recursos evaluados, eficiencia, baja utilización y salud operativa; filtros por recurso, tier y grupo de recursos; ordenación y recomendaciones priorizadas.

Además de las pestañas, la **eficiencia de storage** (`/intelligence/storage-efficiency`) simula el ahorro de mover blobs entre tiers Hot/Cool/Archive antes de aplicarlo. Con un alcance de Perspective activo (3.4), el tablero se recorta con el costo que sí puede atribuirse por recurso; si no hay con qué recortar, lo avisa en lugar de mostrar «tu grupo no tiene storage».

### 5.8. Redes (`/intelligence/redes`, Business+)

Análisis de red, conectividad, balanceo y acceso a internet. Ocho pestañas:

| Pestaña | Qué cubre |
|---|---|
| **Análisis de Red** | Desglose por recurso de todos los servicios de red del tenant: ancho de banda, gateways, load balancers e IPs públicas; picos de transferencia e IPs ociosas para dar de baja |
| **Redes Básicas** | Topología, conectividad privada y observabilidad de costos en Virtual Networks, Private Endpoints, DNS, NSGs y tablas de ruteo (UDR) |
| **Conectividad Híbrida** | ExpressRoute, Virtual WAN, VPN Gateways y conexiones: optimización de túneles, arbitraje de ExpressRoute, gateways ociosos y túneles caídos |
| **Balanceo y Publicación** | Application Gateways / WAF, Azure Front Door, Load Balancers y Traffic Manager: balanceadores huérfanos, autoscale y arbitraje de Front Door |
| **Acceso a Internet** | IPs públicas, NAT Gateways, Azure Firewall y DDoS Protection: IPs huérfanas, planes DDoS y rightsizing de firewalls |
| **Tráfico y egress** | Ver abajo |
| **Capacidad de enlaces** | Ver abajo |
| **Protección DDoS** | Planes DDoS IP Protection y Network Protection |

**Tráfico y egress.** A dónde se va la plata de mover datos, que no aparece en el costo de los recursos de red. Clasifica el costo facturado de transferencia en **salida a internet**, **entre zonas de disponibilidad**, **procesado por NAT Gateway**, **entre regiones del continente**, **entre continentes** y **entrada**, con costo y volumen por región y medidor, en una ventana de últimos N días. El costo es el facturado por Azure, no una estimación. Da sugerencias para los dos tráficos evitables: el tráfico **entre zonas** se paga en las dos direcciones y suele venir de réplicas o balanceo repartidos sin necesidad; el **NAT Gateway** cobra por GB procesado y, si el destino es un servicio de Azure, un Private Endpoint o un Service Endpoint lo evita por completo. Una limitación que la pantalla declara: el **volumen es un piso** (las filas sin cargo, como el tramo gratuito de salida, no se ingieren), mientras que el costo sí es el total.

**Capacidad de enlaces.** Compara el ancho de banda **contratado** de cada circuito ExpressRoute y gateway de VPN contra el **P95 de uso real de los últimos 30 días**. Los que usan menos del **15%** de lo contratado se marcan como **sobredimensionados**: se pueden bajar de SKU. La regla que manda es la seguridad: **sin métricas no se recomienda achicar**. Un enlace sin muestras no está ocioso, probablemente falta el permiso de lectura o es nuevo, y bajarle el SKU a uno saturado cortaría el enlace; esos enlaces se cuentan aparte y se avisan arriba de la tabla. El P95 se calcula sobre las muestras horarias (Azure Monitor no ofrece percentiles), y la pantalla muestra la fecha de revisión del catálogo de SKUs.

### 5.9. Usuarios y Licencias (`/intelligence/licenses`, Enterprise)

Tres pestañas: **Dashboard** (KPIs de M365 y Entra ID), **Actividad de Usuarios** (tabla filtrable) y **Optimización de Licencias** (recursos sin Hybrid Benefit vía Resource Graph y métricas por SKU vía Microsoft Graph).

### 5.10. Azure AI (`/intelligence/azure-ai`, Enterprise)

Plataforma de inteligencia artificial de Azure: búsqueda vectorial, procesamiento de documentos, transcripción, visión, moderación, MLOps y analítica distribuida. Nueve pestañas: **Resumen**, **Azure Foundry**, **AI Search**, **Document Intelligence**, **Speech & Language**, **Vision & Video**, **Content Safety**, **Machine Learning** y **Databricks**.

La pestaña **Azure Foundry** es el *AI Cost Analytics*: costo por modelo y consumo de tokens en Microsoft Foundry / Azure OpenAI, con recomendaciones de optimización de llamadas. Para Document Intelligence ver 4.3.1.

### 5.11. Azure Integration Services (`/intelligence/integration-services`, Enterprise)

Operación y costo de integraciones empresariales. Seis pestañas: **Azure Logic Apps** (con la distinción entre conectores Standard y Enterprise y su impacto en costo), **Azure API Management (APIM)**, **Azure Service Bus**, **Azure Event Grid**, **Azure Event Hubs** y **Azure Data Factory (ADF)**.

### 5.12. Monitoreo (`/intelligence/monitoreo`, Enterprise)

Observabilidad y operación de los servicios de monitoreo. Ocho pestañas: **Application Insights**, **Log Analytics Workspace**, **Azure Monitor**, **Microsoft Sentinel**, **Alerts**, **Action Groups**, **Workbooks** y **Network Watcher**.

En **Log Analytics Workspace** controlás costo mensual, retención e ingesta estimada por workspace; detecta ingesta masiva innecesaria (workspaces sin tope diario), retención excesiva y oportunidades de *Commitment Tier*, con ahorro potencial estimado. También se ve como tarjeta en el White Board.

### 5.13. Seguridad (`/intelligence/seguridad`, Enterprise)

Visibilidad y control de costos en los servicios de seguridad. Seis pestañas: **Defender for Cloud** (planes de protección por recurso: Servers, Containers, SQL, Storage), **Microsoft Sentinel** (ingesta de logs y compromisos de capacidad), **Key Vault**, **Entra ID** (licenciamiento P1/P2 e identidades de carga de trabajo), **WAF** y **DDoS Protection**. Un cron de precalentamiento acelera la carga.

### 5.14. Analítica Avanzada (`/intelligence/analitica-avanzada`, Enterprise)

Modelos avanzados de asignación, anomalías, salud y simulación financiera. Siete pestañas:

| Pestaña | Qué hace |
|---|---|
| **Unit Economics** | Definís tu propia métrica unitaria (costo por transacción, por usuario, por MB procesado) y el sistema calcula el costo unitario sobre tus datos de Azure: gasto total del período dividido por el volumen total, no el promedio de los promedios diarios. El volumen de negocio se carga a mano en la configuración de la pantalla o se automatiza desde tu pipeline con el endpoint de ingesta (11.11) |
| **Prorrateo (Allocation)** | Reglas de distribución de costos compartidos entre áreas, centros de costo y equipos (por uso real, proporcional o fijo) |
| **Scorecard (Fama)** | Puntuación 0-100 de tu salud financiera con indicadores individuales (ahorro, cobertura de reserva, eficiencia) y evaluación de madurez en *Inform, Optimize y Operate* (framework FAMA); podés fijar metas |
| **Detección de Anomalías** | Identifica picos o caídas anormales de gasto (Z-Score) y te permite crear alertas ajustando la sensibilidad. Cada anomalía tiene responsable y seguimiento (18) |
| **Salud del Tenant** | Índice integral de salud arquitectónica y de gobernanza: problemas detectados, consistencia de facturación, cobertura de reservas y cumplimiento de políticas |
| **Simulador (What If)** | Ver 5.14.1 |
| **MACC Tracking** | Seguimiento del compromiso mínimo anual (EA/MCA) — consumido vs. comprometido, burn-rate y proyección de cumplimiento |

#### 5.14.1. Simulador What-If

Simulá el impacto de escalar cómputo/storage, variar el tráfico de red o activar Azure Hybrid Benefit sobre tu costo actual, **antes de aplicar el cambio real**.

**Flujo completo:**
1. Movés los sliders: escala de cómputo, escala de storage, % de incremento de tráfico de red, activar/desactivar AHB.
2. Presionás **"Ejecutar Simulación"** — ves el desglose: costo base, costo proyectado, delta y % de cambio.
3. **Guardar el escenario:** botón **"Guardar actual"** → le ponés nombre y notas opcionales. El escenario queda congelado con esos números (no se recalcula después, aunque tu costo base real cambie con el tiempo — así podés comparar escenarios guardados en distintos momentos entre sí de forma consistente).
4. Repetís el proceso 2-3 veces con distintos sliders para tener varios escenarios guardados.
5. **Comparar:** marcás 2 a 4 escenarios con los checkboxes → botón **"Comparar"** → se abre un modal lado a lado con cada escenario como tarjeta, marcando cuál es la línea base.
6. **Exportar:** elegís el formato (CSV, PDF o Markdown) junto a los botones de descarga — podés exportar un escenario individual, todos los guardados, o la comparación completa con el delta de cada uno contra la base.
7. **Borrar:** ícono de tacho en cada fila (solo el creador del escenario o un Admin/Owner pueden borrarlo).

> El mix de cálculo asumido es Azure-first: 60% del costo es cómputo, 25% storage, 15% red; AHB aplica un descuento flat del 18% sobre el total si está activado.

**Con un alcance de Perspective activo**, el gasto base de los últimos 30 días es el de esa porción: «¿qué pasa si mi equipo crece 20%?» se responde sobre el gasto del equipo y no sobre el del tenant. La lista de escenarios guardados sigue siendo la del tenant.

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

### 6.2. Networking Zombies (`/cleanup/zombies/networking`, Professional+; remediación Business+)

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

### 7.8. Alertas Self-Service (`/governance/alerts`, Professional+)

Reglas de alerta financiera que armás vos, sin pedirle nada a soporte, con entrega a Microsoft Teams, Slack, webhooks, correo y ServiceNow. Se crean con un asistente de **3 pasos** (*Configuración de disparo y destino*).

**Cuatro tipos de alerta:**

| Tipo | Se dispara cuando… |
|---|---|
| **Presupuesto (% de consumo)** | el gasto supera un porcentaje del presupuesto |
| **Umbral fijo ($ USD)** | el gasto supera un monto en dólares |
| **Anomalía estadística (+% desvío)** | el gasto se desvía de lo habitual más que el porcentaje elegido |
| **Forecast de cierre de mes (> % EOM)** | la proyección a fin de mes supera el porcentaje elegido |

**Alcance.** Cada regla puede mirar el **tenant completo**, una **suscripción**, un **grupo de recursos** o un **centro de costo** (por etiqueta). La **previsualización de la condición** te muestra en una frase cuándo va a emitirse la alerta (*«cuando el gasto en X supere Y bajo el criterio de Z»*) antes de guardarla.

**Tabla de reglas.** Buscás por nombre, suscripción o canal; filtrás por tipo, canal y estado (activas o pausadas); ordenás por más disparadas, última activación, nombre o umbral. Cada regla se **pausa con un interruptor**, se **edita** sin que se duplique, y tiene **«Probar envío»**, que despacha una notificación de prueba al canal para verificar la entrega antes de depender de él. Las columnas *Última activación* y *Disparos* te dicen si la regla está viva.

Los canales de entrega se configuran en **Configuración → Notificaciones** (8.5).

### 7.9. Fin de soporte (`/governance/lifecycle`, Business+)

**Qué corre sobre una versión que Azure retira, cuándo, y cuánto cuesta hoy.** Quedarse en una versión retirada tiene dos finales y los dos se pagan: una migración de urgencia sin presupuestar, o soporte extendido pago. Verlo con meses de anticipación permite planificarlo.

Cruza el inventario de tu tenant contra el calendario de retiros de Azure. Hoy cubre **AKS** (versión de Kubernetes), **PostgreSQL Flexible Server** y **MySQL Flexible Server**.

**Arriba**, un resumen: *«N recursos en riesgo — $X al mes corriendo sobre algo que Azure retira dentro del año, o que ya retiró»*.

**La tabla** muestra por recurso el producto, la versión, el **estado**, la fecha de **fin de soporte** (*faltan N días* o *venció hace N días*), la fecha de soporte extendido pago cuando existe, y el **costo mensual**. El estado es un semáforo por ventana:

| Estado | Significa |
|---|---|
| **Retirado** | Azure ya retiró esa versión |
| **Menos de 90 días** | Crítico: el retiro es inminente |
| **Menos de un año** | Próximo: hay tiempo para planificar |
| **Soportado** | Con soporte más allá del año |
| **Sin datos** | No se puede afirmar nada |

**La regla que da nombre a la pantalla: ausencia de dato nunca es «soportado».** Un recurso cuya versión no se pudo leer, una versión posterior a la última que conoce el catálogo, o un tipo de recurso que el catálogo no cubre, se marcan **Sin datos**. Lo mismo con el costo: un recurso sin costo atribuible figura como *sin dato* y se informa aparte —no se suma como cero—, porque sumarlo bajaría el total y haría ver el riesgo más chico.

**De dónde salen las fechas.** De la documentación de Microsoft, mantenidas en un catálogo propio —no de una API de Azure—. Por eso la pantalla muestra la **fecha de la última revisión del catálogo**: si quedó vieja, lo dice. Cuando Azure publica el fin de una versión como un mes (por ejemplo «Mar 2026») significa el **último día** de ese mes, y así se carga.

**Qué no cubre todavía:** los servidores lógicos de Azure SQL (su versión es la del servidor, que no se retira; el fin de soporte de SQL vive en el nivel de compatibilidad de cada base), los runtimes de App Service, las series de VM y las licencias en la nube.

Esta pantalla no se muestra a usuarios con alcance asignado: es el inventario de toda la plataforma, no la porción de un equipo.

### 7.10. Shift-Left FinOps (`/governance/shift-left`, Business+)

**El costo se decide cuando alguien escribe el `.tf`, no cuando llega la factura.** Shift-Left lleva el impacto económico de un cambio de infraestructura a la revisión del **Pull Request**, que es donde todavía es barato corregirlo. Funciona sobre Terraform. En el menú está en **Gobernanza → Shift-Left (PRs)**.

**Cómo funciona.** En el pipeline del PR se genera el plan (`terraform plan`), una acción de GitHub lo envía a la plataforma, y la plataforma estima el **delta de costo mensual** con los **precios de lista de Azure**. El resultado vuelve como comentario en el Pull Request (que se edita en cada push, no se acumula) y puede hacer **fallar el check** si el aumento supera un umbral. La acción y su ejemplo de workflow se describen en 11.10, y necesita una API Key con el permiso `write:shift-left`.

**Cómo leer el número.** El delta es un **piso, no un total**: se tarifa lo que la plataforma sabe mapear a un medidor de la Azure Retail Prices API —hoy **máquinas virtuales Linux y Windows, discos administrados e IPs públicas**—; lo demás se cuenta aparte como *sin tarifar* y aparece en el comentario, y si ese número no es cero el costo real es mayor. Son **precios de lista**: no incluyen tus reservas, Savings Plans, descuentos EA/CSP ni markup. Sirve para comparar el antes contra el después de un PR, no reemplaza el costo real que muestra la plataforma.

**Qué ves en la pantalla.**
- Cuatro KPIs: **Planes analizados**, **Aumento detectado**, **Ahorro detectado** y **Bloqueados por umbral**.
- El **historial**: una fila por cada `terraform plan` analizado, con repositorio, autor, costo *antes* y *después*, **delta mensual**, estado del umbral (*Dentro del umbral*, *Umbral superado* o *Sin umbral*) y fecha. Si hay recursos que no se pudieron tarifar, la pantalla avisa que **el delta es un piso, no el total**.

**Budget Gates.** Definís, por repositorio, cuántos USD por mes puede agregar un Pull Request. Si lo supera, el check de GitHub falla. Cómo se combinan los umbrales:

- El `threshold-usd` del workflow, si está, **gana** sobre el de la plataforma: un equipo puede ser más estricto en su propio pipeline, no más laxo.
- Sin ningún umbral el gate queda en *no evaluado*: informa y no bloquea.
- Si la plataforma no responde, **tampoco bloquea**: es un control de costo, y frenar el trabajo de un equipo por una caída nuestra es peor que dejar pasar un cambio caro.
- Sólo un **Admin u Owner** puede cambiar los umbrales.

**Límites actuales.** Sólo Terraform (no Bicep) y sólo GitHub (no Azure DevOps). El umbral es en USD absolutos —no porcentual—, y el desbloqueo de un PR bloqueado se resuelve con los mecanismos del propio repositorio (otro commit, o las reglas de protección de ramas): la plataforma no tiene un flujo de aprobación propio.

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


#### Cola global de soporte (`/superadmin/support`) — sólo equipo CSCloudSolutions

Todos los tickets de todos los tenants en una sola cola, con cuatro indicadores: total, **sin asignar**,
**en riesgo de SLA** y tiempo medio de resolución.

**En riesgo de SLA** cuenta sólo tickets **sin primera respuesta** a los que les queda menos de una
hora. Un ticket ya respondido, o uno que está esperando al cliente, no aparece acá aunque el reloj siga
corriendo: el pendiente no es del equipo. El SLA aplicado es el del **tier del tenant dueño** del
ticket, no un valor único — Professional tiene 24 h y Enterprise 4 h, y la cola los mezcla.

**Tiempo medio de resolución** promedia sólo tickets ya resueltos. Incluir los abiertos daría un número
que baja cuando entra trabajo nuevo, que es lo contrario de lo que mide.

**Filtros:** pastillas de estado con contadores globales (no del filtro aplicado), organización,
prioridad, y asignación (*Mis tickets* / *Sin asignar*). La tabla trae número, tenant, asunto,
categoría, prioridad, responsable, estado, SLA restante y fecha de creación, con columnas
redimensionables y paginado 15/30/45/60.

**Acciones por fila:** *Atender ticket* abre la conversación; *Tomar* te lo asigna (y pasa a "En curso"
si estaba abierto); *Resolver* lo cierra como resuelto. Tomar un ticket asigna **siempre a quien hace
el pedido** — no se puede asignar a otro agente por email desde el cliente. La **prioridad** también
se puede cambiar desde la cola (selector en la fila) o desde el panel de conversación, sin necesidad de
reabrir el ticket.

**Notas internas privadas.** En el panel de conversación, el conmutador *Nota interna privada* deja
contexto para el equipo (diagnóstico, pasos hechos, a quién escalar) que **el cliente no ve**. El filtro
está en el servidor, no en la pantalla: la nota no sale del backend hacia un usuario de tenant. Una nota
interna tampoco mueve el estado del ticket ni cuenta como primera respuesta — el cliente no vio nada, y
el SLA lo refleja.

### 8.2. Usuarios y Accesos (`/admin/access`)

El hub tiene cinco pestañas: **Usuarios y Permisos** (lo que describe esta sección), **Seguridad (2FA)** (sección 10), **SSO SAML** (11.1), **Onboarding de Clientes** (1.2 y 1.3) y **Onboarding Lighthouse** (Enterprise, para delegar el acceso de un cliente sin pedirle credenciales).

Ver sección 2 para el detalle de rol vs. permisos. Desde la pestaña **Usuarios y Permisos** agregás usuarios, editás su rol, ajustás su alcance de módulos o les quitás el acceso. Sólo Admin y Owner del tenant entran a esta pantalla.

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

#### Alcance por equipo: acotar a una persona a su porción del gasto (Enterprise)

Los **permisos de dominio** (sección 2) deciden qué *páginas* ve una persona; el **alcance por equipo** decide qué *porción de los datos* ve. Sirve para que el dueño de un equipo entre a la plataforma y vea sólo el gasto de su grupo de una Perspective (5.3), sin ver el del resto de la organización.

**No es un filtro de pantalla: lo aplica el servidor.** Con un alcance asignado la API le devuelve sólo su porción —cambiar un parámetro en la URL no le muestra más— y los totales y porcentajes de los tableros se calculan sobre esa porción. Las pantallas que todavía no saben acotarse **le niegan el acceso** en lugar de mostrarle el tenant entero: ante la duda, el sistema falla cerrado.

**Cómo se asigna.** Lo hace un Admin u Owner, sólo en un tenant Enterprise, desde **Usuarios y Accesos → Usuarios y Permisos**: la columna **Equipo (datos)** muestra el alcance de cada persona (*Todo el tenant* si no tiene) y el botón **Acotar** abre la elección de **Perspective** y **Grupo** (*todos los grupos* es la Perspective entera, sin lo no asignado). Antes de guardar, el diálogo dice qué pantallas le van a quedar. **Cambiar** reemplaza el alcance y la **✕** lo quita. A un Admin u Owner no se le ofrece.

Por API: `POST /api/admin/user-scopes` (`tenantId`, `email`, `perspectiveId` y `group` opcional), `GET /api/admin/user-scopes?tenantId=…` y `DELETE /api/admin/user-scopes?tenantId=…&email=…`. La respuesta del POST incluye **cuántas pantallas le quedan** (`screensWhenScoped`): asignar a ciegas sería asignar sin saber qué se le está quitando.

**Reglas.**

- **Un alcance por usuario.** Asignarle otro reemplaza el anterior.
- **Sólo Reader y Colaborador.** Un usuario **Admin u Owner no puede tener alcance**: podría emitirse una clave de API —que es del tenant, no suya— y saltearse el recorte.
- Si se elimina la Perspective, el alcance de quien la tenía asignada se elimina con ella.

**Qué ve la persona acotada.** Sólo las pantallas que hoy saben acotarse a un grupo, todas recortadas a su porción: el **Whiteboard**; en **Consumo y Presupuesto**, las pestañas Grupos de Costos, Presupuesto por Grupos de Costos y Gastos y Proyección; en **Analítica Avanzada**, el Scorecard (Fama); y en **Almacenamiento**, la pestaña *Storage Accounts*. El resto le responde con acceso denegado. El menú lateral le muestra sólo esos lugares: cada hub la lleva directo a su primera pestaña permitida y, adentro, las pestañas que no saben acotarse no aparecen. El selector de Perspective queda fijo con candado y las Vistas no se muestran. Es un producto chico a propósito: crece a medida que más tableros aprenden a acotarse.

### 8.3. Configuración (`/admin/config`)

Hub con cinco pestañas:

| Pestaña | Qué hacés ahí |
|---|---|
| **General** | Apariencia (tema claro, oscuro o del sistema), **Año fiscal** (el mes en que empieza el ejercicio, 5.1.5), marca (el logo del tenant) e integraciones: webhook de alertas, ITSM y el feed para Power BI |
| **IA** | Habilitar o deshabilitar funciones de IA, elegir modelo, ajustar la sensibilidad de las detecciones y qué datos se comparten (Professional+) |
| **Notificaciones** | Canales de entrega: Slack, Teams, correo y webhook (8.5) |
| **Estado de Cuenta** | Tus suscripciones de Azure, el estado de la ingesta y el vencimiento de credenciales; desde acá desvinculás y revinculás suscripciones para elegir cuáles se monitorean (19) |
| **Partner Markup (CSP)** | Márgenes configurables por servicio para partners CSP, aplicados automáticamente en la facturación (Enterprise) |

### 8.4. Facturación — Cambio de Plan (`/admin/billing`, Professional+, rol Owner)

**Límites por Plan:**
| Plan | Suscripciones Azure Permitidas | Usuarios por Tenant | Soporte / SLA |
|---|---|---|---|
| **Professional** | Hasta 2 suscripciones | Hasta 3 usuarios | 20 tickets/mes (24 h) |
| **Business** | Hasta 3 suscripciones | Hasta 5 usuarios | Tickets ilimitados (respuesta en 8 h) |
| **Enterprise** | Ilimitadas | Ilimitados | Soporte dedicado, tickets ilimitados (SLA máximo 4 h) |
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

#### 8.4.2. Ampliar capacidad sin cambiar de plan (add-ons)

Si necesitás más suscripciones de Azure o más tenants pero no querés saltar de plan, en **Administración → Facturación** encontrás la tarjeta **Ampliar capacidad**.

Arriba de todo verás cuánto estás usando: *"Estás usando 3 de 3 suscripciones de Azure"*.

**Cómo contratar:**
1. Escribí la cantidad **total** que querés tener (no cuántas agregar). Si ya tenés 2 contratadas y querés 5, escribí `5`.
2. Presioná **Contratar**. Si escribís un número menor al actual, el botón dice **Reducir**.
3. El cambio se prorratea automáticamente en tu próxima factura.

**La capacidad no se habilita al instante:** se activa unos segundos después, cuando la pasarela de pago confirma el cobro. Si no la ves de inmediato, esperá y recargá.

**Precios de lista por unidad** (la tarjeta muestra el precio vigente, el que cobra la pasarela):

| Add-on | Professional | Business |
|---|---|---|
| Suscripción de Azure adicional | $40/mes | $40/mes |
| Tenant adicional | $90/mes | $240/mes |

**Enterprise no usa esta tarjeta:** tu capacidad se ajusta por contrato. Contactá a tu ejecutivo de cuenta.

Si la tarjeta muestra *"La contratación en línea no está disponible"*, es porque tu cuenta no tiene una suscripción de pago activa (por ejemplo, si estás en trial o si tu plan se gestiona comercialmente). En ese caso, escribinos y lo resolvemos.



### 8.5. Configuración de Notificaciones (`/admin/notifications`, Professional+)

Tres canales soportados: **Slack**, **Microsoft Teams**, **Email (SMTP)**. Además de las alertas que configurás, por estos canales llegan avisos automáticos de la plataforma, como el **vencimiento de reservas** a 90, 60 y 30 días (5.4.4).

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

### 8.6. Reportes y Exportación (`/admin/reports`, Professional+)

Hub con siete pestañas:

| Pestaña | Plan | Qué hace |
|---|---|---|
| **Reporte Ejecutivo** | Business+ | Generación automatizada de reportes de alto nivel, pensados para presentar a dirección: resumen ejecutivo descargable en PDF y con envío por correo |
| **Historial de Reportes** | Business+ | Los reportes ejecutivos ya generados, para volver a abrirlos o descargarlos |
| **Reporte de Facturación** | Business+ | Facturas showback/chargeback por cliente o centro de costo (11.4) |
| **Workbooks** | Enterprise | Reportes personalizados: layout propio, gráficos, tablas de datos, exportables a PDF y compartibles por link |
| **Plantillas Power BI** | Enterprise | Plantillas `.pbit` descargables, preconectadas a tus datos del SaaS |
| **Exportación FOCUS 1.1** | Professional+ | Tus datos en el formato estándar FOCUS, programables para generación diaria automática (11.5) |
| **Suscripciones** | Professional+ | Reportes por correo a la cadencia que elijas (abajo) |

#### Suscripciones a reportes

*En una herramienta de FinOps, el reporte que hay que ir a buscar no se mira.* Una suscripción hace que el reporte **llegue solo**, a la cadencia que elija cada quien, con **link al reporte, gráfico y CSV adjunto** de los datos crudos (el CSV es lo que le permite a finanzas cruzarlo con su propio modelo).

**Crear una suscripción** (Admin u Owner, porque manda correo a terceros): **Nueva suscripción** y completá:

| Campo | Qué es |
|---|---|
| **Reporte** | Hoy hay un tipo: **Gasto por equipo** (el desvío del gasto de un grupo) |
| **Frecuencia** | *Todos los días*, *Semanal* (con el día de la semana) o *Mensual* (con el día del mes) |
| **Destinatarios** | Correos separados por coma; hace falta al menos uno |
| **Perspective y Grupo** (opcional) | Para mandar sólo el gasto de un equipo: quien se suscribe a su grupo no recibe el de los demás. Se eligen de la lista de Perspectives del tenant (Enterprise); sin Perspective, el reporte es del tenant entero |

**Qué conviene saber:**

- **La cadencia se evalúa en la zona horaria de tu tenant**: «los lunes» son los lunes de tu organización, no los del servidor.
- **Un día 31 no se saltea los meses cortos**: se manda el último día del mes.
- **Se envía una sola vez por período**, aunque el sistema revise cada hora.
- **Un reporte sin datos no se manda.** Un correo con la tabla vacía se leería como «tu equipo no gastó nada», y casi siempre significa que la ingesta todavía no corrió.
- **Un correo por destinatario**: nadie ve a quién más le llega, y un rebote no afecta al resto.
- **Si quien creó la suscripción deja de estar activo** en el tenant, la suscripción queda **desactivada** y deja de enviar.
- **Mandar una de prueba ahora** usa el mismo camino que el envío programado y **no cuenta** como el envío del período.
- El gráfico va **dentro del cuerpo del correo** (no como imagen adjunta) para que se vea igual en Gmail y en Outlook.

### 8.7. Integraciones y API (`/admin/integrations`, Enterprise)

Hub con tres pestañas: **Copilot M365** (configuración del tenant y chat asistido sobre tus propios datos FinOps), **MCP API Keys** (claves para integraciones con asistentes de IA tipo MCP: generar, rotar y revocar) y **API Pública** (REST documentada con OpenAPI/Swagger, con límites de uso y monitoreo; ver 11.3).

### 8.8. Facturación y Auditoría (`/admin/account`, Professional+)

Dos pestañas: **Facturación** (plan, cuotas, método de pago y cambio de plan; ver 8.4) y **Audit Trail** (el log de quién cambió qué y cuándo; ver 11.2).

### 8.9. Otros módulos de Administración

| Módulo | Dónde está | Plan | Uso |
|---|---|---|---|
| **Azure Lighthouse Onboarding** | Usuarios y Accesos → Onboarding Lighthouse | Enterprise | Plantilla ARM para delegación cross-tenant, en `/admin/onboarding/lighthouse` |
| **Configuración de IA** | Configuración → IA | Professional | Habilitar o deshabilitar funciones de IA, elegir modelo, ajustar la sensibilidad y qué datos se comparten |
| **Reporte de Facturación (Invoicing)** | Reportes y Exportación | Business | Export en JSON/CSV/PBIT stub con detalle por billing profile, invoice section y customer |
| **Workbooks** | Reportes y Exportación | Enterprise | Reportes personalizados exportables a PDF y compartibles por link |
| **Auditoría** | Facturación y Auditoría → Audit Trail | Professional | Log completo de quién cambió qué y cuándo, filtrable por usuario, acción y fecha, exportable para compliance |
| **MCP API Keys** | Integraciones y API | Enterprise | Claves de API para integraciones tipo MCP — generar, rotar y revocar |
| **API Pública** | Integraciones y API | Enterprise | REST API documentada (OpenAPI/Swagger), con rate limits y monitoreo de uso |
| **Plantillas Power BI** | Reportes y Exportación | Enterprise | Plantillas `.pbit` descargables, preconectadas a tus datos del SaaS |
| **FOCUS 1.1 Export** | Reportes y Exportación | Professional | Exportación de tus datos en el formato estándar FOCUS, programable para generación diaria automática |
| **SSO SAML** | Usuarios y Accesos | Enterprise | Configurás tu Identity Provider, mapeás atributos (roles, emails), testeás y activás para toda la organización |
| **Partner Markup (CSP)** | Configuración | Enterprise | Márgenes configurables por servicio para partners CSP, aplicados automáticamente en la facturación |
| **M365 Copilot** | Integraciones y API | Enterprise | Configuración del tenant + chat asistido sobre tus propios datos FinOps |

### 8.10. Marketplace de Add-ons: módulos y capacidades a la carta (`/marketplace`)

Si necesitás una función o un cupo que tu plan no incluye, **no hace falta cambiar de plan**: el Marketplace vende complementos sueltos. Se contratan con **suscripción mensual prorrateada** o con un **pase temporal** de 1, 3, 6, 9 o 12 meses, y se pagan con la misma pasarela (Paddle) que tu plan.

**Qué se vende:**

| Tipo | Qué incluye |
|---|---|
| **Funcionalidades** | *Simulador de Compromisos RIs & Savings Plans*, *Auditoría Avanzada de Zombies & Redes*, *Informes Ejecutivos en PDF* y los **módulos de navegación**: Inventario de Recursos, Bases de Datos, Cómputo, Redes, TTL, Power Schedules, Alta Disponibilidad, Credenciales por Expirar, Aprobaciones, Optimización y Ahorro, Almacenamiento, Usuarios y Licencias, Azure AI, Azure Integration Services, Monitoreo, Seguridad, Analítica Avanzada, Políticas y Auto-Block y Reporte de Gobernanza |
| **Cuotas y cupos** | Suscripción de Azure adicional, asientos de usuario extra (+5) y tenant adicional |

**Cómo se usa:**

1. Filtrá por *Funcionalidades* o *Cuotas y cupos*. Cada tarjeta explica qué desbloquea y muestra el precio vigente.
2. **Pase temporal:** elegí la duración y presioná **Activar Pase**. Se paga una vez y, al vencer, el módulo se deshabilita solo sin tocar tu plan base. Si ya tenés uno activo, aparece **Extender Pase**.
3. **Suscripción mensual:** **Añadir a suscripción mensual** suma el complemento a tu suscripción actual con prorrateo.
4. Arriba, **Tus Capacidades y Pases Activos** muestra lo que tenés y los días que le quedan a cada pase.

Un módulo comprado abre **tanto la pantalla como sus APIs**, y recibís un aviso antes de que venza. La activación ocurre cuando la pasarela confirma el cobro, unos segundos después.

El **tenant adicional** —suma otro tenant de Azure a tu contrato, con tu misma cuenta y accesos, heredando los límites de tu plan— se contrata en **Facturación → Ampliar capacidad** (8.4.2): modifica tu suscripción existente en lugar de abrir una compra aparte, y el Marketplace lo muestra para que lo encuentres.

Los clientes **Enterprise** tienen todo incluido (verán la insignia *Plan Enterprise Activo*). Si tu suscripción se factura por el **Marketplace de Microsoft Azure**, los módulos adicionales no se pueden contratar desde acá: escribinos y lo resolvemos por tu canal de compra.

### 8.11. Operaciones SaaS (SuperAdmin) (`/superadmin/ops`)

Centro de operaciones global para monitoreo del SaaS:

1. Visualizás estado general de la plataforma y alertas sin reconocer.
2. Revisás salud de componentes y ejecución de crons (última corrida, edad, resumen, estado).
3. Verificás cobertura de canales de notificación por tenant SuperAdmin.
4. Podés disparar notificaciones operativas a los canales configurados cuando detectás degradación.

### 8.12. Módulos exclusivos de SuperAdmin

Las pantallas que sólo ve el equipo de CSCloudSolutions (rol de sistema **SuperAdmin**), al final del grupo *Administración* del menú:

| Pantalla | Ruta | Para qué sirve | Dónde se explica |
|---|---|---|---|
| **Gestión de Tenants** | `/superadmin/tenants` | Alta manual de tenants, tier y estado, vendedor, comisión, fecha de venta y plazo, impersonación segura | 1.3 y 14 |
| **Embudo de Registro** | `/superadmin/funnel` | Conversión de inscripciones, pruebas activas y progreso de onboarding | 21 |
| **Soporte (Global)** | `/superadmin/support` | Cola de tickets de todos los tenants | 8.1 |
| **Operaciones SaaS** | `/superadmin/ops` | Estado de componentes y de crons, notificaciones operativas | 8.11 |
| **Alertas Partner Center** | `/superadmin/partner-alerts` | Estados PAL/CPOR por tenant y eventos recientes | 1.3 |
| **Programa de Afiliados** | `/superadmin/affiliates` | Alta de colaboradores, enlaces de referido y panel del partner | 17 |
| **Comisiones** | `/superadmin/comisiones` | Libro mayor de comisiones, comerciales y corridas de pago | 17.6 y 20 |
| **Consumo de Plataforma** | `/superadmin/consumo` | Tokens de IA que absorbe la casa y llamadas a las APIs de Azure | 22 |
| **Unidades de Precio** | `/superadmin/pricing-units` | Normalizador de Units of Measure bajo FOCUS 1.1 | 23 |
| **Prueba de Carga** | `/superadmin/load-test` | Tráfico concurrente real contra el servidor | 24 |
| **IA — Configuración Global** | `/superadmin/ai-global-config` | Proveedor y key de IA de respaldo, interruptor maestro | 25 |
| **Comunicaciones Globales** | `/superadmin/announcements` | Banners y ventanas emergentes para los usuarios | 13 |

El resto de los flujos de plataforma —ciclo de vida de tenants (14), Azure Marketplace (15) y onboarding por Azure Lighthouse (16)— tienen su propia sección.

---

## 9. FinOps Copilot (asistente de IA)

Ícono flotante en la esquina inferior de la pantalla, disponible en Professional+.

- **Conciencia de contexto automática:** el Copilot lee el contenido de la página donde estás — no necesitás decirle en qué módulo estás. Al abrirlo, sin que escribas nada, genera un **reporte ejecutivo** de lo que se está mostrando: contexto del módulo, hallazgos clave, oportunidades de ahorro priorizadas por impacto, riesgos y un plan de acción a 7 días.
- **Preguntas dirigidas:** además del reporte automático podés preguntarle directamente. Ej. en Presupuestos: *"Resumime el estado actual de nuestros presupuestos"*.
- **Sugerencias e información estratégica:** el Copilot provee exclusivamente análisis, recomendaciones de optimización y respuestas informativas para apoyar la toma de decisiones del equipo — no ejecuta acciones correctivas ni modificaciones directas sobre tu infraestructura.

- **Conversación continua:** el Copilot recuerda la conversación aunque cambies de página, así que podés preguntarle *«compará este rightsizing con las anomalías que vimos recién»* y resuelve la referencia a lo hablado en la pantalla anterior. Recuerda las últimas preguntas de la charla (hasta 8 turnos) y, si un turno viejo contradice lo que hoy muestra la pantalla, **mandan las cifras actuales**.
- **Cuota mensual de consultas:** Professional **50**, Business **150** y Enterprise **sin tope**. Si el tenant configura **su propia clave de IA** (*Configuración → IA*), el Copilot no tiene tope de consultas.
- **Nueva conversación:** el botón del encabezado del panel borra el hilo para empezar de cero (se desactiva mientras el Copilot está respondiendo).
- **Lectura cómoda:** la respuesta llega palabra por palabra y el panel la sigue; si subís a releer un reporte, no te arrastra de vuelta al final hasta que hagas una nueva pregunta.

> El Copilot vive dentro de la plataforma: no aparece en las páginas públicas (legales, estado, panel del partner, demo, login y registro) ni antes de iniciar sesión.

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
1. **Admin → API Pública** → generar una nueva key, eligiendo solo los **scopes** que necesitás (`read:cost`, `read:resources`, `read:budgets`, `read:recommendations`, `read:anomalies`, y los de escritura `write:metrics` y `write:shift-left`, que hay que otorgar a propósito: 11.10 y 11.11) — pedí el mínimo necesario, por ejemplo `read:cost` si es solo para alimentar un dashboard de BI.
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

### 11.10. Shift-Left FinOps: API y GitHub Action (Business+)

Qué hace y cómo se lee el resultado: ver 7.10. Acá, la parte técnica.

**El permiso.** El scope **`write:shift-left`** no viene en las claves existentes: hay que otorgarlo explícitamente al generar la key en **Integraciones y API → API Pública** (11.3). Es a propósito: una clave de lectura de costos no debería poder escribir estimaciones.

**La API.** `POST /api/v1/shift-left/estimate`, con la API Key en el header `X-API-Key`. Recibe el plan de Terraform en JSON (la salida de `terraform show -json`, hasta 6 MB) y devuelve el delta de costo mensual, el costo proyectado, la cantidad de recursos sin tarifar y el estado del Budget Gate del repositorio (`OK`, `EXCEEDED` o `NOT_EVALUATED`).

**La GitHub Action** *FinOps PR Cost Estimator* envuelve ese llamado en un paso del workflow del Pull Request:

```yaml
permissions:
  contents: read
  pull-requests: write   # sin esto no puede comentar

steps:
  - uses: actions/checkout@v4
  - uses: hashicorp/setup-terraform@v3
  - run: terraform init
  - run: terraform plan -out=tfplan.bin
  - uses: ./integrations/github-action      # la acción, tal como la tengas en tu repositorio
    with:
      api-key: ${{ secrets.FINOPS_API_KEY }} # siempre por secrets, nunca literal
      plan-file: tfplan.bin
      threshold-usd: '200'                   # opcional: Budget Gate local
```

Entradas: `api-key` (obligatoria), `plan-file` (por defecto `tfplan.bin`), `plan-json` (un plan ya convertido, para no necesitar Terraform en el runner), `threshold-usd`, `comment` y `api-url`. Salidas, para encadenar con otros pasos: `delta-usd`, `projected-usd`, `unpriced` y `gate-status`. Necesita `jq`, `curl` y `bc`, que ya vienen en los runners de GitHub.

### 11.11. Ingesta de métricas de negocio por API (ingresos y volumen)

Para calcular el **costo unitario** (Unit Economics, 5.14) y el **margen bruto** (Leaderboard, 5.2), la plataforma necesita saber cuánto vendiste o procesaste. Se lo mandás desde tu pipeline o un cron con una API Key pública que tenga el scope **`write:metrics`**:

```
curl -X POST https://<host>/api/unit-metrics/ingest \
  -H "x-api-key: pak_..." -H "Content-Type: application/json" \
  -d '[{"metricDate":"2026-08-21","metricType":"TRANSACTIONS","unitCount":14320}]'
```

Hasta **400 filas por llamada**; el tenant sale de la propia key, nunca del cuerpo del request. `metricType` = `REVENUE` carga **ingresos** (en dinero, no un conteo de unidades: no se ofrece como denominador del costo unitario) y habilita el margen bruto.

### 11.12. App móvil (PWA)

La plataforma se puede instalar en el celular como una **aplicación web progresiva** (agregar a la pantalla de inicio) y, en pantallas angostas, ofrece una experiencia móvil dedicada en `/mobile` con cinco pestañas:

| Pestaña | Qué ves |
|---|---|
| **Resumen** | Costo del mes, proyección, ahorro potencial y recursos zombis |
| **Alertas** | Estado de tus reglas de alerta (disparadas, pausadas) y credenciales vencidas o por vencer en 30 días o menos |
| **Aprobar** | Las aprobaciones de remediación pendientes, con el botón **Aprobar** para resolverlas desde el celular |
| **Soporte** | Abrir un ticket con el equipo |
| **Perfil** | Tu cuenta, el idioma y el acceso a la versión de escritorio |

El resumen trae atajos hacia **Alertas** (presupuestos, anomalías y credenciales), **Recomendaciones** (los ahorros sugeridos por Azure Advisor) y **Soporte**. Si preferís la versión de escritorio, la elegís con **Usar versión de escritorio**.

---

## 12. Mejores Prácticas

- **Revisión semanal:** entrá al **Dashboard** y a **Recursos Zombis** al menos una vez por semana para capturar fugas financieras antes de que se acumulen.
- **Automatizá temprano:** activá **Horarios de Apagado** en tus entornos de Desarrollo/Testing como primera medida — es común ver ahorros del 60% en horas de cómputo inactivas sin ningún otro cambio.
- **Exigí cumplimiento de tags:** sin etiquetas consistentes, el módulo de chargeback/showback no puede distribuir la factura mensual de forma justa entre equipos — es la base de todo lo demás.
- **Usá el Simulador What-If antes de comprometerte:** antes de comprar una Reserva o Savings Plan, simulá el escenario y guardalo — te da un número concreto para justificar la decisión ante finanzas.
- **Configurá al menos un canal de notificación** desde el primer día (Slack/Teams si tu equipo ya vive ahí, o email si preferís simplicidad) — las alertas de presupuesto no sirven si nadie las ve a tiempo.

---


## 13. Comunicaciones Globales

**Dónde:** menú lateral → **Comunicaciones Globales** (`/superadmin/announcements`). Sólo visible para SuperAdmin.

Sirve para avisarle algo a los tenants desde adentro de la plataforma: un mantenimiento programado, una incidencia, un cambio de condiciones.

### 13.1 Crear un anuncio

Presioná **Nuevo anuncio** y completá:

| Campo | Notas |
|---|---|
| **Título y mensaje** | El mensaje admite Markdown (negritas, listas, enlaces) |
| **Severidad** | Info / Mantenimiento / Advertencia / Crítico — define el color del banner |
| **Canales** | **Banner** (franja superior), **Popup** (ventana), o ambos |
| **Vigencia** | Desde / hasta. El aviso aparece y desaparece solo dentro de esa ventana |
| **Alcance** | Todos los tenants, o una selección |
| **Enlace de acción** | Opcional. Agrega un "Más información" |

Podés **Guardar borrador** para dejarlo listo sin publicar, o **Publicar** para que entre en vigencia según sus fechas.

### 13.2 Alcance específico

Al destildar *"Todos los tenants"* se abre un buscador con la lista de tenants: podés filtrar por nombre o por ID, y cada uno muestra su estado (ACTIVE, TRIAL, PAST_DUE).

Los tenants **CANCELED no aparecen**: sus usuarios ya no entran, así que dirigirles un aviso no tendría efecto. Los `TRIAL` y `PAST_DUE` sí aparecen — un `PAST_DUE` suele ser exactamente a quien querés avisarle algo.

Si editás un anuncio viejo que apuntaba a un tenant que ya no está en la lista, lo vas a ver marcado **"Fuera de la lista"**. Está a propósito: así podés desmarcarlo en vez de perderlo sin enterarte al guardar.

### 13.3 Traducciones (opcional)

Dentro del formulario hay una sección **Traducciones** plegable, con campos para inglés y portugués.

**No son obligatorias.** Si sólo cargás el español, los usuarios de otros idiomas van a ver el aviso en español. Eso es deliberado: un aviso de caída no debería esperar a que alguien lo traduzca.

Una traducción a medias (sólo título o sólo mensaje) **se descarta al guardar** — mostrar un cuerpo en blanco sería peor que mostrar el texto completo en otro idioma.

La columna **Idiomas** de la tabla te muestra de un vistazo cuáles tiene cargados cada anuncio.

### 13.4 Estados

El estado se calcula solo a partir de las fechas:

| Estado | Significa |
|---|---|
| **Borrador** | Guardado, no publicado |
| **Programado** | Publicado, pero su fecha de inicio todavía no llegó |
| **Activo** | Se está mostrando ahora |
| **Finalizado** | Pasó su fecha de fin |
| **Cancelado** | Dado de baja a mano |

**Cancelar** (icono ⃠) lo saca de circulación de inmediato sin borrarlo. **Eliminar** (🗑) lo borra junto con el registro de descartes; no se puede deshacer.

---

## 14. Ciclo de Vida de Tenants

En **Tenants** hay tres columnas nuevas, ocultas por defecto — activalas desde el selector de columnas:

- **Fecha de Alta** — cuándo se activó efectivamente
- **Fecha de Baja** — cuándo se dio de baja, si aplica
- **Motivo de Baja** — Baja voluntaria / Impago / Contrato vencido / Baja administrativa

Estas fechas ahora se registran automáticamente: cuando llega una cancelación desde la pasarela de pago o el marketplace, cuando un contrato vence, o cuando se suspende una cuenta por impago. Además queda un **historial completo** de cada transición, así que un tenant que se dio de baja y volvió conserva todos sus períodos —lo que hace falta para calcular retención por cohortes.

> **Sobre los tenants anteriores a septiembre 2026:** su "Fecha de Alta" es la fecha de creación del registro, no la del onboarding efectivo ni la del primer pago. Esa distinción no quedó registrada en su momento y no se puede recuperar. Tomalas como aproximadas.

### 14.1 Filtrar y exportar

Arriba de la tabla podés elegir **Altas** o **Bajas** y acotar un rango de fechas. El filtro se suma al buscador, así que podés combinar ambos.

**Exportar CSV** baja exactamente lo que estás viendo —con los filtros aplicados— e incluye una columna de **permanencia en meses** (alta → baja, o alta → hoy si sigue vigente). Está pensado para el informe contable: se abre bien en Excel, con acentos correctos.


## 15. Azure Marketplace

La plataforma se puede vender también por el Marketplace de Azure. El circuito técnico ya está construido; lo que falta para publicar está en `docs/marketplace-publicacion-checklist.md`.

### 15.1 Qué pasa cuando alguien compra

1. Azure lo manda a la landing con un token temporal.
2. La plataforma resuelve ese token contra Microsoft y muestra el plan contratado.
3. El cliente inicia sesión con Entra ID y activa.
4. Microsoft empieza a facturar y nos avisa por webhook de cada cambio: cambio de plan, cantidad, suspensión, reinstalación y baja.

### 15.2 Dos estados que NO son lo mismo

En la ficha del tenant vas a ver dos campos parecidos, y la diferencia importa:

| Campo | Qué es |
|---|---|
| **Estado de Marketplace** | Lo que dice **Microsoft**: Subscribed, Suspended, Unsubscribed |
| **Estado de suscripción** | El estado comercial **nuestro**, que también mueven Paddle y tus acciones desde este panel |

Se mantienen separados a propósito. Si fueran uno solo, una suspensión originada en Azure borraría el motivo real de una baja gestionada por otro canal — y ante un reclamo de facturación no podrías explicar de dónde salió cada estado.

### 15.3 Datos de conciliación

De cada suscripción de Marketplace guardamos la oferta, el correo del comprador y el directorio desde el que compró. **Quien compra no siempre es quien después usa la plataforma**, y esa distinción es la que Microsoft pide para resolver un reclamo.

---

## 16. Onboarding por Azure Lighthouse (Enterprise)

Es la alternativa al script de onboarding: el cliente **delega** el acceso a sus
suscripciones desde su propio directorio, sin darte credenciales ni ejecutar
nada en su entorno. Está en **Usuarios y Accesos → Onboarding Lighthouse**, y
sólo aparece en el plan **Enterprise**.

### 16.1 Cuándo conviene y cuándo no

| Conviene | No conviene |
|---|---|
| El cliente no quiere ejecutar scripts en su entorno | Necesitás leer secretos de su Key Vault o blobs de su storage |
| El cliente quiere poder revocar el acceso cuando quiera | El cliente maneja el gasto por management group |
| No querés administrar un secreto por cliente | El cliente sólo tiene una suscripción y ya corrió el script |

Lighthouse delega **sólo plano de control**. No hay acceso al plano de datos del
cliente, y sus management groups no se delegan — la delegación es por
suscripción.

### 16.2 El procedimiento

1. **Completá los dos campos.** *Managed Tenant ID* es el GUID del directorio
   del cliente; *Managed Subscription ID* es el de una de sus suscripciones.
2. **Elegí los roles.** Para un alta de sólo visibilidad alcanzan **Lector** y
   **Lector de Gestión de Costos**. *Colaborador* otorga escritura sobre todos
   los recursos de la suscripción: pedilo únicamente si vas a operar la
   infraestructura del cliente.
3. **Generá la plantilla ARM** y descargala o copiala.
4. **El cliente la despliega** en el portal de Azure, dentro de **su propio
   directorio**: *Implementar una plantilla personalizada → Generar mi propia
   plantilla → pegar el JSON*. Necesita ser Propietario de esa suscripción.
5. **Verificá la delegación** con el botón del panel.

### 16.3 El paso 5 no es opcional

Generar la plantilla y que el cliente la despliegue son dos cosas distintas. La
fila queda en **"Pendiente de aceptación — Sin confirmar en Azure"** hasta que
verifiques, y hasta ese momento la plataforma **sigue accediendo con el modelo
anterior**: la delegación existe en Azure y no se usa.

**Verificar delegación** le pregunta a Azure y es lo único que cambia el modo de
acceso del tenant. Si dice activa, mostrá los tableros de costos del cliente
para confirmar que llegan datos.

### 16.4 Un cliente con varias suscripciones

**No hace falta generar una plantilla por suscripción.** La misma delega
*aquella donde se la despliega*, así que el cliente la aplica una vez en cada
una, cambiando de contexto entre cada aplicación.

> El campo *Managed Subscription ID* **no dirige la plantilla**: sólo alimenta el
> registro. Si el cliente la despliega en otra suscripción, se delega esa otra.
> Es lo que permite reutilizarla, pero conviene saberlo.

Las suscripciones delegadas aparecen solas en el próximo ciclo de
sincronización; no hay que registrarlas a mano.

### 16.5 Las dos filas y el botón Eliminar

Después de una delegación activa vas a ver **dos** entradas para la misma
suscripción: una que reporta Azure y otra que es el registro nuestro. Es
esperado.

**Eliminar** da de baja **nuestro registro**, no la delegación. El
`registrationAssignment` vive en la suscripción del cliente y sólo se quita desde
su directorio. Si borrás una que seguía activa, el aviso te lo dice: el cliente
sigue delegando acceso que la plataforma ya no registra.

Sobre las filas que reporta Azure, el botón las rechaza con el motivo — no son
registros nuestros.

> Si dás de baja la **última** delegación de un tenant, vuelve automáticamente al
> modelo de App Registration. Es a propósito: sin ninguna delegación detrás, un
> tenant en modo Lighthouse se queda sin ninguna vía de acceso a Azure.

### 16.6 Si algo no funciona

| Mensaje | Qué pasa |
|---|---|
| *"Falta configurar AZURE_LIGHTHOUSE_PRINCIPAL_ID"* | Configuración de plataforma incompleta. Sin eso la plantilla se desplegaría en verde y no otorgaría acceso a nadie: por eso se bloquea antes. Escalá a infraestructura. |
| *"No permite delegar una suscripción al directorio al que ya pertenece"* | El *Managed Tenant ID* es el nuestro. Lighthouse existe para que el directorio del **cliente** delegue en el nuestro. |
| *"Disponible sólo en el plan Enterprise"* | El tenant no es Enterprise. En Professional y Business el alta se hace con el script. |
| Delegación activa pero sin datos | Revisá los roles delegados: sin *Lector de Gestión de Costos* no llega consumo. |

## 17. Programa de Afiliados

**Ruta:** `/superadmin/affiliates` · **Menú:** Administración → Programa de Afiliados

Un afiliado es un tercero —comercial, influencer, partner— que promociona la
plataforma con un link propio y cobra un porcentaje de lo que paguen los
clientes que trajo.

El afiliado **no es usuario de ningún tenant** y no tiene cuenta en la
plataforma: entra a un panel propio de sólo lectura, con un enlace personal que
le generás vos (17.5). Ahí ve sus clientes referidos y sus comisiones, y nada
más — ni el gasto cloud de los clientes que trajo, ni datos de otros afiliados.

> **Quién hace qué, de un vistazo**
>
> | Vos, acá | El partner, por su cuenta |
> |---|---|
> | Lo das de alta y fijás su % | Comparte su link de referido |
> | Le generás el enlace de su panel | Entra al panel a ver sus números |
> | Armás la corrida y transferís (17.6) | Te factura, si corresponde |

### 17.1 Dar de alta un colaborador

1. **Nuevo afiliado**.
2. Completá nombre, email y **código de referido**. El código va en la URL, así
   que admite letras, números, guiones y guiones bajos, y arranca con letra o
   número. Tiene que ser único.
3. **Comisión (%)** — 15 % por defecto, el del programa estándar de Referido. Es el
   porcentaje que se aplica a cada cobro de los clientes de ese afiliado. La co-venta
   (20 %) no va acá: se da de alta como comercial (sección 20). Los afiliados dados de
   alta antes del 2026-10-04 nacieron con 20 % y lo conservan; si alguno debía ser 15 %,
   se corrige con **Editar**, que no reescribe las comisiones ya devengadas.
4. *Medio de pago* y *Referencia de pago* son texto libre para quien liquida
   (transferencia, PayPal, alias). No se guardan datos bancarios estructurados.
5. **Guardar**.

Si el email o el código ya existen, el alta se rechaza con un aviso: son únicos
a propósito, para que dos afiliados no se peleen la misma atribución.

### 17.2 El link de referido

**Copiar** en la fila del afiliado deja en el portapapeles:

```
https://finops.cscloudsolutions.com.ar/signup?ref=CODIGO
```

Cuando alguien entra por ese link, el código queda guardado en su navegador por
**60 días**. Si en esa ventana se da de alta, el cliente queda atribuido a ese
afiliado.

Tres reglas que conviene saber para responder preguntas:

- **Primer toque gana.** Un cliente pertenece a un solo afiliado y no se
  reasigna. Si entró por el link de A y después por el de B, el cliente es de A.
- **No hay auto-referidos.** Si el email del afiliado es el de un usuario del
  cliente, la atribución se rechaza.
- La atribución por link ocurre **en el alta del cliente**. Un cliente que ya
  existía antes no se atribuye por entrar más tarde a un link: para ese caso
  está la atribución manual.

**Atribuir un cliente a mano.** Para el cliente que trajo un afiliado y se
registró sin el link, el botón **Atribuir tenant** (persona con un +) de la
fila del afiliado abre un selector con los tenants. Valen las mismas reglas que
en el alta: el afiliado tiene que estar activo, el tenant no puede tener ya otro
afiliado y no hay auto-referidos. No es retroactiva y no reinicia la ventana:
devenga desde el próximo cobro, pero los 12 meses se cuentan desde el primer
pago del cliente, así que uno que ya paga hace más de un año queda atribuido
sin generar comisión. Queda registrado qué superadmin hizo la atribución.

### 17.3 Editar, suspender y eliminar

El botón del lápiz abre el mismo formulario del alta, precargado. Se puede
cambiar nombre, email, código, porcentaje, estado y los datos de pago.

Dos cosas que conviene entender antes de tocar:

- **Cambiar el porcentaje no reescribe el histórico.** Cada comisión guarda su
  propia foto del porcentaje vigente cuando se devengó. Lo nuevo aplica desde el
  próximo cobro.
- **Cambiar el código rompe los links ya compartidos.** La cookie del visitante
  guarda el código, no el afiliado, así que quien entre por el anterior queda
  sin atribuir. El formulario avisa cuando estás cambiándolo.

**Suspender** es lo que hay que usar para dejar de operar con alguien: corta el
devengo de comisiones nuevas y conserva todo el historial. El afiliado sigue en
la lista, en gris, con sus números intactos. **Reactivar** lo devuelve a normal.

**Eliminar** sólo funciona si el afiliado **no tiene ninguna comisión**. Si
tiene, aunque sea una y aunque esté pendiente, la plataforma se niega y te dice
cuántas hay. No es una restricción arbitraria: por cómo está armada la base,
borrar al afiliado se llevaría su historial de comisiones —incluidas las que ya
le pagaste— y ese registro no se puede reconstruir. Para eso está *Suspender*.

Si el afiliado tiene clientes referidos pero todavía ninguna comisión, se puede
eliminar; el aviso de confirmación te dice cuántos clientes quedan sin atribuir,
y eso no se puede deshacer.

### 17.4 Comisiones y liquidación

La tabla **Comisiones devengadas** se llena sola: cada vez que un cliente
atribuido paga, se registra una comisión.

**Durante el primer año de cada cliente, y no más.** La ventana son 12 meses
corridos desde el primer cobro de ese cliente: un cliente mensual devenga sus
doce cobros, y a uno anual le entra el cobro inicial y le queda afuera la
renovación del año siguiente. Se mide en meses y no en cantidad de cobros
justamente por eso — "hasta 12 cobros" le daría doce años al cliente anual.

En el panel del partner cada cliente muestra su fecha de corte, así que la
pregunta "¿hasta cuándo cobro por este cliente?" se responde sola.

| Estado | Qué significa |
|---|---|
| **Pendiente** | Devengada. Recién cobrada al cliente; conviene esperar la ventana de reembolsos antes de aprobarla. |
| **Aprobada** | Revisada y lista para pagar. |
| **Pagada** | Ya liquidada al afiliado. |
| **Revertida** | El cliente pidió reembolso y la comisión se anuló automáticamente. |
| **Cancelada** | Anulada a mano. |

Para liquidar: tildá las filas, **Aprobar**, y cuando salga la transferencia,
**Marcar pagada**.

> Una comisión **Pagada** no se puede volver atrás desde la interfaz, ni la
> revierte un reembolso posterior. Si hay que corregirla, se descuenta de la
> liquidación siguiente: es una operación contable, no un click.

Las columnas **Por liquidar** y **Pagado** de la tabla de colaboradores son la
suma en la moneda del último cobro. Si un mismo afiliado tiene clientes que
pagan en monedas distintas, esos totales no son comparables — revisá el detalle
por comisión.

### 17.5 El panel del partner

El botón del **tablero** en la fila del afiliado genera su enlace personal:

```
https://finops.cscloudsolutions.com.ar/partner#k=afp_live_...
```

El enlace **no lleva idioma**: al abrirlo, la plataforma elige el del navegador del
partner (español, inglés o portugués) y redirige conservando el token. En el panel
hay un **selector de idioma** arriba a la derecha, que también lo conserva.

**Se muestra una sola vez.** En la base queda únicamente su hash, así que no hay
forma de volver a verlo: si lo perdés, generás otro — y eso invalida el
anterior. Es el mismo trato que las claves de API.

Qué ve el partner ahí: sus totales (por cobrar y ya cobrado), su link de
referido, sus clientes referidos con la fecha hasta la que comisiona cada uno, y
el detalle de sus comisiones con el estado de cada una. Desde el mismo panel descarga el
**Manual del partner** (PDF o Markdown, en español, inglés y portugués): el material para
entender la plataforma y venderla.

Qué **no** ve, y conviene saberlo para responder: el gasto cloud de los clientes
que trajo, sus identificadores de Azure, ni nada de otros afiliados. Sólo el
nombre de la empresa, las fechas y los montos de su propia comisión.

El botón del **enlace cortado** revoca el acceso sin tocar al afiliado ni a sus
comisiones. Y **suspender** a un afiliado también le cierra el panel: no hace
falta revocar además.

> El enlace **es** la credencial: quien lo tenga ve esos números. Mandáselo por
> un canal directo a la persona, no lo pegues en un grupo.

### 17.6 Corridas de pago

**Ruta:** `/superadmin/comisiones`

Una corrida agrupa en un lote todo lo exigible de **una moneda**, por
beneficiario, y es lo que ata la transferencia a las comisiones que cubrió.
Afiliados y comerciales van juntos: están en el mismo libro.

El circuito del mes:

1. **Elegís moneda y piso por persona** y armás la corrida. El piso se aplica al
   **total de cada beneficiario**, no a cada comisión: doce comisiones de $0,30
   son $3,60, que puede valer una transferencia aunque ninguna de las doce la
   valga sola. Quien no llega al piso queda afuera y su saldo se arrastra a la
   corrida siguiente.
2. **Descargás la orden de pago** (CSV). Trae una fila por persona con el monto,
   el email, el medio de pago y los datos de cobro: es lo que necesitás para
   transferir, sin ir a buscar la ficha de cada uno.
3. **Transferís**, por el medio que hayas acordado con cada uno.
4. **Confirmás el pago** con el comprobante. Recién ahí las comisiones de esa
   corrida pasan a *Pagada*, todas juntas y con la misma referencia.

**Cancelar** una corrida abierta libera sus comisiones para la siguiente. Una
corrida ya pagada no se cancela: la plata salió, y eso se corrige con un ajuste.

Tres cosas que evitan sustos:

- **Una moneda por corrida.** No se puede transferir en dos monedas a la vez, y
  la plataforma no inventa un tipo de cambio.
- **Dos corridas no se pisan.** Las comisiones que entraron a una quedan
  reservadas; otra corrida armada en paralelo no se las lleva.
- **Confirmar dos veces no hace nada.** Es seguro reintentar si se cortó la
  conexión.

El piso que usaste queda guardado en la corrida. Cambiar el default el mes que
viene no reescribe por qué una corrida vieja dejó a alguien afuera.

---

## 18. Anomalías de gasto: quién las atiende

Cuando la plataforma detecta un gasto fuera de lo normal, ya no se queda en el aviso.

### 18.1 El responsable

Cada anomalía muestra **quién es el responsable** y de dónde salió esa asignación. La plataforma la deduce de tu propio modelo de gobernanza, en este orden:

1. Si el Resource Group está asignado a mano a un Cost Group, gana el dueño de ese grupo.
2. Si coincide con la regla de patrón de un Cost Group.
3. Si lleva la etiqueta que define a ese grupo.
4. Si el recurso tiene la etiqueta `Owner` con un correo.

**Si no hay forma de deducirlo, verás "Sin asignar"** — y es a propósito. Preferimos decirte que falta un dueño antes que asignárselo a alguien que no corresponde: esa persona aprendería a ignorar las alertas. Ese "sin asignar" es, en la práctica, la lista de lo que te falta etiquetar.

> Se recalcula en cada análisis. Si asignás el Resource Group a un Cost Group **después** de que saltó el desvío, la anomalía encuentra dueño sola.

### 18.2 El seguimiento

Cada anomalía tiene un estado que **queda guardado**, con quién lo cambió y cuándo:

| Estado | Cuándo usarlo |
|---|---|
| **Nueva** | Todavía nadie la miró |
| **En investigación** | Alguien la tomó y la está viendo |
| **Resuelta** | Se actuó y el gasto se corrigió |
| **Falso positivo** | La detección se equivocó |

Ese último estado no es lo mismo que "descartada": nos sirve como devolución para afinar la detección.

Los cambios los ve todo tu equipo, así que dos personas no trabajan sobre lo mismo sin saberlo.

### 18.3 El aviso

Si la anomalía tiene responsable, la notificación **le llega a esa persona**. Si no lo tiene, le llega a todo el equipo — un desvío sin dueño igual tiene que verlo alguien.

---

## 19. Suscripciones fuera del tope de tu plan

En **Configuración → Estado de Cuenta** (antes «Cuentas Cloud») se listan **todas** las suscripciones de
Azure que la plataforma descubre. Si tenés más de las que tu plan permite
(Professional 2, Business 3, Enterprise sin límite), las que quedan afuera
aparecen **atenuadas** y con el distintivo ámbar **"Fuera del plan"**.

Esa marca significa algo concreto: **esa suscripción se ve en esta tabla y no
alimenta ningún tablero**. Su gasto no entra en los totales, sus recursos no
aparecen en el inventario, y sus anomalías no se detectan.

### 19.1 Cómo elegir cuáles se monitorean

La plataforma no puede saber cuáles te importan, así que toma las primeras por
orden de identificador — un criterio estable pero arbitrario. Tenés dos formas
de decidirlo vos:

- **Desvincular las que no te interesan.** El botón *Desvincular* de cada fila
  saca una suscripción del cómputo y **libera el cupo** para otra. Pide que
  escribas el identificador para confirmar, porque la acción afecta a todos los
  tableros del tenant.
- **Ampliar la cuota.** El botón *Aumentar Cuota* del banner suma suscripciones
  sin cambiar de plan. Lo que compres se conserva incluso si después cambiás de
  tier.

### 19.2 Volver a vincular

Una suscripción desvinculada no desaparece: queda al final de la lista,
atenuada, con el distintivo **"Desvinculada"** y un botón **Revincular**.

A diferencia de desvincular, revincular **no pide confirmación**: no destruye
nada — sólo quita la exclusión — y volver a desvincular está a un click.

> Revincular no requiere repetir el onboarding ni volver a correr ningún script.
> El gasto histórico de una suscripción desvinculada **se conserva**: el de meses
> cerrados es información contable y no se borra nunca.

> Si estás en el tope del plan, revincular devuelve la suscripción a esta tabla
> pero los tableros la siguen dejando afuera, igual que a cualquier otra por
> encima del límite. Primero hacé lugar.

### 19.3 Agregar una suscripción nueva en Azure

**No hace falta rehacer el onboarding.** El script asigna los roles de lectura
en el management group raíz de tu directorio, y Azure los hereda hacia abajo:
una suscripción creada después ya nace con permiso. Aparece sola con
**Sincronizar ahora**.

El único paso manual es si querés **accionarla** —apagar VMs, horarios de
encendido/apagado, right-sizing—: el rol de remediación se asigna por
suscripción y no se hereda. Portal de Azure → la suscripción → Control de acceso
(IAM) → Agregar asignación de rol, sobre el mismo Service Principal.

> Si después de sincronizar la suscripción nueva **no** aparece, la asignación en
> el management group raíz no llegó a hacerse cuando se corrió el onboarding.
> En ese caso hay que asignarle los roles de lectura en esa suscripción.

---

## 20. Comisiones comerciales

**Ruta:** `/superadmin/comisiones` · **Menú:** Administración → Comisiones

Un **comercial** es quien **cierra la venta** de un tenant. No es lo mismo que un afiliado (17), que sólo trae al cliente con su enlace: el comercial cobra un porcentaje de lo que paga el cliente que vendió, con un calendario de devengo propio. Las comisiones de comerciales y de afiliados viven en el **mismo libro mayor** y se liquidan juntas en las corridas de pago (17.6).

> **Quién hace qué, de un vistazo**
>
> | Vos, acá | El sistema, solo |
> |---|---|
> | Das de alta al comercial y cargás la venta en el tenant | Devenga la comisión en cada cobro que corresponde |
> | Atribuís la venta al comercial | Calcula el monto con la foto del porcentaje de ese momento |
> | Armás la corrida y confirmás el pago | Anula la comisión si el cliente pide reembolso antes de pagarla |

### 20.1 Dar de alta a un comercial

En la tarjeta **Alta de comercial** completá nombre y apellido, email y el **porcentaje de comisión** (20% es el porcentaje por defecto del acuerdo) y presioná **Crear comercial**. La lista muestra cuántas ventas tiene cada uno.

### 20.2 Registrar la venta en el tenant

Una comisión **no se devenga sin tres datos del tenant**, que se ven como columnas en **Gestión de Tenants** (`/superadmin/tenants`):

- **Vendedor** y **Comisión (%)**, editables. Si una venta se cerró con una condición distinta a la general, el porcentaje del acuerdo manda sobre el del comercial.
- **Fecha de venta:** desde dónde se devenga. Para los tenants cargados antes de esta función figura *sin registrar* (en ámbar): **no se inventa una fecha retroactiva**, porque una comisión calculada sobre una fecha adivinada es peor que no calcularla. Una vez registrada **no se corrige desde esta pantalla**: moverla correría el inicio del devengo y recalcularía comisiones ya liquidadas.
- **Plazo del contrato:** *anual* o *mensual*. Decide qué calendario aplica.

Con eso cargado, en la tarjeta **Atribuir una venta** escribís el **ID del tenant**, elegís al comercial y presionás **Atribuir**. Sin fecha de venta no se devenga nada.

### 20.3 Cuánto y cuándo cobra

La comisión de referencia es el **20% del valor anual de la venta**. De ahí salen las dos modalidades:

| Contrato | Cómo se devenga |
|---|---|
| **Anual** | Una sola cuota: el 20% del cobro anual, **exigible a partir del 2.º mes** de la venta (el período de retención). La renovación del año siguiente **no** vuelve a pagarla. |
| **Mensual** | Una cuota por mes de **1/12 del 20% anual**, que equivale al **20% de cada cobro mensual** (el valor anual es el cobro × 12). El **mes 1 no se liquida** (gracia de onboarding) y vence junto con el mes 2: tras el segundo cobro se liquidan las dos primeras cuotas. **Del mes 3 en adelante** cada cobro exitoso devenga su cuota y es exigible en el acto, hasta completar **12 cuotas**: el mes 13 no devenga nada. |

Reglas que conviene saber para responder preguntas:

- **Si el cliente se da de baja, se cancelan las cuotas que todavía no eran exigibles.** Cancelar antes del mes 2 no liquida nada; cancelar en el mes 4 detiene las cuotas futuras, y lo que ya era exigible o estaba pagado **no se toca**: descontarle a alguien una comisión que ya se ganó es una decisión contable, no un efecto automático.
- **Un reembolso anula la comisión** mientras no esté pagada. Si ya se pagó, se descuenta de la liquidación siguiente (17.4).
- **No devenga** si el tenant no tiene acuerdo comercial (venta directa o autoservicio, que es lo normal), si no tiene comercial asignado, si el comercial no está activo o si la venta no tiene fecha. No son errores: son ventas sin comercial.
- **Los meses no desbordan:** una venta del 31 de enero vence un mes después el 28 o 29 de febrero, no el 2 o el 3 de marzo.
- Los importes se calculan con precisión decimal; son montos que se le pagan a una persona.

### 20.4 El libro mayor

La tabla **Libro mayor** muestra cada movimiento con tenant (cliente), cuota, comisión, estado y fecha de vencimiento; se filtra por tipo de beneficiario (*Afiliado* o *Comercial*) y por estado. El resumen **Cuánto se le debe a cada uno** separa lo **Exigible**, lo que está **En retención** y lo **Pagado**. Los estados son los de 17.4. **Marcar como pagado** y la **orden de pago en CSV** funcionan igual que para los afiliados, y la forma recomendada de pagar es la **corrida de pago** (17.6).

`DUE` (exigible) no depende de un cron: se calcula al abrir el panel a partir de la fecha de vencimiento de cada comisión.

---

## 21. Embudo de registro

**Ruta:** `/superadmin/funnel` · **Menú:** Administración → Embudo de Registro

Cómo convierten las inscripciones de autoservicio, y en qué punto del onboarding se traba cada cliente nuevo.

**Los indicadores de arriba:** **Inscripciones (30d)**, **Pruebas Activas**, **Convertido** (clientes que pasaron a plan pago), **Tasa de Conversión** y **Tasa de Rotación (Churn)**.

**Embudo de Conversión.** El gráfico muestra cuántas inscripciones llegan a cada etapa, de la inscripción a la conversión. Es la lectura para saber si el problema está arriba (poca gente se inscribe) o en el medio (se inscriben y no activan).

**Inscripciones Recientes** (últimos 90 días). Una tabla con el correo, el tenant, el **plan asignado** y el **estado** (*Activo*, *Expirado* o *Convertido*). Se filtra por correo, plan y estado, y se pagina.

**Ver Onboarding.** El botón de cada fila abre el **detalle de progresión** de ese cliente, con la fecha de registro y los tres **hitos de activación cloud**:

1. **Registro de Aplicación en Microsoft Entra ID** — la App Registration del cliente ya existe.
2. **Permisos de Lector / Reader en Suscripciones Azure** — el Service Principal ya puede leer sus suscripciones.
3. **Primer Reporte FinOps y Telemetría de Costos Generada** — la plataforma ya trajo costos y mostró el primer resultado.

**Cómo usarlo.** Un cliente que se registró pero no pasó del hito 1 probablemente no completó el onboarding de Azure (1.3); uno que llegó al hito 2 y no al 3 tiene el permiso pero no completó la primera sincronización, o le faltan los roles de costos. Es la lista de a quién escribirle antes de que se le termine la prueba de 7 días.

La prueba gratuita de 7 días se activa al pasar por el checkout (11.8). El estado de cada tenant lo mueven el webhook de la pasarela de pagos (la conversión a plan pago) y un cron diario (el vencimiento de la prueba); ver también 14.

## 22. Consumo de plataforma

**Ruta:** `/superadmin/consumo` · **Menú:** Administración → Consumo de Plataforma

**Lo que cuesta operar:** los tokens de IA que absorbe la casa y las llamadas a las APIs de Azure. Es un panel para vigilar y contener costos, no una base de facturación.

### 22.1 Consumo de IA

Muestra el período (últimos N días u horas) y separa quién paga:

- **Tokens que absorbe la plataforma** (`source = platform`): los paga la casa. **Hoy no se le facturan al cliente**: es un costo operativo a vigilar.
- **Tokens con clave del cliente** (`source = byok`): el tenant usa su propia API key, así que los paga él y no hay nada que cobrar.

El detalle se ve **por tenant** (llamadas, tokens de entrada y de salida) y **por función y modelo**. Los tenants de demostración figuran con una insignia **demo**: sus tokens son reales —el Copilot y el reporte ejecutivo llaman al proveedor aunque el tenant sea sintético— y los paga la casa, pero no son de ningún cliente.

Si el costo se dispara por un incidente con el proveedor, el **interruptor maestro** de IA (25) apaga la IA para todos los tenants.

### 22.2 Llamadas a APIs de Azure

Cuenta las llamadas en el limitador por el que pasan todas las consultas a Azure. **El porcentaje de throttling es el número accionable**: unos 429 sueltos no dicen nada sin saber sobre cuántas llamadas fueron. La tabla trae, por servicio, las llamadas, las **frenadas (429)**, el **% frenado** y el **tiempo esperando**.

**Por tenant.** El límite de Cost Management es **por suscripción y se comparte**: un solo cliente con muchas suscripciones puede frenar al resto. Esta vista muestra quién consume la cuota.

Si aparece *«Todavía no hay llamadas registradas»*, es normal tras un deploy: la telemetría arranca con el primer barrido posterior.

## 23. Unidades de precio

**Ruta:** `/superadmin/pricing-units` · **Menú:** Administración → Unidades de Precio

El **Normalizador de Unidades de Precio** es una tabla curada de las *Units of Measure* de Azure Billing (Hours, GB, Transactions, Tokens, etc.) que se usa para **normalizar agregados** bajo la especificación **FOCUS 1.1**: sin ella, «100 Hours» y «1M Tokens» no se pueden comparar ni sumar con criterio.

- **Catálogo** (con su cantidad de UoMs): se busca por UoM, unidad base o categoría, y se pagina.
- **Probar normalización:** una caja de prueba en vivo: escribís una Unit of Measure (por ejemplo `100 Hours` o `1M Tokens`) y una cantidad, y ves cómo se normaliza.
- **Editar regla:** el lápiz de cada fila abre *Editar Regla de Normalización FOCUS 1.1*, donde se ajusta, entre otras cosas, el **nombre de la unidad para visualización**.
- **Reseed Catálogo:** vuelve a cargar el catálogo base y informa cuántas unidades se actualizaron.

Es una pantalla técnica: se toca cuando aparece una Unit of Measure nueva en la facturación de Azure que el catálogo no conoce.

## 24. Prueba de carga

**Ruta:** `/superadmin/load-test` · **Menú:** Administración → Prueba de Carga

Genera **tráfico HTTP concurrente real contra el propio servidor** para medir la **latencia P95** y el **throughput** bajo carga. Sólo la ve el SuperAdmin.

> ⚠️ **Esto corre tráfico real contra producción**, no un simulador aislado. Empezá con valores conservadores. Los límites duros son **concurrencia máxima 50** y **duración máxima 15 segundos**.

**Cómo usarla:** elegí el **endpoint objetivo**, la **concurrencia** (1 a 50) y la **duración** (hasta 15 s) y presioná **Ejecutar Prueba de Carga**. Según lo que quieras medir:

| Endpoint | Qué mide |
|---|---|
| `/api/health` | Sin base de datos: el techo del procesador |
| `/api/status` | Con base de datos: el techo real de MySQL |
| `/api/loadtest/probe` | Autenticado con el Service Principal: base de datos + Redis |
| `/api/v1/costs` | Una consulta de costos |
| `/api/exports/powerbi-feed` | El feed de Power BI |

El **historial** conserva las corridas anteriores para comparar antes y después de un cambio.

## 25. IA — Configuración global

**Ruta:** `/superadmin/ai-global-config` · **Menú:** Administración → IA — Configuración Global

El proveedor y la key de IA que se usan **de respaldo** para cualquier tenant que no configuró la suya propia (BYOK por tenant, en *Configuración → IA*). Alimenta al **FinOps Copilot** y a los **reportes ejecutivos con IA**. Sólo la ve el SuperAdmin.

- **Interruptor maestro** *«Habilitar funciones de IA (plataforma)»*: si se apaga, la IA queda inhabilitada para **todos** los tenants, sin importar su propio interruptor. Está pensado para incidentes con el proveedor o costos fuera de control.
- **Proveedor:** Google Gemini (Flash, gratis en free tier), OpenAI (GPT-4o), **Azure IA** (Azure OpenAI), Anthropic (Claude) o DeepSeek. La configuración está **separada por plan**: *Planes no Enterprise* (el respaldo para Professional y Business) y *Planes Enterprise* (el proveedor exclusivo de ese plan). Con Azure IA hace falta la **API Key**, el **Endpoint URL** y el **Deployment** (modelo).
- **API Key:** se guarda **cifrada**. **Probar conexión** hace una llamada real al proveedor guardado. **Eliminar API Key** deja **sin IA** a los tenants que no tienen la suya hasta que cargues una nueva.
- **Valores por defecto para tenants nuevos:** la **sensibilidad de detección de anomalías** (*Baja*, *Media*, *Alta* o *Estricta*, con Z-score 1.0) y **qué datos se comparten** con el proveedor (nombres de recursos y grupos de recursos, y etiquetas). Se asignan al dar de alta a cada tenant; después cada tenant los ajusta en su propia configuración de IA.

El consumo que genera esta key aparece en **Consumo de Plataforma** (22).

---

## Soporte y contacto

Para cualquier asistencia adicional, abrí un ticket desde **Soporte** (`/support`) dentro de la plataforma, o escribí a **soporte@cscloudsolutions.com.ar**.

---

**Manual de SuperAdmin — FinOps SaaS**
**Versión 2.1 | Español | Octubre 2026**
