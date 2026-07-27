# Manual de Usuario - CSCloudSolutions FinOps Platform

Bienvenido a la Plataforma FinOps de CSCloudSolutions. Este manual está diseñado para ayudarte a navegar, comprender y aprovechar al máximo las capacidades de gobernanza, optimización y gestión financiera de recursos en la nube.

> **Nota:** el soporte para AWS que se menciona en algunas secciones de este manual fue removido; la plataforma es Azure-only.

---

## 1. Introducción y Acceso

La plataforma es una solución SaaS B2B multi-cloud: soporta **Microsoft Azure** y **Amazon Web Services**, con los mismos planes y los mismos precios para ambos.

- **Para Iniciar Sesión (Azure):** Ve a la pantalla principal y haz clic en "Iniciar Sesión con Microsoft". La autenticación se integra con **Entra ID (Active Directory)** y reconoce tu tenant automáticamente.
- **Para Iniciar Sesión (AWS):** AWS no tiene un inicio de sesión corporativo equivalente a Entra ID, así que los tenants AWS usan **email y contraseña** desde el mismo formulario de login. Debajo está el enlace de recuperación de contraseña.
- **Modo Demo:** Si deseas probar la plataforma sin conectar tu propio entorno, puedes utilizar uno de los perfiles comerciales preconfigurados desde la pantalla principal, los cuales proveen datos y métricas simuladas.

> El detalle completo del modelo multi-cloud (elección de proveedor en el alta, switch AWS/Azure del header y qué pasa con los datos al bajar de plan) está en la **sección 7** de este manual y, con más profundidad, en `docs/manual/MANUAL_USUARIO_ES.md` §13.

---

## 2. Jerarquía de Roles (RBAC)

La plataforma mapea automáticamente tu perfil corporativo hacia uno de los siguientes roles internos:

1. **SuperAdmin:** Rol global reservado para los dueños de la plataforma. Permite la administración total, incluyendo la creación de nuevos Tenants (Clientes) y configuración de pasarelas de pago.
2. **Admin (Propietario del Tenant):** Tiene acceso completo a la visibilidad financiera, modificación de configuraciones, y ejecución de acciones correctivas (como el apagado de máquinas o eliminación de recursos).
3. **Colaborador:** Acceso a inteligencia financiera y visibilidad. Puede sugerir cambios pero está restringido en áreas de administración de facturación y usuarios.
4. **Reader (Auditor):** Visibilidad exclusiva en paneles de control y reportes de solo lectura. No puede aplicar cambios ni ver datos sensibles de configuración.

---

## 3. Onboarding de Nuevos Clientes (Flujo SuperAdmin)

Para que un nuevo tenant pueda operar dentro de la plataforma (si no pasó por registro automático), un **SuperAdmin** debe completar el siguiente flujo. En Azure se usa Service Principal; en AWS se conecta cuenta por rol asumido:

1. **Registrar Tenant Manual:** Dirígete a la sección `Gestión de Tenants` (`/admin/tenants`). Aquí debes ingresar el Entra ID del Tenant, el nombre comercial de la empresa y asignar un Tier inicial. **Nota:** Si tu cuenta de Microsoft Entra oculta tu correo en la propiedad `upn`, la plataforma ya está parcheada para reconocer tu identidad y otorgarte acceso de SuperAdmin.
2. **Generar Credenciales:** Una vez creado en la base de datos, ve a `Onboarding de Clientes` (`/admin/onboarding`). Solo ahora aparecerán las casillas de **Client ID** y **Client Secret** junto al nombre del entorno, permitiéndote pegar las credenciales del Service Principal generadas por el script de PowerShell.
3. **Etiquetar origen comercial (opcional):** en el mismo panel expandido de cada tenant del **Directorio de Entornos**, el campo **"Origen comercial / Referido por"** permite anotar qué comercial vendió o refirió al cliente, para tracking interno de ventas. Es visible y editable solo por SuperAdmin; el propio tenant nunca lo ve.

> Si el tenant eligió **AWS**, la conexión técnica se realiza en `/admin/cloud-accounts`: registrá `accountId`, `roleArn` y parámetros de CUR. El wizard de onboarding valida que exista al menos una cuenta AWS registrada antes de avanzar.

### 3.1. Roles Azure que el script PowerShell asigna (por tier)

El script de onboarding asigna los roles RBAC al Service Principal a nivel **suscripción**, según el tier contratado:

| Tier | Roles built-in | Custom Role |
|---|---|---|
| **Essential** | Reader, Cost Management Reader, Monitoring Reader, Billing Reader | — |
| **Professional** | Essential + Tag Contributor | — |
| **Business** | Pro + Tag Contributor | VM start/stop/restart/deallocate + tags |
| **Enterprise** | Business + Tag Contributor | Business + disk/snapshot/NIC/PublicIP/NSG delete |

> **Importante:** Los 4 roles de Essential son el mínimo absoluto para que la página **Consumo Real** muestre datos. Si falta `Cost Management Reader` o `Billing Reader`, Azure devuelve 0 filas silenciosamente.

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
- **Alertas Self-Service (Pro):** creación/edición de reglas de alerta de presupuesto y anomalía sin intervención de soporte (`/intelligence/alerts`).
- **AI Analytics (Enterprise):** consumo de Azure OpenAI (tokens, modelos, $/1k tokens) en `/intelligence/ai-analytics`.
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
- **Facturación (Cambio de Plan):** En `/admin/billing` el rol **Owner** puede cambiar de plan (Essential / Professional / Business) de forma autogestionada. Al seleccionar el nuevo plan, frecuencia (mensual/anual) y modo de prorrateo, el sistema muestra un **resumen previo** con el monto real calculado por Paddle antes de confirmar: **"Se cobrará ahora $X"** (upgrade) o **"Recibirás un crédito de $X"** (downgrade), el nuevo total recurrente y la fecha de próxima facturación. El cambio sólo se aplica al presionar **Confirmar cambio**.
- **Reporte Ejecutivo:** Generación automatizada de reportes periódicos en formato de alto nivel.
- **Invoicing Report (Business+):** export JSON / CSV / PBIT stub con detalle por `billing_profile`, `invoice_section` y `customer` en `/admin/report`. Incluye selector de período (mes puntual o **Últimos 3 meses**, opción por defecto) y selector de **suscripción por nombre** (no GUID); la tabla "Facturación por Suscripción" muestra una fila de **total** con la sumatoria de todas las suscripciones.
- **Azure Lighthouse Onboarding (Enterprise):** generación de ARM template para delegación cross-tenant en `/admin/onboarding/lighthouse`.
- **M365 Copilot (Enterprise):** configuración del tenant + chat asistido sobre datos FinOps en `/admin/copilot-m365`.

### 3.6. Soporte (todos los planes, desde Essential)

En **Soporte** (`/support`, ícono de salvavidas en el menú de Administración) cualquier usuario del tenant puede abrir tickets al equipo de CSCloudSolutions y seguir la conversación dentro de la plataforma:

- **Crear ticket:** asunto, categoría (Técnico / Facturación / Consulta / Pedido de feature), prioridad y mensaje inicial.
- **Hilo de conversación:** las respuestas del equipo de soporte aparecen identificadas con 🛟; puedes responder mientras el ticket no esté cerrado, y cerrarlo o reabrirlo tú mismo.
- **Adjuntos:** al crear o responder puedes adjuntar capturas o archivos (`jpg`, `jpeg`, `png`, `txt`, `json`; máx. 5 MB por archivo, 10 por ticket). Los adjuntos se conservan **60 días** y luego se eliminan automáticamente.
- **Acceso rápido y notificaciones:** el ícono de salvavidas junto a tu usuario (header) abre Soporte desde cualquier página. Cuando el equipo responde tu ticket, verás una notificación en la campanita 🔔 y un aviso en pantalla.
- **Cuotas y SLA por plan:**

| Plan | Tickets por mes | Primera respuesta (SLA) |
| --- | --- | --- |
| Essential | 5 | 48 h |
| Professional | 20 | 24 h |
| Business | Ilimitados | 8 h |
| Enterprise | Ilimitados | 4 h |

El equipo de CSCloudSolutions atiende la cola global desde `/superadmin/support` (exclusivo SuperAdmin, con acceso directo desde el header 🎧), donde puede responder como soporte, adjuntar archivos, y cambiar estado y prioridad de cualquier ticket. El equipo también recibe notificación en la campanita cuando un cliente escribe.

---

## 3.7. Tu Perfil

Haciendo clic en tu **avatar** (círculo con tu inicial, arriba a la derecha) se abre el menú de perfil, disponible en móvil y escritorio:

- **Nombre completo:** editable con el ícono de lápiz (se guarda en tu usuario de la plataforma).
- **Correo electrónico** y **Rol** dentro del tenant.
- **Moneda:** selector de divisa de visualización (antes estaba suelto en el header).
- **Aspecto:** Claro, Oscuro o Automático (sigue el tema del sistema).
- **Cerrar sesión.**

---

## 4. FinOps Copilot (Asistente de IA)

La plataforma cuenta con un asistente inteligente integrado (**FinOps Copilot**), accesible a través de un ícono flotante en la esquina inferior de la pantalla.

- **Conciencia de Contexto (automática):** El Copilot lee automáticamente el contenido de la página donde te encontrás — no importa cuál sea, sin necesidad de que esa vista lo declare de antemano. Al abrir el widget, genera solo (sin que escribas nada) un **reporte ejecutivo** de lo que se está mostrando: contexto del módulo, hallazgos clave, oportunidades de ahorro priorizadas por impacto, riesgos y un plan de acción a 7 días.
- **Preguntas dirigidas:** Además del reporte automático, podés preguntarle directamente sobre lo que ves. Ej.: en *Presupuestos*: *"Resume el estado actual de nuestros presupuestos"*.
- **Acciones Correctivas:** El Copilot no solo provee información; también puede, previa autorización, guiarte en el borrado de recursos zombis o la aplicación de etiquetas faltantes mediante scripts automatizados.

---

## 5. Mejores Prácticas

- **Revisión Semanal:** Sugerimos acceder al **Dashboard** y la sección de **Recursos Zombis** al menos una vez por semana para capturar fugas financieras emergentes.
- **Automatización Temprana:** Activa **Horarios de Apagado** en tus entornos de Desarrollo (Dev/Test) como primera medida para asegurar ahorros del 60% en horas de cómputo inactivas.
- **Delegación de Responsabilidad:** Exige el cumplimiento de **Etiquetas (Tags)** a tus equipos de desarrollo para que el módulo de Showback/Chargeback pueda distribuir justamente la factura mensual.

> **Soporte:** Para cualquier asistencia adicional o reporte de incidencias operativas, por favor contacte al equipo administrativo a través de la sección de soporte.

---

---

## 6. Política de documentación de cambios

A partir de ahora, cada ajuste funcional, técnico o visual de la plataforma se registra en `CAMBIOS_IMPLEMENTADOS.md`.

Además, cada vez que se aplica un cambio también se actualizan de forma obligatoria:

1. `README.md` (documentación técnica y arquitectura)
2. `MANUAL_DE_USUARIO.md` (impacto en uso funcional)
3. `CAMBIOS_IMPLEMENTADOS.md` (bitácora de cambios realizados y futuros)

---

## 7. Multi-cloud: Azure y AWS

### 7.1. Elegir el proveedor

En la pantalla de planes elegís primero qué nube querés analizar. Los planes y los precios son idénticos; lo único que cambia es cómo se crea la cuenta:

| Proveedor | Alta |
|---|---|
| **Azure** | Inicio de sesión con Microsoft; se reconoce tu tenant de Entra ID. |
| **AWS** | Email y contraseña, con verificación por mail. |

### 7.2. Los dos proveedores a la vez (solo Enterprise)

El plan **Enterprise** es el único que puede tener Azure y AWS conectados en la misma cuenta. En ese caso aparece un **selector AWS/Azure en la barra superior**; al cambiarlo, el menú lateral y las páginas muestran los datos de ese proveedor.

El menú lateral **cambia según el proveedor activo**: muchas páginas son específicas de Azure (AKS, Hybrid Benefit, Azure Policies, Defender for Cloud) y no aparecen con AWS activo. Es intencional — preferimos no mostrar una página que no puede funcionar con tus datos.

### 7.3. Qué pasa con tus datos si bajás de plan

Si tenés Enterprise con los dos proveedores y bajás de plan, **no se borra nada en ese momento**:

1. Se retiene un proveedor (por defecto, aquel donde más gastás) y el otro queda **archivado en modo sólo lectura**.
2. Tenés **90 días** para consultarlo y **exportar todo** desde `/admin/focus-export`. El export sigue habilitado durante toda la ventana aunque el nuevo plan no lo incluya.
3. Te avisamos por email y notificación in-app **30 y 7 días antes** de la eliminación.
4. Recién al vencer los 90 días se eliminan los datos de ese proveedor.

Durante la ventana ves un aviso en la parte superior con los días restantes. Podés **invertir la elección** (Admin/Owner) — aunque eso **no reinicia el plazo** — o **volver a Enterprise**, en cuyo caso **se restaura todo sin pérdida**.
