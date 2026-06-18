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
