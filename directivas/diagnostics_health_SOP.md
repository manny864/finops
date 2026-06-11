# SOP: Diagnósticos y Heartbeat del Sistema

## Objetivo
Implementar un sistema de monitoreo de salud ("Diagnostics & Heartbeat") para verificar proactivamente el estado del servidor, la base de datos MySQL, las credenciales de Azure de cada inquilino (tenant) y ofrecer un panel SuperAdmin para visualizar estos indicadores.

## Lógica y Pasos

### 1. API de Diagnóstico (`/api/system/diagnostics`)
- Endpoint de tipo `GET` accesible únicamente por SuperAdmins (usuarios con email que termine en `@cscloudsolutions.com.ar`).
- Debe verificar:
  - Conexión a la Base de Datos: Hacer ping o ejecutar `SELECT 1` en el pool de MySQL.
  - Variables de Entorno Clave: Comprobar la presencia de `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `NEXT_PUBLIC_CLIENT_ID` u otras variables críticas.
  - Tiempo de Actividad (Uptime): Devolver el uptime actual del proceso del servidor usando `process.uptime()`.

### 2. Servicio de Heartbeat de Inquilinos (`tenantHealthService.ts`)
- Debe verificar si las credenciales de Azure de un inquilino siguen activas y válidas sin realizar consultas masivas.
- Para validarlas: Intentar obtener un token de acceso de Azure (OAuth credential flow) usando las credenciales guardadas en la base de datos (`client_id`, `client_secret` y el `tenant_id` de Azure).
- Actualizar la tabla de `Tenants` con las columnas:
  - `last_sync_at` (TIMESTAMP)
  - `sync_status` (VARCHAR: 'OK', 'ERROR')
  - `last_error_message` (TEXT)
- Integrar la verificación en el flujo de inicialización/sincronización o mediante una comprobación programada/manual.

### 3. Interfaz de Salud de SuperAdmin (`/superadmin/health/page.tsx`)
- Crear una tabla para los SuperAdmins que liste todos los tenants activos y muestre:
  - Nombre de la compañía e ID del tenant.
  - Estado de salud con un indicador visual (🟢 Verde para 'OK', 🔴 Rojo para 'ERROR' o 'N/A').
  - Fecha del último latido/sincronización (`last_sync_at`).
  - Último mensaje de error si el estado es 'ERROR'.
  - Botón para disparar de forma manual la verificación (trigger manual de salud).

## Restricciones y Trampas Conocidas
- Comprobar roles usando exclusivamente el dominio de email `@cscloudsolutions.com.ar` obtenido a partir del token JWT Bearer.
- No realizar consultas de recursos pesados durante la verificación del heartbeat de Azure. Intentar únicamente la adquisición del token de Microsoft Identity Platform (login.microsoftonline.com) o una consulta KQL simple y rápida.
- Manejar adecuadamente los errores de base de datos e inicializar las columnas adicionales en la tabla `Tenants` en `initializeDatabase()`.
- **Restricción de TypeScript en Fetch**: El helper `getAuthHeader()` en el frontend debe tiparse explícitamente para retornar `Promise<Record<string, string>>` o `Promise<HeadersInit>` para evitar fallas de sobrecarga en los métodos `fetch`.
- **Propiedades duplicadas en JSON**: Evitar la propagación (spread) de objetos que ya contienen claves explícitamente definidas (como `{ success: true, ...result }` si `result` tiene la clave `success`), ya que causa el error de compilación `TS2783`. En su lugar, retornar el objeto directamente (`NextResponse.json(result)`).
