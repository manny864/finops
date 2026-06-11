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
