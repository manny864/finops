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
