# Directiva: Conexión MSAL Frontend con API Resource Graph

## Objetivo
Conectar el componente visual `ZombieResourcesTable.tsx` con la API segura de `/api/recommendations`. El componente debe adquirir silenciosamente el token JWT de la sesión activa de MSAL y mapear los resultados crudos de Azure Resource Graph a la tabla visual.

## Lógica y Pasos
1. Importar `useMsal` en `ZombieResourcesTable.tsx`.
2. Si no hay sesión (`accounts.length === 0`), mostrar un mensaje indicando que se debe iniciar sesión.
3. Si hay sesión, utilizar `instance.acquireTokenSilent()` para obtener el token.
4. Hacer el `fetch` enviando el `tenantId` (extraído de `accounts[0].tenantId`) y el header `Authorization: Bearer <token>`.
5. Mapear las respuestas `json.unattachedDisks` y `json.unusedIps` inyectándoles las propiedades `type`, `issue`, `resourceName` y un `potentialSavings` estimado para mantener compatibilidad con la tabla.

## Trampas Conocidas / Restricciones
- El componente debe manejar `acquireTokenSilent` en un `useEffect`. Si el token expiró, la promesa fallará y se debe gestionar el error gracefully.
- La respuesta de la API `json.unattachedDisks` contiene la propiedad `name` (en lugar de `resourceName`). Se debe hacer un `.map()` en el frontend o ajustar el backend.
