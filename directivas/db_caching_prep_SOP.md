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
