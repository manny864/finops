# Directiva: Ensamblaje del Frontend SPA (MVP)

## Objetivo
Estructurar el layout principal de la aplicación Next.js, implementando navegación interactiva, autenticación simulada (Auth Mock) y un dashboard dinámico que consuma el backend recién creado.

## Lógica y Pasos
1. Crear `src/components/ClientShell.tsx`: Componente de cliente encargado de manejar el estado local del Sidebar (colapsable) y renderizar la Navbar con el selector de Tenant y el botón de MSAL (Entra ID) simulados.
2. Modificar `src/app/layout.tsx`: Integrar el `ClientShell` como envoltura principal de la aplicación.
3. Crear `src/components/ZombieResourcesTable.tsx`: Componente de cliente con `useEffect` que consulte a `/api/recommendations`. Manejar estados `loading`, `error`, y proveer un fallback visual en caso de fallos del SDK para no romper el flujo del UI.
4. Sobrescribir `src/app/page.tsx`: Renderizar la tabla y las tres tarjetas placeholder ("Cost Summary", "Rate Optimization", "Workload Optimization") para inyecciones futuras de Power BI.

## Trampas Conocidas / Restricciones
- La consola del navegador arrojará error si el servidor carece de las credenciales de Azure (`DefaultAzureCredential`), por lo que la tabla debe tener un bloque `catch` para renderizar datos de prueba temporalmente.
- **CRÍTICO:** En Next.js (modo desarrollo), nunca utilizar `throw new Error()` dentro de un bloque `fetch().then()` para delegar el control de fallos. Next.js intercepta las excepciones inmediatamente y muestra un overlay rojo invasivo que rompe la experiencia de UI, aunque la excepción esté capturada en un `.catch()`. Se deben manejar las respuestas de error condicionalmente sin arrojar excepciones (ej. validando `json.error`).
