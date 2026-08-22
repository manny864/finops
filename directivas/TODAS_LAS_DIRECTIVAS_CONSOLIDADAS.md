# 📋 DIRECTIVAS CONSOLIDADAS — CSCloudSolutions FinOps Platform

> **Fecha de consolidación:** 2026-08-21
> **Total de SOPs:** 107
>
> Este archivo contiene **todas** las directivas / SOPs del proyecto en un solo documento.
> Cada sección está delimitada por el nombre del archivo original para referencia.

---


---

# 📄 action_center_SOP.md

> **Archivo fuente:** `directivas/action_center_SOP.md`

# Action Center & Notifications SOP\n\n- **Toasts**: Usamos `sonner` para disparar notificaciones flotantes ricas (`toast.success`, `toast.error`) reemplazando los intrusivos `alert()` de navegador.\n- **Global Log (Zustand)**: `useActionLogStore` guarda cada operación (con timestamp y estatus) para que los FinOps Managers puedan tener trazabilidad inmediata de lo ocurrido en la sesión.\n- **Drawer**: El `ActionCenterDrawer` se vincula a la campana (Bell) global en el `ClientShell` para ofrecer un slide-out lateral estilo Azure Portal Notifications.\n

---

# 📄 administrative_hygiene_SOP.md

> **Archivo fuente:** `directivas/administrative_hygiene_SOP.md`

# SOP: Higiene Administrativa (Detección de Grupos de Recursos Vacíos)

## Objetivo
Implementar la detección de "Higiene Administrativa" para identificar Grupos de Recursos (Resource Groups) vacíos en Azure que no contienen ningún recurso, clasificándolos como desperdicio administrativo con un costo mensual de $0 y mostrándolos en la interfaz de usuario de recursos zombis bajo una insignia distinta de "Higiene" en lugar de un indicador financiero.

## Lógica y Pasos

### 1. Catálogo KQL (`src/modules/core/kqlCatalog.ts`)
- Utilizar la consulta `emptyRgs` ya registrada o ajustarla:
  - `emptyRgs`: `ResourceContainers | where type =~ 'microsoft.resources/subscriptions/resourcegroups' | extend rgAndSub = strcat(name, '--', subscriptionId) | join kind=leftouter (Resources | extend rgAndSub = strcat(resourceGroup, '--', subscriptionId) | summarize count() by rgAndSub) on rgAndSub | where isnull(count_) | project id, name, location, resourceGroup=name, subscriptionId`

### 2. API de Cleanup (`src/app/api/cleanup/zombies/route.ts`)
- Añadir `emptyRgs` a la lista de objetivos a consultar en paralelo.
- Para cada Grupo de Recursos vacío detectado:
  - Definir `monthlyCost` y `estimatedMonthlyCost` como `0`.
  - Asignar una propiedad de categoría especial `hygiene: true` o `category: 'Hygiene'` para diferenciarlo de las pérdidas monetarias tradicionales.
  - El tipo de recurso es `microsoft.resources/subscriptions/resourcegroups`.
  - Mapear a la interfaz estándar de zombies: `{ resourceId, name, resourceType, monthlyCost: 0, isHygiene: true }`.

### 3. UI de Cleanup (`src/components/ZombieResourcesTable.tsx`)
- Adaptar la tabla de recursos zombis para admitir e identificar registros de higiene (`isHygiene: true` o costo $0).
- Si un recurso tiene la propiedad de higiene activa, renderizar un badge estilizado `"Higiene"` o `"Limpieza"` (por ejemplo, con fondo azul/violeta suave) y mostrar "$0.00" o "N/A" para el ahorro financiero, en lugar de alertar sobre pérdidas monetarias.
- El botón de eliminación debe estar habilitado, permitiendo eliminar el grupo de recursos vacío a través de la API de remediación existente.

## Restricciones y Trampas Conocidas
- **Mapeo de RG en KQL:** En `ResourceContainers`, la propiedad `resourceGroup` puede no estar presente de forma natural (ya que el contenedor *es* el grupo de recursos). Por lo tanto, debemos proyectar `resourceGroup=name` para evitar valores nulos que rompan la tabla o el selector en la UI.
- **Badge de Higiene:** Asegurar que los estilos utilicen clases existentes de CSS o Tailwind que aporten un diseño moderno y premium, evitando colores chillones.


---

# 📄 agent_dba_SOP.md

> **Archivo fuente:** `directivas/agent_dba_SOP.md`

# STRICT DATABASE MIGRATION PROTOCOL
Whenever a task requires modifying the database structure (adding/removing tables, columns, indexes, or constraints), you MUST explicitly inform the user about the impact of this change.
You MUST implement the changes in the local schema files (src/modules/storage/schema.sql and src/modules/storage/db.ts) using safe ALTER TABLE methods.
Crucially, at the end of your response, you MUST output a separate, raw SQL code block labeled -- PRODUCTION DB MIGRATION SCRIPT ---. This block must contain the exact, safe SQL commands (e.g., ALTER TABLE...) that the user needs to manually copy and execute in their production MySQL database.

# Directiva: Agente DBA - Módulo de Presupuestos Mensuales por Tenant

## Objetivo
Diseñar, implementar y mantener la estructura de base de datos para gestionar presupuestos mensuales a nivel de `tenant_id` (distinto a presupuestos por Cost Center).

## Reglas y Restricciones (DBA)
- **Precisión Financiera:** Los cálculos de costos y presupuestos NUNCA deben usar `FLOAT`. Usar siempre tipos exactos como `DECIMAL(10,2)` o `DECIMAL(12,4)` según corresponda en la base de datos.
- **Integridad Referencial:** Cualquier tabla relacionada a tenants debe tener `FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE`.
- **Idempotencia:** Los scripts de creación de esquemas deben usar `CREATE TABLE IF NOT EXISTS` y `INSERT ... ON DUPLICATE KEY UPDATE` para mantener la idempotencia.
- **Unicidad:** Asegurar restricciones `UNIQUE KEY` lógicas (ej. un solo presupuesto por tenant y período).

## Procedimiento (Pendiente de Aprobación)
1. Extender `schema.sql` y `db.ts` con la nueva estructura de presupuestos mensuales.
2. Crear servicio TypeScript para aislar la lógica de lectura y escritura de presupuestos en la BD.


---

# 📄 agent_frontend_SOP.md

> **Archivo fuente:** `directivas/agent_frontend_SOP.md`

# ROL: Ingeniero Frontend Senior (Next.js + Tailwind)
Actúas como un experto en UX/UI y React.
- **Misión:** Traducir datos financieros complejos en componentes visuales limpios, modulares y responsivos.
- **Reglas:**
  1. Utiliza Server Components por defecto.
  2. Implementa soporte `next-intl` (i18n) para TODOS los textos. No dejes strings en código duro.
  3. Utiliza Tailwind CSS siguiendo el diseño de nuestro SaaS (modos claro/oscuro soportados).
  4. Maneja los estados de carga (Skeletons/Spinners) y los errores de API de forma elegante con `react-hot-toast` u otra librería de notificaciones.
5. **Prevención de Errores de Hidratación (Hydration Errors):**
   - **Recharts / Gráficos:** Los componentes de Recharts (como `ResponsiveContainer`) calculan dimensiones que difieren entre el servidor y el cliente. Para evitar errores de hidratación, envuelve el renderizado del gráfico en una condición `isMounted` (`const [isMounted, setIsMounted] = useState(false); useEffect(() => setIsMounted(true), [])`) o cárgalo dinámicamente con `next/dynamic` y `ssr: false`.
   - **Rules of Hooks:** Nunca utilices `require()` o llamadas a hooks condicionales (ej. `try/catch` envolviendo a `useTranslations()`) dentro del cuerpo de un componente React.
6. **Lucide React Icons:**
   - **Regla:** Los iconos de Lucide React no aceptan propiedades como `title`. Para mostrar un tooltip nativo, envuelve el icono en una etiqueta HTML estándar como `<span>` con el atributo `title`.
7. **APIs de IA (Vercel AI SDK):**
   - **Regla:** Si los componentes cliente del frontend consumen un endpoint de IA esperando un JSON (ej. `await res.json()`), utiliza `generateText` en lugar de `streamText` para evitar incompatibilidades de tipo y fallos de análisis en tiempo de ejecución.


---

# 📄 agent_qa_SOP.md

> **Archivo fuente:** `directivas/agent_qa_SOP.md`

# ROL: Auditor de Código y QA Financiero
Actúas como un revisor de código implacable. No escribes código nuevo, analizas el existente.
- **Misión:** Encontrar fugas de memoria, errores de seguridad, y fallos en cálculos matemáticos de FinOps.
- **Reglas:**
  1. Verifica que no haya operaciones matemáticas de punto flotante inseguras en JavaScript (ej. `0.1 + 0.2`).
  2. Asegura que las rutas API verifiquen la autenticación y los límites de suscripción del Tenant (`authGuard.ts`).
  3. Comprueba que las llamadas a APIs externas de Azure estén envueltas en bloques try/catch y no bloqueen la UI si fallan.

---

# 📄 ahub_optimization_SOP.md

> **Archivo fuente:** `directivas/ahub_optimization_SOP.md`

# SOP: Detección y Optimización de Licencias Azure Hybrid Benefit (AHUB)

## Objetivo
Implementar la política empresarial de Flexera "Azure Hybrid Benefit (AHUB) Optimization" en la plataforma FinOps. Esta regla identifica recursos de Azure (Máquinas Virtuales Windows y Bases de Datos SQL) que se ejecutan sin licencias de beneficio híbrido (pagando el precio completo de licencia por hora) y calcula el ahorro estimado (quick-win) equivalente al 40% del costo estándar.

## Lógica y Pasos

### 1. Catálogo KQL (`src/modules/core/kqlCatalog.ts`)
- Registrar las siguientes consultas KQL exactas:
  - `missingAhubWindowsVMs`: VMs del proveedor `microsoft.compute/virtualmachines` con sistema operativo Windows (`osType =~ 'Windows'`) donde el atributo `properties.licenseType` es nulo o no es igual a `Windows_Server`.
  - `missingAhubSql`: Databases SQL de tipo `microsoft.sql/servers/databases` (excluyendo la de sistema `master`) donde `properties.licenseType` es nulo o no es igual a `BasePrice`.

### 2. API de Licencias (`src/app/api/intelligence/licenses/route.ts`)
- Recuperar el `tenantId` desde las cabeceras.
- Realizar consultas concurrentes a Azure Resource Graph para obtener las listas de VMs y Bases de Datos SQL afectadas.
- Para cada recurso detectado:
  - Obtener el costo mensual estimado (vía `getMonthlyCostEstimate` o fallbacks realistas).
  - Calcular el ahorro potencial de licencia (`potentialLicenseSavings`) como el 40% del costo estándar del recurso.
  - Mapear a la estructura `{ resourceId, name, type, potentialLicenseSavings }` manteniendo otros metadatos (Grupo, Suscripción, Ubicación).
- Incorporar control defensivo en las consultas de Graph (M365) para que, en caso de fallar por falta de permisos o admin consent (403), el endpoint retorne las licencias M365 vacías pero siga respondiendo con éxito la lista de recursos Azure faltos de AHUB (`missingAhub`).

### 3. UI de Licencias (`src/app/[locale]/intelligence/licenses/page.tsx`)
- Modificar el frontend para que consulte el nuevo endpoint.
- Integrar una nueva sección/tarjeta con una tabla de "Recursos sin Azure Hybrid Benefit (AHUB)".
- Listar el nombre del recurso, tipo de recurso (VM / SQL DB), suscripción, y el potencial de ahorro formateado en dólares ($).
- Mostrar un badge destacado que avise al usuario del potencial ahorro mensual acumulado de AHUB.

## Restricciones y Trampas Conocidas
- **Manejo de Permisos Graph 403:** El token de Microsoft Entra puede no tener permisos para Graph API, devolviendo un error 403. La API debe atrapar este error de manera segura y retornar los datos de AHUB para no dejar la página en blanco con un cartel de error.
- **Ignorar Base de Datos master:** Las bases de datos `master` en Azure SQL son lógicas y gratuitas. Deben excluirse de las alertas KQL para no sobrecargar de falsos positivos la tabla.


---

# 📄 app_router_SOP.md

> **Archivo fuente:** `directivas/app_router_SOP.md`

# App Router Navigation SOP\n\n- **Navegación**: Utiliza `next/link` y `usePathname` en lugar de estados. Sidebar vive en `src/components/Sidebar.tsx`.\n- **Iconos**: Usa `lucide-react` para estandarización visual.\n

---

# 📄 app_service_finops_cmp_SOP.md

> **Archivo fuente:** `directivas/app_service_finops_cmp_SOP.md`

# SOP: Cockpit FinOps y Densidad de Aplicaciones en App Services (Web Apps & Plans)

## Objetivo
Procedimiento operativo determinista para auditar, consolidar y optimizar costos de **App Service Plans (`Microsoft.Web/serverfarms`)** y **Web Apps / Deployment Slots (`Microsoft.Web/sites`)** en Azure, erradicando planes huérfanos/zombies y maximizando la densidad de aplicaciones por worker.

---

## 1. Arquitectura de Costos en Azure App Services

En Azure, el costo computacional no lo generan las Web Apps individuales, sino el **App Service Plan (ASP)**:
- **Facturación**: Se cobra por la capacidad asignada (`numberOfWorkers` / `sku.capacity`), el SKU/Tier (ej. Standard S1, Premium v3 P1v3) y el sistema operativo (`reserved: true` = Linux, `false` = Windows).
- **Relación 1:N**: Un solo App Service Plan puede alojar múltiples Web Apps y Deployment Slots que comparten la CPU y RAM de los workers.
- **Desperdicio Principal**:
  1. **Planes Huérfanos / Vacíos**: Planes activos con `numberOfSites == 0` que siguen facturando mensualmente.
  2. **Subutilización / Dispersión (Baja Densidad)**: Múltiples planes con una sola app al 5-10% de CPU en lugar de consolidarlas en un plan compartido (App Packing).
  3. **SKUs Antiguos**: Planes Standard S1 ($79.51 USD) cuando Premium v3 P0v3 ($54.75 USD) ofrece mejor CPU/RAM a menor precio.
  4. **Deployment Slots Inactivos**: Slots de staging/test olvidados consumiendo RAM y CPU del plan dedicado.

---

## 2. Reglas de Remediación Resolutivas

### 1. Plan Huérfano / Vacío (Zombie ASP)
- **Gatillo**: `numberOfSites == 0` (0 Web Apps alojadas).
- **Ahorro**: 100% del costo del plan ($79.51/mes en S1).
- **Comando Azure CLI**:
  ```bash
  az appservice plan delete --resource-group <resourceGroup> --name <planName> --yes
  ```

### 2. Consolidación de Aplicaciones (App Packing)
- **Gatillo**: Múltiples planes en la misma región y grupo de recursos con CPU promedio $< 15\%$ y memoria $< 40\%$.
- **Ahorro**: Costo del plan que se da de baja ($79.51/mes).
- **Comando Azure CLI**:
  ```bash
  # Mover Web App al plan compartido destino:
  az webapp update --resource-group <resourceGroup> --name <appName> --plan <targetSharedPlanName>
  # Eliminar el plan origen desocupado:
  az appservice plan delete --resource-group <resourceGroup> --name <sourcePlanName> --yes
  ```

### 3. Modernización a Premium v3 / Downgrade a Basic
- **Gatillo**: Planes Standard (S1/S2) subutilizados.
- **Ahorro**: $35 a $50 USD/mes por plan.
- **Comando Azure CLI**:
  ```bash
  # Migrar a Premium v3 P0v3 (1 vCPU, 4GB RAM, SSD NVMe):
  az appservice plan update --resource-group <resourceGroup> --name <planName> --sku P0v3
  # O para entornos de Dev/QA sin requerir SLA:
  az appservice plan update --resource-group <resourceGroup> --name <planName> --sku B1
  ```

### 4. Escalado a 1 Instancia / Autoscale Dinámico
- **Gatillo**: `numberOfWorkers > 1` fijo con baja utilización sostenida.
- **Ahorro**: 50% del costo de workers.
- **Comando Azure CLI**:
  ```bash
  az appservice plan update --resource-group <resourceGroup> --name <planName> --number-of-workers 1
  ```

### 5. Limpieza de Deployment Slots Inactivos
- **Gatillo**: Slots de staging sin tráfico HTTP en $> 14$ días.
- **Comando Azure CLI**:
  ```bash
  # Detener slot:
  az webapp deployment slot stop --resource-group <resourceGroup> --name <appName> --slot <slotName>
  # Eliminar slot:
  az webapp deployment slot delete --resource-group <resourceGroup> --name <appName> --slot <slotName>
  ```

---

## ⚠️ Restricciones y Trampas Conocidas (Gotchas)

### ❌ Requisito de Webspace al Mover Web Apps
- Azure no permite mover una Web App entre App Service Plans que residan en diferentes grupos de recursos o regiones si los planes no pertenecen a la misma unidad de despliegue (Webspace).
- **Solución**: Asegurar que ambos planes residan en el mismo Resource Group y Región geográfica antes de ejecutar `az webapp update --plan`.


---

# 📄 artefactos_y_workbooks_SOP.md

> **Archivo fuente:** `directivas/artefactos_y_workbooks_SOP.md`

# Artefactos y Workbooks SOP\n\n## Objetivo\nDesplegar Azure Workbooks pre-compilados en el entorno del cliente usando la UI.\n\n## Restricciones/Casos Borde\n- Validar el token y tenantId en el endpoint API.\n- Manejar el despliegue de ARM templates a nivel del Resource Group especificado.\n- Usar `sonner` toast para el feedback al usuario.\n

---

# 📄 audit_and_tags_enhancement_SOP.md

> **Archivo fuente:** `directivas/audit_and_tags_enhancement_SOP.md`

# Directiva: Refactorización de Auditoría y Gestión de Etiquetas (SDK)

## Objetivo
Mejorar la visualización de la "Auditoría Completa" introduciendo filtros dinámicos en la interfaz (Tipo, Grupo, Severidad), y dotar a la "Gestión de Etiquetas" de la capacidad para aplicar (Patch) etiquetas directamente en Azure mediante el SDK `@azure/arm-resources`.

## Lógica y Pasos
1. **Instalación de SDK:** Requiere instalar `@azure/arm-resources` para manipular etiquetas en recursos de Azure.
2. **Backend (API):** Crear `/api/tags/apply/route.ts`. Este endpoint:
   - Debe validar el token MSAL y asegurar que el `tenantId` coincide (Zero-Trust).
   - Extraer el `subscriptionId` desde el `resourceId` proporcionado en el body para inicializar `ResourceManagementClient`.
   - Utilizar el método `tags.beginUpdateAtScope(resourceId, { operation: 'Merge', properties: { tags: <tags> } })` para anexar/modificar etiquetas.
   - Retornar el estado correspondiente manejando errores de RBAC y Client Secret.
3. **Frontend (Auditoría - ZombieResourcesTable):** 
   - Extraer dinámicamente los valores únicos de `resourceGroup` y `type` de los datos mapeados.
   - Insertar selects para `Suscripción`, `Tipo`, `Grupo`, y `Severidad` y aplicar un `.filter()` reactivo antes de renderizar.
4. **Frontend (Gestión de Etiquetas - TagManager):**
   - Incorporar columna de "Acciones" y modal de edición.
   - Construir el payload con los valores ingresados por el usuario para las etiquetas faltantes.
   - Llamar al endpoint `/api/tags/apply` y reflejar el loading state.

## Trampas Conocidas / Restricciones (Aprendidas)
- **Token Validación:** La modificación de estado en Azure DEBE ir protegida. No confíes en los IDs enviados desde el cliente sin contrastar el `tenantId` del token JWT.
- **RBAC para Tags:** El motor requiere que el Service Principal tenga, como mínimo, el rol de "Tag Contributor" o "Contributor" sobre el ámbito (suscripción o grupo de recursos). De lo contrario, `tags.beginUpdateAtScope` fallará con un error 403 (AuthorizationFailed).
- **Extracción de Subscription:** La API de `ResourceManagementClient` requiere un `subscriptionId` en su constructor, pero `tags.beginUpdateAtScope` trabaja con el `scope` (que es el `resourceId` completo). Se extrae el `subscriptionId` usando regex o asumiendo un ID global si la URL del recurso es genérica, para poder instanciar el cliente sin quejarse.
\n- **KQL Catalog**: Las consultas KQL deben incluir `isnull(prop) or array_length(prop) == 0` para manejar los nulos y arrays vacíos correctamente en recursos huérfanos (Availability Sets, Route Tables, Load Balancers, NAT Gateways).\n- **CostPieChart Tooltip**: Se corrigió el mapeo de variables para que el tooltip muestre correctamente la cantidad de recursos (`count`) además del costo.\n

---

# 📄 azure_advisor_SOP.md

> **Archivo fuente:** `directivas/azure_advisor_SOP.md`

# Directiva: Integración de Azure Advisor

## Objetivo
Implementar el tablero de Azure Advisor replicando las 5 categorías oficiales de Microsoft (Costo, Seguridad, Confiabilidad, Rendimiento y Excelencia Operativa) y permitiendo exportar las métricas de recomendaciones y auditoría general a un CSV consolidado, con soporte integral multi-idioma (es, en, pt-BR).

## Lógica y Pasos
1. **Backend**: El endpoint `/api/advisor/route.ts` itera sobre todas las suscripciones permitidas (validando explícitamente el token y el `tenantId`).
2. **Frontend**: `<AdvisorPanel />` consume los datos para mostrarlos en 5 tarjetas y pestañas.
3. **Exportación**: El cliente genera y descarga el CSV consolidado con encabezados localizados según el idioma activo.

## Trampas Conocidas / Restricciones
- **Multitenancy**: Siempre utilizar `selectedTenant.id` provisto por `useTenant()`.
- **Suscripciones Vacías**: Si `GET /subscriptions` devuelve cero elementos, retornar `403 MISSING_RBAC_ROLE` en lugar de fallar silenciosamente.
- **Filtrado y Scores**: Las recomendaciones se etiquetan con `subscriptionId`. Se hace fetch a la REST API de Microsoft.Advisor/advisorScore (versión `2023-01-01`) para obtener las puntuaciones por categoría y general. La puntuación general del Score no se calcula en el frontend sino que se muestra directamente el valor devuelto por el API bajo el nombre de score `"Advisor"`. Cada tarjeta de categoría muestra su respectiva puntuación individual con insignias de colores (Verde >= 80%, Amarillo >= 50%, Rojo < 50%, Gris N/A).
- **Internacionalización Integral (i18n)**: La API REST de Azure Advisor a menudo devuelve los textos en inglés independientemente del header `Accept-Language`. Todas las recomendaciones y acciones deben pasar por `translateAdvisorText(text, locale, kind)` en `src/lib/advisorI18n.ts`, cubriendo los 5 pilares (Costo, Seguridad, Confiabilidad, Rendimiento y Excelencia Operativa).
- **Extracción de Nombres de Recursos**: Nunca mostrar URIs completas de ARM (ej. `/subscriptions/.../virtualMachines/vm-01`) en la columna Recurso; usar `extractResourceDisplayName()` para mostrar el nombre limpio del recurso y el Resource Group como subtítulo.
- **Ocultamiento de IDs Técnicos**: Las claves de `extendedProperties` que contengan GUIDs o IDs (`recommendationTypeId`, `recommendationId`, `ruleId`, etc.) deben estar en `HIDE_EXT_KEYS` para no crear columnas con GUIDs.
- **Traducción de Columnas Dinámicas**: Los encabezados de columnas generadas dinámicamente desde `extendedProperties` deben traducirse mediante `translateColumnHeader(headerKey, locale)`.

---

# 📄 azure_budgets_creation_SOP.md

> **Archivo fuente:** `directivas/azure_budgets_creation_SOP.md`

# SOP: Creación de Presupuestos Nativos en Azure (Cost Management)

## Objetivo
Habilitar la creación directa de presupuestos (Budgets) en Azure de forma nativa desde la plataforma SaaS utilizando el SDK/API de Azure Cost Management, integrándolo de forma segura y consistente en el frontend del panel de presupuestos.

## Lógica y Pasos

### 1. Budget Service (`src/services/budgetService.ts`)
- Implementar la función `createSubscriptionBudget` instanciando `ConsumptionManagementClient`.
- Definir el ámbito estricto de suscripción `/subscriptions/${subscriptionId}`.
- Armar el payload del presupuesto estableciendo `timeGrain: 'BillingMonth'` y `category: 'Cost'`.
- Configurar las fechas dinámicas: inicio el primer día del mes actual en curso, fin exactamente un año después en formato ISO `YYYY-MM-01T00:00:00Z`.
- Configurar notificaciones al 80% y 100% del consumo real dirigidas a la lista de emails provista.

### 2. API Route (`src/app/api/budgets/create/route.ts`)
- Crear un endpoint POST protegido bajo Zero-Trust (comparación de tenant del token vs body).
- Extraer `subscriptionId`, `budgetName`, `amount`, `contactEmail` y `tenantId`.
- Obtener credenciales de Azure del tenant y delegar la llamada a `createSubscriptionBudget`.
- Manejar los errores de la API de Azure de forma segura y retornar un estado 201 en caso de éxito.

### 3. Modal de Creación Frontend (`src/components/CreateBudgetModal.tsx`)
- Crear un Client Component modal con un formulario de entrada (Nombre, Límite, Email).
- Mostrar un estado de carga visual interactivo e indicador animado durante la petición POST a la API.
- Al guardar correctamente en Azure, registrarlo también en la base de datos local mediante POST a `/api/budgets` para visualización inmediata, cerrar el modal y disparar un refresco reactivo de la UI.

### 4. Página de Presupuestos (`src/app/[locale]/intelligence/budgets/page.tsx`)
- Integrar la importación y renderizado de `CreateBudgetModal`.
- Dividir el botón de acción superior para permitir tanto la definición local como la nativa en Azure.
- Implementar un mecanismo de refresco (`refreshKey`) en el hook `useEffect` de carga para actualizar instantáneamente la tabla tras guardar un presupuesto.

## Restricciones y Trampas Conocidas
- **Formato de Fechas de Azure:** La API de presupuestos de Azure es extremadamente estricta con los formatos de fecha de inicio/fin. Deben enviarse exactamente en formato UTC `YYYY-MM-01T00:00:00Z` y no pueden ser fechas pasadas.
- **Formato de Emails:** Los emails de alerta deben ser un arreglo de strings y estar bien formados, de lo contrario la API de Azure rechazará la llamada con un error 400 Bad Request.


---

# 📄 azure_cost_exports_SOP.md

> **Archivo fuente:** `directivas/azure_cost_exports_SOP.md`

# Directiva: Ingesta Escalable vía Azure Cost Management Exports a Blob Storage

## Descripción del Objetivo
Establecer el protocolo de arquitectura para mitigar y eliminar de forma definitiva las limitaciones de cuota (HTTP 429 - Too Many Requests) de la Azure Cost Management Query API mediante la ingesta asíncrona por **Cost Management Exports a Azure Blob Storage** (formato FOCUS 1.0 / CSV).

---

## 1. Contexto del Problema y Cuotas de Microsoft
- **Limitación de Azure:** Microsoft impone un límite de **12 a 60 llamadas/minuto** en la API de consultas analíticas (`/providers/Microsoft.CostManagement/query`).
- **Cadencia de Actualización:** Azure actualiza la facturación interna cada **4 a 8 horas**, por lo que consultas sincrónicas repetidas saturan la cuota sin aportar mayor frescura.

---

## 2. Arquitectura de Ingesta Asíncrona (Enterprise FinOps)

### A. Recursos Requeridos en Azure
1. **Azure Storage Account:**
   - SKU: Standard LRS (Hot/Cool tier).
   - Contenedor dedicado: `finops-cost-exports`.
   - Costo estimado: < $0.20 USD/mes por almacenamiento de blobs comprimidos (gzip/parquet/csv).
2. **Cost Management Export Programado (Scheduled Export):**
   - Ámbito (Scope): Suscripción o Management Group.
   - Tipo de Métrica: *Amortized Cost* o *Actual Cost (FOCUS 1.0)*.
   - Frecuencia: Diaria (Daily Export de MTD) y Mensual (Historical Export).
   - Formato de salida: CSV / FOCUS v1.0 comprimido.

---

## 3. Estrategia de Mitigación en Backend (Caché & Coalescing)

1. **TTL de Caché Unificado:**
   - La clave compartida `cost:mtd:shared:v1:${tenantId}:${subscriptionId}:${metricType}` en Redis mantiene un TTL de **30 minutos** (`1800s`).
   - Respuestas vacías o degradadas usan un TTL corto de **60 segundos** para reintento rápido.
2. **Request Coalescing (Deduplicación en Vuelo):**
   - El mapa `COST_INFLIGHT` deduplica solicitudes concurrentes entre el Dashboard, el Whiteboard y Presupuestos: si varias peticiones llegan simultáneamente, solo se ejecuta **una única llamada a Azure** y se comparte el resultado.
3. **Escalonamiento Multi-Suscripción (Staggered Execution):**
   - Se introduce un delay de **350ms** entre llamadas por suscripción con concurrencia máxima de 2 y reintentos con backoff exponencial basados en el header `retry-after`.
4. **Pipeline en 3 Capas:**
   - Capa 1: Redis Fast Cache (sub-milisegundo).
   - Capa 2: Tabla MySQL `CostSnapshots` (sincronizada).
   - Capa 3: Live Azure Query API con reintentos y deduplicación.

---

## 4. Trampas Conocidas / Restricciones
- **No ignorar el header `retry-after`:** Si Azure devuelve un 429, se debe esperar el tiempo indicado por Microsoft antes del siguiente reintento.
- **No duplicar capas de caché con distintos TTLs:** El resultado del backend debe alinearse para que todas las vistas del dashboard muestren la misma cifra acumulada.


---

# 📄 azure_finops_bootstrap_SOP.md

> **Archivo fuente:** `directivas/azure_finops_bootstrap_SOP.md`

# Directiva: Bootstrap Azure FinOps Project

## Objetivo
Inicializar un proyecto Next.js desde cero con configuración para Docker en modo standalone, crear un agente de skill y estructurar la arquitectura base para la integración con Azure FinOps de manera predecible y reproducible.

## Entradas
- Ninguna interactiva (todo debe ser automático sin requerir input del usuario).

## Salidas
- Proyecto Next.js inicializado en el directorio actual.
- Archivo `next.config.ts` modificado para salida `standalone`.
- `Dockerfile` y `.dockerignore` listos para entorno de producción.
- Skill en `.agent/skills/azure-finops-expert/SKILL.md` con instrucciones core para un arquitecto de Azure FinOps.
- Archivos base: `src/lib/azure.ts`, `src/app/api/consumption/route.ts`, `src/app/api/recommendations/route.ts`.

## Lógica y Pasos
1. Ejecutar `npx create-next-app@latest ./ --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --yes` en el directorio raíz.
2. Leer y reemplazar el contenido de `next.config.ts` para agregar `output: 'standalone'`.
3. Crear el `Dockerfile` de múltiples etapas para Next.js (base, deps, builder, runner).
4. Crear `.dockerignore` para excluir `node_modules`, `.next`, etc.
5. Crear la carpeta y el archivo `.agent/skills/azure-finops-expert/SKILL.md` con las instrucciones de búsqueda de recursos zombie y optimización.
6. Crear los archivos base (esqueletos vacíos) en `src/lib/` y `src/app/api/`.

## Trampas Conocidas / Restricciones
- **CRÍTICO**: El `Dockerfile` debe usar obligatoriamente la imagen `node:22-alpine` para todas sus etapas para coincidir con el host.
- La CLI de `create-next-app` podría fallar si el directorio no está vacío.
- **Nota**: Los archivos vacíos en `app/api/.../route.ts` deben contener `export {}` para que TypeScript los reconozca como módulos válidos, de lo contrario el build fallará.
- El archivo `next.config.ts` depende del tipado de Next.js (`NextConfig`), por lo que su modificación debe hacerse respetando la constante principal del archivo generado.
- **Nota**: No hacer `create-next-app@latest .` si el directorio actual contiene mayúsculas (ej. "FinOpsProyect"), porque causa el error de restricciones de npm (`name can no longer contain capital letters`). En su lugar, hacer el bootstrap en una carpeta temporal con un nombre en minúsculas (ej. `finops-project`) y mover los archivos ocultos y visibles al directorio actual.


---

# 📄 azure_pricing_SOP.md

> **Archivo fuente:** `directivas/azure_pricing_SOP.md`

# Azure Retail Prices Integration SOP\n\n- **Servicio Externo**: Utilizamos la API oficial `https://prices.azure.com/api/retail/prices`.\n- **Caché Crítico**: La API de retail es pública pero estricta. Todo `fetch` se enruta mediante `pricingService.ts` que almacena una caché en memoria local (Map) basada en `serviceName-skuName-region`.\n- **Cálculo**: Multiplicamos el `retailPrice` por 730 horas para obtener la estimación mensual en `estimatedMonthlyCost`.\n\n- **Fallback Lógico**: Si la API de Retail Prices falla o no encuentra el SKU exacto (ej. devuelve 0), el frontend DEBE usar el operador lógico `||` para recaer sobre el cálculo matemático genérico (ej. `r.diskSizeGB * 0.15`). Nunca usar `??` ya que `0 ?? fallback` evalúa a `0`.\n

---

# 📄 azure_red_hat_openshift_finops_cmp_SOP.md

> **Archivo fuente:** `directivas/azure_red_hat_openshift_finops_cmp_SOP.md`

# SOP — Azure Red Hat OpenShift (ARO) FinOps & Governance Cockpit

## 1. Propósito y Alcance
Establecer el procedimiento estándar para la gobernanza, observabilidad de costos, análisis de arquitectura (Control Plane vs. Worker MachineSets), desglose de facturación tripartito (Cómputo Azure, Licencia Red Hat OpenShift y Almacenamiento Persistente) y remediación resolutiva de clústeres Azure Red Hat OpenShift (`Microsoft.RedHatOpenShift/openShiftClusters`).

---

## 2. Principios de Arquitectura ARO y Modelo Económico
1. **Control Plane / Nodos Master (Costo Ineludible de Existencia):**
   - Un clúster ARO aprovisiona obligatoriamente 3 nodos Master (típicamente `Standard_D8s_v5` o similar) para garantizar el quórum de `etcd` y la alta disponibilidad del plano de control de OpenShift.
   - Estos 3 nodos representan un costo base fijo ininterrumpido de ~$800–$1,200 USD/mes independientemente de si hay cargas de trabajo corriendo en los workers.
   - En ambientes `dev`, `test` o `qa` con baja utilización, el overhead de 3 masters fijos suele ser desproporcionado; la recomendación estándar es la consolidación de cargas no productivas en clústeres compartidos aislados mediante Namespaces y OpenShift RBAC.

2. **Nodos Worker (MachineSets y MachineAutoscaler):**
   - Los pools de workers ejecutan los pods de aplicación. Su capacidad se escala mediante MachineSets y MachineAutoscaler (`autoscaling.openshift.io/v1beta1`).
   - El rightsizing de workers analiza CPU y memoria promedio/máxima para sugerir transiciones (ej. de `Standard_D8s_v5` a `Standard_D4s_v5`) reduciendo tanto el costo de cómputo de la VM como la tarifa por vCore de Red Hat.

3. **Desglose Dual/Tripartito de Facturación:**
   - **Cómputo Azure (VMs):** Costo de la infraestructura subyacente de Azure (masters y workers).
   - **Licencia Red Hat OpenShift (ARO Service Fee):** Tarifa por hora por cada vCore asignado al clúster para el soporte y licenciamiento gestionado de Red Hat.
   - **Almacenamiento Persistente (Storage Classes / PVCs):** Managed Disks (Premium SSD / Standard SSD) aprovisionados dinámicamente en el Managed Resource Group (`aro-*`).

---

## 3. Entradas, Fuentes de Datos y APIs
1. **Azure Resource Graph (`Microsoft.RedHatOpenShift/openShiftClusters`):**
   - `properties.masterProfile.vmSize`: Tamaño de VM del plano de control.
   - `properties.workerProfiles`: Array de MachineSets con `vmSize`, `count`, `diskSizeGB`.
   - `properties.clusterProfile.version`: Versión de OpenShift desplegada.
   - `properties.clusterProfile.resourceGroupId`: ID del Managed Resource Group que contiene la infraestructura interna.
   - `properties.apiserverProfile.visibility`: Endpoint del API Server (`Public` / `Private`).
   - `properties.ingressProfiles[0].visibility`: Router default de OpenShift (`Public` / `Private`).
   - `properties.provisioningState`: Estado operativo del clúster (`Succeeded`, `Failed`, `Creating`, etc.).

2. **Azure Cost Management / FOCUS:**
   - Costo acumulado del clúster y desglose mediante cálculo del ARO Fee por vCore hora y residuo de Storage.

3. **Azure Monitor / Container Insights:**
   - Métrica de CPU promedio y percentil 95 (`CpuPercentage`, `node_cpu_utilization`).
   - Métrica de memoria en uso (`MemoryPercentage`, `node_memory_utilization`).

4. **Detección de PVCs Huérfanos en Managed RG:**
   - Detección de discos administrados en el Managed Resource Group con `managedBy == null` no adjuntos a nodos activos.

---

## 4. Reglas de Remediación y Priorización
1. **Consolidación de Clústeres Dev/Test:**
   - *Gatillo:* Clúster en grupo o nombre con tags no productivos (`dev`, `test`, `qa`, `staging`, `sandbox`) con CPU promedio < 20%.
   - *Acción:* `Analizar Fusión de Clúster ✨`. Sugerir consolidación en clúster compartido con aislamiento por Projects/Namespaces.
2. **Rightsizing de Worker MachineSets:**
   - *Gatillo:* CPU promedio < 25% y Memoria < 35% en los pools de workers.
   - *Acción:* `Redimensionar MachineSet ✨`. Transición a SKUs con menor número de vCores (ej. D4s_v5).
3. **Activación de MachineAutoscaler en Workers:**
   - *Gatillo:* Workers en capacidad fija sin MachineAutoscaler activo y baja utilización en horarios valles.
   - *Acción:* `Habilitar Autoscaler ARO ✨`. Aprovisionar manifiesto de `MachineAutoscaler` para reducir workers fuera de hora laboral.
4. **Cobertura con Compute Savings Plans:**
   - *Gatillo:* Clústeres de producción estables 24/7 en modelo Pay-As-You-Go.
   - *Acción:* `Simular Cobertura SP ✨`. Cobertura de la línea base de los 3 masters y workers fijos.
5. **Purga de PVCs Huérfanos:**
   - *Gatillo:* Managed Disks huérfanos detectados en el Managed Resource Group.
   - *Acción:* `Identificar PVCs sin Pod ✨`. Validación en OpenShift CLI (`oc get pvc`) y eliminación segura en Azure CLI.

---

## 5. Trampas Conocidas y Gotchas Técnicos
- **SKU Resolution en Azure Resource Graph:** Los clústeres OpenShift no tienen un `sku.name` plano estándar en ARM. Nunca utilizar propiedades genéricas de SKU que puedan confundirse con App Service (`P2v3`) o VMs estándar. El SKU de ARO debe componerse siempre a partir de `masterProfile.vmSize` y `workerProfiles[0].vmSize`.
- **Managed Resource Group (`aro-*`):** Azure ARO crea un grupo de recursos gestionado interno bloqueado con deny assignments. La inspección de discos huérfanos se hace mediante lectura de metadatos, no mutación directa sin antes desacoplar el PVC en la API de Kubernetes/OpenShift.
- **MachineAutoscaler vs ARM:** `MachineAutoscaler` es un objeto nativo de la API de OpenShift (`openshift-machine-api`), no un recurso directo de ARM. La verificación debe contemplar la API de OpenShift o la telemetría de conteo de nodos a lo largo del tiempo.
- **Estándar de Tablas CMP:** El módulo debe cumplir la Regla #19: filtros inmediatos (Recurso, Región, Perfil/SKU, Grupo), ordenamiento multi-criterio, paginación 15/30/45/60, columnas redimensionables con `ResizableTh` y ancho completo responsive.

---

## 6. Checklist de Verificación
- [x] SKU resuelto correctamente sin interferencias de SKUs de App Service.
- [x] Tarjeta de detalle con 3 columnas nítidas: Identidad & Red, Arquitectura & MachineSets, Métricas & FinOps.
- [x] Desglose de costos tripartito: Cómputo Azure, Licencia Red Hat (ARO Fee) y Storage.
- [x] Motor de recomendaciones resolutivas con las 5 reglas de negocio priorizadas.
- [x] Botones corporativos rectangulares suaves con fondo blanco y borde coincidente.
- [x] InfoTooltips institucionales `#1B2A41` con paridad i18n en ES, EN y PT-BR.
- [x] Mocks completos por tier en `mockData.ts`.


---

# 📄 azure_resourcegraph_SOP.md

> **Archivo fuente:** `directivas/azure_resourcegraph_SOP.md`

# Directiva: Azure Resource Graph Optimization

## Objetivo
Refactorizar la API de recomendaciones (`src/app/api/recommendations/route.ts`) para sustituir los clientes individuales y lentos (Compute/Network) por `@azure/arm-resourcegraph`. Esto permite realizar consultas KQL globales y concurrentes, lo cual reduce el tiempo de escaneo de recursos huérfanos drásticamente y evita los Rate Limits del Azure Service Management API.

## Lógica y Pasos
1. Instalar `@azure/arm-resourcegraph`.
2. Crear la función `getResourceGraphClient(tenantId)` en `src/lib/azure.ts`.
3. Reemplazar la lógica de `route.ts`.
4. Utilizar `client.resources({ query, subscriptions: [subscriptionId] })` para restringir la consulta al scope preciso, evitando costos extra en Azure.
5. Agrupar la respuesta en la estructura JSON `{ unattachedDisks, unusedIps }`.

## Trampas Conocidas / Restricciones
- El SDK de Resource Graph devuelve el payload crudo en la propiedad `response.data`. 
- Es fundamental no quebrar el validador de JWT; se debe interceptar y verificar la identidad antes de delegar la consulta asíncrona a Azure.
- **Nota (KQL ≠ JavaScript):** NUNCA usar `?.` (optional chaining) en queries KQL. Eso es sintaxis de JavaScript/TypeScript, no de Kusto. El operador correcto para acceder a propiedades anidadas en KQL es el punto simple: `connection.properties.privateLinkServiceConnectionState.status`. Usar `?.` causa un error del tipo "Please provide below info when asking for support" en Azure Resource Graph.


### Actualización Fase 4: Multi-Suscripción
- `subscriptionId` ahora es un parámetro opcional.
- Si NO se proporciona, el backend omitirá el atributo `subscriptions` en la llamada de Azure SDK, lo que le instruye nativamente a Resource Graph a escanear **todas las suscripciones** del Tenant.


---

# 📄 azure_sql_finops_cmp_SOP.md

> **Archivo fuente:** `directivas/azure_sql_finops_cmp_SOP.md`

# SOP: Cockpit FinOps de Azure SQL & Managed Instance

## 1. Objetivo
Establecer el procedimiento operativo estándar para la auditoría, optimización de costos y gobernanza de bases de datos relacionales en Azure (Single Database, Elastic Pools y SQL Managed Instance).

## 2. Modelos Arquitectónicos y Esquemas de Compra
1. **Single Database (`Microsoft.Sql/servers/databases`):**
   - **DTU:** Basic (5 DTU), Standard (S0-S12, 10-3000 DTU), Premium (P1-P15).
   - **vCore Provisioned:** General Purpose, Business Critical, Hyperscale (Gen5, 2-128 vCores).
   - **vCore Serverless:** Cómputo escalable por segundo con Auto-Pause tras inactividad (ej. 60 min). Ideal para ambientes Dev/Test con carga intermitente.
   - **Base del Sistema (`master`):** Debe ser marcada con `isSystemDatabase: true` para excluirla de alertas de subutilización o rightsizing.

2. **Elastic Pools (`Microsoft.Sql/servers/elasticpools`):**
   - Agrupación de bases de datos que comparten un pool común de eDTUs o vCores.
   - Recomendado para consolidar múltiples Single DBs con patrones de carga complementarios en un mismo servidor.

3. **SQL Managed Instance (`Microsoft.Sql/managedInstances`):**
   - Compatibilidad 100% con SQL Server on-premises, VNet nativa, Agent y Cross-Database queries.
   - Oportunidades: Azure Hybrid Benefit (AHUB) y Reserved Capacity (1 o 3 años).

## 3. Reglas de Remediación Resolutivas

### Regla 1: Migración a SQL Serverless con Auto-Pause (Dev/Test)
- **Criterio:** Single DB en `vCore-provisioned` con CPU medio < 15% en ambientes no productivos.
- **Azure CLI:**
  ```bash
  az sql db update \
    --resource-group <RG> \
    --server <SERVER> \
    --name <DB> \
    --edition GeneralPurpose \
    --family Gen5 \
    --capacity 2 \
    --compute-model Serverless \
    --auto-pause-delay 60
  ```

### Regla 2: Consolidación en Elastic Pool
- **Criterio:** $\ge 2$ bases independientes subutilizadas compartiendo el mismo servidor lógico.
- **Azure CLI:**
  ```bash
  az sql db update \
    --resource-group <RG> \
    --server <SERVER> \
    --name <DB> \
    --elastic-pool <POOL_NAME>
  ```

### Regla 3: Activación de Azure Hybrid Benefit (AHUB SQL)
- **Criterio:** Instancia vCore o Managed Instance con `licenseType == 'LicenseIncluded'`.
- **Azure CLI:**
  ```bash
  az sql db update \
    --resource-group <RG> \
    --server <SERVER> \
    --name <DB> \
    --license-type BasePrice
  ```

### Regla 4: Reducción de Almacenamiento Asignado (Storage Trim)
- **Criterio:** Almacenamiento asignado supera en >3x al espacio de datos utilizado.
- **Azure CLI:**
  ```bash
  az sql db update \
    --resource-group <RG> \
    --server <SERVER> \
    --name <DB> \
    --max-size <NUEVO_TAMANIO_GB>GB
  ```

### Regla 5: Reserva de Capacidad SQL vCore (1 o 3 años)
- **Criterio:** Elastic Pools o Managed Instances productivas operando 24/7 en PAYG.


---

# 📄 backend_auth_refactor_SOP.md

> **Archivo fuente:** `directivas/backend_auth_refactor_SOP.md`

# Directiva: Refactor Multi-Tenant y Service Principal Auth

## Objetivo
Transicionar el sistema de autenticación de Azure de un modelo local/default a un modelo Multi-Tenant dinámico basado en un Service Principal explícito (`ClientSecretCredential`).

## Lógica y Pasos
1. `azure.ts`: Eliminar `DefaultAzureCredential`. Crear `getAzureCredential(tenantId)` que lea `AZURE_CLIENT_ID` y `AZURE_CLIENT_SECRET` desde el entorno.
2. `azure.ts`: Actualizar los instanciadores `getComputeClient` y `getNetworkClient` para recibir `tenantId` y pasarlo a la credencial dinámicamente.
3. `route.ts` (Recomendaciones y Consumo): Reemplazar la lógica de extracción de URLs. Extraer estrictamente `tenantId` y `subscriptionId`.
4. `route.ts` (Recomendaciones y Consumo): Validar si faltan parámetros, devolviendo 400 Bad Request si es el caso.

## Trampas Conocidas / Restricciones
- Las llamadas a la credencial fallarán con error si las variables `AZURE_CLIENT_ID` y `AZURE_CLIENT_SECRET` no están configuradas en `.env` (esto generará un error 500 controlado o un crash en la inicialización si se usa en top-level. Por eso la inicialización DEBE ser encapsulada en una función dentro del bloque try/catch de las rutas).


---

# 📄 backend_engine_SOP.md

> **Archivo fuente:** `directivas/backend_engine_SOP.md`

# Directiva: Construcción del Motor Backend de FinOps y Configuración Global

## Objetivo
Configurar el backend para comunicación segura con Azure Resource Manager (ARM), extrayendo "Recursos Zombie" e inyectar al mismo tiempo la identidad de marca (colores y tipografías).

## Entradas
- `subscriptionId` a través del parámetro de búsqueda de la URL o variable de entorno (`AZURE_SUBSCRIPTION_ID`).

## Salidas
- `src/lib/azure.ts`: Configuración segura de autenticación con `DefaultAzureCredential`.
- `src/app/api/recommendations/route.ts`: Endpoint REST GET con manejo de errores robusto (500) para escaneo de recursos huérfanos.
- `src/app/layout.tsx` y `src/app/globals.css`: Configuración global de la marca basada en `colores.txt` integrando Tailwind v4.

## Lógica y Pasos (Ejecutados vía script Python)
1. Instalar `@azure/identity`, `@azure/arm-compute`, `@azure/arm-network`.
2. Actualizar la paleta de colores y variables CSS de Tailwind v4 en `globals.css` (`--color-primary`, `--color-secondary`, etc).
3. Configurar fuentes de Google (`Montserrat`, `Open Sans`) en el layout raíz de Next.js.
4. Desarrollar la lógica iterativa de los clientes de Azure en el backend devolviendo `zombieResources`.

## Trampas Conocidas / Restricciones
- **CRÍTICO:** Tailwind CSS v4 ya no utiliza el archivo `tailwind.config.ts`. Todas las variables del tema de Tailwind deben configurarse inyectando código en la regla `@theme inline` dentro de `globals.css`.
- Para iterar sobre el paginador de Azure SDKs (ej. `.list()`), siempre se debe utilizar un ciclo `for await (const item of items)`. Mapearlo directamente con un array method fallará de manera silenciosa o arrojará un error de sintaxis en TypeScript.


---

# 📄 billing_module_SOP.md

> **Archivo fuente:** `directivas/billing_module_SOP.md`

# Billing Module SOP\n\n- **Cost Management API**: `CostManagementClient.query.usage()` devuelve matrices sin nombres de columna. Columna 0 es costo, 1 es fecha, 2 es nombre de dimension.\n- **Fechas**: La API requiere cortes en ISO 8601 sin milisegundos (`YYYY-MM-DDTHH:mm:ssZ`). Para simplificar, se recomienda enviar el Timeframe absoluto `MonthToDate`.\n- **Error Handling**: Las faltas de permisos (`SubscriptionNotFound` o `AuthorizationFailed`) se controlan mediante alertas de interfaz (UI) orientando al usuario a arreglar su RBAC en lugar de pintar errores crudos.\n

---

# 📄 brand_naming_SOP.md

> **Archivo fuente:** `directivas/brand_naming_SOP.md`

# Directiva: Denominación de Marca e Identidad Corporativa (CSCloudSolutions)

## Descripción del Objetivo
Garantizar la consistencia absoluta de la marca e identidad corporativa en todos los componentes del sistema, interfaces de usuario (UI), videos corporativos, copys, documentación y directivas.

## Normativa de Nombre de Marca
- **Nombre Oficial Único:** `CSCloudSolutions`
- **Formato Estricto:** Todo junto, sin espacios intermediarios, con mayúsculas en `C`, `S`, `C` y `S` (`CSCloudSolutions`).
- **Dominio Asociado:** `cscloudsolutions.com.ar` / `finops.cscloudsolutions.com.ar`

## Prohibiciones Explícitas
Queda **estrictamente prohibido** utilizar cualquiera de las siguientes variaciones en código, UI, gráficos, videos o documentación:
- ❌ `CS Cloud Solutions` (con espacios)
- ❌ `CS Cloud`
- ❌ `CSCloud Solutions`
- ❌ `cs cloud solutions`

## Alcance de Aplicación
1. **Componentes de UI / Frontend:** Títulos, encabezados, footers, favicons, alt tags de imágenes y meta etiquetas SEO.
2. **Material Audiovisual y Videos:** Títulos de apertura, banners, tarjetas de presentación, narraciones TTS y marcas de agua.
3. **Documentación & SOPs:** Manuales de usuario, LLD, README y directivas en `directivas/`.

## Trampas Conocidas / Restricciones
- Al generar locuciones de voz (Text-to-Speech / TTS / Narración), pronunciar claramente "CSCloudSolutions" para evitar pausar entre palabras como si fueran términos independientes.


---

# 📄 budget_schedules_SOP.md

> **Archivo fuente:** `directivas/budget_schedules_SOP.md`

# Tag-Based Budgets SOP\n\n- **Servicio**: `budgetService.ts` invoca `CostManagementClient.query.usage` filtrando por el tag `CostCenter`.\n- **API**: `/api/budgets/burn` orquesta la unión entre los límites de DB (MySQL) y el consumo reportado (Azure API).\n

---

# 📄 coin_optimization_index_SOP.md

> **Archivo fuente:** `directivas/coin_optimization_index_SOP.md`

# Procedimiento Operativo Estándar (SOP): Índice de Optimización COIN (Cost Optimization Implementation Number)

## 1. Objetivo
Refactorizar y enriquecer la vista y servicio del **Índice de Optimización (COIN)** en la plataforma SaaS FinOps (Next.js App Router, TypeScript, Tailwind CSS, MySQL) para proveer visibilidad dual de ejecución (volumen de recomendaciones vs. valor monetario capturado), conciliación exacta de los 5 estados de recomendaciones, desglose de los 5 pilares Well-Architected Framework (WAF), serie temporal histórica y lista interactiva de Quick Wins pendientes.

---

## 2. Entradas y Parámetros
- `tenantId` (string, obligatorio): Identificador del tenant.
- `days` (number, opcional, default: 90): Ventana de evaluación histórica.
- Token de autenticación Bearer con validación RBAC (Tier mínimo: Professional).

---

## 3. Lógica de Negocio y Fórmulas
1. **Conciliación Exhaustiva de Estados (Total $N = 75$ en demo / real en prod):**
   - `pending` (o `open`): Recomendaciones abiertas sin acción aún.
   - `accepted` (o `inProgress`): Aceptadas/planeadas para ejecución técnica.
   - `implemented`: Acciones ejecutadas y confirmadas con éxito.
   - `snoozed` (o `suppressed`): Pospuestas temporalmente con fecha de expiración (`expires_at`).
   - `dismissed`: Descartadas formalmente con justificación documentada.
   - **Regla de integridad:** `total = pending + accepted + implemented + snoozed + dismissed`.

2. **Cálculo COIN Dual:**
   - **COIN por Volumen (`coinVolumeRate`):**
     $$\text{coinVolumeRate} = \left(\frac{\text{implementedCount}}{\text{totalCount}}\right) \times 100$$
   - **COIN Financiero (`coinFinancialRate`):**
     $$\text{coinFinancialRate} = \left(\frac{\text{realizedSavings}}{\text{totalPotentialSavings}}\right) \times 100$$
   - `totalPotentialSavings`: Ahorro mensual consolidado de todas las recomendaciones (abiertas + aceptadas + implementadas).
   - `realizedSavings`: Ahorro mensual capturado exclusivamente de las recomendaciones `implemented`.

3. **Categorías Well-Architected Framework (WAF):**
   - 5 pilares oficiales:
     - `Cost` (Optimización de Costos)
     - `Security` (Seguridad y Cumplimiento)
     - `Reliability` / `HighAvailability` (Confiabilidad y Alta Disponibilidad)
     - `Performance` (Rendimiento)
     - `OperationalExcellence` (Excelencia Operativa)
   - Cada categoría reporta: `implemented`, `total`, `coinRate` (%), `potentialSavingsUsd`, `realizedSavingsUsd`.

4. **Tendencia Mensual Histórica:**
   - Serie temporal de los últimos 6 meses con `month` (`YYYY-MM`), `coinRate`, `implementedCount`, `totalCount`.
   - Línea de Benchmark / Meta objetivo: 70% de implementación.

5. **Top Quick Wins Pendientes:**
   - Lista priorizada de las 5 recomendaciones abiertas con mayor ahorro potencial mensual o impacto técnico.
   - Columnas requeridas: Recomendación, Categoría, Recurso Afectado, Ahorro Mensual Estimado, Botón de acción directo / Resolver.

---

## 4. Requerimientos de UI y Estándar Corporativo
- **Colores Corporativos:** Azul profundo `#1B2A41` (títulos, cards, tooltips), Azul acción `#0054A6`, Cyan `#00AEEF`, Verde `#10B981`, Ámbar `#F59E0B`, Rojo `#EF4444`.
- **Tipografías:** Montserrat para títulos (`#1B2A41`), Sans-serif para métricas y tablas.
- **Iconografía:** Tabler Icons (`@tabler/icons-react`).
- **Botones Corporativos:** Fondo blanco puro, borde con color coincidente con el texto.
- **Tooltips e InfoPopovers:** Componente `InfoTooltip` con fondo `#1B2A41` y capa `z-[9999]`.
- **Modales y Drawers:** `fixed inset-0 bg-black/50 z-50` y contenedor en `z-50` o superior (`z-[100]`).
- **Aislamiento de Mocks:** Solo cuando `isMockTenant(tenantId)` es verdadero; en producción consultar Azure Advisor / `RecommendationActions`.
- **Margen de Gráficos:** `margin={{ left: 50, right: 30 }}` en gráficos horizontales de Recharts para que `Operational Excellence` no se trunque jamás.

---

## 5. Casos Borde y Gotchas Conocidos
- En Recharts horizontal, `YAxis` necesita `width={150}` o margen izquierdo amplio para textos largos como "Operational Excellence".
- En caso de división por cero (`totalCount === 0` o `totalPotentialSavings === 0`), retornar tasa 0% sin romper `NaN` o `Infinity`.
- Todas las traducciones deben estar sincronizadas en `messages/es.json`, `messages/en.json` y `messages/pt-BR.json`.


---

# 📄 command_palette_SOP.md

> **Archivo fuente:** `directivas/command_palette_SOP.md`

# Command Palette SOP\n\n- **Atajo de Teclado Uniforme**: La escucha de eventos se programa como `(e.metaKey || e.ctrlKey) && e.key === 'k'` para soportar macOS y Windows/Linux orgánicamente.\n- **Accesibilidad (a11y)**: Se utiliza `cmdk` para heredar las reglas WAI-ARIA de Radix UI, asegurando navegación con flechas de teclado y `Enter` para las vistas FinOps.\n- **Arquitectura Híbrida**: Al montar el componente cliente (`<CommandPalette />`) directamente dentro de `layout.tsx`, logramos que esté suspendido sobre todas las vistas simultáneamente.\n

---

# 📄 compute_efficiency_SOP.md

> **Archivo fuente:** `directivas/compute_efficiency_SOP.md`

# SOP — Compute Efficiency & Unit Economics Dashboard

## 1. Propósito y Alcance
Procedimiento operativo estándar para el cálculo, monitoreo, optimización de tarifas y gobierno de Unit Economics de cómputo en Microsoft Azure (`$/vCore` y `$/GiB RAM`), análisis de mix de arquitectura (ARM / AMD / Intel), generaciones de CPU, utilización efectiva de núcleos y recomendaciones de Rate Optimization.

---

## 2. Métricas y Conceptos Clave
1. **Economía Unitaria Dual:**
   - `$/vCore-mes`: Gasto total de cómputo dividido entre la cantidad de vCores activos.
   - `$/GiB RAM-mes`: Gasto total de cómputo dividido entre los GiB de memoria RAM aprovisionados.
   - `Costo por vCore Efectivo Usado`: `costPerCore / (avgCpuUtilization / 100)`. Refleja el costo real por la capacidad de cómputo que efectivamente trabaja.

2. **Mix de Compra y Compromisos:**
   - Desglose entre PAYG, Spot y Azure Hybrid Benefit (AHUB).
   - Porcentaje de cobertura de compromisos (Reserved Instances y Savings Plans).

3. **Arquitectura y Generaciones:**
   - Distribución de vCores y costo unitario por arquitectura de procesador: ARM (Ampere Altra), AMD (EPYC), Intel (Xeon).
   - Distribución por generación de VM (v3, v4, v5, v6).

4. **Desglose Multi-Dimensional:**
   - Desglose por Región con comparativa porcentual vs. la región más económica.
   - Desglose por Suscripción con resolución de nombres mediante `azureSubscriptionNames.ts`.
   - Desglose por SKU con memoria RAM, tipo de compra, costo total y acciones sugeridas.

---

## 3. Entradas, Fuentes y Agregación
1. **CostMeterSnapshots (Primario) / CostSnapshots (Fallback):**
   - Agrupación por SKU (`MeterSubCategory`), cores (`MeterName`), región (`resource_location`), suscripción (`subscription_id`) y fecha.
   - Idempotencia y exclusión de identificadores no atribuibles (`mg-aggregated`, `default`) para evitar suscripciones ficticias.

2. **Azure Monitor API:**
   - Métrica de utilización de CPU (`Percentage CPU`) sobre las VMs del inventario para calcular la utilización promedio ponderada.

3. **Rate Optimization Engine:**
   - Detección de oportunidades de Savings Plans (cobertura base), migración a arquitectura ARM (v8/v6), activación de Azure Hybrid Benefit (AHUB) en VMs con Windows Server detectado, y arbitraje de región hacia zonas más económicas.

---

## 4. Estándares de Diseño y Experiencia de Usuario
- Gráfica de tendencia con `ResponsiveContainer`, `AreaChart` con gradiente `#0054A6` y `ReferenceLine` para el benchmark de mercado.
- Gráfica de barras horizontales para el mix de arquitectura con código de colores oficial (`#0054A6` Intel, `#00AEEF` AMD, `#10B981` ARM).
- Barras de progreso para el mix de generaciones.
- Tablas completas y responsive con popovers explicativos `#1B2A41` en cada KPI y encabezado de sección.
- Paridad estricta i18n en `messages/es.json`, `messages/en.json`, `messages/pt-BR.json`.


---

# 📄 consumo_real_dinamico_SOP.md

> **Archivo fuente:** `directivas/consumo_real_dinamico_SOP.md`

# SOP — Consumo Real Dinámico, Burn Rate y Detección de Anomalías

## 1. Propósito y Alcance
Transformar la vista de **Consumo Real** (`/intelligence/consumo-y-presupuesto`) de un listado estático de cifras en un monitor ejecutivo de alta resolución para FinOps, que proporcione:
1. **Contexto Financiero Relativo:** % de participación sobre el total (*Share of Wallet*).
2. **Velocidad de Gasto:** *Daily Burn Rate* ($/día) y *Run Rate Proyectado* a fin de mes.
3. **Tendencias y Detección de Anomalías:** Variación MoM (% frente al mes anterior) y alertas de picos (*Spikes*) en las últimas 48h (>30% sobre la media móvil de 14 días).
4. **Desglose en 1-Clic (*Drill-Down Drawer*):** Granularidad FOCUS (BilledCost vs. EffectiveCost) a nivel de recurso individual (SKU, Región, Grupo de Recursos).
5. **Remediaciones Resolutivas Específicas:** Acciones rápidas de optimización por servicio dominante (Redis Cache, Azure Container Apps, Foundry Models, Cognitive Search, Container Registry, Virtual Network / LB).

---

## 2. Métricas Clave y Fórmulas Matemáticas

### A. Participación sobre el Total (Share of Wallet)
$$\text{ShareOfWallet}_i = \left( \frac{\text{Costo MTD del Servicio}_i}{\text{Gasto Total MTD}} \right) \times 100$$
- Visualización: Barra de progreso horizontal en cada tarjeta de servicio y *Stacked Progress Bar* global en el encabezado para el Top 5.

### B. Velocidad de Gasto (Daily Burn Rate)
$$\text{DailyBurnRate}_i = \frac{\text{Costo MTD del Servicio}_i}{\text{Días Transcurridos del Mes en Curso}}$$
- Precisión: Uso de tipos exactos (`Decimal.js`), evitando imprecisiones de coma flotante.

### C. Run Rate Proyectado a Fin de Mes
$$\text{ProjectedCost}_i = \text{DailyBurnRate}_i \times \text{Días Totales del Mes (28-31)}$$

### D. Variación Mes sobre Mes (MoM %)
$$\text{MoM} = \left( \frac{\text{Costo Día } d \text{ Mes Actual} - \text{Costo Día } d \text{ Mes Anterior}}{\text{Costo Día } d \text{ Mes Anterior}} \right) \times 100$$

### E. Detección de Anomalías / Spikes (Últimas 48 Horas)
$$\text{Gasto Diario Reciente (48h)} > 1.30 \times \text{Media Móvil (14 días)}$$
- Asignación de flag `hasAnomaly: true` con badge ámbar destacado en la tarjeta y en el drawer.

---

## 3. Matriz de Remediaciones Resolutivas por Servicio Dominante

| Servicio / Categoría | Condición de Alerta | Acción Resolutiva Sugerida | Ahorro Est. Mensual |
| :--- | :--- | :--- | :--- |
| **Redis Cache** | Mayor costo MTD (>20% total) o tier Standard/Premium en ambientes no-prod | `Evaluar SKU Basic / C1 ✨` | ~$40/mes |
| **Azure Container Apps** | Réplicas mínimas > 1 sin tráfico sostenido 24/7 | `Configurar Scale-to-Zero ✨` | ~$25/mes |
| **Foundry Models / AI** | Inferencia de tokens sin límite de cuota o picos en 48h | `Activar Límite de Cuota ✨` | Variable (~30%) |
| **Azure Cognitive Search** | Tier Standard con bajo volumen de queries/índices | `Revisar Réplicas / Tier ✨` | ~$50/mes |
| **Container Registry (ACR)** | Tier Standard/Premium sin Geo-Replication activa | `Downgrade a Basic ($5/mes) ✨` | ~$15/mes |
| **Virtual Network / LB** | IPs públicas inactivas o Load Balancers sin backends | `Auditar IPs Públicas / NAT ✨` | ~$30/mes |

---

## 4. Estándar Visual y de Interacción (Frontend & UI)

1. **Header Principal de Consumo:**
   - Tarjeta destacada con Gasto Total MTD, Proyección a Fin de Mes, Burn Rate Diario General, Badge MoM y contador de días transcurridos.
   - Barra de distribución global apilada (*Stacked Progress Bar*) con colores corporativos armónicos (`#0054A6`, `#00AEEF`, `#10B981`, `#8B5CF6`, `#F59E0B`, `#64748B`).
2. **Smart Service Cards:**
   - Botones/Cards interactivos con cursor `pointer` y micro-hover suave.
   - Badge MoM dinámico (Verde para reducción, Rojo/Ámbar para incremento).
   - Badge de Anomalía con icono de alerta si `hasAnomaly` es verdadero.
   - Barra de progreso horizontal con el % de peso.
   - Badge de recomendación FinOps contextual.
3. **Drill-down Drawer / Modal:**
   - Despliegue lateral animado al hacer clic en cualquier tarjeta.
   - Tabla de recursos individuales con columnas: Recurso, Grupo de Recursos, Región, SKU, BilledCost (FOCUS), EffectiveCost (FOCUS), Costo MTD y Acción de Optimización.
4. **Botones Corporativos:**
   - Fondo blanco puro (`bg-white dark:bg-slate-900`) con borde y texto coincidente según la Regla #21 de `AGENTS.md`.
5. **Tooltips Informativos:**
   - Componente `InfoTooltip` en títulos, KPIs, tarjetas y cabeceras de tabla conforme a la Regla #22.
6. **Internacionalización (i18n):**
   - Sincronización obligatoria en `messages/es.json`, `messages/en.json` y `messages/pt-BR.json` bajo el namespace `RealConsumptionMonitor`.

---

## 5. Protocolo de Fallback y Resiliencia
1. **Live Azure Cost Management:** Consulta de uso MTD y descomposición por `ServiceName` y `ResourceId`.
2. **Fallback CostSnapshots:** Si Azure API rechaza la llamada o hay límite de rate, consultar agregaciones de la tabla `CostSnapshots`.
3. **Ambiente Mock / Demo:** Cobertura enriquecida por tiers (Professional, Business, Enterprise) en `src/lib/mockData.ts` con los valores calibrados del tenant de demostración.


---

# 📄 control_acceso_login_usuarios_registrados_SOP.md

> **Archivo fuente:** `directivas/control_acceso_login_usuarios_registrados_SOP.md`

# SOP - Control de Acceso Estricto en Login para Usuarios Registrados y Compras Reales

## Objetivo
Garantizar que únicamente los usuarios que existan efectivamente en la base de datos (`Users` / `Tenants`) o que cuenten con una compra/suscripción activa puedan acceder a las rutas y módulos internos del SaaS CSCloudSolutions. Si un usuario autenticado mediante Microsoft Entra ID / SSO no existe en la base de datos ni posee un entorno asociado, el sistema debe bloquear el acceso y desplegar una pantalla de advertencia institucional clara.

---

## Flujo Lógico y Principios de Autorización

1. **Autenticación vs. Autorización**:
   - La autenticación (MSAL / Microsoft Entra ID) comprueba la identidad criptográfica del usuario.
   - La autorización comprueba si esa identidad pertenece a una organización registrada en la base de datos de CSCloudSolutions (`Tenants` / `Users` / `BillingTransactions`).
2. **Validación en `/api/tenants`**:
   - `SuperAdmin` (dominio `@cscloudsolutions.com.ar` o `Users.system_role = 'SUPERADMIN'`): acceso total a los entornos.
   - `Usuario Corporativo`: debe existir en `Users` vinculado a un `tenant_id`, o su `tenant_id` de Microsoft Entra debe coincidir con un `Tenants` con suscripción activa o credenciales cargadas.
   - Si no existe: `/api/tenants` devuelve `tenants: []` e `isRegistered: false`. Bajo ninguna circunstancia se inyectan `mockTenants` a usuarios no registrados.
3. **Estado Global en `TenantProvider`**:
   - No generar ningún tenant fallback sintético (`Mi Entorno (Azure)`).
   - Exponer la bandera `isUserRegistered: boolean | null`.
4. **Barrera de Acceso en `ClientShell`**:
   - Si `isAuthenticated === true` pero `isUserRegistered === false` (y no es una ruta demo o pública):
     - Interceptar y renderizar `<UnregisteredUserScreen />`.
     - Mostrar mensaje informativo con el email autenticado, motivo del bloqueo y 3 acciones:
       1. Ver Planes y Precios (para adquirir licencia).
       2. Contactar a Soporte (`soporte@cscloudsolutions.com.ar`).
       3. Cerrar Sesión / Cambiar Cuenta (`instance.logoutRedirect()`).

---

## Restricciones y Casos Borde

1. **Cuentas Personales (MSA / Outlook / Hotmail)**:
   - Se rechazan inmediatamente con `MSA_CONSUMERS_TENANT_ID` (error 403).
2. **Rutas Demo (`/demo`)**:
   - Continúan operando mediante el session context de demo sin requerir base de datos.
3. **Rutas Públicas y Tokens de Invitación**:
   - `/legal/*`, `/status`, `/pricing`, `/auth/accept-invite/*` se excluyen de la intercepción para permitir el onboarding.


---

# 📄 cosmosdb_finops_cmp_SOP.md

> **Archivo fuente:** `directivas/cosmosdb_finops_cmp_SOP.md`

# SOP: Optimización FinOps de Azure Cosmos DB (NoSQL & MongoDB vCore)

## 1. Objetivo
Proveer análisis determinista de sobreprovisionamiento de RU/s, fragmentación de índices, políticas de consistencia multi-región y rightsizing de clústeres MongoDB vCore en Azure Cosmos DB.

## 2. Modelos de Arquitectura
1. **Azure Cosmos DB NoSQL (RU-based):**
   - Modelos: Manual Throughput, Autoscale (10% - 100%) y Serverless (on-demand).
   - Métricas: Throughput Normalizado (`NormalizedRU`), Tasa de Throttling HTTP 429 (`ThrottledRequests`), Ratio de Índices (`IndexRatio`).
   - Gotchas: La directiva de indexación indexa todo por defecto (`/*`). Configurar `excludedPaths` reduce el costo de escritura en un 20-50%.

2. **Azure Cosmos DB for MongoDB vCore (vCore-based):**
   - Modelos: M25, M30, M40, M50, M60, M80, M100, M200.
   - Recursos: `Microsoft.DocumentDB/mongoClusters`.
   - **Gotcha Azure CLI (CRÍTICO):** El comando `az cosmosdb mongocluster update` de la extensión `cosmosdb-preview` NO acepta `--tier` ni `--sku`. El parámetro oficial exacto para el tamaño de cómputo del nodo shard es **`--shard-node-tier`** (ej: `--shard-node-tier "M30"`).

## 3. Snippets Deterministas de Remediación

### A. Rightsizing de MongoDB vCore (Azure CLI)
```bash
az cosmosdb mongocluster update \
  --cluster-name <NOMBRE_CLUSTER> \
  --resource-group <GRUPO_RECURSOS> \
  --shard-node-tier "M30"
```

### B. Rightsizing de MongoDB vCore (Bicep / ARM)
```bicep
resource mongoCluster 'Microsoft.DocumentDB/mongoClusters@2024-07-01' = {
  name: '<NOMBRE_CLUSTER>'
  location: '<REGION>'
  properties: {
    nodeGroupSpecs: [
      {
        kind: 'Shard'
        sku: 'M30'
        diskSizeGB: 128
        nodeCount: 1
      }
    ]
  }
}
```

### C. Ajuste de Indexing Policy en NoSQL (Azure CLI)
```bash
az cosmosdb sql container update \
  --account-name <NOMBRE_CUENTA> \
  --resource-group <GRUPO_RECURSOS> \
  --database-name <DB_NAME> \
  --name <CONTAINER_NAME> \
  --idx @indexingPolicy.json
```


---

# 📄 costo_por_categoria_dinamico_SOP.md

> **Archivo fuente:** `directivas/costo_por_categoria_dinamico_SOP.md`

# SOP: Monitor Dinámico y Resolutivo de Costo por Categoría FinOps (FOCUS)

## 1. Contexto y Objetivos
Transformar la sub-pestaña **"Por Categoría"** (`/intelligence/cost-by-category` y dentro de `/intelligence/consumo-y-presupuesto`) de un gráfico estático en un **panel analítico jerárquico y resolutivo de control presupuestario por pilar FinOps**.

### Objetivos Clave:
1. **Clasificación FOCUS / FinOps Toolkit:** Agrupación estandarizada por `ServiceCategory` (Databases, Compute, Networking, Storage, AI and Machine Learning, Security, Management and Governance, Analytics, Web, Other).
2. **Desglose Multinivel (1-Click Drill-Down):** `Categoría` -> `Servicios Subyacentes` -> `Instancias / Recursos individuales` (SKUs, Región, Resource Group, Costo).
3. **Evolución Temporal Apilada (Stacked Area Chart 6M):** Tendencia histórica mensual de distribución del gasto por categoría.
4. **Control Presupuestario por Categoría:** Seguimiento de presupuesto asignado vs ejecutado por pilar con alertas semafóricas.
5. **Variación MoM y Velocidad de Gasto:** Variación porcentual mes a mes y Daily Burn Rate ($/día).
6. **Oportunidades de Remediación Resolutivas:** Acciones directas por categoría dominante (Reserved Capacity en DBs, Egress/NAT en Networking, Rightsizing & Scale-to-Zero en Compute).
7. **Aislamiento Estricto de Mocks:** Mocks calibrados **únicamente** para `isMockTenant(tenantId)`. Los tenants reales consultan Cost Management en vivo y `CostSnapshots` / `CostCategorySnapshots`.
8. **Popovers y Tooltips no bloqueados:** Uso estricto de `InfoTooltip` con React Portal a `document.body` y posicionamiento `fixed` dinámico.

---

## 2. Fórmulas Matemáticas y Reglas de Negocio
- **Share of Wallet (% sobre Total):**
  $$\text{Share} = \left(\frac{\text{Costo Categoría MTD}}{\text{Costo Total MTD}}\right) \times 100$$
- **Daily Burn Rate ($/día):**
  $$\text{Burn Rate} = \frac{\text{Costo Categoría MTD}}{\text{Días Transcurridos del Mes}}$$
- **Proyección a Fin de Mes (Run Rate):**
  $$\text{Proyección} = \text{Burn Rate} \times \text{Días Totales del Mes}$$
- **Variación Mensual (MoM %):**
  $$\Delta\% = \left(\frac{\text{Costo Mes Actual} - \text{Costo Mes Anterior}}{\text{Costo Mes Anterior}}\right) \times 100$$
- **Detección de Spike / Anomalía:**
  $$\text{hasSpike} = \text{true} \quad \text{si } \Delta\% > 15\% \text{ y Costo} > \$10$$

---

## 3. Matriz de Remediación por Categoría Dominante
| Categoría | Gotcha Común / Desviación | Acción Resolutiva Sugerida | Ahorro Est. |
|---|---|---|---|
| **Databases** | Servidores MySQL/PostgreSQL/Redis aprovisionados 24/7 sin reserva ni escalado | `[Ver Recomendaciones DB ✨]` (Reserved Capacity 1y / Downgrade SKU) | 25% - 40% |
| **Networking** | Egress elevado, Gateways NAT subutilizados, IPs públicas huérfanas | `[Auditar Flujos y NAT/IPs ✨]` | 20% - 50% |
| **Compute** | VMs de tamaño excesivo y Container Apps con réplicas fijas sin tráfico | `[Rightsizing de VMs/Containers ✨]` (Scale-to-Zero / B-series) | 30% - 45% |
| **AI & ML** | Inferencia sin cuotas de tokens diarias o modelos sobredimensionados | `[Configurar Cuotas de Inferencia ✨]` | 20% - 40% |
| **Storage** | Blobs en Hot sin lifecycle policy a Cool/Archive | `[Activar Lifecycle Management ✨]` | 15% - 30% |

---

## 4. Checklist de Validación
- [ ] Mocks sólo en `isMockTenant` y aislados del flujo de producción.
- [ ] Los popovers y tooltips flotan sobre `document.body` (`z-index: 999999`) sin recortarse por `overflow: hidden`.
- [ ] Tabla del Drawer con búsqueda, filtros, ordenación y exportación CSV.
- [ ] Internacionalización en `es.json`, `en.json` y `pt-BR.json`.
- [ ] Typecheck y tests en verde (0 errores).


---

# 📄 dark_mode_SOP.md

> **Archivo fuente:** `directivas/dark_mode_SOP.md`

# Dark Mode SOP\n\n- **Arquitectura Híbrida Tailwind 4**: Usamos custom-variant dark en globals.css para permitir alternado por clase.\n- **Next-Themes**: El proveedor ThemeProvider envuelve ClientShell con attribute class y suppressHydrationWarning en la raíz html.\n- **Adopción Temática**: Se inyectaron gradualmente las variantes dark: en los componentes estructurales (Header, Sidebar, Shell, etc).\n

---

# 📄 dashboard_fixes_SOP.md

> **Archivo fuente:** `directivas/dashboard_fixes_SOP.md`

# Directiva: Correcciones de Dashboard, Auditoría y Gobernanza

## Objetivo
Implementar mejoras estructurales en tres componentes principales de la interfaz de administración: el Selector de Tenant, el Widget de Gobernanza y el Motor Principal de Auditoría (Resource Graph).

## Lógica y Pasos
1. **Tenant Selector (`/api/tenants`)**
   - Modificar la consulta MySQL para extraer `company_name` y `primary_domain`.
   - Modificar el mapeo JSON para utilizar `company_name` como primera opción, `primary_domain` como fallback, u "Organización Desconocida" en caso de que ambos sean nulos.

2. **Dashboard Widget (`app/page.tsx`)**
   - En el contenedor de "Estado de Gobernanza", interceptar la condición de `complianceScore === -1`.
   - Inyectar el botón `Configurar Políticas` en la interfaz utilizando la función `setActiveTab('tags')` provista por el contexto visual.

3. **Motor de Auditoría (`auditService.ts`)**
   - Evitar el falso positivo "100% OK".
   - Si no hay `subscriptionId` explícito, ejecutar una query de pre-auditoría: `ResourceContainers | where type == 'microsoft.resources/subscriptions' | project subscriptionId`.
   - Extraer todos los IDs mapeados e inyectarlos en la función constructora `client.resources({ subscriptions: [subs], query: ... })`.
   - Lanzar un `Error` si la lista queda vacía para abortar la tabla frontend e informar correctamente al usuario.

## Trampas Conocidas / Restricciones
- La API de Azure Resource Graph asume scopes predeterminados para usuarios, pero **exige** declaraciones explícitas en el parámetro `subscriptions` para el `ClientSecretCredential`. Si pasas un array vacío `[]` te devuelve un resultado vacío en lugar de un error.
- En la base de datos, **no** intentes consultar la columna `primary_domain` ya que no existe en el esquema de producción. El `company_name` ya almacena el fallback del dominio extraído del email en el cliente. Por lo tanto, debes continuar consultando `company_name as name`.


---

# 📄 dashboard_reactivity_and_responsiveness_SOP.md

> **Archivo fuente:** `directivas/dashboard_reactivity_and_responsiveness_SOP.md`

# SOP: Reactividad del Selector de Suscripción y Responsividad de Gráficos de Fugas

## Objetivo
1. Asegurar que las tarjetas y tablas de la página principal (Dashboard) y de los paneles de detalle (Zombie Resources y Azure Advisor) reaccionen y se actualicen inmediatamente al cambiar la suscripción en el selector global.
2. Garantizar que los gráficos circulares (Pie Charts) de distribución de fugas financieras sean completamente responsivos y se adapten dinámicamente al tamaño de su contenedor, tanto en el Dashboard principal como en el módulo de Billing.
3. Resolver los errores y fallas de carga de datos que ocurren al consultar el tenant "como un todo" (tenant-wide / sin suscripción específica) optimizando el plan de consultas (batching) y la definición de scopes.

## Lógica y Pasos

### 1. Reactividad y Sincronización del Selector de Suscripción
- **Dashboard Principal (`src/app/[locale]/page.tsx`)**:
  - Consumir el hook `useSubscription()` para obtener el valor global de `selectedSubscription`.
  - Agregar `selectedSubscription` a la lista de dependencias del `useEffect` principal que realiza las peticiones a la API.
  - Modificar las URLs de petición para incluir el parámetro `&subscriptionId=${selectedSubscription}` (filtrando por la suscripción seleccionada) al llamar a `/api/audit/full` y `/api/advisor`.
  - En la respuesta de Advisor, si se ha seleccionado una suscripción específica, filtrar las recomendaciones por `subscriptionId` en el cliente antes de sumar el ahorro proyectado, ya que el endpoint `/api/advisor` devuelve el set completo del tenant.
- **Tabla de Recursos Zombie (`src/components/ZombieResourcesTable.tsx`)**:
  - Consumir el hook `useSubscription()` para leer `selectedSubscription` y actualizar la función de cambio global `setSelectedSubscription`.
  - Sincronizar el estado interno de la tabla `selectedSub` mediante un `useEffect` que observe `selectedSubscription`.
  - Al cambiar el dropdown propio de la tabla, no solo actualizar el estado local sino llamar a `setSelectedSubscription` para propagar el cambio al selector global y a todo el portal.
- **Panel de Azure Advisor (`src/components/AdvisorPanel.tsx`)**:
  - Consumir el hook `useSubscription()` para obtener `selectedSubscription` y actualizar `setSelectedSubscription`.
  - Sincronizar el estado interno del panel `selectedSub` mediante un `useEffect` que observe `selectedSubscription`.
  - Al cambiar el dropdown del panel, propagar el cambio llamando a `setSelectedSubscription`.

### 2. Responsividad de los Gráficos de Fugas (Pie Charts) y Mapeo de Nombres de Suscripciones
- **Componentes de Gráficos (`src/components/CostPieChart.tsx` y `src/components/dashboard/FocusCostPieChart.tsx`)**:
  - Reemplazar la restricción de altura mínima estática `min-h-[350px]` por una altura responsiva adaptable `h-full min-h-[220px]`.
  - Utilizar un contenedor relative con `absolute inset-0` para albergar a `<ResponsiveContainer width="100%" height="100%">` de Recharts. Esto asegura que Recharts pueda calcular correctamente sus dimensiones (ancho y alto) evitando el error de renderizado de `width(-1)` y `height(-1)`.
  - **Evitar recortes verticales (Clipping)**: En contenedores de altura fija (como `h-64` / 256px) con leyenda activa, usar radios moderados (`innerRadius={45}`, `outerRadius={70}`) y una expansión de forma activa de máximo `outerRadius + 6`. Radios mayores (ej. 65/95) causan desbordamiento del SVG resultando en arcos cortados verticalmente (flat top/bottom).
  - **Mapeo de Nombres descriptivos**: En gráficos de costo por suscripción (`FocusCostPieChart.tsx`), importar y consumir `useSubscription` para mapear los UUIDs de `SubAccountId` a sus respectivos nombres en `subscriptions` (`sub.name`), previniendo mostrar IDs crudos en la leyenda y tooltips.
- **Módulo de Billing / Dashboard Interactivo (`src/components/dashboard/InteractiveDashboard.tsx`)**:
  - Ajustar el contenedor de la "Distribución de fugas financieras" y de "Spend by Subscription" para que tengan un diseño responsivo real (`h-64 w-full relative` con contenedores absolutos internos) y no causen desbordamiento o fallas de medición en flexbox.
  - Asegurar la consistencia visual del gráfico de fugas de esta sección usando radios moderados (`innerRadius={45}`, `outerRadius={70}`).

### 3. Optimización de Consultas Tenant-Wide (Como un todo)
- **Evitar Errores de Permisos (403/AccessDenied) por Scope Implícito**:
  - Cuando se selecciona el tenant "como un todo" (`selectedSubscription === 'All'`), los endpoints del backend que consumen Resource Graph (`/api/audit/full`, `/api/tags/compliance`, `/api/recommendations`, `/api/intelligence/rightsizing`, y `/api/intelligence/sustainability`) **no deben** realizar consultas omitiendo el parámetro `subscriptions`.
  - Omitir el parámetro hace que Azure Resource Graph intente buscar en todas las suscripciones del directorio Azure AD, lo que falla con un error `403` si la credencial (Service Principal) solo tiene acceso de Lector a un subconjunto de suscripciones.
  - En su lugar, se debe obtener explícitamente el listado de suscripciones autorizadas mediante la API de Azure Resource Manager (`/subscriptions`) y pasarlas como un array de IDs en la propiedad `subscriptions` del cliente de Resource Graph.
  - Implementar un helper compartido `getSubscriptionsForTenant(tenantId)` en `src/lib/azure.ts` para este propósito.
- **Evitar Throttling (429/RateLimiting) y Timeouts**:
  - Azure Resource Graph restringe las llamadas a un límite estricto de 15 solicitudes en una ventana de 5 segundos.
  - El motor de auditoría ejecuta 38 consultas KQL secuenciales en lotes. Si el lote es demasiado grande (ej. 5) o la pausa es insuficiente (ej. 1.5s), superamos el límite rápidamente y entramos en un ciclo de retries bloqueantes que hace que la API tarde más de 40 segundos, provocando un timeout HTTP en el navegador.
  - Modificar `runInBatches` en `src/services/auditService.ts` para usar lotes de `12` consultas con un retraso (delay) inter-lote de `4500` ms. Esto asegura que nunca se ejecuten más de 12 consultas en cualquier ventana de 5 segundos, previniendo por completo el throttling de Azure.
  - Implementar un bucle de reintentos resiliente con retroceso exponencial (exponential backoff) para manejar cualquier fluctuación de red o pico de rate limit.

## Restricciones y Trampas Conocidas
- Al usar `ResponsiveContainer` con `height="100%"`, el contenedor padre inmediato DEBE tener una altura explícitamente definida. Si el padre inmediato es un flexbox sin altura explícita, Recharts fallará y el gráfico desaparecerá o mostrará advertencias en la consola.
- El valor del selector global de suscripciones es `"All"` (con la "A" mayúscula) cuando no hay ninguna suscripción específica seleccionada. Sin embargo, los endpoints de API y algunos dropdowns locales pueden utilizar `"all"` (en minúsculas). Se debe normalizar esta conversión.


---

# 📄 data_caching_SOP.md

> **Archivo fuente:** `directivas/data_caching_SOP.md`

# SOP: Estrategia de Data Caching

## Objetivo
Implementar una capa de almacenamiento en caché para los datos de facturación de Azure y las recomendaciones de ahorro para evitar realizar llamadas lentas a las APIs externas en cada carga del dashboard.

## Lógica y Pasos

### 1. Tablas de Caché en MySQL
- `CostSnapshots`: Almacena el costo facturado ayer para cada Resource Group, Service Name y Subscription.
- `RecommendationsCache`: Almacena la suma de ahorros potenciales por cada categoría de recomendación (ej. 'Cost', 'Security') por tenant y día.
- Implementar llaves únicas compuestas para permitir inserciones y actualizaciones idempotentes (`INSERT INTO ... ON DUPLICATE KEY UPDATE`).

### 2. Tarea de Sincronización Programada (CRON)
- Un endpoint expuesto en `/api/cron/sync` que es activado de forma segura (verificación de Bearer Token secreto `CRON_SECRET`).
- Iterar sobre todos los inquilinos activos.
- Para cada uno, realizar una consulta del día de ayer a Azure Cost Management API con granularidad diaria agrupando por Resource Group, Service Name y Subscription ID, guardando los resultados en `CostSnapshots`.
- Consultar las recomendaciones de Azure Advisor, consolidar el ahorro acumulado por tipo y guardarlo en `RecommendationsCache`.

### 3. Redirección de APIs del Dashboard
- Refactorizar `/api/intelligence/billing` para que realice un SELECT directo a la base de datos local `CostSnapshots` en lugar de llamar al SDK de Azure.
- Mapear las filas de la base de datos de vuelta al formato `FocusCostEntry[]` esperado por el frontend.

## Restricciones y Trampas Conocidas
- **Nombres de Columna Opcionales**: Las columnas devueltas por Azure query (`c.name`) en TypeScript pueden ser de tipo `string | undefined`. Asegurar el manejo seguro de nulos en `findIndex` mediante `(c.name || '').toLowerCase()`.
- **Estructura de Datos**: El dashboard espera que la propiedad `SubAccountId` contenga el Subscription ID de Azure para clasificar el gasto por suscripción en el gráfico circular. Conservar esta correlación guardando el ID de suscripción en la tabla.


---

# 📄 db_caching_prep_SOP.md

> **Archivo fuente:** `directivas/db_caching_prep_SOP.md`

# SOP: Preparación de Base de Datos para Caching de Costos Diarios

## Objetivo
Preparar la base de datos MySQL mediante la definición de esquemas y funciones auxiliares para soportar la sincronización nocturna de costos diarios y latido de salud de los inquilinos.

## Lógica y Pasos

### 1. Actualización de Esquema
- Crear e inicializar la tabla `cost_snapshots`:
  - `id INT AUTO_INCREMENT PRIMARY KEY`
  - `tenant_id VARCHAR(255)`
  - `sync_date DATE`
  - `total_cost_usd DECIMAL(10,2)`
  - `currency VARCHAR(10)`
  - `created_at TIMESTAMP`
  - `UNIQUE KEY unique_tenant_sync_date (tenant_id, sync_date)` (Para soportar `ON DUPLICATE KEY UPDATE` basado en tenant y fecha).
- Crear e inicializar la tabla `tenant_health`:
  - `tenant_id VARCHAR(255) PRIMARY KEY`
  - `last_sync_at TIMESTAMP`
  - `sync_status VARCHAR(50)`
  - `last_error TEXT`

### 2. Funciones del Servicio de DB (`db.ts`)
- Exportar `insertCostSnapshot(tenantId, date, cost, currency)`:
  - Realizar una consulta SQL `INSERT INTO cost_snapshots ... ON DUPLICATE KEY UPDATE total_cost_usd = VALUES(total_cost_usd)`.
- Exportar `updateTenantHealth(tenantId, status, errorMsg)`:
  - Realizar una consulta SQL `INSERT INTO tenant_health (tenant_id, last_sync_at, sync_status, last_error) VALUES (?, CURRENT_TIMESTAMP, ?, ?) ON DUPLICATE KEY UPDATE last_sync_at = CURRENT_TIMESTAMP, sync_status = VALUES(sync_status), last_error = VALUES(last_error)`.

## Restricciones y Trampas Conocidas
- Usar nombres de tabla exactamente como se indican: `cost_snapshots` y `tenant_health` (en minúsculas).
- Utilizar `ON DUPLICATE KEY UPDATE` para garantizar la idempotencia de los datos diarios, previniendo duplicados cuando se vuelve a correr el cron el mismo día.


---

# 📄 db_onboarding_SOP.md

> **Archivo fuente:** `directivas/db_onboarding_SOP.md`

# Directiva: MSAL Onboarding y MySQL Upserts

## Objetivo
Implementar la capa de persistencia local (MySQL). Al recibir un token válido a través del flujo de MSAL React, el backend debe registrar al nuevo inquilino (Tenant) y al usuario (User Administrator) en la base de datos de FinOps, garantizando la integridad referencial.

## Lógica y Pasos
1. Archivo `schema.sql`: Definir sentencias `CREATE TABLE IF NOT EXISTS` para `Tenants` y `Users` con clave foránea en `tenant_id` y restricción en cascada.
2. Pool `db.ts`: Implementar función `initializeDatabase()` que lea asíncronamente el archivo `schema.sql` y ejecute las sentencias una única vez por instancia activa.
3. API `/api/onboard`: 
   - Parsear el Header de Autenticación.
   - Extraer `tid`, `oid`, `name`, y `preferred_username`.
   - Utilizar transacciones SQL para `UPSERT` en `Tenants` y posteriormente en `Users` para evitar errores de claves foráneas.
4. UI `AuthProvider.tsx`: Inicializar MSAL, lanzar `loginPopup()`, capturar el `accessToken` y hacer fetch hacia la API de Onboarding.

## Trampas y Restricciones

1. **MySQL 8 y `caching_sha2_password` (Error de Acceso Denegado)**:
   - *Problema*: Al ejecutar la base de datos en Docker con MySQL 8.0+, la conexión desde Node.js (host a container) puede fallar con `Access denied for user 'finops_user'@'...'`. Esto ocurre porque Docker levanta MySQL con el plugin `caching_sha2_password` por defecto, el cual requiere configuración estricta de SSL o puede tener conflictos con la IP del gateway de Docker.
   - *Solución*: Debes conectarte a la base de datos y cambiar el plugin de autenticación del usuario a `mysql_native_password` ejecutando:
     `ALTER USER 'finops_user'@'%' IDENTIFIED WITH mysql_native_password BY 'finopspassword'; FLUSH PRIVILEGES;`
   - *Prevención*: En entornos de desarrollo locales con Docker, es preferible añadir `--default-authentication-plugin=mysql_native_password` al `command` de `docker-compose.yml`.

2. **Evitar duplicados (Idempotencia)**: Usamos `INSERT IGNORE` para el Tenant y `ON DUPLICATE KEY UPDATE` para Users. Si un usuario ya existe, simplemente se actualiza su email para mantener el rol de administrador intacto.


---

# 📄 demo_lead_modal_SOP.md

> **Archivo fuente:** `directivas/demo_lead_modal_SOP.md`

# Directiva: Demo Lead Gate Modal

## Descripción del Objetivo
Implementar una barrera de entrada obligatoria (Demo Gate) antes de que un usuario pueda acceder a las rutas de `/demo`. El usuario debe completar un formulario de leads que validará un reCAPTCHA v3 e informará al equipo de ventas de CSCloudSolutions por correo.

## Entradas
- Nombre Completo (fullName)
- Correo Electrónico (email)
- Teléfono (phone)
- Nombre de la empresa (companyName)
- reCAPTCHA Token (recaptchaToken)

## Salidas
- Formulario completado con éxito (Status 200).
- Correo de notificación enviado a `sales@cscloudsolutions.com.ar`.
- State en localStorage `hasCompletedDemoLead = true` en el frontend.

## Lógica y Pasos a Seguir
1. **Frontend (Modal):**
   - Renderizar modal con z-index alto y fondo oscuro translúcido (`bg-black/70`).
   - Evitar cualquier opción de cierre o dismiss (sin botón X, sin cerrar en blur).
   - Generar el token reCAPTCHA en el cliente utilizando la Site Key provista al hacer submit.
2. **Backend (API):**
   - Recibir los datos.
   - Validar el token contra la API de Google reCAPTCHA. Debe arrojar un score >= 0.5.
   - Enviar un correo de notificación usando el token de MS Graph API con las credenciales de entorno (`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, etc.).
   - Retornar éxito.
3. **Frontend (Integración):**
   - Integrar el modal en `src/app/[locale]/demo/page.tsx`.
   - Mostrar el modal solo si el state en localStorage es falso.
   - Bloquear el scroll del background (`overflow: hidden`) mientras esté abierto.

## Restricciones y Casos Borde
- **Precaución 1:** No dejar que el componente se renderice en el servidor (SSR) si depende de `localStorage`. Utilizar `useEffect` para montar el estado, u obligar a renderizarlo siempre si no se encuentra el flag localmente para evitar parpadeos (Hydration Mismatch).
- **Precaución 2:** Google reCAPTCHA v3 requiere que el token se asocie a una acción específica o se cargue de forma dinámica sin entorpecer el flujo. Asegurarse de usar la tag `<script>` o `next/script` correctamente.


---

# 📄 design_system_branding_SOP.md

> **Archivo fuente:** `directivas/design_system_branding_SOP.md`

# Directiva: Sistema de Diseño Corporativo, Paleta Empresarial, Tipografía e Iconos Tabler

## Descripción del Objetivo
Garantizar la consistencia estética, elegancia visual y alineación estricta con la identidad corporativa de **CSCloudSolutions** en todas las vistas, componentes, paneles de control, tablas y visualizaciones gráficas del SaaS.

---

## 1. Paleta de Colores Empresariales

- **Color Primario de Títulos y Encabezados:** Azul empresarial profundo `rgb(27, 42, 65)` (`#1B2A41`).
- **Color de Texto General (Cuerpo / Párrafos / Labels):** `#1B2A41` (en modo claro) / `--ink: #EEF3F9` (en modo oscuro).
- **Azul de Acción / Brand Deep:** `#0054A6` (utilizado para CTAs principales, bordes activos, badges destacados y barras primarias).
- **Azul Acento / Brand Bright:** `#00AEEF` (cian secundario para gradientes y métricas complementarias).
- **Superficies y Fondos:**
  - Fondo general: `#EEF3F9` (Modo claro) / `#0C1B30` (Modo oscuro).
  - Superficie de tarjetas (`bg-surface`): `#FFFFFF` / `#0A1728`.
  - Superficie secundaria (`bg-surface-2`): `#F6F9FD` / `#102442`.
  - Bordes de separación (`border-line`): `#E3EBF3` / `#1C3149`.

---

## 2. Estándar de Tipografías

### A. Tipografía para Títulos y Encabezados (H1, H2, H3, H4, Card Headers)
- **Familia:** `font-family: Montserrat, "Montserrat Fallback";`
- **Color obligatorio:** Azul empresarial `rgb(27, 42, 65)` / `#1B2A41` (en modo claro) y `#FFFFFF` / `#F6F9FD` (en modo oscuro).
- **Pesos:** `font-bold` (700) o `font-extrabold` (800).

### B. Tipografía para Texto de Cuerpo, Tablas, Formularios y Párrafos
- **Familia:** `font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";`
- **Color obligatorio:** `#1B2A41` (en modo claro) y `--ink: #EEF3F9` (en modo oscuro).
- **Pesos:** `font-normal` (400), `font-medium` (500), `font-semibold` (600).

---

## 3. Estándar de Gráficas y Visualizaciones (Recharts / SVG)

Todas las gráficas de evolución temporal, barras, áreas, líneas y donas deben emplear **estrictamente el azul empresarial y colores armónicos**:

- **Serie Principal / Gasto Real / Tendencia:** `#0054A6` (Azul Empresarial Primario).
- **Serie Secundaria / Forecast / Contrafactual:** `#1B2A41` (Azul Noche), `#00AEEF` (Cian Acento), `#90CAF9` (Celeste Claro).
- **Gradientes de Área:** Desde `#0054A6` (opacidad 0.25 - 0.30) hasta `#0054A6` (opacidad 0.00).
- **Ahorro / Métricas Positivas:** `#10B981` (Verde esmeralda equilibrado).
- **Presupuestos / Umbrales de Alerta:** `#EF4444` (Línea punteada de límite).
- **Prohibición:** Queda prohibido el uso de colores saturados genéricos o combinaciones fuera de la paleta institucional.

---

## 4. Biblioteca Oficial de Iconos

- **Iconos Oficiales:** Se debe utilizar la biblioteca **Tabler Icons** (`@tabler/icons-react` o SVGs oficiales de Tabler).
- **Estilo:** Trazo moderno, grosor `strokeWidth={1.5}` o `strokeWidth={2}`, tamaño consistente (`w-4 h-4` para tablas y badges, `w-5 h-5` para tarjetas y headers de página).
- **Color del Icono:** Heredar el azul empresarial `text-brand-deep` / `text-[#1B2A41]` o el color semántico correspondiente según el contexto (verde para éxito, ámbar para advertencia).

---

## 5. Trampas Conocidas / Restricciones
- **No hardcodear fuentes ad-hoc:** No declarar familias tipográficas arbitrarias (ej. Comic Sans, Times, Arial genérico) en estilos en línea o clases custom. Usar las variables `--font-heading` (`Montserrat`) y `--font-sans` configuradas en el proyecto.
- **Sincronización Dark Mode:** Al usar `#1B2A41` para títulos y textos en modo claro, asegurarse siempre de agregar la clase de dark mode `dark:text-white` o `dark:text-foreground` para garantizar contraste óptimo en temas oscuros.


---

# 📄 diagnostics_health_SOP.md

> **Archivo fuente:** `directivas/diagnostics_health_SOP.md`

# SOP: Diagnósticos y Heartbeat del Sistema

## Objetivo
Implementar un sistema de monitoreo de salud ("Diagnostics & Heartbeat") para verificar proactivamente el estado del servidor, la base de datos MySQL, las credenciales de Azure de cada inquilino (tenant) y ofrecer un panel SuperAdmin para visualizar estos indicadores.

## Lógica y Pasos

### 1. API de Diagnóstico (`/api/system/diagnostics`)
- Endpoint de tipo `GET` accesible únicamente por SuperAdmins (usuarios con email que termine en `@cscloudsolutions.com.ar`).
- Debe verificar:
  - Conexión a la Base de Datos: Hacer ping o ejecutar `SELECT 1` en el pool de MySQL.
  - Variables de Entorno Clave: Comprobar la presencia de `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `NEXT_PUBLIC_CLIENT_ID` u otras variables críticas.
  - Tiempo de Actividad (Uptime): Devolver el uptime actual del proceso del servidor usando `process.uptime()`.

### 2. Servicio de Heartbeat de Inquilinos (`tenantHealthService.ts`)
- Debe verificar si las credenciales de Azure de un inquilino siguen activas y válidas sin realizar consultas masivas.
- Para validarlas: Intentar obtener un token de acceso de Azure (OAuth credential flow) usando las credenciales guardadas en la base de datos (`client_id`, `client_secret` y el `tenant_id` de Azure).
- Actualizar la tabla de `Tenants` con las columnas:
  - `last_sync_at` (TIMESTAMP)
  - `sync_status` (VARCHAR: 'OK', 'ERROR')
  - `last_error_message` (TEXT)
- Integrar la verificación en el flujo de inicialización/sincronización o mediante una comprobación programada/manual.

### 3. Interfaz de Salud de SuperAdmin (`/superadmin/health/page.tsx`)
- Crear una tabla para los SuperAdmins que liste todos los tenants activos y muestre:
  - Nombre de la compañía e ID del tenant.
  - Estado de salud con un indicador visual (🟢 Verde para 'OK', 🔴 Rojo para 'ERROR' o 'N/A').
  - Fecha del último latido/sincronización (`last_sync_at`).
  - Último mensaje de error si el estado es 'ERROR'.
  - Botón para disparar de forma manual la verificación (trigger manual de salud).

## Restricciones y Trampas Conocidas
- Comprobar roles usando exclusivamente el dominio de email `@cscloudsolutions.com.ar` obtenido a partir del token JWT Bearer.
- No realizar consultas de recursos pesados durante la verificación del heartbeat de Azure. Intentar únicamente la adquisición del token de Microsoft Identity Platform (login.microsoftonline.com) o una consulta KQL simple y rápida.
- Manejar adecuadamente los errores de base de datos e inicializar las columnas adicionales en la tabla `Tenants` en `initializeDatabase()`.
- **Restricción de TypeScript en Fetch**: El helper `getAuthHeader()` en el frontend debe tiparse explícitamente para retornar `Promise<Record<string, string>>` o `Promise<HeadersInit>` para evitar fallas de sobrecarga en los métodos `fetch`.
- **Propiedades duplicadas en JSON**: Evitar la propagación (spread) de objetos que ya contienen claves explícitamente definidas (como `{ success: true, ...result }` si `result` tiene la clave `success`), ya que causa el error de compilación `TS2783`. En su lugar, retornar el objeto directamente (`NextResponse.json(result)`).


---

# 📄 diseno_botones_corporativos_SOP.md

> **Archivo fuente:** `directivas/diseno_botones_corporativos_SOP.md`

# Directiva: Estándar de Botones Corporativos Clicables (SOP)

## 1. Propósito y Alcance
Esta directiva establece el estándar visual obligatorio y universal para todos los **botones clicables** e **interactivos** dentro de la plataforma **CSCloudSolutions**. Aplica a botones de acción, botones de actualización, pestañas/tabs, botones de tabla, modales y barras de herramientas.

---

## 2. Reglas Obligatorias de Diseño (Binding Standard)

### A. Geometría y Fondo
1. **Forma:** Rectangular con bordes redondeados suaves (`rounded-lg` / `rounded-xl`). Nunca completamente circular (a menos que sea icono flotante aislado) ni con esquinas duras a 90°.
2. **Fondo:** Siempre **blanco puro** (`bg-white` en modo claro, `dark:bg-slate-900` en modo oscuro).
3. **Sombra y Transición:** Sombra muy suave (`shadow-xs`), con transición fluida de `hover` y `active` (`transition-all`).
4. **Hover State:** Micro-tinte translúcido muy suave del mismo color del texto (ej. `hover:bg-blue-50/50 dark:hover:bg-blue-950/30`).

### B. Regla de Coincidencia de Color (Borde == Texto)
El color del borde exterior debe **coincidir estrictamente** con el color de la tipografía y del icono interior del botón.

---

## 3. Paleta de Colores por Tipo y Secuencia de Botones

| Tipo de Botón / Secuencia | Color de Borde | Color de Texto e Icono | Clase Tailwind Recomendada |
| :--- | :--- | :--- | :--- |
| **Primario / Actualizar / Acciones** | Azul Empresarial `#0054A6` | Azul Empresarial `#0054A6` | `bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/50 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/30` |
| **Secuencia #1 / Pestaña Azul** | Azul Empresarial `#0054A6` | Azul Empresarial `#0054A6` | `border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-300` |
| **Secuencia #2 / Pestaña Cian** | Azul Cian `#00AEEF` | Azul Cian `#008dbf` | `border-[#00AEEF] text-[#008dbf] dark:border-cyan-400 dark:text-cyan-300` |
| **Secuencia #3 / Pestaña Verde** | Verde Esmeralda `#10B981` | Verde Esmeralda `#10B981` | `border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-300` |
| **Secuencia #4 / Pestaña Púrpura** | Púrpura `#8B5CF6` | Púrpura `#8B5CF6` | `border-purple-600 text-purple-600 dark:border-purple-400 dark:text-purple-300` |
| **Secuencia #5 / Pestaña Ámbar** | Ámbar `#F59E0B` | Ámbar `#D97706` | `border-amber-600 text-amber-600 dark:border-amber-400 dark:text-amber-300` |
| **Acciones Resolutivas (Optimizar ✨)** | Azul Empresarial `#0054A6` | Azul Empresarial `#0054A6` | `bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/60` |
| **Copiar / Éxito / Guardar** | Verde Esmeralda `#10B981` | Verde Esmeralda `#10B981` | `bg-white dark:bg-slate-900 border border-emerald-600 text-emerald-600 hover:bg-emerald-50` |
| **Neutro / Cerrar / Descartar** | Gris Neutro `slate-300` | Gris `slate-700` | `bg-white dark:bg-slate-900 border border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300` |
| **Peligro / Destructivo / Eliminar** | Rojo `#EF4444` | Rojo `#EF4444` | `bg-white dark:bg-slate-900 border border-red-500 text-red-600 hover:bg-red-50` |

---

## 4. Ejemplos de Implementación en Código

```tsx
// 1. Botón de Actualizar / Acción Principal
<button
    type="button"
    onClick={handleRefresh}
    className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 border border-[#0054A6] text-[#0054A6] dark:border-blue-400 dark:text-blue-300 transition-all cursor-pointer shadow-xs"
>
    <IconRotateClockwise className="w-3.5 h-3.5" />
    <span>Actualizar</span>
</button>

// 2. Botón de Acción en Tabla ("Optimizar ✨")
<button
    onClick={() => handleAction(row)}
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#0054A6] text-[#0054A6] hover:bg-blue-50/60 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/30 text-xs font-bold transition-all shadow-xs cursor-pointer"
>
    <IconSparkles className="w-3.5 h-3.5" />
    <span>Optimizar</span>
</button>
```

---

## 5. Checklist de Verificación para el Agente
- [ ] ¿El botón tiene forma rectangular con bordes redondeados suaves (`rounded-lg` o `rounded-xl`)?
- [ ] ¿El fondo del botón es blanco puro (`bg-white` en modo claro / `dark:bg-slate-900` en modo oscuro)?
- [ ] ¿El color del borde exterior coincide con el color del texto y del icono?
- [ ] ¿En secuencias de botones múltiples, se alternan colores armónicos (`#0054A6`, `#00AEEF`, `#10B981`, `#8B5CF6`) manteniendo siempre fondo blanco y borde coincidente con el texto?


---

# 📄 distribucion_fugas_SOP.md

> **Archivo fuente:** `directivas/distribucion_fugas_SOP.md`

# SOP: Análisis e Inclusión de Todos los Recursos en la Distribución de Fugas Financieras

## Objetivo
Asegurar que el gráfico circular (Pie Chart) de "Distribución de Fugas Financieras" en el dashboard principal (`src/app/[locale]/page.tsx`) y en el panel interactivo de facturación (`src/components/dashboard/InteractiveDashboard.tsx`) analice e incluya todos los recursos huérfanos auditados que representen una fuga financiera (costo real o estimado mayor a cero), y no se limite únicamente a las máquinas virtuales (VMs).

## Lógica y Pasos
1. **Identificar la causa del filtro de recursos**:
   - Determinar por qué solo se muestran VMs en el dashboard. Analizar si existe un filtro explícito o implícito, o si es un problema de carga/mapeo de datos.
2. **Normalizar la visualización de nombres de recursos**:
   - En `InteractiveDashboard.tsx`, asegurar que el gráfico circular use nombres de categorías legibles y traducidos en lugar de los identificadores camelCase internos o las strings crudas de Azure.
3. **Mapear todos los recursos con costo > 0 en el dashboard**:
   - Asegurar que todos los recursos definidos en `resourceConfig` que tengan `issueType: "cost"` y un costo real o estimado se incluyan en el desglose de fugas.
4. **Verificar consultas de Resource Graph**:
   - Corregir cualquier query de KQL en `kqlCatalog.ts` que pueda estar fallando silenciosamente debido a campos inexistentes (ej. `properties.timeCreated` en recursos de red) lo cual provoca que retornen arreglos vacíos y por ende no se muestren en el gráfico.

## Restricciones y Trampas Conocidas
- Los recursos de gobernanza pura con costo cero no deben aparecer en el gráfico de torta de fugas financieras.
- Los nombres en el gráfico circular del dashboard de billing deben estar unificados con los del dashboard principal para evitar discrepancias visuales.


---

# 📄 documentacion_sincronizada_SOP.md

> **Archivo fuente:** `directivas/documentacion_sincronizada_SOP.md`

# Directiva: Actualización Obligatoria de Documentación Técnica

## Objetivo
Asegurar que la documentación técnica (LLD, manuales de usuario, README) se mantenga **sincronizada** con el código fuente en todo momento. Ninguna implementación o cambio que afecte la arquitectura, APIs, modelo de datos, UI, infra o seguridad puede mergearse sin actualizar los documentos impactados.

## Alcance

Esta directiva aplica a **todo cambio** que modifique alguno de estos dominios:

| Dominio | Documentos a actualizar |
|---|---|
| Arquitectura / Infraestructura | `docs/lld/00-lld-completo.md`, `docs/lld/LLD-FinOps-CSCloudSolutions.pdf`, `README.md` |
| Rutas API (crear/eliminar/cambiar guard/tier) | `docs/lld/00-lld-completo.md` (§6 Servicios, §5 Seguridad), `docs/lld/generated/api-inventory.md` |
| Modelo de datos (tablas/columnas/migraciones) | `docs/lld/00-lld-completo.md` (§4 Modelo de Datos), `docs/lld/generated/db-tables.md` |
| Páginas de UI (crear/eliminar/cambiar tier) | `docs/lld/00-lld-completo.md` (§10 UI), `docs/lld/generated/ui-routes.md` |
| Variables de entorno (nuevas/eliminadas) | `docs/lld/00-lld-completo.md` (§15 Env Vars), `docs/lld/generated/env-vars.md`, `.env.example` |
| Servicios / Modules (crear/eliminar) | `docs/lld/00-lld-completo.md` (§6 Servicios), `docs/lld/generated/code-inventory.md` |
| Seguridad / RBAC / Tiers | `docs/lld/00-lld-completo.md` (§5 Seguridad) |
| Cron Jobs (crear/eliminar/cambiar frecuencia) | `docs/lld/00-lld-completo.md` (§5.3 Cron Jobs), `README.md` |
| CI/CD / Workflows / Docker | `docs/lld/00-lld-completo.md` (§7 Pipeline), `README.md` |
| Terraform (módulos/recursos/variables) | `docs/lld/00-lld-completo.md` (§11 Infraestructura), `infra/README.md` |
| Integraciones externas | `docs/lld/00-lld-completo.md` (§8 Integraciones) |
| Features visibles al usuario | `MANUAL_DE_USUARIO.md`, `docs/manual/MANUAL_USUARIO_{ES,EN,PT-BR}.md` |
| Features de SuperAdmin | `docs/manual/MANUAL_SUPERADMIN_{ES,EN,PT-BR}.md` |
| Pendientes / Estado del proyecto | `docs/lld/00-lld-completo.md` (§12 Estado Actual) |

## Procedimiento

### 1. Antes de implementar
- Revisar si el cambio planificado impacta algún dominio de la tabla anterior.
- Si impacta: marcar los documentos a actualizar en el plan de trabajo.

### 2. Durante la implementación
- Actualizar los documentos **en el mismo branch** que el código.
- No dejar la actualización de docs para "después del merge".

### 3. Archivos generados automáticamente
Los 5 archivos en `docs/lld/generated/` se regeneran con:
```bash
node scripts/generate-lld.mjs
```
Ejecutar este comando **después de cada cambio** que afecte APIs, tablas, rutas UI, servicios o env vars.

### 4. PDF del LLD
El PDF se regenera con:
```bash
node scripts/generate-lld-pdf.js
```
Ejecutar **después de cada cambio al markdown** `docs/lld/00-lld-completo.md`. El PDF incluye diagramas Mermaid renderizados como SVG.

### 5. PDFs de manuales de usuario
Los PDFs de manuales se regeneran con:
```bash
node scripts/generate-manual-pdfs.js
```
Ejecutar después de modificar cualquier manual en `docs/manual/`.

### 6. README.md
- Es la cara del repositorio en GitHub.
- Actualizar siempre que cambien: capabilities, env vars, setup, infra, workflows, cron jobs, o la estructura del proyecto.
- Mantener sincronizado el diagrama Mermaid y el árbol de directorios.

## Checklist de commit (extendido)

Agregar a la checklist existente del `AGENTS.md`:

- [ ] ¿Mi cambio impacta arquitectura/APIs/DB/UI/infra/seguridad?
  - [ ] ¿Actualicé `docs/lld/00-lld-completo.md`?
  - [ ] ¿Regeneré `docs/lld/generated/*` si aplica?
  - [ ] ¿Regeneré el PDF del LLD?
- [ ] ¿Mi cambio afecta features visibles al usuario?
  - [ ] ¿Actualicé los manuales (ES/EN/PT-BR)?
  - [ ] ¿Regeneré los PDFs de manuales?
- [ ] ¿Mi cambio afecta capabilities, setup, o infra pública?
  - [ ] ¿Actualicé `README.md`?

## Restricciones

1. **No se acepta un PR que agregue/elimine un endpoint API sin actualizar el LLD.**
2. **No se acepta un PR que agregue/elimine una tabla/migración sin actualizar el LLD.**
3. **No se acepta un PR que cambie la UI (páginas/tiers) sin actualizar el LLD.**
4. **No se acepta un PR que agregue features de usuario sin actualizar los manuales.**
5. **El PDF del LLD debe estar al día con el .md en cada merge a `main`.**

## Caso borde: Cambios triviales

Si el cambio es puramente interno (refactor sin cambio de contrato, fix de bug sin cambio de API, ajuste de estilo) y no altera nada de lo listado en la tabla de dominios, la actualización de docs **no es necesaria**.

## Nota para el agente

Esta directiva **tiene prioridad** sobre la velocidad de implementación. Un cambio implementado sin documentación actualizada es un cambio incompleto. El ciclo es:

```
Código + Docs + Tests = Implementación completa
```

Aprendido: en sesiones anteriores se acumuló deuda de documentación que requirió un relevamiento completo (LLD) para ponerse al día. Esta directiva existe para **que eso no vuelva a pasar**.


---

# 📄 enterprise_zombie_hunting_SOP.md

> **Archivo fuente:** `directivas/enterprise_zombie_hunting_SOP.md`

# SOP: Motor Enterprise de Detección de Recursos Zombis (Flexera Policies)

## Objetivo
Elevar a nivel empresarial el motor de detección de recursos huérfanos/zombis basándose en las directivas de desperdicio de Flexera. Esto requiere garantizar el soporte de consultas concurrentes para 8 tipos de recursos específicos y estandarizar sus salidas bajo la interfaz `{ resourceId, name, resourceType, monthlyCost }`.

## Lógica y Pasos

### 1. KQL Catalog (`src/modules/core/kqlCatalog.ts`)
- Asegurar y registrar las siguientes consultas exactas:
  - `unattachedDisks`: Discos huérfanos.
  - `unattachedPublicIps`: Alias idéntico a `unusedIps`.
  - `unattachedNics`: Alias idéntico a `orphanedNics`.
  - `emptyAppServicePlans`: Server Farms con `numberOfSites == 0` (o JOIN a sitios).
  - `unusedVNetGateways`: VNet Gateways sin conexiones.
  - `unusedLoadBalancers`: Load Balancers con pools de backend vacíos.
  - `oldSnapshots`: Snapshots con antigüedad superior a 30 días.
  - `longStoppedVMs`: VMs en estado `Deallocated` (para mostrar el costo de almacenamiento atado).

### 2. Zombie Cleanup API (`src/app/api/cleanup/zombies/route.ts` y `/api/audit/full/route.ts`)
- Crear/actualizar los endpoints correspondientes para ejecutar concurrentemente (`Promise.all`) las consultas del catálogo KQL.
- Estandarizar los resultados mapeados a la interfaz:
  - `resourceId`: `id` del recurso en Azure.
  - `name`: `name` del recurso.
  - `resourceType`: tipo de recurso en Azure (ej. `Microsoft.Compute/disks`).
  - `monthlyCost`: costo mensual estimado del desperdicio (usando la API de precios de Retail o fallbacks realistas).
- Mantener compatibilidad con los campos de datos esperados en la interfaz de usuario (`id`, `resourceName`, `type`, `armType`, `potentialSavings`, etc.).

### 3. UI Continuity (`src/components/ZombieResourcesTable.tsx`)
- Configurar la correspondencia en `resourceConfig` para los nuevos aliases (`unattachedPublicIps`, `unattachedNics`, `longStoppedVMs`).
- Mapear las cadenas de tipo amigables de Flexera (ej. `ServerFarms`, `VirtualNetworkGateways`, `Snapshots`, `DeallocatedVMs`, `PublicIPAddresses`, `NetworkInterfaces`) a sus respectivas categorías, permitiendo que la tabla renderice correctamente las etiquetas e iconos.

## Restricciones y Trampas Conocidas
- **Formato del JSON devuelto:** La API de limpieza `/api/cleanup/zombies` debe retornar un JSON estructurado y autenticado bajo Zero-Trust.
- **Evitar fallas de renderizado:** Asegurar que todos los campos utilizados en `columns` de `@tanstack/react-table` se resuelvan sin importar si se usan nombres de propiedades estándar o heredados.


---

# 📄 feature_enhancements_SOP.md

> **Archivo fuente:** `directivas/feature_enhancements_SOP.md`

# Directiva: Enhancements de Advisor, Madurez y Facturación

## Objetivo
Mejorar la localización de Advisor, expandir los pilares de Madurez a 5 e incluir Tooltips, y agregar manejo de errores estandarizado en la Facturación.

## Restricciones/Casos Borde
- **Azure SDK Locale**: Se debe inyectar `Accept-Language` en headers de la request (vía customHeaders en el SDK).
- **Mapeo JSON**: Usar `recommendationType.name` en lugar de duplicar `problem`.
- **Error Codes**: Usar claves estandarizadas para i18n (`ERR_INSUFFICIENT_PERMISSIONS`, etc).


---

# 📄 finops_maturity_SOP.md

> **Archivo fuente:** `directivas/finops_maturity_SOP.md`

# FinOps Maturity Scoring Engine SOP

## Objetivo
Generar un cálculo de madurez alineado al framework de la FinOps Foundation (Crawl, Walk, Run).

## Restricciones/Casos Borde
- Validar siempre `tenantId` en los endpoints.
- Renderizar una interfaz que priorice de un vistazo la salud (Overall Health) usando componentes circulares grandes.
- Mantener consistencia visual y de theming (dark mode).

## Motor de scoring (`src/app/api/intelligence/maturity/route.ts`)
El GET calcula 5 pilares (Visibility, Usage, Rate, Forecasting, Governance) a partir de señales
reales de Azure, agregadas sobre **todas** las suscripciones del tenant (cap `MAX_SUBS_TO_SCAN=10`):
- Suscripciones (`GET /subscriptions`), recomendaciones de Advisor (categoría Cost/Security) y
  presupuestos (Consumption budgets).
- **Regla clave:** distinguir "fuente inaccesible" (sin permiso / throw) de "fuente sin hallazgos".
  Una fuente que lanza NO debe puntuar como perfecta. Cuando Advisor/budgets no son accesibles se
  aplica un baseline neutral (45–50), NO 100. Esto evita que todos los tenants colapsen al mismo
  score constante (bug histórico: 68 fijo cuando Advisor/budgets no eran legibles).
- El scoring usa **densidad** de recomendaciones por suscripción (`costRecs / scannedSubs`) para no
  penalizar injustamente a tenants con muchas suscripciones.
- La respuesta incluye `data.signals` (subscriptionCount, advisorAccessible, budgetsAccessible,
  costRecs, securityRecs, budgetCount, …) para trazabilidad de por qué salió cada score.
- Cache key versionada (`intelligence:maturity:v2:{tenantId}`); bumpear la versión al cambiar la
  fórmula para invalidar scores viejos.

---

# 📄 fix_cost_snapshots_schema_SOP.md

> **Archivo fuente:** `directivas/fix_cost_snapshots_schema_SOP.md`

# Directiva SOP: Corrección del índice de la tabla CostSnapshots

## Objetivo
Actualizar la tabla **CostSnapshots** para evitar errores `ER_TOO_LONG_KEY` al crear el índice único `unique_tenant_date_rg_service_sub`. El índice combina cinco columnas cuyo tamaño total supera el límite de 3072 bytes de MySQL.

## Pasos
1. **Eliminar el índice problemático** (si existe).
2. **Reducir la longitud de los campos** que forman parte del índice:
   - `tenant_id` → `VARCHAR(100)`
   - `subscription_id` → `VARCHAR(100)`
   - `resource_group` → `VARCHAR(100)`
   - `service_name` → `VARCHAR(100)`
   - `date` permanece como `DATE`.
3. **Crear un nuevo índice único** con los campos acortados.
4. **Actualizar la inserción** de snapshots (si corresponde) para usar los tamaños reducidos.

## Trampas conocidas
- **Datos existentes**: Si los valores actuales exceden los nuevos límites, la migración fallará. Se asume que los IDs y nombres de suscripción, RG y servicios no superan 100 caracteres (práctica común en Azure). Si se detecta truncamiento, validar y ajustar antes de aplicar.
- **Migraciones en producción**: Ejecutar durante una ventana de mantenimiento para evitar bloqueos.
- **Rollback**: En caso de error, revertir los cambios restaurando la definición original de la tabla.

## Verificación
- Ejecutar `SELECT * FROM CostSnapshots LIMIT 1;` para confirmar que la tabla sigue accesible.
- Probar la inserción de un snapshot nuevo y verificar que el índice único no produce error.
- Revisar que la API `/api/intelligence/billing` retorne datos sin `500`.


---

# 📄 freemium_teaser_SOP.md

> **Archivo fuente:** `directivas/freemium_teaser_SOP.md`

# Freemium Teaser SOP

## Objetivo
Implementar la lógica "Freemium Teaser" para optimizar ingresos mediante la táctica de enmascarar los IDs de los recursos a eliminar, motivando al usuario a hacer un Upgrade a la versión Profesional.

## Lógica y Pasos a seguir

1. **Lógica de Tier del Tenant**: Añadir el campo `tier` ('Free', 'Pro', 'Enterprise') al modelo/interfaz de `Tenant` (ej. en `src/lib/tenants.ts`).
2. **Enmascaramiento Seguro en la API**: Al devolver la lista de recursos Zombies en `/api/cleanup/zombies/route.ts`, verificar el tier del usuario. Si es 'Free', iterar por los recursos y reemplazar el `name`, `resourceId` y `resourceGroup` con `"**********"`, y añadir `isLocked: true`. `monthlyCost` y `savings` deben permanecer legibles.
3. **Desenfoque Visual y Llamada a la Acción (CTA)**: Modificar `ZombieResourcesTable.tsx` para aplicar clases de desenfoque de Tailwind (`filter blur-sm select-none`) en las columnas relevantes si el item está bloqueado (`isLocked: true`).
4. **Overlay de CTA**: Añadir un cuadro opaco superpuesto en la tabla (usando `absolute inset-0 z-10 ... backdrop-blur-[1px]`) con el botón "Upgrade to Professional to unlock exact resource names and start saving", redirigiendo a `/upgrade`.

## Trampas y Restricciones
- No enmascarar el `monthlyCost`, el objetivo es que vean exactamente cuánto van a ahorrar.
- El enmascaramiento debe hacerse siempre del lado del backend (API) para evitar que el usuario acceda a los nombres completos usando DevTools del navegador.
- El objeto alterado no debe romper la estructura de las tablas de TypeScript. Asegurar que los tipos sean compatibles.


---

# 📄 frontend_api_wiring_SOP.md

> **Archivo fuente:** `directivas/frontend_api_wiring_SOP.md`

# Directiva: Conexión MSAL Frontend con API Resource Graph

## Objetivo
Conectar el componente visual `ZombieResourcesTable.tsx` con la API segura de `/api/recommendations`. El componente debe adquirir silenciosamente el token JWT de la sesión activa de MSAL y mapear los resultados crudos de Azure Resource Graph a la tabla visual.

## Lógica y Pasos
1. Importar `useMsal` en `ZombieResourcesTable.tsx` y el hook del Tenant actual (`useTenant` o similar).
2. Si no hay sesión (`accounts.length === 0`), mostrar un mensaje indicando que se debe iniciar sesión.
3. Si hay sesión, utilizar `instance.acquireTokenSilent()` para obtener el token.
4. Hacer el `fetch` enviando el `tenantId` (extraído de `selectedTenant.id`, **NUNCA** de `accounts[0].tenantId` en modo multi-tenant) y el header `Authorization: Bearer <token>`.
5. Mapear las respuestas `json.unattachedDisks` y `json.unusedIps` inyectándoles las propiedades `type`, `issue`, `resourceName` y un `potentialSavings` estimado para mantener compatibilidad con la tabla.

## Trampas Conocidas / Restricciones
- El componente debe manejar `acquireTokenSilent` en un `useEffect`. Si el token expiró, la promesa fallará y se debe gestionar el error gracefully.
- La respuesta de la API `json.unattachedDisks` contiene la propiedad `name` (en lugar de `resourceName`). Se debe hacer un `.map()` en el frontend o ajustar el backend.
- **Multitenancy Bug**: Si utilizas `accounts[0].tenantId` en lugar de la variable global del selector (`selectedTenant.id`), la auditoría fallará arrojando un error 403 (MISSING_RBAC_ROLE) o un 500 cuando el administrador del SaaS esté conectado pero intente auditar a un cliente, ya que buscará recursos en el tenant interno de la empresa en lugar del tenant del cliente.
\n- **Multitenancy Bypass**: Todas las rutas de API (incluyendo `/api/subscriptions`) DEBEN validar el token permitiendo un bypass si el usuario es administrador (ej. `@cscloudsolutions.com.ar`). Si se omite esto, el dropdown de suscripciones quedará vacío al devolver 403 para usuarios SaaS Admins.\n

---

# 📄 frontend_spa_SOP.md

> **Archivo fuente:** `directivas/frontend_spa_SOP.md`

# Directiva: Ensamblaje del Frontend SPA (MVP)

## Objetivo
Estructurar el layout principal de la aplicación Next.js, implementando navegación interactiva, autenticación simulada (Auth Mock) y un dashboard dinámico que consuma el backend recién creado.

## Lógica y Pasos
1. Crear `src/components/ClientShell.tsx`: Componente de cliente encargado de manejar el estado local del Sidebar (colapsable) y renderizar la Navbar con el selector de Tenant y el botón de MSAL (Entra ID) simulados.
2. Modificar `src/app/layout.tsx`: Integrar el `ClientShell` como envoltura principal de la aplicación.
3. Crear `src/components/ZombieResourcesTable.tsx`: Componente de cliente con `useEffect` que consulte a `/api/recommendations`. Manejar estados `loading`, `error`, y proveer un fallback visual en caso de fallos del SDK para no romper el flujo del UI.
4. Sobrescribir `src/app/page.tsx`: Renderizar la tabla y las tres tarjetas placeholder ("Cost Summary", "Rate Optimization", "Workload Optimization") para inyecciones futuras de Power BI.

## Trampas Conocidas / Restricciones
- La consola del navegador arrojará error si el servidor carece de las credenciales de Azure (`DefaultAzureCredential`), por lo que la tabla debe tener un bloque `catch` para renderizar datos de prueba temporalmente.
- **CRÍTICO:** En Next.js (modo desarrollo), nunca utilizar `throw new Error()` dentro de un bloque `fetch().then()` para delegar el control de fallos. Next.js intercepta las excepciones inmediatamente y muestra un overlay rojo invasivo que rompe la experiencia de UI, aunque la excepción esté capturada en un `.catch()`. Se deben manejar las respuestas de error condicionalmente sin arrojar excepciones (ej. validando `json.error`).


---

# 📄 function_apps_finops_cmp_SOP.md

> **Archivo fuente:** `directivas/function_apps_finops_cmp_SOP.md`

# SOP: Cockpit FinOps y Eficiencia Serverless en Azure Function Apps

## Objetivo
Procedimiento operativo determinista para auditar, optimizar y controlar los costos de **Azure Function Apps (`Microsoft.Web/sites` con `kind: functionapp`)**, resolviendo la relación entre planes de hosting (Consumption vs. Elastic Premium vs. Dedicated), métricas de ejecución (GB-s) y costos ocultos asociados (Storage y Application Insights).

---

## 1. Arquitectura de Costos en Azure Functions

El costo de una Function App se compone de tres vectores principales:
1. **Cómputo Serverless**:
   - **Consumption (Y1)**: Facturación basada estrictamente en invocaciones ($0.20 USD por millón) y consumo de memoria/tiempo en **GB-Segundos** ($0.000016 USD por GB-s), con un subsidio gratuito mensual de 1 millón de ejecuciones y 400,000 GB-s por suscripción.
   - **Elastic Premium (EP1, EP2, EP3)**: Nodos siempre activos (pre-warmed) con tarifa fija por núcleo y RAM (~$150 USD/mes por EP1), independientemente de que reciban tráfico.
   - **Dedicated (App Service Plan)**: Costo fijo del ASP compartido con Web Apps.
   - **Flex Consumption (FC1)**: Nuevo modelo serverless con memoria configurable por función y VNet privada nativa.
2. **Costo de Storage (`AzureWebJobsStorage`)**:
   - Transacciones de lectura/escritura en Blob, Table y Queue storage para checkpoints, triggers y logs internos.
3. **Costo de Telemetría (Application Insights / Log Analytics)**:
   - Ingesta de datos de telemetría ($2.30 USD por GB). Frecuentemente **supera al costo de cómputo en 100x a 2000x** cuando no se activa muestreo (Sampling).

---

## 2. Reglas de Remediación Resolutivas

### 1. Migración a Plan Consumption (Baja Carga Serverless)
- **Gatillo**: Function App en SKU Elastic Premium (EP1/EP2) con invocaciones mensuales $< 100,000$ y sin requerimiento de VNet.
- **Ahorro Estimado**: ~$145 USD/mes por función.
- **Comando Azure CLI**:
  ```bash
  az functionapp plan create --name <plan-consumption-name> --resource-group <resourceGroup> --consumption-only --location <location>
  az functionapp update --name <functionAppName> --resource-group <resourceGroup> --plan <plan-consumption-name>
  ```

### 2. Control de Fuga en Logs & Telemetría (Sampling al 20%)
- **Gatillo**: Ingesta de logs en Application Insights $> 5 \text{ GB/mes}$ o costo de logs $> 3\times$ el costo de cómputo.
- **Ahorro Estimado**: 80% del costo de telemetría (~$28 a $40 USD/mes).
- **Configuración en `host.json`**:
  ```json
  {
    "version": "2.0",
    "logging": {
      "applicationInsights": {
        "samplingSettings": {
          "isEnabled": true,
          "maxTelemetryItemsPerSecond": 5,
          "evaluationInterval": "00:01:00"
        }
      }
    }
  }
  ```

### 3. Detección de Function App Ociosa / Zombie
- **Gatillo**: 0 invocaciones registradas en los últimos 30 días en un plan dedicado (`Dedicated / App Service Plan`).
- **Ahorro Estimado**: 100% del costo del plan ($79.51 USD/mes en Standard S1).
- **Comando Azure CLI**:
  ```bash
  az functionapp stop --name <functionAppName> --resource-group <resourceGroup>
  # O desaprovisionar:
  az functionapp delete --name <functionAppName> --resource-group <resourceGroup>
  ```

### 4. Reducción de Polling en Triggers (Storage Cost)
- **Gatillo**: Millones de transacciones de lectura en Storage Account vinculada por triggers de colas ejecutándose a intervalos por defecto de 100ms.
- **Configuración en `host.json`**:
  ```json
  {
    "extensions": {
      "queues": {
        "maxPollingInterval": "00:00:02",
        "visibilityTimeout": "00:00:30",
        "batchSize": 16
      }
    }
  }
  ```

---

## ⚠️ Restricciones y Trampas Conocidas (Gotchas)

### ❌ Cold Starts en Consumption
- El plan Consumption escala a cero. Funciones en Node.js o Python tardan entre 400ms y 1.5s en primer arranque. Para APIs de baja latencia con tráfico constante, evaluar **Flex Consumption** antes de recurrir a Elastic Premium.

### ❌ Integración de VNet en Consumption Clásico
- El plan Consumption (Y1) estándar no permite inyección de red virtual privada saliente. Si se requiere VNet, la alternativa de menor costo es **Flex Consumption** en lugar de Elastic Premium EP1.


---

# 📄 git_auth_refactor_commit_SOP.md

> **Archivo fuente:** `directivas/git_auth_refactor_commit_SOP.md`

# Directiva: Commit de Refactorización de Autenticación Multi-Tenant

## Objetivo
Hacer staging de los cambios realizados en el motor del backend (`azure.ts`, endpoints de las rutas) y sus directivas operativas, y generar un commit atómico.

## Lógica y Pasos (Python)
1. Ejecutar `git add .` en el directorio base.
2. Ejecutar `git commit -m "refactor: Migrate Azure authentication to multi-tenant ClientSecretCredential model"`.

## Trampas Conocidas / Restricciones
- Asegurarse de capturar los códigos de error en Python para informar a la UI si el `git commit` falla (ej. si no hay cambios listos para el commit).


---

# 📄 git_init_SOP.md

> **Archivo fuente:** `directivas/git_init_SOP.md`

# Directiva: Inicialización de Repositorio Git

## Objetivo
Inicializar el repositorio Git local para mantener control de versiones de la arquitectura FinOps, añadiendo los archivos existentes y creando el commit inicial.

## Entradas
- El directorio de trabajo `/Users/manuelchavez/Documents/FinOpsProyect` con los archivos base.

## Salidas
- Repositorio de Git inicializado (`.git/`).
- Commit inicial con el mensaje: "Initial Next.js and Docker architecture setup".

## Lógica y Pasos (vía Python)
1. Ejecutar `git init` en el directorio raíz.
2. Ejecutar `git add .` para incluir todo el código base (ignorando lo que esté en el `.gitignore` creado en el paso de bootstrap).
3. Ejecutar `git commit -m "Initial Next.js and Docker architecture setup"`.

## Trampas Conocidas / Restricciones
- No ejecutar `git push` automáticamente. El control del remoto y el empuje del código queda a discreción del usuario.
- Si el cliente de git carece de usuario/email configurado de forma global, la ejecución de la lógica fallará.


---

# 📄 git_phase1_commit_SOP.md

> **Archivo fuente:** `directivas/git_phase1_commit_SOP.md`

# Directiva: Generación de README y Commit de Fase 1

## Objetivo
Sobrescribir el README.md predeterminado de Next.js con documentación propia del proyecto FinOps, hacer staging de todos los cambios de arquitectura Frontend/Backend y generar el commit formal de Fase 1.

## Lógica y Pasos (Python)
1. Generar y escribir un `README.md` que detalle la arquitectura (Next.js, Azure Backend, Frontend SPA, Docker).
2. Ejecutar `git add .` en la raíz del proyecto.
3. Ejecutar `git commit -m "feat: Complete Phase 1 base architecture, backend Azure APIs, and Frontend SPA layout"`.

## Trampas Conocidas
- El `README.md` previo de Next.js será sobrescrito completamente. Esto es intencional para eliminar rastro de boilerplates genéricos.


---

# 📄 git_phase2_commit_SOP.md

> **Archivo fuente:** `directivas/git_phase2_commit_SOP.md`

# Directiva: Commit de Fase 2 (Seguridad, JWT y DB)

## Objetivo
Hacer staging de los cambios arquitectónicos introducidos en el backend y frontend (botón Admin Consent, arquitectura de Base de Datos local con MySQL, lógica de aislamiento JWT y abstracción de Key Vault), y consolidarlos en un único commit.

## Lógica y Pasos (Python)
1. Ejecutar `git add .` en el directorio base.
2. Ejecutar `git commit -m "feat: Phase 2 - Add MySQL Docker, JWT tenant isolation, Admin Consent UI, and Key Vault"`.

## Trampas Conocidas / Restricciones
- Los archivos `.env` o `.env.local` son automáticamente ignorados por el `.gitignore` por defecto de Next.js. El script de Python debe asumir que este comportamiento nativo protegerá el `NEXT_PUBLIC_CLIENT_ID` y cualquier secreto del control de versiones.


---

# 📄 git_phase3_commit_SOP.md

> **Archivo fuente:** `directivas/git_phase3_commit_SOP.md`

# Directiva: Commit de Fase 3 (Persistencia y UX Authentication)

## Objetivo
Hacer staging y commit atómico de todos los cambios estructurales de la Fase 3, que incluyen la capa de Base de Datos MySQL, las lógicas de Onboarding, la resolución de bugs del Token MSAL (`idToken`), el flujo final de Login/Logout Redirect y la identidad visual de la aplicación (Logo y Meta Título).

## Lógica y Pasos (Python)
1. Ejecutar `git add .` en el directorio base.
2. Ejecutar `git commit -m "feat: Phase 3 - MySQL schema, MSAL Onboarding persistency, and UX refinements"`.

## Trampas Conocidas / Restricciones
- Garantizar que todos los scripts de validación y de inyección en Python (`scripts/`) queden agregados al control de versiones, ya que fungen como la "memoria procedimental ejecutable" que permitió estos cambios (SOPs automatizados).


---

# 📄 git_phase4_commit_SOP.md

> **Archivo fuente:** `directivas/git_phase4_commit_SOP.md`

# Directiva: Commit de Fase 4 (Azure Resource Graph & Multi-Subscription)

## Objetivo
Hacer staging y commit de la Fase 4, la cual reemplazó las lentas consultas individuales de la API de Azure por el motor de **Azure Resource Graph** (KQL), implementó la inyección silenciosa del JWT en el Frontend (`acquireTokenSilent`) y habilitó consultas multi-suscripción globales (Tenant-wide) modificando la respuesta JSON para mapearla nativamente a la tabla dinámica.

## Lógica y Pasos (Python)
1. Ejecutar `git add .` en el directorio base.
2. Ejecutar `git commit -m "feat: Phase 4 - Azure Resource Graph KQL, MSAL silent token auth, and Tenant-Wide multi-subscription support"`.

## Trampas Conocidas / Restricciones
- Asegurarse de que `package.json` y `package-lock.json` queden obligatoriamente incluidos debido a la instalación del paquete `@azure/arm-resourcegraph` para mantener la reproducibilidad de la imagen de Docker.


---

# 📄 git_push_SOP.md

> **Archivo fuente:** `directivas/git_push_SOP.md`

# Directiva: Configuración de Repositorio Remoto y Push

## Objetivo
Conectar el repositorio Git local con el remoto de GitHub (`origin`) y sincronizar la rama principal de código.

## Entradas
- Repositorio remoto: `https://github.com/manny864/finops.git`

## Salidas
- Código de la arquitectura base pusheado exitosamente al servidor remoto.

## Lógica y Pasos (vía Python)
1. Ejecutar `git remote add origin https://github.com/manny864/finops.git`.
2. Asegurar el nombramiento de la rama con `git branch -M main`.
3. Empujar los commits usando `git push -u origin main`.

## Trampas Conocidas / Restricciones
- Si la consola arroja `remote origin already exists`, se debe remover el viejo con `git remote remove origin` o usar `set-url` antes de configurar el nuevo.
- El push requiere que la terminal tenga credenciales activas o GitHub CLI autenticado localmente. De lo contrario, fallará pidiendo permisos en la consola.
- **CRÍTICO**: Queda estrictamente prohibido realizar `git push` de forma automática. Los commits se deben guardar en local, y solo se debe hacer push cuando el usuario lo pida explícitamente en el chat.


---

# 📄 global_rules_SOP.md

> **Archivo fuente:** `directivas/global_rules_SOP.md`

# Directivas Globales del Proyecto

## Restricciones y Patrones Estrictos

### 1. Nunca usar código hardcodeado (Hardcoded Data)
**Regla:** Queda terminantemente prohibido utilizar datos de prueba, *mock data* o valores estáticos *hardcodeados* en los componentes del Frontend o en la lógica del Backend que se ponga en producción, independientemente de si se solicita un "prototipo rápido" o la directiva de "Token Optimization Mode".
- **Por qué falló antes:** En el módulo de *Green FinOps (Sustainability)* se inyectaron valores estáticos (`730 * 10`) para simular consumo, lo que provocó que la interfaz no reaccionara a los cambios de Tenant o Suscripción, causando frustración en el usuario.
- **En su lugar hacer:** Toda métrica, por más preliminar que sea el módulo, DEBE estar respaldada por un endpoint de API que lea datos dinámicos (vía Azure Resource Graph, Cost Management o Bases de Datos), aunque la fórmula de cálculo sea básica o una estimación inicial.

### 2. Protocolo Estricto de Migración de Base de Datos
**Regla:** Todos los agentes (Frontend, Backend, DBA) que modifiquen esquemas de base de datos deben seguir rigurosamente el protocolo "STRICT DATABASE MIGRATION PROTOCOL".
- **Referencia:** Ver `directivas/agent_dba_SOP.md` para los detalles.
- **Acción Obligatoria:** Siempre se debe incluir el script `-- PRODUCTION DB MIGRATION SCRIPT ---` al final de la respuesta si se modifican estructuras (tablas, columnas, índices, restricciones). Las migraciones locales deben ser siempre seguras (`ALTER TABLE` con `try/catch`).

### 3. Documentación Obligatoria Post-Fix
**Regla:** Queda terminantemente prohibido dar por terminada la corrección de un bug o la implementación de una característica sin actualizar la documentación del proyecto.
- **Acción Obligatoria:** Después de cada fix o despliegue exitoso a staging/producción, SE DEBEN actualizar el `README.md` (sección Recent Major Updates) y el `MANUAL_DE_USUARIO.md` (si la corrección o característica afecta el flujo de usuario o los requisitos del sistema).


---

# 📄 governance_policies_SOP.md

> **Archivo fuente:** `directivas/governance_policies_SOP.md`

# Governance & Policies (Policies As Code) SOP

## Objetivo
Desplegar políticas de Azure nativas (Built-In) desde el panel de SaaS FinOps directamente a los Management Groups o Suscripciones del Tenant.

## Arquitectura de Fetching
- **Identificar Built-In Policies a nivel Tenant**: Debido a que los Management Groups y Subscriptions pueden no existir o no tener permisos asignados por defecto, se debe consultar el "Provider" global utilizando el filtro oficial:
  `GET https://management.azure.com/providers/Microsoft.Authorization/policyDefinitions?api-version=2020-09-01&$filter=policyType eq 'BuiltIn'`
- **Error 404 (Scope Management Group)**: Consultar políticas Built-In en la raíz de un Management Group puede arrojar Error 404 si el inquilino no tiene activados los Management Groups o si no se utiliza el `$filter=policyType eq 'BuiltIn'`.

## Restricciones y Requisitos de Rol (CRÍTICO)

### Error de Autorización al Asignar Políticas (Azure 403)
**Síntoma:** Al enviar el POST para inyectar la política en un Management Group, Azure responde con:
`AuthorizationFailed ... does not have authorization to perform action 'Microsoft.Authorization/policyAssignments/write' over scope ...`

**Causa:** El Service Principal (App Registration) o Managed Identity utilizado por la plataforma SaaS solo tiene el rol de `Reader`. Para **ASIGNAR** políticas (modificar recursos o desplegarlos), se requiere un permiso superior.

**Solución (Rol Necesario):**
El usuario / administrador del Tenant debe asignar el rol de **"Resource Policy Contributor"** (Contribuidor de directiva de recurso) al App Registration en el nivel de "Tenant Root Group" (Management Group raíz) o en el Management Group / Suscripción objetivo.

- Si solo tienen `Reader`, la API REST lanzará `403 AuthorizationFailed`.
- El permiso exacto faltante es: `Microsoft.Authorization/policyAssignments/write`.
- **Por qué "Resource Policy Contributor"?** Porque sigue el principio de menor privilegio (Least Privilege). Es más seguro que asignar el rol global de `Contributor` o `Owner`, limitando al Agente de FinOps exclusivamente a la lectura y escritura de directivas (Azure Policy).

## Manejo de Interfaz (UI)
- Debido a la latencia de la API de Azure, utilizar `onMouseDown` con `e.preventDefault()` en los cuadros de búsqueda desplegables. Si se utiliza `onClick`, el evento `onBlur` del input oculta la lista antes de que se registre la selección, bloqueando la selección de la política.
- **Transparencia de Errores**: Nunca ocultar los mensajes de error devueltos por `fetchRes.text()` en la API REST de Azure. El frontend SIEMPRE debe lanzar y mostrar `json.details` para que el administrador sepa qué parámetro o rol específico falta en el Payload (ej. Error 400 por un Parameter requerido, o Error 403 por falta de rol).


---

# 📄 historical_progress_SOP.md

> **Archivo fuente:** `directivas/historical_progress_SOP.md`

# Directiva: Progreso Histórico y Retorno de Inversión FinOps (SOP)

## Objetivo
Implementar el módulo integral de **Progreso Histórico (Historical Progress)** en `/overview/progress`, permitiendo a los directores ejecutivos y equipos de ingeniería visualizar la evolución temporal de la madurez FinOps, ahorro contrafactual, higiene de tags, salud de compromisos (RIs/SPs), cacería zombi, precisión del forecast ML, auditoría Before vs After y registro de excepciones (Waiver Ledger), soportando rangos temporales de **30 días, 3 meses, 6 meses y 1 año**.

## Arquitectura del Módulo
1. **Selector de Rango Temporal**:
   - `30d` (30 Días - Vista diaria).
   - `90d` (3 Meses - Vista diaria/semanal).
   - `180d` (6 Meses - Vista semanal).
   - `365d` (1 Año - Vista mensual).

2. **Estructura de Vistas (Tabs)**:
   - **Tab 1: Madurez & Gobernanza**:
     - Score de Madurez FinOps (0-100) con desglose por pilares (Asignación, Tarifas, Uso, Gobernanza) e insignias Crawl/Walk/Run.
     - Higiene de Tags (% Cobertura) y Reducción de Gasto Huérfano (Unallocated Spend Area Chart).
     - Efectividad de Herencia de Tags (Tag Inheritance).
   - **Tab 2: Compromisos & Desperdicio**:
     - Cobertura y Utilización de Reservas & Savings Plans (% Coverage & % Utilization).
     - Adopción de Azure Hybrid Benefit (AHUB vCores Windows / SQL).
     - Caza de Recursos Zombi (Discos, IPs, Snapshots, PaaS purgados) y Ahorro Recurrente Acumulado.
     - Burndown de Deuda Técnica Financiera (Backlog de Oportunidades vs Ritmo de Resolución y MTTR).
   - **Tab 3: ROI & Ahorro Contrafactual**:
     - Gasto Real vs Línea Base Contrafactual ("Lo que habrías gastado") con Área de Ahorro Neto.
     - Gasto Real vs Presupuesto vs Forecast ML (Holt-Winters / Ensemble) + Detección de Anomalías.
     - Ahorro Realizado vs Fuga por Dilación (Leakage) + Tiempo Promedio de Implementación.
     - Sostenibilidad & GreenOps (MTCO2e emitidas y evitadas).
   - **Tab 4: Before/After & Hitos**:
     - Verificación Antes vs Después (30d antes vs 30d después) con Detección de Efecto Rebote.
     - Marcadores de Hitos de Arquitectura (Releases, Migraciones SQL, Nuevas Regiones).
     - Registro de Excepciones y Rechazos (Waiver Ledger con justificación y fecha de vencimiento).
     - Registro de Auditoría de Acciones (Usuario, método y estado actual del recurso).

## Restricciones y Reglas
- **Precisión Matemática**: Cálculos monetarios exactos, sin pérdida de precisión.
- **Internacionalización (i18n)**: Paridad estricta en las 3 bases de idiomas (`messages/es.json`, `messages/en.json`, `messages/pt-BR.json`).
- **Mocks por Tier**: Soporte completo para tiers Professional (30d/90d), Business (180d) y Enterprise (365d) en `src/lib/mockData.ts`.
- **Eficacia Visual**: Gráficos responsivos de Recharts, paleta corporativa `brand-deep` (`#0054A6`), bordes sutiles y tooltips enriquecidos.
- **Cumplimiento de Estándar de Tablas**: Reutilización de filtros, paginación y ordenamiento en las tablas de auditoría Before/After y Waiver Ledger.

---

# 📄 i18n_setup_SOP.md

> **Archivo fuente:** `directivas/i18n_setup_SOP.md`

# i18n Setup SOP (Next-Intl)\n\n## Objetivo\nSoportar múltiples idiomas (EN, ES, PT-BR) en la plataforma App Router mediante `next-intl`.\n\n## Restricciones/Casos Borde\n- Todas las rutas (excepto API) deben ubicarse dentro de `[locale]`.\n- `middleware.ts` requiere excluir las rutas estáticas y `/api`.\n

---

# 📄 i18n_tenant_fix_SOP.md

> **Archivo fuente:** `directivas/i18n_tenant_fix_SOP.md`

# i18n & Tenant State Fix SOP\n\n## Objetivo\n1. Persistir el `selectedTenant` en `localStorage` para sobrevivir transiciones de ruta causadas por el cambio de idioma.\n2. Mejorar `LanguageSwitcher.tsx` para que retenga parámetros de búsqueda (searchParams) y no corte la URL.\n3. Colocar el `LanguageSwitcher` en el layout de Login para accesibilidad internacional.\n\n## Restricciones/Casos Borde\n- **Nota**: El `useSearchParams` debe ser importado de `next/navigation`. El `TenantProvider` debe hidratar el estado del tenant inicial si existe en el `localStorage`.\n

---

# 📄 iconos_informativos_popovers_SOP.md

> **Archivo fuente:** `directivas/iconos_informativos_popovers_SOP.md`

# Directiva: Estándar Obligatorio de Iconos Informativos con Popovers Explicativos (SOP)

## 1. Propósito y Alcance
Esta directiva establece el estándar visual y funcional obligatorio y universal para la inclusión de **iconos informativos interactivos (`InfoTooltip`) con diálogos popover contextuales** en toda la plataforma **CSCloudSolutions**.

Aplica de forma estricta e inexcusable a:
1. **Encabezados de Página:** Títulos principales (`h1`/`h2`) y subtítulos explicativos de cada vista.
2. **Pestañas y Subpestañas (Tabs):** Cada pestaña de navegación de módulos y tabuladores internos.
3. **Títulos de Tablas y Secciones:** Cada sección de datos, panel comparativo y tarjeta de recomendaciones.
4. **Columnas de Tablas y Tarjetas KPI:** Métricas clave, cálculos unitarios y columnas de tablas de recursos/costos.

---

## 2. Reglas Obligatorias de Diseño y Arquitectura (Binding Standard)

### A. Componente Oficial
- Utilizar exclusivamente el componente centralizado [`src/components/InfoTooltip.tsx`](file:///Users/manuelchavez/Documents/FinOpsProyect/src/components/InfoTooltip.tsx).
- Nunca crear tooltips ad-hoc ni usar librerías externas no estandarizadas.

### B. Visual y Estilo Corporativo
1. **Icono Oficial:** `IconInfoCircle` de **Tabler Icons** (`@tabler/icons-react`).
2. **Fondo del Popover:** Sólido azul empresarial profundo `#1B2A41` (`bg-[#1B2A41]` / `dark:bg-slate-800`), 100% opaco (`opacity: 1`), con borde nítido (`border border-slate-600`) y sombra de elevación alta (`shadow-2xl`).
3. **Tipografía del Popover:** Texto blanco `#FFFFFF` en modo claro y oscuro, con tamaño `text-[11px]`, interlineado relajado (`leading-relaxed`), peso normal (`font-normal`), alineación izquierda (`text-left`) y sin transformación forzada (`normal-case tracking-normal`).
4. **Posicionamiento y Capas (Z-Index):**
   - Siempre renderizar con `z-[9999]` o `z-[100]` para evitar solapamientos con modales, tarjetas o tablas.
   - En encabezados de tablas y elementos superiores, usar `position="bottom"` con alineación adaptativa (`align="left"`, `align="center"` o `align="right"`) para evitar recortes con los bordes de la pantalla o contenedores con scroll.

### C. Reglas de Validación HTML y React (Semántica DOM)
- El tooltip debe contener etiquetas inline (`<span>`, nunca `<div>` internos) para permitir su inserción segura dentro de etiquetas `<p>`, `<span>`, `<h1>` a `<h6>`, `<th>`, `<td>`, `<button>`, etc. sin generar errores de hidratación (`In HTML, <div> cannot be a descendant of <p>`).

---

## 3. Internacionalización Obligatoria (i18n)
- **Cero strings hardcodeados:** Todo contenido explicativo de los tooltips DEBE residir en los diccionarios de internacionalización bajo una clave descriptiva (ej. `tooltip_page_title`, `tooltip_tab_name`, `tooltip_table_title`, `tooltip_col_cost`).
- **Paridad en los 3 idiomas:** Cada clave añadida debe existir obligatoriamente en `messages/es.json`, `messages/en.json` y `messages/pt-BR.json`.

---

## 4. Ejemplos de Implementación en Código

```tsx
// 1. Título de Página / Módulo
<div className="flex items-center gap-2">
  <h1 className="text-2xl font-bold text-[#1B2A41] dark:text-white">{t("pageTitle")}</h1>
  <InfoTooltip content={t("tooltip_page_title")} position="bottom" align="left" />
</div>

// 2. Pestañas / Tabs
<button className="...">
  <span>{t("tabCompute")}</span>
  <InfoTooltip content={t("tooltip_tab_compute")} position="bottom" align="center" />
</button>

// 3. Título de Tabla / Sección
<div className="flex items-center gap-2 mb-3">
  <h3 className="text-sm font-semibold text-[#1B2A41] dark:text-white">{t("tableTitle")}</h3>
  <InfoTooltip content={t("tooltip_table_title")} position="bottom" align="left" />
</div>

// 4. Encabezado de Columna en Tabla
<ResizableTh minWidth={140} className="bg-white py-3 px-4 border-b border-slate-200 font-bold text-xs text-slate-500 uppercase text-right">
  <span className="inline-flex items-center justify-end gap-1">
    {t("colMonthlyCost")}
    <InfoTooltip content={t("tooltip_col_monthly_cost")} position="bottom" align="right" />
  </span>
</ResizableTh>
```

---

## 5. Checklist de Verificación para el Agente
- [ ] ¿Cada título de página nuevo o modificado cuenta con su `InfoTooltip` explicativo?
- [ ] ¿Cada pestaña / tab de navegación contiene un `InfoTooltip` descriptivo?
- [ ] ¿Cada tabla de datos y sección tiene un `InfoTooltip` en su título y columnas clave?
- [ ] ¿Las claves de traducción están presentes de forma idéntica en `messages/es.json`, `messages/en.json` y `messages/pt-BR.json`?
- [ ] ¿El popover abre en posición correcta (`position="bottom"`, `align="left"|"right"`) sin quedar cortado por el viewport ni detrás de tablas?


---

# 📄 lemon_squeezy_SOP.md

> **Archivo fuente:** `directivas/lemon_squeezy_SOP.md`

# Lemon Squeezy Integration SOP

## Objetivo
Implementar pagos recurrentes, subscripciones y control de acceso Premium (SaaS) mediante Lemon Squeezy como Merchant of Record (MoR).

## Lógica y Flujo
1. **Modelado de Datos (`src/lib/tenants.ts`)**:
   - `subscriptionId`: ID único de Lemon Squeezy.
   - `subscriptionStatus`: Estado (`active`, `past_due`, `canceled`, etc.).
   - `planTier`: Nivel (`Free`, `Pro`, `Enterprise`).
   - `trialEndsAt`: Fecha límite (si aplica).
2. **Generación de Checkout (`/api/checkout/route.ts`)**:
   - Usar la API de Lemon Squeezy (`v1/checkouts`) o la SDK `@lemonsqueezy/lemonsqueezy.js`.
   - Pasar el `tenantId` en los campos `custom_data` del checkout para poder identificar qué tenant pagó al recibir el webhook.
3. **Recepción de Webhooks (`/api/webhooks/lemon/route.ts`)**:
   - Validar la firma criptográfica usando `LEMON_SQUEEZY_WEBHOOK_SECRET` y HMAC SHA256.
   - Escuchar eventos `subscription_created`, `subscription_updated`.
   - Extraer el `tenantId` de `meta.custom_data.tenant_id`.
   - Actualizar el estado del Tenant en la DB/Memoria.
4. **Página de Upgrade (`/upgrade`)**:
   - Para los usuarios autenticados que estén en el plan Free, mostrar los planes Premium y un botón que llama a `/api/checkout`.

## Trampas y Restricciones
- NUNCA confiar en llamadas del frontend para dar por pagado un plan. Siempre depender del Webhook firmado y procesado asíncronamente.
- El Webhook de Lemon Squeezy firma el body crudo (raw body), por lo que en Next.js App Router se debe leer mediante `request.text()` o un buffer, y no mediante `request.json()` antes de verificar la firma.
- Asegurar que las variables en `.env` (API KEY, Store ID, Variant IDs) no se expongan al frontend (sin prefijo `NEXT_PUBLIC_`).


---

# 📄 license_optimization_SOP.md

> **Archivo fuente:** `directivas/license_optimization_SOP.md`

# License Optimization SOP

## Objetivo
Implementar el módulo de "License Optimization" para extraer suscripciones activas y en uso de Microsoft 365 y Azure a través de la API de Microsoft Graph.

## Componentes y Pasos
1. **licenseService.ts**: Conectarse a Graph API (`https://graph.microsoft.com/v1.0/subscribedSkus`) usando `ClientSecretCredential`. Map de `skuPartNumber`, `prepaidUnits.enabled` y `consumedUnits`.
2. **API Route**: Endpoint seguro en `/api/intelligence/licenses` para proveer los datos.
3. **Frontend Dashboard**: KPIs superiores y tabla de react-table detallando las licencias subutilizadas.

## Casos Borde y Trampas
- Graph API requiere el scope `https://graph.microsoft.com/.default` para autenticación Server-to-Server.
- Si no hay licencias, devolver array vacío.


---

# 📄 maturity_reactivity_SOP.md

> **Archivo fuente:** `directivas/maturity_reactivity_SOP.md`

# Maturity Reactivity SOP\n\n## Objetivo\n1. Reparar la reactividad en `overview/maturity/page.tsx` para que al cambiar el `selectedTenant`, la UI actualice correctamente su estado.\n2. Mejorar la UX manteniendo la estructura de la página y mostrando un spinner sobre las tarjetas en lugar de desmontar todo el componente.\n\n## Restricciones/Casos Borde\n- **Nota**: El mock actual retorna siempre los mismos valores, lo que causaba la ilusión de falta de reactividad. Se debe usar el `tenantId` para variar los datos o limpiar explícitamente el estado anterior.\n

---

# 📄 mock_data_SOP.md

> **Archivo fuente:** `directivas/mock_data_SOP.md`

# Standard Operating Procedure (SOP): Inyección de Mock Data

## Objetivo
Garantizar que todo nuevo módulo o funcionalidad desarrollada dentro de la plataforma (especialmente en los dashboards de Inteligencia y Gobernanza) cuente siempre con datos ficticios (Mocks) predecibles y realistas para su demostración y validación.

## Restricciones y Reglas Estrictas (Trampas Conocidas)
- **AISLAMIENTO CRÍTICO:** NUNCA se deben inyectar mocks condicionando la respuesta a `if (data.length === 0)`. Esto contamina y destruye la experiencia de tenants reales que legítimamente no poseen recursos en esa área.
- **USO EXCLUSIVO DEL TENANT DEMO:** Los mocks solo deben activarse si el `tenantId` actual forma parte de la lista blanca de tenants de demostración controlados en la plataforma.
- **CENTRALIZACIÓN:** Los datos mock no deben estar hardcodeados (escritos en duro) dentro de cada ruta individual (`route.ts`). Todo mock debe estar registrado en el archivo central.

## Pasos de Implementación para Nuevas Funcionalidades

1. **Definir el Mock en el Archivo Central:**
   Al crear un nuevo módulo, dirigirse inmediatamente a `src/lib/mockData.ts`.
   Agregar un nuevo `case` en el `switch (route)` correspondiente al nombre del nuevo módulo. Devolver los datos imitando exactamente la interfaz y estructura JSON que devolvería la API en producción.

2. **Interceptar la Ruta del Backend:**
   En el archivo de la ruta (ej. `src/app/api/nuevo-modulo/route.ts`), importar las utilidades:
   `import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";`

3. **Inyectar Tempranamente (Early Return):**
   Justo después de realizar las validaciones de Autenticación y Autorización, y **ANTES** de efectuar consultas costosas a las APIs de Azure (ARG o Cost Management), se debe evaluar la condición del tenant:
   ```typescript
   if (isMockTenant(tenantId)) {
       return NextResponse.json(getMockDataForRoute('nombre_del_caso', tenantId));
   }
   ```

4. **Validar Visualización:**
   Correr la interfaz bajo el tenant de demo (o ingresando a `/demo`) y verificar que los datos fluyan correctamente hacia el UI.


---

# 📄 modular_audit_SOP.md

> **Archivo fuente:** `directivas/modular_audit_SOP.md`

# Directiva: Motor de Auditoría Modular (Fase 7)

## Reglas de Arquitectura
1. **Catálogo Central**: Todas las consultas KQL deben escribirse exclusivamente en `src/lib/kqlCatalog.ts`. Ningún archivo de ruta debe contener strings de Kusto quemados en el código.
2. **Servicios Desacoplados**: La interacción con los SDKs (`@azure/arm-resourcegraph`, `@azure/arm-monitor`) se realiza en `src/services/`.
3. **Cero-Trust en la API**: Cualquier nueva ruta (como `/api/audit/full`) debe validar obligatoriamente la congruencia entre `tenantId` del query parameter y el reclamo `tid` del Bearer token decodificado de MSAL.


---

# 📄 msal_iframe_auth_SOP.md

> **Archivo fuente:** `directivas/msal_iframe_auth_SOP.md`

# SOP: Manejo de Excepciones Silent Token en MSAL (block_iframe_reload y timed_out)

## Objetivo
Resolver el error de autenticación `BrowserAuthError: block_iframe_reload` y `timed_out` provocado por políticas de cookies de terceros del navegador o bloqueos de recarga de iFrames ocultos en MSAL.js al renovar tokens silenciosamente. Esto se logra redirigiendo interactivamente al usuario para refrescar su sesión y rellenar el caché cuando falle la adquisición silenciosa.

## Lógica y Pasos

### 1. Manejo en SubscriptionProvider (`src/components/SubscriptionProvider.tsx`)
- Modificar el bloque `catch` de `fetchSubscriptions`:
  - Identificar si el error es de tipo `BrowserAuthError` o `InteractionRequiredAuthError` y si el código de error coincide con `block_iframe_reload`, `timed_out`, `interaction_required`, `consent_required`, o `login_required`.
  - En caso positivo, invocar `instance.acquireTokenRedirect({ scopes: ["User.Read"], account: accounts[0] })` para redirigir al usuario al flujo interactivo de Microsoft, refrescando el token y guardándolo en caché de forma permanente.

### 2. Manejo en ZombieResourcesTable (`src/components/ZombieResourcesTable.tsx`)
- Modificar el bloque `catch` de `fetchResourcesAndSubs`:
  - Aplicar la misma lógica de redirección condicional defensiva para evitar que la interfaz de la tabla se bloquee indefinidamente en estado de error debido al bloqueo del iFrame oculto de autenticación.

## Restricciones y Trampas Conocidas
- **Evitar bucles de redirección:** El redireccionamiento interactivo guarda el token de manera fresca en el caché del navegador local. Al regresar a la aplicación, `acquireTokenSilent` resolverá el token directamente desde el caché sin disparar llamadas de red en iFrames, rompiendo cualquier bucle potencial de redirección.
- **Validación de cuentas:** Siempre comprobar `accounts.length > 0` y utilizar `accounts[0]` al llamar a `acquireTokenRedirect` para asegurar que el contexto del usuario autenticado esté inicializado.


---

# 📄 mysql_backup_automation_SOP.md

> **Archivo fuente:** `directivas/mysql_backup_automation_SOP.md`

# Directiva: mysql_backup_automation_SOP

## Objetivo
Gestionar el sistema de backups automatizados de MySQL mediante Azure Automation:
un Orchestrator (runbook en Azure sandbox) prende la VM Worker, dispara el
runbook hijo en el Hybrid Runbook Worker, monitorea hasta completar, y apaga la
VM. Todo declarado en Terraform (`infra/terraform/modules/mysql_backup/main.tf`).

## Componentes Clave
- **Automation Account:** `aa-mysql-backups` (Basic SKU, System Assigned Identity)
- **Orchestrator Runbook:** `Orchestrator-Start-Backup-Stop` — corre en Azure sandbox (PS 7.2)
- **Worker Runbook:** `Backup-MySQL-Smart` — corre en Hybrid Runbook Worker dentro de `vm-mysql-worker`
- **VM:** `vm-mysql-worker` (Windows Server 2022, Standard_D2s_v5)
- **Alertas:** Logic App `la-backup-alerts` con conexión Office 365

## Restricciones / Casos Borde Conocidos

### ⚠️ CRÍTICO: Runtime de módulos Az vs runbooks (descubierto 2026-08-01)
- **Problema:** Los cmdlets `Connect-AzAccount`, `Start-AzVM`, `Stop-AzVM` no se
  reconocen si los módulos Az se importan con `azurerm_automation_module` (PS 5.1)
  pero el runbook corre en PS 7.2.
- **Causa raíz:** `azurerm_automation_module` importa módulos en el runtime de
  PS 5.1. Los runbooks de tipo `PowerShell72` solo ven módulos importados para
  el runtime 7.2.
- **Solución:** Usar `azurerm_automation_powershell72_module` para importar
  `Az.Accounts`, `Az.Compute` y `Az.Automation`. Los runbooks deben tener
  `runbook_type = "PowerShell72"`.
- **⚠️ Schema diferente:** `azurerm_automation_powershell72_module` usa
  `automation_account_id` (el ID completo del Automation Account), NO
  `resource_group_name` + `automation_account_name` como el viejo
  `azurerm_automation_module`. Si se copian los argumentos del resource viejo
  sin adaptarlos, Terraform falla con "Missing required argument:
  automation_account_id" y "Unsupported argument: resource_group_name".
- **Nota:** No mezclar `azurerm_automation_module` y
  `azurerm_automation_powershell72_module` para el mismo módulo — si se importa
  en ambos runtimes, el provisioning puede fallar por conflicto de dependencias.

### Conexión OAuth de Office 365
- La API Connection de Office 365 se crea por Terraform pero NO se autoriza.
- Requiere un paso manual único post-apply: Portal → Resource Group →
  `api-connection-office365` → Editar → Autorizar con la cuenta que enviará
  los correos de alerta.

### SAS Token
- El SAS no se auto-rota. Vence según `sas_validity_years` desde el primer apply.
- La variable `STORAGE_SAS_TOKEN` se actualiza automáticamente con `terraform apply`
  cuando `time_rotating.sas_reference` rota.

### Variables de Automation
- `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASS`, `STORAGE_ACCOUNT_NAME`,
  `STORAGE_SAS_TOKEN`, `ALERT_WEBHOOK_URL` — todas encrypted.
- El Worker runbook las lee con `Get-AutomationVariable -Name "..."`.

### Escape de variables en heredoc
- **Nota (descubierto 2026-07-31):** PowerShell dentro de un heredoc `<<-PS1`
  de Terraform requiere `$$` para escapar `$` de PowerShell. Sin el doble `$`,
  Terraform interpola la variable y el script falla con errores de parsing
  como `Unexpected token 'toolPath_MysqlDump'`.

## Procedimiento de Deploy
1. `terraform plan -target=module.mysql_backup` — verificar que los módulos se
   recrean como `azurerm_automation_powershell72_module`.
2. `terraform apply` — los módulos se importan asincrónicamente; puede tardar
   hasta 5 minutos por módulo.
3. Verificar en el Portal: Automation Account → Modules → filtrar por Runtime 7.2
   → confirmar que `Az.Accounts`, `Az.Compute`, `Az.Automation` están en
   `Succeeded`.
4. Ejecutar manualmente el Orchestrator y verificar que pasa la fase de
   autenticación (`Connect-AzAccount -Identity`).

## Checklist
- [ ] ¿Los 3 módulos Az usan `azurerm_automation_powershell72_module`?
- [ ] ¿Ambos runbooks tienen `runbook_type = "PowerShell72"`?
- [ ] ¿El `depends_on` del orchestrator referencia los módulos `powershell72`?
- [ ] ¿La conexión OAuth de Office 365 está autorizada en el Portal?
- [ ] ¿El SAS token tiene fecha de vencimiento dentro del rango esperado?


---

# 📄 mysql_validation_SOP.md

> **Archivo fuente:** `directivas/mysql_validation_SOP.md`

# Directiva: Validación de Contenedor MySQL Local

## Objetivo
Levantar la base de datos y verificar que el pool de conexiones de Node.js (`mysql2`) autentique exitosamente sin errores de acceso o permisos.

## Lógica y Pasos
1. Ejecutar `docker compose up -d` en la raíz del proyecto.
2. Esperar a que el motor de la base de datos se inicialice y exponga el puerto TCP 3306.
3. Ejecutar un script de prueba de Node.js invocando a `mysql2/promise` hacia `mysql://finops_user:finopspassword@localhost:3306/finops_app`.

## Trampas Conocidas
- **Binarios de Docker**: En instalaciones modernas de macOS/Docker Desktop, usar `docker-compose` (con guión) fallará por archivo no encontrado. Se debe utilizar la sintaxis v2: `docker compose` (separado por espacio).
- MySQL 8.0 toma varios segundos (a veces más de 15s) en su primer arranque para inicializar el contenedor y crear el esquema de base de datos interno. Si Node.js intenta conectarse de inmediato, arrojará el error `ECONNREFUSED` o fallos de autenticación temporal. Es obligatorio incluir un bucle de reintentos (`retry loop`) en la verificación para dar tiempo a que el socket de MySQL responda.


---

# 📄 network_analytics_SOP.md

> **Archivo fuente:** `directivas/network_analytics_SOP.md`

# Análisis de Red (Network Analytics) SOP\n\n## Objetivo\nIdentificar costos ocultos de transferencia de datos cruzada y saliente mediante la API de Cost Management.\n\n## Restricciones/Casos Borde\n- Filtrar los costos por MeterCategory='Networking' y MeterSubCategory con 'Bandwidth' o 'Egress'.\n- Se debe usar `@azure/arm-costmanagement`.\n- Validar el tenantId y aislar por suscripción.\n

---

# 📄 onboarding_SOP.md

> **Archivo fuente:** `directivas/onboarding_SOP.md`

# Onboarding Module SOP

- **Role-Based Access Control (RBAC)**: Se automatiza un principio de Privilegio Mínimo (Least Privilege). La aplicación usa los Roles Incorporados de Azure ('Reader', 'Cost Management Reader', 'Monitoring Reader') combinados con un Rol Personalizado en el que solo se incluyen `Actions` de escritura y borrado estrictamente necesarias.
- **Herramienta de Automatización Python**: Se utiliza `scripts/onboarding_automator.py` para asignar los roles automáticamente usando `azure-identity` y `azure-mgmt-authorization`.
- **Experiencia Frontend (UX)**: El panel de PowerShell se renderiza usando Tailwind imitando una terminal nativa de macOS, permitiendo a los clientes confiar en la plataforma SaaS.
- **Clipboard API**: Para evitar que los clientes corrompan el script al seleccionarlo manualmente con el mouse, el botón `navigator.clipboard.writeText` asegura la integridad del comando powershell.

## Acciones del Rol Personalizado
Para evitar dar `Contributor`, el Rol Personalizado de remediación incluye exclusivamente:
- `Microsoft.Compute/virtualMachines/deallocate/action`
- `Microsoft.Compute/virtualMachines/start/action`
- `Microsoft.Compute/virtualMachines/restart/action`
- `Microsoft.Resources/tags/write`
- `Microsoft.Compute/disks/delete`
- `Microsoft.Compute/snapshots/delete`
- `Microsoft.Network/networkInterfaces/delete`
- `Microsoft.Network/networkSecurityGroups/delete`
- `Microsoft.Network/publicIPAddresses/delete`
- `Microsoft.Web/serverfarms/delete`

### Restricciones/Casos Borde
- **Nota PowerShell: No usar `-DisplayName` junto con `New-AzADAppCredential`, ni usar el ObjectId del Service Principal, porque causa el error 'Parameter set cannot be resolved'.** En su lugar, obtener la Application mediante `Get-AzADApplication -AppId $sp.AppId`, extraer su `Id` (Application Object ID), y pasarlo al parámetro `-ObjectId` junto con `-StartDate` y `-EndDate` únicamente.
- **Nota Python Automator:** Se debe instanciar `AuthorizationManagementClient` pasando la credencial y la suscripción. La creación de roles personalizados requiere generar un GUID (`uuid.uuid4()`) como nombre del rol (role definition name).

---

# 📄 pdf_export_SOP.md

> **Archivo fuente:** `directivas/pdf_export_SOP.md`

# PDF Export SOP\n\n- **Restricciones/Casos Borde (Tailwind v4 vs html2canvas)**: Nota: No usar `html2canvas` en proyectos con Tailwind v4. Causa el error `Attempting to parse an unsupported color function "lab"` porque Tailwind v4 renderiza colores en formatos modernos (oklch/lab) que html2canvas no soporta. En su lugar, usar `html-to-image`.\n- **Arquitectura de Reportes**: El generador de reportes se aisló en su propia vista `/admin/report` bajo Administración para no contaminar el Dashboard principal, permitiendo generar vistas pre-estilizadas específicamente para el layout A4 del PDF.\n

---

# 📄 power_schedules_SOP.md

> **Archivo fuente:** `directivas/power_schedules_SOP.md`

# R&D Power Schedules SOP\n\n- **Endpoint**: `/api/power` gestiona el array de VMs a afectar.\n- **Decisión Arquitectónica**: Las llamadas usan `beginDeallocate` y no `beginDeallocateAndWait` para evadir el timeout de la API al afectar a un grupo grande de máquinas. Dejamos que el plano de control de Azure procese asincrónicamente.\n- **Selección Individual**: `PowerSchedules.tsx` muestra un listado interactivo con checkboxes para encender/apagar de manera granular.\n- **Estado de VM**: El query `devVirtualMachines` exporta `powerState` mapeado desde `properties.extended.instanceView.powerState.code`. Este valor es usado en la tabla para marcar gráficamente si está Encendida o Apagada.\n

---

# 📄 pricing_page_SOP.md

> **Archivo fuente:** `directivas/pricing_page_SOP.md`

# Pricing Page SOP

## Objetivo
Crear una página de "Pricing" (Precios) pública atractiva que se mostrará antes del inicio de sesión (Login), basada en la imagen de referencia. 

## Lógica y Pasos a seguir

1. **Creación del Componente**: Crear `src/components/PricingPage.tsx` con un diseño moderno, limpio y alineado al tema de la aplicación (vibrante, dark mode, glassmorphism opcional).
2. **Estructura de la Página**:
   - **Título**: "Planes Simples y Transparentes" (o similar).
   - **Tarjetas de Precios**:
     - **Free/Starter**: $0. Botón "Sign up".
     - **Professional**: $299/mes. Botón "Sign up" con etiqueta "14 Day Free Trial".
     - **Enterprise**: Custom / $899. Botón "Schedule a call".
3. **Integración en ClientShell**:
   - Modificar `src/components/ClientShell.tsx`.
   - Cuando el usuario no esté autenticado (`!isAuthenticated`), en lugar de mostrar directamente el formulario de inicio de sesión actual, mostraremos una landing que contenga la tabla de precios.
   - Alternativamente, se puede añadir un estado `showLogin` para alternar entre el "Pricing Page" y el "Login Page" actual, o que los botones de "Sign up" de los planes de Pricing redirijan directamente a `instance.loginRedirect()`.
4. **Diseño (Estética)**:
   - Uso de TailwindCSS.
   - Animaciones sutiles (hover effects en botones y tarjetas).
   - Tipografía moderna (Montserrat / Open Sans, ya configuradas).

## Trampas y Restricciones
- Asegurar que la página de Pricing sea completamente responsiva (apilando tarjetas en móvil).
- El botón "Sign up" debe iniciar el flujo de autenticación de MSAL.
- Mantener la coherencia visual con la marca "CSCloudSolutions".


---

# 📄 rbac_auth_multitenancy_policy_SOP.md

> **Archivo fuente:** `directivas/rbac_auth_multitenancy_policy_SOP.md`

# RBAC, Autenticación y Multi-Tenancy Policy SOP

## Objetivo

Definir la política vinculante de acceso, autenticación y aislamiento de datos entre tenants de demostración (mock/sandbox) y tenants reales conectados a Azure. Estas reglas aplican a **todas** las rutas API (`/api/...`) y Server Actions del proyecto.

---

## POLÍTICA DE ACCESO, AUTENTICACIÓN Y MULTI-TENANCY (RBAC VS. MOCK)

### 1. Tenants de Demostración / Sandbox

**Condición de activación:** `isMockTenant(tenantId) === true` **O** query/param `mock=true` **O** `isDemoMode === true` **O** `tenantId.startsWith("demo-")`.

- **Bypass de OAuth:** Servir los datos sintéticos/demo de inmediato **sin exigir autenticación OAuth** ni tokens de Azure Entra ID.
- **Sin bloqueo de sesión:** Permitir la navegación fluida e interactiva en modo vista previa sin disparar errores 401/403.
- **Orden obligatorio en rutas API:** El check `isMockTenant(tenantId)` DEBE ejecutarse **ANTES** de `requireTenantAccess(request, tenantId)`. Nunca al revés.

### 2. Tenants Reales / Conectados

**Condición de activación:** `isMockTenant(tenantId) === false`.

- **Validación Estricta de RBAC:** Ejecutar obligatoriamente el middleware de seguridad `requireTenantAccess(req, tenantId)` antes de cualquier consulta.
- **Autenticación OAuth / Entra ID:** Exigir y validar el token Bearer, permisos de lectura (`Cost Management Reader`, `Reader`, `Monitoring Reader`) y contexto de suscripción.
- **Consumo Exclusivo de APIs Vivas:** Prohibido el uso de fallbacks mock; consultar directamente Azure Resource Graph, Cost Management y Azure Monitor.

---

## DATA ACCURACY, TENANT ROUTING & AUTHENTICATION POLICY

### DEMO / MOCK TENANTS (`isMockTenant(tenantId) === true` OR `mock=true` OR `isDemoMode === true`):
- Serve demo/mock datasets immediately without requiring OAuth authentication or Entra ID access tokens.
- Never block navigation, API routes, or UI rendering with 401/403 challenges in demo mode.

### REAL PRODUCTION TENANTS (`isMockTenant(tenantId) === false`):
- Enforce strict RBAC validation using `requireTenantAccess(req, tenantId)`.
- Validate Entra ID OAuth tokens, subscription scopes, and role assignments prior to data resolution.
- Zero-tolerance mock policy: NEVER display fallback mocks or hardcoded zeroes. Compute data dynamically via live Azure APIs:
  - Azure Resource Graph (`Microsoft.Resources`, `Microsoft.Compute`, `Microsoft.DocumentDB`, `Microsoft.DBforPostgreSQL`, `Microsoft.DBforMySQL`, `Microsoft.Sql`, `Microsoft.Cache`, `Microsoft.Storage`, `Microsoft.Fabric`, `Microsoft.RecoveryServices`).
  - Azure Cost Management API & FOCUS 1.0 Dataset.
  - Azure Monitor Metrics API.

### AUDITING & DRILL-DOWNS:
- Always preserve mapping back to Azure Resource ID, Resource Group, Subscription, and Location.

---

## DATA ACCURACY, TENANT ISOLATION & ZERO-FALLBACK POLICY (CRITICAL)

### DEMO / MOCK TENANTS:
- Servir datasets de demostración inmediatamente sin exigir autenticación OAuth ni tokens de Entra ID.
- Habilitar interacción y navegación libre sin bloqueos 401/403.

### REAL / CONNECTED TENANTS:
- Exigir validación estricta de RBAC mediante `requireTenantAccess(req, tenantId)`.
- **PROHIBIDO EL FALLBACK A MOCKS:** Si una consulta a Azure Resource Graph, Cost Management o Monitor devuelve `[]`, `$0.00` o valores nulos (por ejemplo, una suscripción recién creada o sin ese tipo de recurso aprovisionado), la UI **DEBE mostrar `$0.00` / estado vacío real (`Empty State`)**.
- **JAMÁS inyectar mocks como rescate visual de datos vacíos.** Un tenant real con costo cero o sin recursos es un estado operativo válido, no un error que deba enmascararse con datos sintéticos.

### CONSULTAS EN TIEMPO REAL:
Consumir exclusivamente endpoints vivos:
- Azure Resource Graph (`Microsoft.Resources`, `Microsoft.Compute`, `Microsoft.DocumentDB`, `Microsoft.DBforPostgreSQL`, `Microsoft.DBforMySQL`, `Microsoft.Sql`, `Microsoft.Cache`, `Microsoft.Storage`, `Microsoft.Fabric`, `Microsoft.RecoveryServices`).
- Azure Cost Management API & FOCUS 1.0 Dataset.
- Azure Monitor Metrics API.

---

## Patrón de Implementación en Rutas API

```
// Pseudocódigo — Patrón CORRECTO de auth en rutas API
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

  // ✅ PASO 1: Mock check PRIMERO (sin auth)
  if (isMockTenant(tenantId)) {
    return NextResponse.json(buildMockResponse(tenantId));
  }

  // ✅ PASO 2: Auth estricta SOLO para tenants reales
  await requireTenantAccess(request, tenantId);

  // ✅ PASO 3: Consultar APIs vivas de Azure
  const data = await queryAzureLive(tenantId);
  return NextResponse.json(data);
}
```

---

## Permisos Azure Requeridos (Tenants Reales)

| Capa | Rol Mínimo | Propósito |
|------|-----------|-----------|
| ARM / Azure Resource Graph | `Reader` (Suscripción o RG) | Listar recursos (VMs, Discos, Storage Accounts, DBs, Vaults) |
| Cost Management API | `Cost Management Reader` o `Billing Reader` | Snapshots de facturación, amortizaciones, costos MTD |
| Azure Monitor | `Monitoring Reader` | Métricas de rendimiento (CPU, IOPS, transacciones) |
| Entra ID App Registration | `user_impersonation` (delegado) o `https://management.azure.com/.default` (app) | Autenticación OAuth del Service Principal |

---

## Trampas Conocidas / Restricciones

1. **Error 401 por orden incorrecto:** Si `requireTenantAccess` se ejecuta antes de `isMockTenant`, los tenants demo reciben 401 porque no tienen sesión OAuth activa.
2. **Prefijos de tenant:** Además de `isMockTenant()`, verificar `tenantId.startsWith("mock-")` y `tenantId.startsWith("demo-")` para cubrir variantes de demo.
3. **Parámetro `mock=true`:** Algunas rutas antiguas usan el query param `mock=true` como señal de demo; mantener compatibilidad.
4. **Tenants vacíos ≠ Error:** Un tenant real con `$0.00` de costo o sin recursos es un estado válido. La UI debe mostrar un Empty State limpio, nunca inyectar mocks.
5. **Guards de auth reconocidos** (`src/lib/requestAuth.ts`): `requireTenantAccess`, `requireTenantRole`, `requireSuperAdmin`, `requireRequestIdentity`. Toda ruta API que lea `tenantId` del cliente DEBE pasar por uno de ellos antes de cualquier operación tenant-scoped (después del check de mock).


---

# 📄 rbac_onboarding_SOP.md

> **Archivo fuente:** `directivas/rbac_onboarding_SOP.md`

# Directiva: Onboarding RBAC Cero-Fricción

## Objetivo
Detectar cuando la aplicación ha sido consentida (Admin Consent) pero carece de permisos sobre los recursos (Suscripciones / Resource Graph), y proporcionar una experiencia automatizada al cliente.

## Lógica
- Si la API de Azure devuelve un error 403 (AccessDenied) o `AuthorizationFailed`, el backend interceptará este error y devolverá un HTTP 403 con el código `MISSING_RBAC_ROLE`.
- El Frontend (React) atrapará este código y renderizará `<RoleAssignmentBanner />` en lugar de una tabla vacía o un error genérico.
- El Banner proporciona el script `az role assignment create` usando el Client ID nativo, permitiendo al cliente ejecutarlo directamente en Cloud Shell.

## Restricciones/Casos Borde
- **Falta de Admin Consent (AADSTS7000229)**: Cuando un cliente agrega un nuevo Tenant, la aplicación Multi-Tenant no existe en su directorio hasta que se consiente. El SDK de Azure arrojará `AuthenticationRequiredError` con el código `AADSTS7000229`. El backend DEBE interceptar esta subcadena en `e.message` y devolver un HTTP 403 con el código `MISSING_ADMIN_CONSENT`. El Frontend debe atrapar esto y mostrar un mensaje pidiendo que se cree el Service Principal mediante `az ad sp create --id <Client_ID>` o usando la URL de Admin Consent, en lugar de intentar mostrar datos o fallar con 401/500.
- **Object ID Mismatch tras borrar/recrear SP (CRÍTICO)**: Cuando se borra y recrea un Service Principal, Azure le asigna un NUEVO Object ID. Las asignaciones de roles RBAC se vinculan al Object ID (NO al App/Client ID). Si se asignan roles al Object ID viejo, el SP nuevo se autentica exitosamente pero Azure retorna 0 suscripciones (HTTP 200 con array vacío). Azure reporta el Object ID real en mensajes de error de `AuthorizationFailed`. El script `onboarding_automator.py` DEBE auto-detectar el Object ID actual via Microsoft Graph antes de asignar roles. NUNCA confiar en un Object ID proporcionado manualmente sin verificar que coincida con el SP actualmente autenticado.


---

# 📄 redistest_fixes_SOP.md

> **Archivo fuente:** `directivas/redistest_fixes_SOP.md`

# Redis Metrics Debugging and Fixes SOP

## Objetivo
Este SOP documenta el diagnóstico y la resolución definitiva para asegurar que las 12 gráficas de `redistest` (Azure Cache for Redis) nunca se muestren vacías en la interfaz de usuario.

## Entradas
- API de Azure Monitor Metrics para recursos de tipo `microsoft.cache/redis` y `microsoft.cache/redisenterprise`.
- Endpoint `/src/app/api/intelligence/databases/redis-metrics/route.ts`.
- Componente `/src/components/dashboard/RedisTestBoard.tsx`.

## Lógica y Pasos

1. **Métrica Inexistente en Azure Monitor**:
   - Se removió `"TotalCommandsProcessed"` del arreglo de métricas de Azure Monitor para evitar errores `400 Bad Request`.
   - Se calcula derivando `totalCmds = Math.round(ops * 3600)`.

2. **Patrón de Fallback de Puntos a Cero (24h)**:
   - Cuando un recurso de Redis existe en la suscripción del tenant pero Azure Monitor no devuelve datos de telemetría (instancia inactiva, sin tráfico o permisos limitados de métrica), `history` no debe ser un arreglo vacío `[]`.
   - En su lugar, el backend debe generar 24 puntos para las últimas 24 horas con valor `0` en todas las métricas.
   - Esto permite que las 12 gráficas de área se rendericen correctamente mostrando la línea de actividad en `0` (CPU 0%, Memoria 0 B, Clientes 0), confirmando el estado del servidor en lugar de dejar la pantalla vacía.

3. **Invalidez de Caché**:
   - La caché de diagnósticos de Redis (`databases:diagnostics:v1:redis-metrics:${tenantId}`) retiene respuestas por 15 minutos.
   - El script de parche limpia las claves obsoletas para asegurar la renderización inmediata.

## Trampas Conocidas / Restricciones
- **No Devolver Arreglos Vacíos si el Recurso Existe**: Si el recurso de Redis existe, `history` jamás debe retornar `[]`. Siempre debe devolver los 24 puntos del intervalo temporal.
- **Marca**: NUNCA usar variantes con espacios en la denominación de la empresa. Usar siempre **CSCloudSolutions**.


---

# 📄 redistest_realtime_metrics_SOP.md

> **Archivo fuente:** `directivas/redistest_realtime_metrics_SOP.md`

# Redis Realtime Metrics SOP

## Objetivo
Este SOP define la arquitectura y el procedimiento para habilitar telemetría en tiempo real (Live Metrics) para `redistest` (Azure Cache for Redis).

## Entradas
- API de Azure Monitor Metrics (`Microsoft.Insights/metrics`).
- Endpoint `/src/app/api/intelligence/databases/redis-metrics/route.ts`.
- Componente `/src/components/dashboard/RedisTestBoard.tsx`.

## Lógica y Pasos

1. **Consulta de Granularidad de Tiempo Real en Azure Monitor**:
   - Cambiar o parametrizar el llamado a Azure Monitor a `timespan=PT1H` con `interval=PT1M` (última 1 hora con resolución por minuto - 60 puntos de telemetría en vivo).
   - Formatear las marcas de tiempo a minuto exacto (`HH:mm`).

2. **Bypass de Caché para Live Streaming**:
   - Cuando se consulta con `realtime=true` o `bust=1`, la API backend omite la lectura de la caché de Redis (`readDiagnosticsCache`) y consulta directamente a Azure Management API para obtener la métrica en vivo.

3. **Auto-Refresh en Frontend**:
   - En `RedisTestBoard.tsx`, implementar un temporizador de actualización automática (Auto-Refresh) cada 30 segundos cuando el modo "Tiempo Real" esté activo.
   - Añadir una insignia visual en la cabecera con un indicador animado en verde (`Live Telemetry`) e i18n habilitado.

## Trampas Conocidas / Restricciones
- **Límites de Rate Limit de Azure**: Para evitar saturar las cuotas de Azure Resource Manager, el intervalo mínimo de auto-refresh recomendado en frontend es de 30 segundos.
- **Marca**: Mantener strictly el nombre **CSCloudSolutions**.


---

# 📄 reservas_activas_SOP.md

> **Archivo fuente:** `directivas/reservas_activas_SOP.md`

# Directiva: Reservas Activas (Azure Reservations blade)

## Objetivo
Replicar el blade **Reservations** del portal de Azure dentro de *Descuentos por Compromiso
(RIs & Savings Plans)* → sección **Reservas Activas** (`/intelligence/commitments`), exponiendo
por reserva: **Nombre, Estado, Expiración, Alcance (Scope), Tipo, Nombre del producto, Región,
Renovación, Cantidad, Utilización último día y últimos 7 días**, con dos modales:
1. **Renovación**: activar/deshabilitar la auto-renovación (mutación en Azure).
2. **Utilización**: al hacer clic sobre el % → aggregates 1/7/30 días + tendencia diaria.

## Fuentes Azure
- **Listado**: `GET https://management.azure.com/providers/Microsoft.Capacity/reservations?api-version=2022-11-01&$refreshSummary=true` (paginado por `nextLink`). Los `properties.utilization.aggregates` traen los grains 1 y 7 días.
- **Tendencia (modal)**: `Microsoft.Capacity/reservationOrders/{orderId}/reservations/{id}?$expand=renewProperties` para aggregates 1/7/30; serie diaria vía Consumption `reservationsSummaries.listByReservationOrderAndReservation(orderId, id, "daily", { filter })` (best-effort EA/MCA, usa `avgUtilizationPercentage`).
- **Renovación**: `PATCH .../reservationOrders/{orderId}/reservations/{id}` body `{ "properties": { "renew": <bool> } }`.

## Lógica y Pasos
1. **Service** (`src/services/reservationService.ts`): `getActiveReservations`, `getReservationUtilizationTrend`, `setReservationRenew`, `parseReservationResourceId`. Todo vía `fetch` con token ARM (`credential.getToken('https://management.azure.com/.default')`), consistente con el patrón previo del archivo.
2. **API**:
   - `GET /api/intelligence/commitments` → agrega `reservationDetails` (cache `commitments:v3:{tenantId}`, 12 h SWR). Guard `requireTenantAccess`.
   - `GET /api/intelligence/commitments/reservations/utilization` → modal. Guard `requireTenantAccess`.
   - `PATCH /api/intelligence/commitments/reservations/renew` → mutación. Guard `requireTenantRole(['Admin','Owner'])`; invalida `commitments:v3:{tenantId}` en Redis.
3. **Frontend** (`Commitments.tsx` + `ReservationRenewalModal.tsx` + `ReservationUtilizationModal.tsx`): tabla detallada; el % de uso y el botón de renovación abren sus modales. `authFetch` reutilizable (token MSAL silencioso) se pasa a los modales.

## RBAC (menor privilegio)
- **Lectura**: app `requireTenantAccess`; Azure **Reservations Reader** sobre el order.
- **Renovación**: app `requireTenantRole(['Admin','Owner'])`; Azure **Reservations Contributor** u **Owner** del order.

## Trampas Conocidas / Restricciones
- **Degradación silenciosa**: si el SP no tiene *Reservations Reader*, `getActiveReservations` loguea y devuelve `[]` (no rompe el resto del panel de commitments).
- **Serie diaria**: `reservationsSummaries` requiere Billing Reader (EA/MCA). Si falla, el modal muestra solo los aggregates + aviso `utilNoTrend`.
- **LRO**: el `PATCH` de renovación puede responder 202 sin body; se trata como aceptado.
- **Mock**: tenants demo (`isMockTenant`) → `reservationDetails` por tier (`case 'commitments'`) y `reservation_utilization` en `src/lib/mockData.ts`; la mutación de renovación NO toca Azure.
- **i18n**: namespace `Commitments` (es/en/pt-BR), paridad de keys obligatoria.
- **Multitenancy**: siempre usar `selectedTenant.id` de `useTenant()`; nunca leer `tenantId` sin guard (regla ESLint `local/no-unauth-tenant-id`).


---

# 📄 responsive_ui_SOP.md

> **Archivo fuente:** `directivas/responsive_ui_SOP.md`

# Responsive UI & Dashboard Restructure SOP\n\n## Objetivo\nAsegurar que la plataforma FinOps sea responsiva en PC, tabletas y móviles. Reordenar las cajas del dashboard para evitar espacios vacíos.\n\n## Implementación\n- `Sidebar`: Off-canvas absoluto en móviles, con overlay.\n- `ClientShell`: Headers responsivos.\n- `Dashboard`: Layout de Grid actualizado con `col-span-full` para gráficos anchos.\n

---

# 📄 rightsizing_SOP.md

> **Archivo fuente:** `directivas/rightsizing_SOP.md`

# Rightsizing Engine SOP

- **Azure Monitor API**: Se consulta `Percentage CPU` utilizando la sintaxis de ISO 8601 Duration (`P14D` para timespan, `P1D` para intervalo).
- **Lógica de Decisión**: Máquinas con Pico CPU (Maximum) inferior a 20% en un periodo de 14 días se marcan como subutilizadas.
- **Concurrencia**: Al leer métricas de múltiples VMs, se envuelve en `Promise.all` para evitar tiempos de espera prolongados en el backend.
- **Error Handling**: Las consultas fallidas de Resource Graph (generalmente errores genéricos con correlationId) se capturan y renderizan como alertas de permisos de Azure RBAC en la UI.
- **Rate Limiting (429) de Azure Resource Graph**:
  - *Nota*: No lanzar múltiples consultas concurrentes a `argClient.resources` con `Promise.all` en el backend sin reintentos o delays, porque causa errores `429 RateLimiting (Internal Server Error)`.
  - *En su lugar*: Implementar un helper de reintento (`queryResourceGraphWithRetry`) con retroceso exponencial (exponential backoff) para peticiones ARG, y realizar las consultas de manera secuencial o con pequeños retrasos (delays) de 1000ms.

---

# 📄 rightsizing_network_SOP.md

> **Archivo fuente:** `directivas/rightsizing_network_SOP.md`

# Directiva: Rightsizing P95 y Network API Fix

## Objetivo
Mejorar el motor de rightsizing usando métricas reales (P95/Max en 14 días). Solucionar error 500 en Network aislando tenants y capturando fallos de SDK.

## Restricciones/Casos Borde
- **Azure Monitor API**: El parámetro `aggregation` requiere especificar `Maximum,Average` (o los soportados explícitamente). No asumas que la API devuelve P95 nativamente si no lo pides, o en su defecto, calcula el P95 basado en las métricas listadas.
- **Network SDK (AuthorizationFailed)**: Siempre envuelve `networkClient` y `getNetworkEgressCosts` en try/catch. Un error 403 del SDK (`AuthorizationFailed` o `ScopeNotFound`) significa que el SPN no tiene permiso en esa Subscripción. No se debe petar con 500.
- **DefaultAzureCredential / ClientSecretCredential**: Instanciar SIEMPRE usando `getAzureCredential(tenantId)` para garantizar que el token esté scoped al directorio del cliente.


---

# 📄 rightsizing_paas_stopped_SOP.md

> **Archivo fuente:** `directivas/rightsizing_paas_stopped_SOP.md`

# SOP: Optimización de Desperdicio PaaS y Long Stopped Instances (Flexera Policies)

## Objetivo
Implementar dos políticas empresariales de Flexera en la plataforma FinOps:
1. **Desperdicio PaaS (Unused App Service Plans):** Registrar y ejecutar la consulta `emptyAppServicePlans` con un Join real en KQL. Calcular costos con el servicio de precios de Azure (Retail API) y un fallback según la categoría (P/S/B/etc.), integrando el resultado en la vista de Zombis (Fugas Financieras).
2. **Long Stopped Instances (Falsos Ahorros):** Detectar VMs persistentemente deallocated con discos de almacenamiento asociados. Calcular el costo oculto de estos discos e incluirlos como una recomendación especial en la vista de Rightsizing, permitiendo al usuario Snapshot/Borrar la máquina.

## Lógica y Pasos

### 1. KQL Catalog (`src/modules/core/kqlCatalog.ts`)
- **Query `emptyAppServicePlans`:** Usar un Join explícito para cruzar `microsoft.web/serverfarms` con `microsoft.web/sites` y filtrar aquellos planes con recuento de sitios igual a 0.
- **Query `longStoppedVMs`:** Consultar `microsoft.compute/virtualmachines` buscando estado `PowerState/deallocated`. Proyectar las propiedades de discos: `osDiskId = tolower(tostring(properties.storageProfile.osDisk.managedDisk.id))` y la colección `dataDisks`.

### 2. Pricing Fallback (`src/app/api/audit/full/route.ts`)
- Mapear costos de `emptyAppServicePlans` consultando `getMonthlyCostEstimate("App Service", sku, location)`.
- Si retorna 0 o falla, aplicar un fallback basado en la primera letra del SKU:
  - `P` (Premium): $150.00 USD
  - `S` (Standard): $75.00 USD
  - `B` (Basic): $55.00 USD
  - Otros: $45.00 USD
  - Shared/Free: $0.00 USD
- Estandarizar el objeto devuelto con las propiedades `{ resourceId, name, resourceType, monthlyCost }` para compatibilidad en el dashboard de fugas financieras.

### 3. Derechos de VM Paradas / Rightsizing (`src/app/api/intelligence/rightsizing/route.ts`)
- Consultar en paralelo tanto las VMs normales como las de `longStoppedVMs`.
- Consultar todos los discos (`microsoft.compute/disks`) de la suscripción para armar un mapa rápido de `diskId -> { diskSizeGB, sku }`.
- Para cada VM deallocated, sumar el tamaño de su OS Disk y Data Disks adjuntos.
- Calcular el costo de almacenamiento usando la Retail API o un valor estándar ($0.15 por GB).
- Retornar estos elementos en la respuesta con:
  - `recommendedSku`: `"Snapshot & Delete"`
  - `isUnderutilized`: `true`
  - `reason`: `"Deallocated VM with attached Storage"`
  - `hiddenCost`: el costo calculado de los discos.
  - `maxCpu`: `0`

### 4. UI Rightsizing (`src/app/[locale]/intelligence/rightsizing/page.tsx`)
- Detectar si `vm.reason === 'Deallocated VM with attached Storage'`.
- En caso afirmativo, mostrar un badge/texto especial para advertir del costo oculto.
- Cambiar el botón de acción a "Snapshot & Delete".
- Al hacer clic, invocar `/api/remediation` enviando el tipo de recurso `microsoft.compute/virtualmachines` para destruir la VM o alertar al usuario.

## Restricciones y Trampas Conocidas
- **Manejo de nulos en discos:** Una VM deallocated puede tener discos no administrados o un perfil de almacenamiento incompleto. Utilizar validaciones seguras (`?.`) y fallbacks.
- **Evitar duplicación de VMs:** Al mezclar los dos flujos en el backend de rightsizing, filtrar VMs duplicadas (si una VM parada también es clasificada por CPU).


---

# 📄 security_db_SOP.md

> **Archivo fuente:** `directivas/security_db_SOP.md`

# Directiva: Integración de MySQL, Aislamiento JWT y Key Vault

## Objetivo
Agregar soporte local para MySQL vía Docker, y robustecer la arquitectura Multi-Tenant extrayendo el Tenant ID (`tid`) desde el token JWT y descargando secretos por tenant de forma dinámica con Azure Key Vault.

## Entradas
- Cabecera `Authorization: Bearer <token>`
- Variables de entorno: `NEXT_PUBLIC_CLIENT_ID`, `KEYVAULT_NAME`, `DATABASE_URL`

## Lógica y Pasos
1. Configuración de Base de Datos: Generar `docker-compose.yml` para MySQL 8.0 y su módulo de conexión en `src/lib/db.ts` vía `mysql2`.
2. Flujo Admin Consent: Inyectar componente de Next.js `AdminConsentButton.tsx` en el layout para hacer redirect al endpoint de Entra ID.
3. Azure Key Vault: Crear `src/lib/keyvault.ts` que se conecte mediante `DefaultAzureCredential` local para recuperar secretos de la bóveda bajo el formato `client-secret-{tenantId}`.
4. Aislamiento JWT (Zero-Trust): Refactorizar endpoints `route.ts`. Validar si el Bearer token existe. Decodificar usando `jsonwebtoken` y validar estrictamente que `decoded.tid === tenantId`. Devolver 403 en caso contrario.

## Trampas Conocidas / Restricciones
- Al requerir asincronía en Key Vault, `getAzureCredential`, `getComputeClient` y `getNetworkClient` ahora son métodos asíncronos (`async/await`). Los endpoints `route.ts` fallarán si no usan `await` al instanciarlos.
- La decodificación del JWT confía en `jsonwebtoken.decode()` únicamente para extraer el `tid`. Para la validación completa en el futuro (JWKS), se requerirá autenticación extendida, pero esta validación blinda la lectura cruzada temporalmente.


---

# 📄 security_patch_SOP.md

> **Archivo fuente:** `directivas/security_patch_SOP.md`

# Security Patches SOP\n\n## Objetivo\n1. Mitigar Inyección PowerShell validando estrictamente el formato UUID.\n2. Mitigar Inyección SQL asegurando que ninguna cadena SQL sea construida por concatenación (+), usando template literals de un solo string y variables parametrizadas (?).\n\n## Restricciones/Casos Borde\n- **Nota: Tenant Isolation no fue implementado estrictamente** para no romper el modelo de SuperAdmin cross-tenant de la plataforma SaaS.\n

---

# 📄 sentinel_monitoring_SOP.md

> **Archivo fuente:** `directivas/sentinel_monitoring_SOP.md`

# Sentinel Monitoring Integration SOP

## Objetivo
Este SOP describe los lineamientos y requerimientos técnicos para integrar Microsoft Sentinel como una pestaña en la sección de Monitoreo de CSCloudSolutions. Permite a los administradores visualizar el inventario detallado de recursos de Sentinel y sus costos individuales asociados en una tabla paginada, incluyendo nombre, grupo de recursos, suscripción y costo mensual.

## Entradas
- API de Azure Resource Graph para listar y contar recursos individuales de tipo `microsoft.operationalinsights/workspaces`.
- API de Azure Cost Management para obtener el costo detallado por `ResourceId` (últimos 30 días) para los servicios de Sentinel.
- Configuración de internacionalización (i18n) en los 3 idiomas (Español, Inglés, Portugués).
- Mocks para simulación de desgloses de recursos según el Tenant.

## Lógica y Pasos

1. **Definición de Tipo y Parámetros en API**:
   - Modificar la API `/api/intelligence/monitoring/service-cost/route.ts` para que realice una consulta individualizada de recursos.
   - En Resource Graph: traer `name`, `resourceGroup`, `subscriptionId` e `id` (en minúsculas) de los workspaces.
   - En Cost Management: agrupar el costo por `ResourceId` en lugar de por `ServiceName`, filtrando por los servicios configurados.
   - Cruzar los datos para calcular el costo de cada recurso y el total agregado.
   - Proporcionar arrays mock para simulación coherente en `isMockTenant` con nombres representativos de Sentinel.

2. **Actualización de Interfaz del Frontend**:
   - Modificar `src/components/dashboard/MonitoringServiceCostBoard.tsx` para admitir `data.resources`.
   - Incorporar paginación importando `Pagination, { usePagination }` desde `@/components/Pagination`.
   - Si `data.resources` está presente, renderizar la tabla paginada de recursos individuales detallando:
     - Nombre del recurso (y grupo de recursos)
     - Suscripción
     - Costo mensual
   - Si no está presente, caer en la vista agregada por defecto.

3. **Internacionalización**:
   - Asegurar que los headers de la tabla estén debidamente traducidos en `es.json`, `en.json` y `pt-BR.json` bajo la sección `MonitoringFamilies` (ej. `colResourceName`, `colResourceGroup`, `colSubscription`).

## Trampas Conocidas / Restricciones
- **Precisión Monetaria**: Mantener la agregación y el formateo de costos usando los tipos y helpers numéricos provistos.
- **Marca**: NUNCA escribir "CS Cloud Solutions". Escribir siempre **CSCloudSolutions**.
- **Consistencia**: El costo total debe ser la suma exacta de los costos individuales de los recursos listados.


---

# 📄 storage_efficiency_SOP.md

> **Archivo fuente:** `directivas/storage_efficiency_SOP.md`

# Directiva: Storage Efficiency Dashboard

## Objetivo
Mantener el dashboard de Eficiencia de Storage mostrando siempre los datos reales de Azure (Cuentas de Almacenamiento, Tiers, y Costos) para el tenant correspondiente.

## Restricciones y Casos Borde (El Protocolo de Auto-Corrección)
1. **Nombres de Tenants:** Nombres inventados o sintéticos (ej. `stMath.random()`) SOLO deben utilizarse para los tenants de demostración (`tenantId.startsWith("mock-")`). En tenants productivos SIEMPRE el nombre tiene que venir de Azure Resource Graph. No se debe caer en fallbacks sintéticos si la llamada a ARG falla.
2. **Límites de Suscripción (Truncamiento):** La función `getSubscriptionsForTenant(tenantId)` por diseño trunca el número de suscripciones devueltas basándose en el Tier del tenant (ej. Essential=1). Sin embargo, para la tabla de inventario de Storage Accounts, debemos mostrar **todas** las cuentas del tenant independientemente del plan, para evitar el bug donde "solo trae 1 SA cuando hay 5". Para lograrlo, utilizar un listado sin truncamiento de la API de Management (`getUntruncatedSubscriptions`) al buscar en ARG, para garantizar que ARG devuelva todos los recursos sin ser limitado por la capa de aplicación.
3. **Manejo de Arrays Vacíos:** Antes de completar una implementación, asegurarse que no se devuelvan arrays vacíos `[]` por error al consultar ARG. Si ARG requiere el parámetro `subscriptions` obligatoriamente (para no tirar 403 o arrojar excepciones de SDK), asegúrese de pasar un array válido de IDs de suscripciones. Si no hay suscripciones, omita la llamada a ARG de manera segura pero siga enviando los datos de Costos (`totalGb`, `totalCost`) si existen en la BD.
4. **Tipos de Recursos:** Al consultar ARG (`microsoft.storage/storageaccounts`), incluir también explícitamente `microsoft.classicstorage/storageaccounts` para evitar omitir cuentas de almacenamiento heredadas.
5. **Git Push:** NUNCA enviar código a github (`git push`) a menos que el usuario lo ordene explícitamente. Solo realizar `git commit` a nivel local para asentar los arreglos en el flujo de desarrollo.
6. **CostMeterSnapshots y resource_group:** La tabla `CostMeterSnapshots` (a diferencia de `CostSnapshots` legacy) NO contiene la columna `resource_group`.
   - **CRÍTICO: NUNCA agregar `resource_group` al `SELECT` de `queryMeterRows`.** Hacerlo causa un error `ER_BAD_FIELD_ERROR` (Unknown column 'resource_group') que hace colapsar la consulta contra `CostMeterSnapshots`, provocando que la API devuelva costos en `$0.00` y `0 GB` para tenants cuyos datos residen en `CostMeterSnapshots`.
   - **Nota de Orden:** En `storage-efficiency`, consultar siempre primero `queryLegacyRows` (`CostSnapshots`). De esta forma, si existen datos de costo sincronizados en la BD, la API obtendrá la columna `resource_group` y podrá asociar de manera exacta los GB y costos a cada *Storage Account* individual según su Grupo de Recursos. Si no hay registros legacy, se usará `queryMeterRows` (sin `resource_group`) para obtener los totales agregados.
7. **Disparo de SWR en Frontend (`StorageEfficiencyDashboard.tsx`):** NO condicionar la llamada de SWR a `accounts.length > 0` (del hook de MSAL), ya que en sesiones locales, auth basada en cookies o logins JWT la lista de cuentas de MSAL puede estar vacía `[]`. 
   - **Nota:** La condición de SWR solo debe requerir `selectedTenant && selectedTenant.id !== 'default'`.
8. **Disponibilidad de Datos por Tenant:** Entender que en la base de datos MySQL local/producción, solo los tenants que hayan completado una sincronización de costos (como RPA365) tendrán filas de consumo histórico en `CostSnapshots`. Para tenants sin consumo sincronizado aún (ej. CSCloudSolutions o Azure Patrocinio), la API consultará a ARG y devolverá las Cuentas de Almacenamiento vivas de Azure en la tabla con costo $0 hasta que se ejecute la sincronización de FinOps (`/api/cron/sync-tenant-costs`).
9. **Sintaxis KQL en ARG (`fetchAllStorageAccountsFromARG`):** NUNCA usar sintaxis de asignación inline inválida en el operador `project` de KQL (ej. `project sku = tostring(sku.name)`). Esto causa un error de parseo `400 BadRequest` (`ParserFailure`) en la API de Azure Resource Graph, haciendo caer la llamada a ARG en la captura de excepciones y devolviendo un array de cuentas vacío `[]`. 
    - **Nota:** Proyectar las columnas directamente (`project id, name, location, resourceGroup, subscriptionId, sku, kind, properties`) y mapear en JavaScript propiedades anidadas (`acc.properties?.accessTier`, `acc.sku?.name || acc.sku`).
10. **Estrategia de atribución financiera (RG -> Ubicación):** La atribución por Resource Group o ubicación solo puede utilizarse para distribuir el **costo histórico** cuando el export de costos no identifica una cuenta individual. Nunca se debe usar para completar o estimar `usedGb` por Storage Account:
    - **Nivel 1 (Resource Group):** Coincidencia exacta por `resourceGroup` (cuando los datos vienen de `CostSnapshots`).
    - **Nivel 2 (Ubicación / Región Azure):** Coincidencia normalizada por región Azure (`resource_location` en `CostMeterSnapshots` vs `location` de la Storage Account en ARG, ej. `eastus2`, `westus2`, `brazilsouth`).
    - Si no hay costo atribuible, la cuenta debe mostrar `$0.00` hasta la siguiente sincronización de FinOps; no se inventan costos ni capacidades.
11. **Agregación de Tiers desde Cuentas (`tierMap`):** El mapa de desglose de Tiers (`tierMap`) para el gráfico de barras y los indicadores superiores se recalcula directamente a partir de la propiedad `tier` de las cuentas mapeadas (`acc.tier`: Hot, Cool, Cold, Archive). Esto garantiza que si la tabla de Storage Accounts muestra cuentas en tiers `Cool`, `Archive` o `Cold`, el gráfico de distribución los refleje inmediatamente sin quedarse atascado en 100% `Hot`.
12. **Pipeline de totales:** Los costos se calculan desde la facturación en BD. La capacidad, los tiers y los totales de capacidad se calculan solo desde `UsedCapacity` de Azure Monitor para las cuentas inventariadas por ARG. Una métrica no disponible no equivale a cero y debe indicarse como no disponible.
13. **Sin baselines en producción:** Cuando no hay telemetría o facturación, la interfaz debe mostrar el valor real `0 GB` si Monitor lo informó, o `No disponible` si no hay datapoint. Los datos sintéticos quedan limitados a tenants `mock-*`.
14. **Integración Demo Mock (`getMockDataForRoute`) y Formateo Sub-GB (MBs):**
    - **Demostración Multi-Tier (`/demo`):** Integrado `getMockDataForRoute('storage_efficiency', tenantId)` en `src/lib/mockData.ts` para que los ambientes de demostración (Essential, Professional, Business, Enterprise) reciban datos dinámicos escalados por tier con desgloses en Hot, Cool, Cold y Archive.
    - **Formateo Inteligente MB/GB/TB (`formatStorageSize`):** Para cuentas de almacenamiento con consumo menor a 1 GB (ej. 50 MB o 60 MB en `CSCloudSolutions`), la interfaz formatea automáticamente el tamaño en **MBs** (ej. `"61 MB"`, `"51 MB"`), y ajusta el formateo de moneda a 4 decimales para costos inferiores a $0.01 (ej. `"$0.0006"`), garantizando máxima legibilidad.
15. **Telemetría en Vivo desde Azure Monitor Metrics API (`UsedCapacity`):** Para eliminar cualquier número hardcodeado o estimado, la API consulta en paralelo a la REST API de Azure Monitor (`Microsoft.Insights/metrics` con la métrica `UsedCapacity`) utilizando las credenciales OAuth del tenant. De esta forma, los bytes exactos ocupados por cada *Storage Account* (ej. `65,018,852 Bytes` = `62.01 MB` y `52,172,298 Bytes` = `49.76 MB`) se obtienen 100% en tiempo real directamente desde la nube de Azure.


---

# 📄 subscriptions_fallback_SOP.md

> **Archivo fuente:** `directivas/subscriptions_fallback_SOP.md`

# Directiva: Manejo de Entornos Híbridos y Selector de Suscripciones

## Objetivo
Garantizar tolerancia a fallos en la capa de identidad (`keyvault.ts`) para entornos locales o despliegues ligeros, e implementar un componente dinámico de filtrado de suscripciones para el Dashboard FinOps.

## Lógica de Tolerancia a Fallos (Fallback)
- En `keyvault.ts`, si `KEYVAULT_NAME` no está configurado, o si `DefaultAzureCredential` lanza una excepción (típico en localhost), el código DEBE ser capaz de interceptar el error y retroceder a leer el secreto quemado en la variable `process.env.AZURE_CLIENT_SECRET`.

## Arquitectura de API de Suscripciones
- Se expone `/api/subscriptions` utilizando `SubscriptionClient` de `@azure/arm-subscriptions`.
- Esta ruta está protegida por la misma lógica Zero-Trust (Bearer Token) que la API de recomendaciones.

## Restricciones / Casos Borde (Aprendidos)

### 1. Catch seguro contra `error.message` undefined
- **Nota:** NUNCA hacer `error.message.includes(...)` directamente en un catch. Si el error no tiene propiedad `.message`, esto lanza un `TypeError` secundario que enmascara el error original.
- **Solución:** Siempre extraer primero: `const errorMessage = error?.message || String(error) || "Error desconocido";` y luego usar `errorMessage.includes(...)`.

### 2. Error AADSTS7000215 — Client Secret Inválido
- **Síntoma:** Todos los endpoints fallan con `AuthenticationRequiredError: invalid_client` + `AADSTS7000215`.
- **Causa:** El `AZURE_CLIENT_SECRET` en `.env.local` (o en producción) ha expirado o se copió el Secret ID en lugar del Secret Value.
- **Detección en código:** Los catch blocks deben buscar `AADSTS7000215`, `invalid_client` o `Invalid client secret` en el mensaje de error y devolver un código de error específico `INVALID_CLIENT_SECRET` con status 401.
- **Solución:** Ir a Azure Portal > App Registrations > app `876D8A5B-...` > Certificates & secrets > New client secret. Copiar el **Value** (no el ID) y actualizar `AZURE_CLIENT_SECRET` en el servidor.

### 3. Logging estructurado en endpoints
- Todo endpoint API debe loguear paso a paso (credencial, token, fetch) para facilitar diagnóstico en producción donde los stack traces están minificados.

### 4. Error AuthorizationFailed en Management Group Scope (Chargeback/Billing)
- **Nota:** No hacer consultas directas al scope `/providers/Microsoft.Management/managementGroups/${tenantId}` si no se está 100% seguro de que el Service Principal tiene rol Reader en el Management Group raíz. Causa el error `AuthorizationFailed` (403) ya que muchas veces las apps solo tienen acceso a nivel suscripción.
- **En su lugar, hacer Z:** Implementar una lógica de "fallback": capturar el error `403` o `AuthorizationFailed`, listar las suscripciones habilitadas iterándolas concurrentemente (con `Promise.all` y `catch(() => null)`) llamando al API de Cost Management por cada suscripción individualmente, y luego fusionar los resultados.


---

# 📄 tablas_finops_cmp_estandar_SOP.md

> **Archivo fuente:** `directivas/tablas_finops_cmp_estandar_SOP.md`

# SOP — Estándar de Tablas FinOps/CMP

## Objetivo

Definir un estándar único y vinculante para **todas** las tablas actuales y futuras de recursos/costos en el SaaS, evitando divergencias de UX y de contrato visual entre módulos.

## Alcance

Aplica a páginas/pestañas de inteligencia, operaciones y cockpits que muestren inventario/costos por recurso en cualquier dominio (Compute, Storage, Database, Monitoring, Network, Security, etc.).

================================================================================
### DIRECTIVA MAESTRA: TABLAS CON COLUMNAS AJUSTABLES Y PERSISTENTES (UX/CMP)
================================================================================
- AJUSTE DINÁMICO DE ANCHO (COLUMN RESIZING):
  • Las cabeceras de todas las tablas deben incluir manejadores de arrastre interactivos (resize handles con cursor `col-resize` en el borde derecho de cada `<th>`).
  • Soportar redimensionamiento manual por el usuario (mediante estados de TanStack Table / React resizable headers) con límites seguros (`minWidth: 100px`, `maxWidth: 600px`).

- SELECTOR DE VISIBILIDAD DE COLUMNAS (COLUMN TOGGLE):
  • Incluir un botón desplegable en la barra superior de cada tabla: `<IconColumns size={16} className="inline mr-1.5" /> Personalizar Columnas` (renderizado en `z-[100]`).
  • Menú con checkboxes interactivos para activar u ocultar columnas según la necesidad del operador.

- PERSISTENCIA EN NAVEGADOR (LOCAL STORAGE):
  • El ancho configurado y la visibilidad de las columnas deben guardarse automáticamente en `localStorage` bajo una clave única por tenant y vista (ej. `table_columns_config_zombies_${tenantId}`), asegurando que la personalización del cliente se mantenga al recargar o navegar entre módulos.

## Reglas obligatorias

1. Los filtros deben ubicarse **inmediatamente debajo** del título/subtítulo de la página o pestaña.
2. Filtros obligatorios:
   - Recurso
   - Región
   - Tipo
   - Grupo de recursos
3. Columnas obligatorias:
   - Recurso
   - Región
   - Tipo
   - Grupo de recursos
   - Suscripción (**nombre**, nunca ID como valor primario de UI)
4. Orden obligatorio:
   - A-Z
   - Z-A
   - costo mayor a menor
   - costo menor a mayor
5. Paginación obligatoria:
   - 15 / 30 / 45 / 60
6. UX obligatoria:
   - Tabla responsive
   - Ocupa ancho de ventana (`w-full` y sin contenedores `max-w-*` que limiten el board)
   - Columnas redimensionables por usuario con límites seguros (100px - 600px)
   - Selector de visibilidad de columnas en z-[100]
   - Persistencia automática de anchos y visibilidad en `localStorage`
7. Extensión permitida:
   - Cada tabla puede agregar columnas específicas del dominio, pero **no puede** omitir los filtros/columnas base.

## Implementación recomendada

- Reusar:
  - `src/components/dashboard/FinopsTableControls.tsx`
  - `src/components/Pagination.tsx`
  - `src/components/ResizableTh.tsx`
- Mantener paridad i18n (`messages/es.json`, `messages/en.json`, `messages/pt-BR.json`) para labels de filtros, orden y columnas.
- Resolver `subscriptionName` en backend (fallback a ID sólo cuando no exista nombre).

## Checklist de aceptación

- [ ] Filtros base visibles bajo el header.
- [ ] Columnas base presentes en la tabla.
- [ ] Sort A-Z/Z-A/costo asc/desc.
- [ ] Paginado 15/30/45/60.
- [ ] Tabla full-width + responsive.
- [ ] Columnas redimensionables (cursor `col-resize`, min 100px, max 600px).
- [ ] Selector de visibilidad de columnas (`IconColumns`, z-[100]).
- [ ] Persistencia de personalización en `localStorage` por tenant y vista.
- [ ] i18n completo en ES/EN/PT-BR.
- [ ] Mocks por tier cuando aplique tenant demo.


---

# 📄 tag_compliance_SOP.md

> **Archivo fuente:** `directivas/tag_compliance_SOP.md`

# SOP: Motor de Cumplimiento de Etiquetas (Tag Compliance Engine)

## Objetivo
Implementar un "Tag Compliance Engine" inspirado en las políticas de cardinalidad de Flexera para evaluar el cumplimiento de etiquetado en todos los recursos de Azure de un inquilino. Este motor identificará recursos completamente sin etiquetas y recursos con etiquetas obligatorias faltantes ('Environment' y 'CostCenter'), calculará una puntuación de cumplimiento dinámica (%) y permitirá a los usuarios visualizar los recursos infractores en la interfaz.

## Lógica y Pasos

### 1. Catálogo KQL (`src/modules/core/kqlCatalog.ts`)
- Registrar las siguientes consultas KQL:
  - `completelyUntaggedResources`: Busca todos los recursos (`Resources`) donde el atributo `tags` es nulo o el tamaño del diccionario de etiquetas es 0 (`dictionary_size(tags) == 0`).
  - `missingMandatoryTags`: Busca todos los recursos (`Resources`) donde faltan las etiquetas obligatorias 'Environment' o 'CostCenter'. Para hacer esto dinámico y flexible, usamos `isnull(tags['Environment']) or isnull(tags['CostCenter'])`.

### 2. API de Cumplimiento de Etiquetas (`src/app/api/tags/compliance/route.ts`)
- Obtener el `tenantId` y de forma opcional el `subscriptionId` desde los parámetros de búsqueda o cabeceras.
- Ejecutar las consultas KQL concurrentemente en Azure Resource Graph.
- Calcular un `complianceScore` (porcentaje de recursos en cumplimiento vs recursos infractores).
  - La cantidad total de recursos del inquilino se puede obtener mediante una consulta rápida de conteo (`Resources | summarize count()`).
  - `complianceScore = ((Total Resources - Violating Resources) / Total Resources) * 100`. Si no hay recursos, se define como 100%.
- Mapear la lista de recursos infractores (`violatingResources`) incluyendo detalles: `resourceId`, `name`, `type`, `resourceGroup`, `subscriptionId`, `location`, y el motivo del incumplimiento (ej. "Sin etiquetas" o "Falta Environment/CostCenter").
- Retornar `{ success: true, data: { complianceScore, violatingResources } }`.

### 3. UI de Cumplimiento (`src/app/[locale]/governance/tags/page.tsx`)
- Consumir el nuevo endpoint `/api/tags/compliance`.
- Mostrar el `complianceScore` utilizando un indicador de progreso circular responsivo.
- Renderizar una tabla con los recursos que violan la política, detallando Nombre, Tipo, Suscripción, Grupo de Recursos y el Motivo de infracción.

## Restricciones y Trampas Conocidas
- **Evitar datos mock o hardcodeados:** No inyectar listas estáticas de recursos infractores. Si no hay recursos en el tenant, la tabla debe mostrarse vacía y el cumplimiento en 100%.
- **Configuración de Etiquetas Obligatorias:** Definir las etiquetas obligatorias como constantes configurables en el backend (`['Environment', 'CostCenter']`) para que puedan expandirse en el futuro.


---

# 📄 tenant_management_SOP.md

> **Archivo fuente:** `directivas/tenant_management_SOP.md`

# Tenant Management SOP\n\n- **Nomenclatura Legible**: Dado que Azure AD no siempre provee el dominio correcto mediante tokens de invitado, los SuperAdmins ahora renuevan explícitamente el nombre del tenant desde el módulo `/admin/onboarding`.\n- **API REST**: `PUT /api/tenants` actualiza `company_name` en la BD MySQL.\n

---

# 📄 ttl_enforcement_SOP.md

> **Archivo fuente:** `directivas/ttl_enforcement_SOP.md`

# TTL Enforcement SOP\n\n- **Fechas de Expiración**: La etiqueta `ExpireOn` o `TTL` se parsea a JS Date y se compara estrictamente (`< new Date()`). Entornos sin etiqueta válida son omitidos.\n- **UI de Expiraciones**: Emplea estados de vacío atractivos usando Tailwind y lucide-react para maximizar la legibilidad en tableros limpios.\n- **Remediación**: Llama al endpoint de remediación de zombis (`/api/remediation`) pasándole los parámetros para destruir la infraestructura subyacente.\n- **Manejo de Errores de API**: Las excepciones de lectura de suscripciones devueltas por Azure con `correlationId` se remapean en UI hacia advertencias amistosas de RBAC para guiar al usuario a arreglar sus roles.\n

---

# 📄 ui_auth_refinements_SOP.md

> **Archivo fuente:** `directivas/ui_auth_refinements_SOP.md`

# Directiva: Refinamientos de Branding y Login UX

## Objetivo
Unificar la experiencia visual y el flujo de autenticación de acuerdo a la identidad de CSCloudSolutions.
- Reemplazar Popups por `loginRedirect()`.
- Unificar el login y el onboarding en un único botón azul corporativo.
- Insertar logotipo e identificador visual para el Tenant Administrativo.

## Lógica y Pasos
1. Modificar `AuthProvider.tsx` para utilizar `pca.addEventCallback()` con `EventType.LOGIN_SUCCESS`. Este listener detectará cuando el usuario retorne de Microsoft, extraerá el AccessToken de forma silenciosa y disparará el `POST /api/onboard`.
2. Actualizar la UI de `<AuthButton />` en el mismo archivo para que utilice los colores azules de la marca y tenga el texto "Iniciar sesión con Microsoft".
3. Modificar `ClientShell.tsx`:
   - Eliminar los botones de mock y reemplazarlos por `<AuthButton />`.
   - Integrar `useIsAuthenticated` de `@azure/msal-react` para renderizado condicional. Si es verdadero, desplegar el nombre y el botón 'Cerrar Sesión' atado a `logoutRedirect()`.
   - Modificar el menú desplegable del Tenant añadiendo el texto "Admin CS".
   - Insertar la imagen `/logo.png` en el encabezado de la barra lateral.
4. Modificar `layout.tsx` para cambiar el `<title>` global a `CSCloudSolutions FinOps`.

## Trampas Conocidas / Restricciones
- **Componentes de Cliente en Next.js**: El archivo `ClientShell.tsx` contiene hooks interactivos como `useState` para colapsar la barra lateral. Si se sobrescribe el archivo en una actualización de diseño, es **CRÍTICO** añadir la directiva `"use client";` en la línea 1; de lo contrario, Next.js arrojará error de compilación al intentar renderizarlo como Server Component.
- Al utilizar `loginRedirect()`, el contexto de React se reinicia (se pierde el estado de la memoria local debido a la navegación completa del navegador). Es por ello que la llamada a la API (`fetch /api/onboard`) debe hacerse obligatoriamente interceptando el Evento Global de MSAL en un `useEffect` durante el ciclo de inicialización en el Provider.


---

# 📄 ui_components_SOP.md

> **Archivo fuente:** `directivas/ui_components_SOP.md`

# Directiva: Generación de Componentes UI para Azure FinOps

## Objetivo
Crear una suite de componentes React modulares, escalables y orientados al rendimiento (Next.js + Tailwind CSS) que correspondan a los requerimientos visuales y de UX de la propuesta de Azure FinOps. 

## Entradas
- Datos crudos desde los endpoints `/api/consumption` y `/api/recommendations` de Azure.

## Salidas
- `src/components/layout/FinOpsDashboardLayout.tsx` (App shell con Grid).
- `src/components/dashboard/QuickWinsTable.tsx` (Tabla optimizada con `content-visibility`).
- `src/components/dashboard/ExecutiveSummaryCard.tsx` (Métricas con Container Queries).
- `src/components/remediation/ApprovalWorkflowBoard.tsx` (Flujo de aprobación).

## Lógica y Pasos
1. Todo componente UI se genera a través del script de Python `generate_ui_components.py` para asegurar determinismo.
2. Utilizar Raw Tailwind CSS. No importar dependencias externas como shadcn a menos que se agreguen al `package.json` explícitamente en el futuro.
3. Se deben aplicar las mejores prácticas modernas de CSS:
   - `grid-template-areas` para el shell principal.
   - `content-visibility: auto` para listas masivas en la tabla de quick wins.
   - `@container` y `cqi` (Container Queries) para las tarjetas ejecutivas.

## Trampas Conocidas / Restricciones
- El SDK de Next.js App Router usa Server Components por defecto; asegurarse de tipar las props explícitamente. Se puede agregar `"use client"` más adelante cuando se conecten Hooks, pero por ahora se definen los layouts puros.
- Los Container Queries requieren el uso explícito de `container-type` en un contenedor padre.


---

# 📄 video_demostracion_SOP.md

> **Archivo fuente:** `directivas/video_demostracion_SOP.md`

# Directiva: Video Demostrativo Corporativo FinOps (CSCloudSolutions)

## Descripción del Objetivo
Generar un video corporativo y material audiovisual de alta fidelidad que muestre las capturas de pantalla reales de la plataforma **CSCloudSolutions FinOps Command Center** inyectadas en formato **Base64 Data URL** para garantizar su renderizado 100% confiable, con la imagen del logo oficial al inicio y final del video, y una pista de música electrónica corporativa interactiva en sustitución de la locución hablada.

## Entradas
1. Capturas de pantalla reales en `public/video-assets/desktop_shots/shot_01.png` .. `shot_16.png` convertidas a base64.
2. Logo oficial de la marca: `public/Logo_CSCloudSolutions.png` / `public/logo.png` convertido a base64.
3. Denominación oficial única: **CSCloudSolutions** (sin espacios).
4. Pista de música interactiva en `.tmp/bg_music.wav` / `.mp3`.

## Salidas
- `public/video-assets/finops_demo_video.mp4`: Video HD 1080p con logo oficial de apertura/cierre, capturas reales incrustadas en Base64, transiciones de pantalla y pista de música corporativa.
- `public/video-assets/finops_demo_preview.gif`: GIF animado de vista previa.
- `public/video-assets/index.html`: Showcase HTML5 con reproductor de video y galería de capturas.

## Lógica y Pasos a Seguir
1. **Base64 Inlining de Capturas y Logo:**
   - Leer cada imagen PNG desde Node.js (`fs.readFileSync(...)`) y convertir a `data:image/png;base64,...`.
   - Inyectar el string base64 directamente en las etiquetas `<img>` del HTML renderizado por Playwright. Esto elimina cualquier bloqueo de políticas CORS o `file://` en Chromium.
2. **Escenas de Apertura y Cierre:**
   - Intro (Escena 0): Renderizar `Logo_CSCloudSolutions.png` (Base64) centrado con animación glow y título **CSCloudSolutions FinOps Command Center**.
   - Escenas Intermedias (Escenas 1 a 6): Renderizar las capturas reales base64 en un marco de navegador HD con URL `https://finops.cscloudsolutions.com.ar`.
   - Outro (Escena Final): Renderizar `Logo_CSCloudSolutions.png` (Base64) con llamada a la acción `finops.cscloudsolutions.com.ar`.
3. **Mezcla Audiovisual con Música:**
   - Eliminar voz hablada.
   - Sincronizar la pista de audio musical `.tmp/bg_music.wav` con la secuencia de frames mediante `ffmpeg`.

## Trampas Conocidas / Restricciones
- NUNCA usar `file://` en el `src` de las imágenes dentro de `page.setContent()`; SIEMPRE usar Base64 Data URLs (`data:image/png;base64,...`).
- Mantener la marca **CSCloudSolutions** unida sin espacios en toda la composición.


---

# 📄 view_mode_SOP.md

> **Archivo fuente:** `directivas/view_mode_SOP.md`

# View Mode SOP\n\n- **Context API**: El estado `viewMode` se almacena globalmente en `ViewModeContext.tsx` y es consumido por los componentes descendientes.\n- **Segregación de UI**: Las columnas técnicas (Suscripción, Resource ID, ARM Type) se renderizan condicionalmente mediante `{viewMode === 'engineer' && <.../>}` para evitar abrumar a perfiles financieros (Executive).\n

---

# 📄 virtual_machines_finops_cmp_SOP.md

> **Archivo fuente:** `directivas/virtual_machines_finops_cmp_SOP.md`

# SOP: Cockpit FinOps y Optimización de Cómputo en Azure Virtual Machines

## Objetivo
Procedimiento operativo determinista para auditar, redimensionar, optimizar y controlar los costos de **Azure Virtual Machines (`Microsoft.Compute/virtualMachines`)**, identificando fugas de almacenamiento persistente en VMs apagadas (`PowerState/deallocated`), optimizando licenciamiento híbrido (AHUB), mitigando sobredimensionamiento de cómputo hacia Serie B Burstable y aplicando calendarios de apagado automático.

---

## 1. Arquitectura de Costos y Vectores de Gasto en Azure VMs

El costo total de una máquina virtual en Azure se compone de:
1. **Costo de Cómputo (Compute Running Cost)**:
   - Facturado por segundo únicamente cuando la máquina está en estado `PowerState/running`.
   - Si la máquina se desasigna (`PowerState/deallocated`), el costo de cómputo se reduce a **$0.00 USD/hora**.
2. **Costo de Almacenamiento Persistente (Storage Managed Disks)**:
   - **Disco OS (Sistema)**: Discos Premium SSD (`Premium_LRS`), Standard SSD (`StandardSSD_LRS`) o Standard HDD (`Standard_LRS`).
   - **Discos de Datos Adicionales (Data Disks)**.
   - ⚠️ **La Mayor Fuga Oculta FinOps**: En estado `PowerState/deallocated`, los discos administrados **siguen facturándose al 100% de la tarifa mensual**. Una VM apagada con disco Premium SSD de 128 GiB y Data Disk de 256 GiB sigue costando ~$32.80 USD/mes de almacenamiento estático.
3. **Licenciamiento de Sistema Operativo (OS Licensing & AHUB)**:
   - En Windows Server, el licenciamiento Pay-As-You-Go añade un recargo de ~40% sobre el costo de cómputo.
   - Con **Azure Hybrid Benefit (AHUB)** (`licenseType: 'Windows_Server'`), los clientes con Software Assurance ahorran ese 40%.
4. **Networking e IP Pública (Public IP Cost)**:
   - Las direcciones IP públicas estáticas o dinámicas asociadas a la NIC de la VM generan costo fijo mensual incluso con la VM apagada.

---

## 2. Reglas de Remediación Resolutivas

### 1. Rightsizing Inteligente hacia Serie B (Burstable) o Menor SKU
- **Gatillo**: VM en familias de propósito general o memoria (D, E o F) con CPU promedio sostenido $< 10\%$ y RAM en uso $< 30\%$ durante 14 a 30 días.
- **Acción**: Migrar a `Standard_B2s` (2 vCPU / 4 GB) o `Standard_D2s_v5`.
- **Ahorro Estimado**: ~70% a 76% en costo de cómputo (~$24.80 a $145.00 USD/mes).
- **Comando Azure CLI**:
  ```bash
  az vm resize --resource-group <resourceGroup> --name <vmName> --size Standard_B2s
  ```

### 2. Mitigación de Fuga de Disco en VM Desasignada (Deallocated Waste)
- **Gatillo**: VM en estado `PowerState/deallocated` con disco OS configurado en `Premium_LRS`.
- **Acción**: Degradar storage tier a Standard HDD (`Standard_LRS`) mientras permanezca apagada.
- **Ahorro Estimado**: ~$14.00 a $18.00 USD/mes por disco de 128 GiB.
- **Comando Azure CLI**:
  ```bash
  OS_DISK=$(az vm show -g <resourceGroup> -n <vmName> --query "storageProfile.osDisk.managedDisk.id" -o tsv)
  az disk update --ids $OS_DISK --sku Standard_LRS
  ```

### 3. Programación de Apagado (Dev/Test Schedule 8x5)
- **Gatillo**: VMs en suscripciones o grupos de recursos de desarrollo/pruebas (`dev`, `test`, `qa`, `staging`) con uptime del 100% (24/7).
- **Acción**: Configurar auto-shutdown diario a las 19:00 horas y encendido automático 08:00 L-V.
- **Ahorro Estimado**: 65% del costo mensual de cómputo.
- **Comando Azure CLI**:
  ```bash
  az vm auto-shutdown --resource-group <resourceGroup> --name <vmName> --time 1900 --email-alert false
  ```

### 4. Activación de Azure Hybrid Benefit (AHUB Windows Server)
- **Gatillo**: VM con Windows Server pagando tarifa completa en Pay-As-You-Go (`licenseType: 'None'`).
- **Acción**: Aplicar licencia propia on-premises con Software Assurance (`licenseType: 'Windows_Server'`).
- **Ahorro Estimado**: 40% del costo de cómputo.
- **Comando Azure CLI**:
  ```bash
  az vm update --resource-group <resourceGroup> --name <vmName> --set licenseType=Windows_Server
  ```

### 5. Descarte / Snapshot de VM Abandonada
- **Gatillo**: VM desasignada hace más de 60 días sin actividad de red ni cambios de estado.
- **Acción**: Crear snapshot administrado del disco OS para archivo histórico y eliminar la VM junto a sus recursos asociados.
- **Ahorro Estimado**: 100% del costo mensual de discos e IP pública.
- **Comando Azure CLI**:
  ```bash
  az snapshot create --resource-group <resourceGroup> --name snap-<vmName> --source $(az vm show -g <resourceGroup> -n <vmName> --query "storageProfile.osDisk.managedDisk.id" -o tsv)
  az vm delete --resource-group <resourceGroup> --name <vmName> --yes
  ```

---

## ⚠️ Restricciones y Trampas Conocidas (Gotchas)

### ❌ Reinicio Obligatorio al Cambiar de Tamaño (Resize Downtime)
- Cambiar el SKU de una máquina virtual requiere reiniciar la instancia. Si el nuevo tamaño está en un clúster físico de hardware diferente, Azure moverá la VM y causará un reinicio de ~1 a 3 minutos. Siempre coordinar ventanas de mantenimiento para entornos productivos.

### ❌ Créditos de CPU en Serie B (Burstable Performance)
- Las instancias Serie B no garantizan CPU constante al 100%. Si una aplicación satura la CPU por periodos prolongados, agotará los créditos y el rendimiento se limitará al valor base (ej. 20% en B2s). No usar Serie B para bases de datos de alta concurrencia o procesos batch pesados.

### ❌ Discos Premium Degradados a Standard HDD
- Degradar un disco de `Premium_LRS` a `Standard_LRS` reduce los IOPS de 3,500 a 500 ops/s. Antes de volver a encender la VM para producción, se debe restaurar el tier a `Premium_LRS` o `StandardSSD_LRS`.


---

# 📄 vm_restart_and_rbac_SOP.md

> **Archivo fuente:** `directivas/vm_restart_and_rbac_SOP.md`

# VM Restart y Least Privilege RBAC SOP\n\n## Objetivo\nIntegrar la función de reinicio de VMs y ajustar el RBAC para seguir el principio de Least Privilege.\n\n## Restricciones/Casos Borde\n- Usar `beginRestartAndWait` del cliente arm-compute.\n- Payload del script de RBAC debe incluir los 7 permisos estrictamente necesarios, ni uno más.\n

---

# 📄 vmss_osdisk_tier_optimization_SOP.md

> **Archivo fuente:** `directivas/vmss_osdisk_tier_optimization_SOP.md`

# SOP: Optimización de Tier de Disco OS en Virtual Machine Scale Sets (VMSS)

## Objetivo
Guía operativa determinista para la degradación y optimización de costos de discos de Sistema Operativo (OS Disk) en conjuntos de escalado de máquinas virtuales (VMSS) de Azure sin interrumpir la operación y evitando errores de inmutabilidad de Azure Resource Manager (ARM).

---

## ⚠️ Restricciones y Trampas Conocidas (Gotchas)

### ❌ Error Detectado: `PropertyChangeNotAllowed`
```
(PropertyChangeNotAllowed) Changing property 'osDisk.managedDisk.storageAccountType' is not allowed.
Code: PropertyChangeNotAllowed
Message: Changing property 'osDisk.managedDisk.storageAccountType' is not allowed.
Target: osDisk.managedDisk.storageAccountType
```

### 🧠 Causa Raíz
En Azure Resource Manager, la propiedad `virtualMachineProfile.storageProfile.osDisk.managedDisk.storageAccountType` del modelo base de un VMSS existente es **inmutable** vía `az vmss update --set`. Azure prohíbe la modificación directa del tipo de cuenta de almacenamiento del disco OS en el scale set en caliente.

### ✅ Protocolo Correcto de Remediación

#### Caso 1: Actualización de Discos de Instancias Existentes (Vía `az disk update`)
Para optimizar el costo de los discos existentes sin recrear el VMSS:
1. **Desasignar (Deallocate) las instancias del VMSS** para liberar el bloqueo de lectura/escritura del storage engine:
   ```bash
   az vmss deallocate --resource-group <resourceGroup> --name <vmssName>
   ```
2. **Actualizar el SKU de los discos administrados de cada instancia**:
   ```bash
   # Obtener los IDs o nombres de discos OS asociados a las instancias del VMSS y actualizar el SKU:
   for disk in $(az disk list --resource-group <resourceGroup> --query "[?contains(managedBy, '<vmssName>')].name" -o tsv); do
     az disk update --resource-group <resourceGroup> --name $disk --sku StandardSSD_LRS
   done
   ```
3. **Iniciar el VMSS nuevamente**:
   ```bash
   az vmss start --resource-group <resourceGroup> --name <vmssName>
   ```

#### Caso 2: Infraestructura como Código (Terraform / OpenTofu)
En Terraform, actualizar el bloque `os_disk` en el recurso `azurerm_orchestrated_virtual_machine_scale_set` o `azurerm_linux_virtual_machine_scale_set`:
```hcl
os_disk {
  caching              = "ReadWrite"
  storage_account_type = "StandardSSD_LRS"
}
```
Terraform gestionará la actualización según la directiva `rolling_upgrade_policy` o el reemplazo controlado de instancias.

---

## Checklist de Verificación
- [ ] Validar que las IOPS requeridas por la carga sean $< 500$ IOPS sostenidas antes de degradar a `StandardSSD_LRS`.
- [ ] Ejecutar `az vmss deallocate` previo a `az disk update`.
- [ ] Confirmar que el SKU de todos los discos administrados figure como `StandardSSD_LRS`.
- [ ] Iniciar el Scale Set y verificar métricas de latencia de disco en Azure Monitor.


---

# 📄 vmss_spot_conversion_SOP.md

> **Archivo fuente:** `directivas/vmss_spot_conversion_SOP.md`

# SOP: Conversión de Instancias a Spot en Virtual Machine Scale Sets (VMSS)

## Objetivo
Procedimiento operativo y consideraciones de arquitectura para la conversión o despliegue de conjuntos de escalado de máquinas virtuales (VMSS) en Azure Spot para cargas tolerantes a fallos (Dev, Test, QA, Staging, Batch Processing), evitando errores de sintaxis y restricciones de Azure ARM.

---

## ⚠️ Restricciones y Trampas Conocidas (Gotchas)

### ❌ Error Detectado 1: `Couldn't find 'billingProfile'`
```
Couldn't find 'billingProfile' in 'virtualMachineProfile'. Available options: ['diagnosticsProfile', 'evictionPolicy', 'extensionProfile', 'networkProfile', 'osProfile', 'priority', 'securityProfile', 'storageProfile', 'timeCreated']
```

### 🧠 Causa Raíz
Cuando un VMSS se crea con prioridad regular (`Regular`), el objeto `billingProfile` está inicializado como `null` en la plantilla JSON de Azure. La sintaxis `--set virtualMachineProfile.billingProfile.maxPrice=-1` de Azure CLI intenta acceder a una clave anidada inexistente.

### ❌ Error Detectado 2: `PropertyChangeNotAllowed` en Prioridad Spot
En ciertos modos de orquestación (Uniform y algunos perfiles Flexible), Azure ARM marca la propiedad `priority` como inmutable después de la creación del scale set.

---

## ✅ Protocolo de Remediación y Solución

### Opción A: Actualización vía Azure CLI con Dict JSON Completo
Si el modo de orquestación admite actualización en caliente:
```bash
az vmss update \
  --resource-group <resourceGroup> \
  --name <vmssName> \
  --set virtualMachineProfile.priority=Spot \
        virtualMachineProfile.evictionPolicy=Deallocate \
        virtualMachineProfile.billingProfile='{"maxPrice":-1}'
```

### Opción B: Despliegue de Nuevo Pool Spot & Drenado de Tráfico (Recomendado)
En entornos de producción, staging o clústeres donde la prioridad es inmutable:
1. Desplegar un nuevo Scale Set o pool Spot con capacidad inicial:
   ```bash
   az vmss create \
     --resource-group <resourceGroup> \
     --name <vmssName>-spot \
     --image <imageUrn> \
     --vm-sku <sku> \
     --priority Spot \
     --eviction-policy Deallocate \
     --max-price -1 \
     --instance-count <count>
   ```
2. Asociar el nuevo VMSS al Application Gateway / Load Balancer.
3. Reducir instancias del pool anterior a 0 y eliminarlo una vez estabilizado el tráfico.

---

## Checklist de Verificación
- [ ] Confirmar que la carga de trabajo sea tolerante a interrupciones (desalojo con notificación de 30 segundos vía Azure Scheduled Events).
- [ ] Establecer la política de desalojo en `Deallocate` (no `Delete`) para retener discos y configuraciones.
- [ ] Fijar `maxPrice=-1` para garantizar que el scale set solo se desaloje si la capacidad física de Azure se satura, sin límite de precio de corte.


---

# 📄 webhook_url_schema_SOP.md

> **Archivo fuente:** `directivas/webhook_url_schema_SOP.md`

# SOP - Ampliar longitud de webhook_url en Tenants

## Objetivo
Ampliar la columna `webhook_url` de la tabla `Tenants` a `VARCHAR(1024)` para permitir URLs de webhook largas (como las de Microsoft Teams y Power Automate) sin provocar errores 500 en las solicitudes de guardado.

## Procedimiento

1. **Modificación del Schema Inicial**:
   - En `src/modules/storage/db.ts`, buscar el `CREATE TABLE IF NOT EXISTS Tenants`.
   - Modificar la definición de `webhook_url VARCHAR(255)` a `webhook_url VARCHAR(1024)`.

2. **Migración Segura**:
   - Para bases de datos que ya existen y tienen la columna en `VARCHAR(255)`, ejecutar un comando `ALTER TABLE Tenants MODIFY COLUMN webhook_url VARCHAR(1024);` dentro del proceso de inicialización (`initializeDatabase`).
   - Capturar cualquier excepción potencial para evitar que detenga la aplicación si la columna ya está modificada o si la tabla no existe.

3. **Prueba y Validación**:
   - Confirmar que la aplicación inicializa la base de datos sin errores.
   - Probar que las URLs largas de webhook se guardan correctamente.


---

# 📄 workbooks_and_i18n_SOP.md

> **Archivo fuente:** `directivas/workbooks_and_i18n_SOP.md`

# Workbooks UI y Traducciones SOP\n\n## Objetivo\n1. Habilitar la traducción dinámica de la Navigation con `useTranslations`.\n2. Mejorar Workbooks UI con selectores de suscripciones y grupos de recursos dinámicos, permitiendo crear RGs.\n\n## Restricciones/Casos Borde\n- **Nota: Al obtener resource groups**, si la cuenta carece de permisos de lectura a nivel suscripción, el endpoint de Azure regresará 403. Esto debe atraparse y retornar un array vacío en lugar de crashear.\n

---

# 📄 zombie_detection_SOP.md

> **Archivo fuente:** `directivas/zombie_detection_SOP.md`

# SOP: Expansión del Motor de Detección de Recursos Zombis (Flexera Policies)

## Objetivo
Implementar tres políticas de detección de recursos huérfanos/zombis basadas en reglas empresariales de Flexera:
1. `oldSnapshots`: Snapshots antiguos de Azure (> 30 días).
2. `unusedLoadBalancers`: Load Balancers sin configuraciones de IP frontend o sin pools de backend configurados.
3. `unusedVNetGateways`: Virtual Network Gateways sin conexiones activas (conexiones vacías o nulas).

Esto requiere registrar las consultas en `kqlCatalog.ts`, ejecutarlas en el servicio de auditoría de Resource Graph y retornarlas de forma estandarizada en la respuesta de la API/Servicio correspondiente en el formato `{ resourceId, name, resourceType, monthlyCost }` para que la UI (`ZombieResourcesTable`) las renderice automáticamente sin romperse.

## Lógica y Pasos

### 1. Actualización de Catálogo de KQL (`src/modules/core/kqlCatalog.ts`)
- Asegurar o añadir las siguientes consultas:
  - `oldSnapshots`: Buscar snapshots de tipo `microsoft.compute/snapshots` con `properties.timeCreated < ago(30d)`.
  - `unusedLoadBalancers`: Buscar load balancers de tipo `microsoft.network/loadbalancers` con `properties.frontendIPConfigurations` vacío o nulo, o `properties.backendAddressPools` vacío o nulo.
  - `unusedVNetGateways`: Buscar virtual network gateways de tipo `microsoft.network/virtualnetworkgateways` que no tengan conexiones en `microsoft.network/connections`.

### 2. Actualización del Servicio de Auditoría / API de Zombis (`src/app/api/audit/full/route.ts` o servicio correspondiente)
- Ejecutar las consultas KQL correspondientes de manera eficiente.
- Mapear las 3 nuevas colecciones (`oldSnapshots`, `unusedLoadBalancers`, `unusedVNetGateways`) retornadas en el objeto de resultados de auditoría.
- Asegurar que los datos retornados cumplan con la interfaz esperada en el frontend (`{ resourceId, name, resourceType, monthlyCost }` o el formato que `ZombieResourcesTable` requiera).
- En particular, mapear:
  - `id` -> `resourceId` o `id` (dependiendo de la normalización).
  - `name` -> `name` o `resourceName`.
  - `type` -> `resourceType` o `type`.
  - Estimar e incluir el costo mensual (`monthlyCost` o `potentialSavings`).

### 3. Integración en la Interfaz (`ZombieResourcesTable.tsx`)
- Configurar el mapeo de estas tres nuevas claves en el objeto `resourceConfig` de la tabla si no están presentes, garantizando que tengan definidos los textos correspondientes para `issue`, `type`, `armType`, `savings`, e `issueType`.

## Restricciones y Trampas Conocidas
- **Evitar Nombres Duplicados o Colisiones:** Verificar si ya existen claves con nombres similares en `kqlCatalog` (como `staleSnapshots`, `loadBalancers`, o `vnetGateways`) y diferenciar las reglas si es necesario.
- **Formato del Payload:** Validar los campos de la interfaz para evitar desajustes que causen fallas de renderizado en React o TypeScript.
- **Idempotencia y Robustez:** Manejar casos donde las propiedades de Azure sean nulas o no estén definidas usando operadores de coalescencia o filtros defensivos en las consultas KQL.


---

# 📄 azure_integration_services_ipaas_SOP.md

> **Archivo fuente:** `directivas/azure_integration_services_ipaas_SOP.md`

# SOP: Azure Integration Services (iPaaS) FinOps & Directivas Maestras

## 1. Propósito y Alcance
Establecer las directivas maestras y procedimientos estándar obligatorios para la arquitectura, seguridad, reconciliación de costos, rendimiento y diseño UI/UX del módulo **Azure Integration Services (iPaaS)** (Logic Apps, API Management, Service Bus, Event Grid, Event Hubs y Azure Data Factory) en la plataforma FinOps de CSCloudSolutions.

---

## 2. Directivas Maestras Obligatorias

### 1. POLÍTICA DE ACCESO, AUTENTICACIÓN Y ENRUTAMIENTO DE TENANTS (PREVENCIÓN ERROR 401)
- El backend DEBE implementar una validación de RBAC estricta mediante `requireTenantAccess(req, tenantId)` y tokens OAuth válidos antes de cualquier consulta a las APIs de Azure.
- **Tenant Demo** (`isMockTenant(tenantId) === true || searchParams.get('mock') === 'true' || tenantId.startsWith('demo-') || tenantId.startsWith('mock-')`):
  - Servir datos sintéticos/demo de inmediato sin requerir autenticación OAuth ni tokens de Entra ID.
  - Navegación fluida sin bloqueos 401/403.
  - **ORDEN CRÍTICO:** El check `isMockTenant` DEBE evaluarse ANTES de `requireTenantAccess`. Nunca al revés.
- **Tenant Real / Conectado** (`isMockTenant(tenantId) === false`):
  - Validación obligatoria de RBAC mediante `requireTenantAccess(req, tenantId)` y tokens OAuth válidos.
  - **TOLERANCIA CERO A FALLBACKS MOCK:** Si una consulta a Azure devuelve datos vacíos (`[]` o `$0.00`), la UI DEBE renderizar el estado real (`$0.00` / Empty State legítimo). PROHIBIDO inyectar mocks como rescate visual de datos vacíos en un tenant real.
  - Consumir exclusivamente endpoints vivos (Azure Resource Graph, Cost Management API / Dataset FOCUS, Azure Monitor API).
- **Prevención de Carrera de Hidratación MSAL (Error 401 a los 11ms):**
  - El frontend DEBE condicionar la ejecución del fetcher (`canFetch`) a que `inProgress === 'none'` y `(accounts.length > 0 || isDemo)`.
  - Nunca despachar llamadas anónimas a endpoints protegidos en tenants reales.

### 2. LECTURA CORRECTA DE MÉTRICAS DE COSTOS (MTD, ANTERIOR, FORECAST)
- El servicio backend DEBE consultar la API de Cost Management (FOCUS dataset o Amortized Cost) mapeando las métricas exactas: `PreTaxCost` para MTD, gasto acumulado de los mismos días del mes anterior, y cálculo de `ML Forecast` para el cierre de mes, desglosado por recurso individual para evitar que todos los registros muestren `$0.00` de forma errónea.

### 3. DIRECTIVA DE ANCHO MÁXIMO DE VENTANA (FULL-WIDTH 100%)
- El layout principal, contenedores de KPIs, gráficas, paneles de conectores y tablas DEBEN ocupar el **ANCHO MÁXIMO POSIBLE DE LA VENTANA** (`w-full max-w-full px-4 sm:px-6 lg:px-8`).
- PROHIBIDO aplicar restricciones rígidas de ancho como `max-w-5xl`, `max-w-6xl` o `max-w-7xl`. El dashboard debe estirarse y aprovechar todo el monitor del usuario de borde a borde.

### 4. POLÍTICA DE ICONOGRAFÍA CORPORATIVA (TABLER)
- Librería exclusiva: `@tabler/icons-react` (Tabler Icons).
- Color del icono: Azul empresarial corporativo (Tailwind: `text-[#0078D4]` o `text-blue-600`).
- Estilo: Iconos de trazo limpio (`stroke={1.5}` o `stroke={2}`).
- Fondo: **ESTRICTAMENTE SIN FONDO** (`bg-transparent` / sin badges circulares ni contenedores cuadrados de color de fondo).

### 5. GESTIÓN DE CAPAS (Z-INDEX Y POPOVERS)
- Modales (drawer de simulación de migración Consumption vs Standard, auditoría de APIM, configurador de ADF), popovers, tooltips y dropdowns DEBEN renderizarse SIEMPRE por delante: backdrop `fixed inset-0 bg-black/50 z-50` y contenedor en `z-50` o `z-[100]`.
- Widgets flotantes (como el chat) deben permanecer en `z-40` o inferior, quedando siempre por detrás de cualquier modal abierto.

### 6. DISEÑO DE INTERFAZ Y PALETA EN TONOS DE AZUL
- Contenedores y KPI Cards: Fondos neutros limpios (`bg-white` o `bg-slate-50/50`) con bordes sutiles (`border border-slate-200`). ELIMINAR fondos verdes o amarillos planos.
- Gráficas y barras de desglose (Recharts): Utilizar escala armónica en **TONOS DE AZUL**:
  - Ejecuciones / Cómputo Base: Azul corporativo profundo (`#0078D4` / `bg-blue-600`).
  - Conectores Estándar: Azul cobalto (`#2563EB` / `bg-blue-500`).
  - Conectores Enterprise: Azul cian intermedio (`#0284C7` / `bg-sky-600`).
  - Runs Exitosos: Azul cielo suave (`#38BDF8` / `bg-sky-400`).
  - Runs Fallidos / Alertas: Slate neutro (`#94A3B8` o `#64748B`).

### 7. PRESERVACIÓN ESTRICTA DE LÓGICA Y LAS 6 SUB-PESTAÑAS iPAAS
- Mantener intactas las 6 sub-pestañas:
  1. `[Azure Logic Apps]`
  2. `[Azure API Management (APIM)]`
  3. `[Azure Service Bus]`
  4. `[Azure Event Grid]`
  5. `[Azure Event Hubs]`
  6. `[Azure Data Factory (ADF)]`
- Botones de acción corporativos: Fondo blanco puro (`bg-white dark:bg-slate-900`) con borde y texto coincidente según el estándar de la plataforma.

---

## 3. Checklist de Validación
- [ ] ¿`isMockTenant` se evalúa antes que `requireTenantAccess` en backend?
- [ ] ¿El frontend espera `inProgress === 'none'` antes de disparar peticiones autenticadas?
- [ ] ¿El layout y las tablas usan `w-full max-w-full px-4 sm:px-6 lg:px-8` sin limitadores `max-w-*`?
- [ ] ¿Todos los iconos son Tabler en color azul empresarial (`#0078D4`) y `bg-transparent`?
- [ ] ¿Los modales y draweres usan `z-50` sobre backdrops `fixed inset-0 bg-black/50 z-50`?
- [ ] ¿Las 6 sub-pestañas iPaaS están activas y operativas?

---

# 📄 optimizacion_memoria_compilacion_SOP.md

> **Archivo fuente:** `directivas/optimizacion_memoria_compilacion_SOP.md`

# SOP: Optimización de Consumo de Memoria RAM en Compilación y Desarrollo Next.js / Node.js

## Contexto y Diagnóstico
En entornos macOS (especialmente con procesadores Apple Silicon y memoria unificada de 16GB, 32GB, 64GB o 128GB), el motor V8 de Node.js no establece un techo bajo de memoria por defecto, infiriendo que puede utilizar la mayor parte de la RAM física libre antes de disparar el *Garbage Collector* (GC).

Esto produce escenarios donde la terminal o el servidor de desarrollo (`npm run dev` o `npm run build`) escala hasta 20-25+ GB de RAM consumida, causando degradación o lentitud en el sistema operativo.

A esto se suma el costo computacional de paquetes de frontend y SDKs masivos con miles de exportaciones individuales (`@tabler/icons-react`, `lucide-react`, `@azure/arm-*`), los cuales inflan el AST (*Abstract Syntax Tree*) y la caché de módulos en RAM si no se cargan bajo demanda.

---

## Directiva de Mitigación y Buenas Prácticas

### 1. Límite de Heap V8 en Scripts (`package.json`)
Todos los comandos de ejecución, desarrollo y build en `package.json` deben incluir explícitamente el flag `--max-old-space-size=4096` (o `2048` para runtime liviano) para forzar a Node a recolectar basura y liberar memoria de forma proactiva:

```json
"scripts": {
  "dev": "NODE_OPTIONS='--max-old-space-size=4096' next dev -p 3000",
  "dev:clean": "lsof -ti:3000 | xargs kill -9 2>/dev/null; NODE_OPTIONS='--max-old-space-size=4096' next dev -p 3000",
  "dev:3003": "PORT=3003 NODE_OPTIONS='--max-old-space-size=4096' next dev -p 3003",
  "build": "NODE_OPTIONS='--max-old-space-size=4096' next build",
  "start": "NODE_OPTIONS='--max-old-space-size=2048' next start -p 3000"
}
```

### 2. Optimización de Paquetes Masivos en `next.config.ts`
En `next.config.ts`, bajo la clave `experimental.optimizePackageImports`, se deben registrar todas las librerías con árboles de exportación extensos:

```typescript
experimental: {
  optimizePackageImports: [
    '@tabler/icons-react',
    'lucide-react',
    'recharts',
    '@azure/arm-compute',
    '@azure/arm-costmanagement',
    '@azure/arm-network',
    '@azure/arm-resources',
    '@azure/arm-subscriptions',
    '@azure/arm-advisor',
    '@azure/arm-monitor',
    '@azure/arm-consumption',
    '@azure/arm-appservice',
    '@azure/identity',
  ],
},
```

### 3. Liberación de Páginas Inactivas en Desarrollo (`onDemandEntries`)
Para evitar que las páginas visitadas durante la sesión de desarrollo permanezcan indefinidamente en la memoria del proceso Next.js:

```typescript
onDemandEntries: {
  maxInactiveAge: 60 * 1000, // Libera páginas inactivas a los 60s
  pagesBufferLength: 5,      // Mantiene máximo 5 páginas en buffer
},
```

### 4. Configuración Global para Terminales macOS (`~/.zshrc`)
Para desarrolladores que ejecutan comandos directos sin pasar por `npm run dev` (ej. CLI tools o scripts auxiliares), se recomienda persistir en su shell:

```bash
# En ~/.zshrc o ~/.bashrc
export NODE_OPTIONS="--max-old-space-size=4096"
```

---

## Restricciones y Trampas Conocidas
- **No asignar menos de 2048MB para `build`**: La compilación de producción con internacionalización de 3 idiomas y generación de rutas estáticas puede fallar por OOM si se fija un límite inferior a 2GB. 4096MB (4GB) es el punto dulce entre contención y estabilidad.
- **Limpieza de carpetas `.next-*` acumuladas**: Si se utilizan múltiples puertos con `PORT=3003` o similares, verificar que no queden carpetas huérfanas `.next-300*` indexadas por el servidor de TypeScript en `tsconfig.json`.

---

# 📄 auditoria_recursos_zombis_SOP.md

> **Archivo fuente:** `directivas/auditoria_recursos_zombis_SOP.md`

# SOP: Auditoría de Recursos Zombis y Limpieza Cloud (Omni-Scan 25 Tipos)

## Objetivo
Establecer las directivas maestras y procedimientos estándar para el motor de auditoría de recursos zombis, clasificación Hard vs. Soft waste, sistema de excepciones/whitelist persistente en base de datos, etiquetado masivo con autocompletado y consulta a FinOps Copilot, y remediación en lote.

================================================================================
### DIRECTIVAS MAESTRAS OBLIGATORIAS: AUDITORÍA DE RECURSOS ZOMBIS Y LIMPIEZA CLOUD
================================================================================

1. POLÍTICA DE ACCESO, AUTENTICACIÓN Y ENRUTAMIENTO DE TENANTS:
   - Tenant Demo (isMockTenant(tenantId) === true || searchParams.get('mock') === 'true' || tenantId.startsWith('demo-') || tenantId.startsWith('mock-')):
     • Servir datos sintéticos/demo de inmediato sin requerir autenticación OAuth ni tokens de Entra ID.
     • Navegación fluida sin bloqueos 401/403.
     • ORDEN CRÍTICO: El check `isMockTenant` DEBE evaluarse ANTES de `requireTenantAccess`. Nunca al revés.
   - Tenant Real / Conectado (isMockTenant(tenantId) === false):
     • Validación obligatoria de RBAC mediante `requireTenantAccess(req, tenantId)` y tokens OAuth válidos.
     • TOLERANCIA CERO A FALLBACKS MOCK: Si una consulta a Azure devuelve datos vacíos ([] o $0.00), la UI DEBE renderizar el estado real ($0.00 / Empty State legítimo). PROHIBIDO inyectar mocks como rescate visual de datos vacíos en un tenant real.
     • Consumir exclusivamente endpoints vivos (Azure Resource Graph KQL Omni-Scan, Cost Management API / Dataset FOCUS, ARM REST API para operaciones de tags y borrado).

2. DIRECTIVA DE ANCHO MÁXIMO (FULL-WIDTH 100%) Y RESPONSIVE CON SCROLLBAR VISIBLE EN macOS:
   - El layout principal, barra de filtros, banner de acciones masivas y tabla DEBEN ocupar el ANCHO MÁXIMO POSIBLE DE LA VENTANA (`w-full max-w-full px-4 sm:px-6 lg:px-8`).
   - PROHIBIDO aplicar restricciones rígidas de ancho como `max-w-5xl` o `max-w-7xl`.
   - **Fix Crítico para Scrollbar en macOS:** En contenedores con `overflow-x-auto`, aplicar clases Tailwind para forzar la visibilidad del scrollbar horizontal:
     `scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800`.
   - Celdas con texto adaptable (`min-w-[120px] max-w-[240px] truncate` con tooltip) y botones compactos que no desborden la vista.

3. POLÍTICA DE ICONOGRAFÍA CORPORATIVA (TABLER EXCLUSIVO - PROHIBIDO EMOJIS):
   - Librería exclusiva: '@tabler/icons-react' (Tabler Icons).
   - REEMPLAZO OBLIGATORIO: Está estrictamente prohibido usar el carácter emoji "✨" en botones o textos. Debe ser reemplazado por el componente Tabler oficial `<IconSparkles size={16} stroke={1.5} className="inline mr-1.5 text-[#0078D4]" />`.
   - Color del icono: Azul empresarial corporativo (Tailwind: 'text-[#0078D4]' o 'text-blue-600').
   - Estilo: Iconos de trazo limpio (stroke={1.5} o stroke={2}).
   - Fondo: ESTRICTAMENTE SIN FONDO ('bg-transparent' / sin badges circulares ni contenedores cuadrados de color de fondo).

4. GESTIÓN DE CAPAS (Z-INDEX Y POPOVERS INFORMATIVOS):
   - Todos los popovers de ayuda (iconos con `IconInfoCircle`), dropdowns de filtros, modales de etiquetado masivo, modal de confirmación de borrado y drawer de exención DEBEN renderizarse SIEMPRE por delante del contenido:
     • Backdrop: `fixed inset-0 bg-black/50 z-50`.
     • Contenedores de modal/popover: `z-50` o `z-[100]`.
     • Widgets flotantes (como el chat): permanecer estrictamente en `z-40` o inferior.

5. DISEÑO DE INTERFAZ Y PALETA EN TONOS DE AZUL:
   - Contenedores y KPI Cards: Fondos neutros limpios ('bg-white' o 'bg-slate-50/50') con bordes sutiles ('border border-slate-200').
   - Banner de Selección Múltiple: Fondo `bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800` con texto azul corporativo `#0078D4`.
   - Badges de Problemas:
     • Hard Waste (VM Apagada con Discos, Disco Huérfano, IP Huérfana): Badge en rojo suave o ámbar profundo (`bg-rose-50 text-rose-700 border border-rose-200` o `bg-amber-50 text-amber-700 border border-amber-200`).
     • Soft Waste (Sin Etiquetas FinOps): Badge en azul suave (`bg-blue-50 text-[#0078D4] border border-blue-200`).
     • Eximido / Whitelist: Badge en slate neutro (`bg-slate-100 text-slate-700 border border-slate-200`).

6. PRESERVACIÓN ESTRICTA DE LÓGICA Y PAGINACIÓN:
   - Paginación obligatoria (15/30/45/60) con selector de página y total de registros.


