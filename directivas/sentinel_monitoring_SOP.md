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
