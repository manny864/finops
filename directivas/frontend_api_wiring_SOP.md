# Directiva: Conexión MSAL Frontend con API Resource Graph

## Objetivo
Conectar el componente visual `ZombieResourcesTable.tsx` con la API segura de `/api/recommendations`. El componente debe adquirir silenciosamente el token JWT de la sesión activa de MSAL y mapear los resultados crudos de Azure Resource Graph a la tabla visual.

## Lógica y Pasos
1. Importar `useMsal` en `ZombieResourcesTable.tsx` y el hook del Tenant actual (`useTenant` o similar).
2. Si no hay sesión (`accounts.length === 0`), mostrar un mensaje indicando que se debe iniciar sesión.
3. Si hay sesión, utilizar `instance.acquireTokenSilent()` para obtener el token.
4. Hacer el `fetch` enviando el `tenantId` (extraído de `selectedTenant.id`, **NUNCA** de `accounts[0].tenantId` en modo multi-tenant) y el header `Authorization: Bearer <token>`.
5. Mapear las respuestas `json.unattachedDisks` y `json.unusedIps` inyectándoles las propiedades `type`, `issue`, `resourceName` y un `potentialSavings` estimado para mantener compatibilidad con la tabla.

## Trampas Conocidas / Restricciones
- El componente debe manejar `acquireTokenSilent` en un `useEffect`. Si el token expiró, la promesa fallará y se debe gestionar el error gracefully.
- La respuesta de la API `json.unattachedDisks` contiene la propiedad `name` (en lugar de `resourceName`). Se debe hacer un `.map()` en el frontend o ajustar el backend.
- **Multitenancy Bug**: Si utilizas `accounts[0].tenantId` en lugar de la variable global del selector (`selectedTenant.id`), la auditoría fallará arrojando un error 403 (MISSING_RBAC_ROLE) o un 500 cuando el administrador del SaaS esté conectado pero intente auditar a un cliente, ya que buscará recursos en el tenant interno de la empresa en lugar del tenant del cliente.
\n- **Multitenancy Bypass**: Todas las rutas de API (incluyendo `/api/subscriptions`) DEBEN validar el token permitiendo un bypass si el usuario es administrador (ej. `@cscloudsolutions.com.ar`). Si se omite esto, el dropdown de suscripciones quedará vacío al devolver 403 para usuarios SaaS Admins.\n