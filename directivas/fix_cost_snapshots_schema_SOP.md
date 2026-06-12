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
