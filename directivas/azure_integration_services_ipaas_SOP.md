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
