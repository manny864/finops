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
