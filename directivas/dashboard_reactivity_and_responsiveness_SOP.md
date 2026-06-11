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

### 2. Responsividad de los Gráficos de Fugas (Pie Charts)
- **Componentes de Gráficos (`src/components/CostPieChart.tsx` y `src/components/dashboard/FocusCostPieChart.tsx`)**:
  - Reemplazar la restricción de altura mínima estática `min-h-[350px]` por una altura responsiva adaptable `h-full min-h-[220px]`.
  - Utilizar un contenedor relative con `absolute inset-0` para albergar a `<ResponsiveContainer width="100%" height="100%">` de Recharts. Esto asegura que Recharts pueda calcular correctamente sus dimensiones (ancho y alto) evitando el error de renderizado de `width(-1)` y `height(-1)`.
- **Módulo de Billing / Dashboard Interactivo (`src/components/dashboard/InteractiveDashboard.tsx`)**:
  - Ajustar el contenedor de la "Distribución de fugas financieras" y de "Spend by Subscription" para que tengan un diseño responsivo real (`h-64 w-full relative` con contenedores absolutos internos) y no causen desbordamiento o fallas de medición en flexbox.

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
