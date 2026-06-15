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

## Trampas y Restricciones

1. **MySQL 8 y `caching_sha2_password` (Error de Acceso Denegado)**:
   - *Problema*: Al ejecutar la base de datos en Docker con MySQL 8.0+, la conexión desde Node.js (host a container) puede fallar con `Access denied for user 'finops_user'@'...'`. Esto ocurre porque Docker levanta MySQL con el plugin `caching_sha2_password` por defecto, el cual requiere configuración estricta de SSL o puede tener conflictos con la IP del gateway de Docker.
   - *Solución*: Debes conectarte a la base de datos y cambiar el plugin de autenticación del usuario a `mysql_native_password` ejecutando:
     `ALTER USER 'finops_user'@'%' IDENTIFIED WITH mysql_native_password BY 'finopspassword'; FLUSH PRIVILEGES;`
   - *Prevención*: En entornos de desarrollo locales con Docker, es preferible añadir `--default-authentication-plugin=mysql_native_password` al `command` de `docker-compose.yml`.

2. **Evitar duplicados (Idempotencia)**: Usamos `INSERT IGNORE` para el Tenant y `ON DUPLICATE KEY UPDATE` para Users. Si un usuario ya existe, simplemente se actualiza su email para mantener el rol de administrador intacto.
