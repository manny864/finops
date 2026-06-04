# Directiva: MSAL Onboarding y MySQL Upserts

## Objetivo
Implementar la capa de persistencia local (MySQL). Al recibir un token válido a través del flujo de MSAL React, el backend debe registrar al nuevo inquilino (Tenant) y al usuario (User Administrator) en la base de datos de FinOps, garantizando la integridad referencial.

## Lógica y Pasos
1. Archivo `schema.sql`: Definir sentencias `CREATE TABLE IF NOT EXISTS` para `Tenants` y `Users` con clave foránea en `tenant_id` y restricción en cascada.
2. Pool `db.ts`: Implementar función `initializeDatabase()` que lea asíncronamente el archivo `schema.sql` y ejecute las sentencias una única vez por instancia activa.
3. API `/api/onboard`: 
   - Parsear el Header de Autenticación.
   - Extraer `tid`, `oid`, `name`, y `preferred_username`.
   - Utilizar transacciones SQL para `UPSERT` en `Tenants` y posteriormente en `Users` para evitar errores de claves foráneas.
4. UI `AuthProvider.tsx`: Inicializar MSAL, lanzar `loginPopup()`, capturar el `accessToken` y hacer fetch hacia la API de Onboarding.

## Trampas Conocidas / Restricciones
- **Tokens MSAL**: Al realizar el onboarding hacia nuestra API local, el frontend DEBE enviar el `payload.idToken` como Bearer token, no el `payload.accessToken`. Los Access Tokens emitidos para Graph suelen ser opacos o carecer de los claims de identidad (`tid`, `oid`), lo que provocará el error de 'Token inválido o incompleto'.
- La lectura de `schema.sql` desde un entorno Serverless de Next.js (`process.cwd()`) puede tener conflictos de rutas absolutas si no se utiliza `path.join()`.
- MSAL v3 en adelante suele requerir inicialización asíncrona (`await msalInstance.initialize()`), de no tenerlo en cuenta, lanzará un error silencioso en el navegador antes del popup.
- Siempre utilizar `ON DUPLICATE KEY UPDATE` o la lógica `INSERT IGNORE` en lugar del simple `INSERT` para que un tenant o usuario que inicie sesión dos veces no colapse el motor de base de datos por los campos UNIQUE.
- **Sintaxis SQL Obsoleta**: En MySQL 8.0.20+, la sintaxis `VALUES(columna)` dentro de un `ON DUPLICATE KEY UPDATE` está deprecada y puede causar un "Error interno del servidor" en entornos de producción modernos. Utiliza siempre la vinculación de parámetros directa: `ON DUPLICATE KEY UPDATE columna = ?` pasando la variable nuevamente en el array de valores.
