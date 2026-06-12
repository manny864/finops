# SOP: Manejo de Excepciones Silent Token en MSAL (block_iframe_reload y timed_out)

## Objetivo
Resolver el error de autenticación `BrowserAuthError: block_iframe_reload` y `timed_out` provocado por políticas de cookies de terceros del navegador o bloqueos de recarga de iFrames ocultos en MSAL.js al renovar tokens silenciosamente. Esto se logra redirigiendo interactivamente al usuario para refrescar su sesión y rellenar el caché cuando falle la adquisición silenciosa.

## Lógica y Pasos

### 1. Manejo en SubscriptionProvider (`src/components/SubscriptionProvider.tsx`)
- Modificar el bloque `catch` de `fetchSubscriptions`:
  - Identificar si el error es de tipo `BrowserAuthError` o `InteractionRequiredAuthError` y si el código de error coincide con `block_iframe_reload`, `timed_out`, `interaction_required`, `consent_required`, o `login_required`.
  - En caso positivo, invocar `instance.acquireTokenRedirect({ scopes: ["User.Read"], account: accounts[0] })` para redirigir al usuario al flujo interactivo de Microsoft, refrescando el token y guardándolo en caché de forma permanente.

### 2. Manejo en ZombieResourcesTable (`src/components/ZombieResourcesTable.tsx`)
- Modificar el bloque `catch` de `fetchResourcesAndSubs`:
  - Aplicar la misma lógica de redirección condicional defensiva para evitar que la interfaz de la tabla se bloquee indefinidamente en estado de error debido al bloqueo del iFrame oculto de autenticación.

## Restricciones y Trampas Conocidas
- **Evitar bucles de redirección:** El redireccionamiento interactivo guarda el token de manera fresca en el caché del navegador local. Al regresar a la aplicación, `acquireTokenSilent` resolverá el token directamente desde el caché sin disparar llamadas de red en iFrames, rompiendo cualquier bucle potencial de redirección.
- **Validación de cuentas:** Siempre comprobar `accounts.length > 0` y utilizar `accounts[0]` al llamar a `acquireTokenRedirect` para asegurar que el contexto del usuario autenticado esté inicializado.
