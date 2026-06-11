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
