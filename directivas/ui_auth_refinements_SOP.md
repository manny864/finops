# Directiva: Refinamientos de Branding y Login UX

## Objetivo
Unificar la experiencia visual y el flujo de autenticación de acuerdo a la identidad de CSCloudSolutions.
- Reemplazar Popups por `loginRedirect()`.
- Unificar el login y el onboarding en un único botón azul corporativo.
- Insertar logotipo e identificador visual para el Tenant Administrativo.

## Lógica y Pasos
1. Modificar `AuthProvider.tsx` para utilizar `pca.addEventCallback()` con `EventType.LOGIN_SUCCESS`. Este listener detectará cuando el usuario retorne de Microsoft, extraerá el AccessToken de forma silenciosa y disparará el `POST /api/onboard`.
2. Actualizar la UI de `<AuthButton />` en el mismo archivo para que utilice los colores azules de la marca y tenga el texto "Iniciar sesión con Microsoft".
3. Modificar `ClientShell.tsx`:
   - Eliminar los botones de mock y reemplazarlos por `<AuthButton />`.
   - Integrar `useIsAuthenticated` de `@azure/msal-react` para renderizado condicional. Si es verdadero, desplegar el nombre y el botón 'Cerrar Sesión' atado a `logoutRedirect()`.
   - Modificar el menú desplegable del Tenant añadiendo el texto "Admin CS".
   - Insertar la imagen `/logo.png` en el encabezado de la barra lateral.
4. Modificar `layout.tsx` para cambiar el `<title>` global a `CSCloudSolutions FinOps`.

## Trampas Conocidas / Restricciones
- **Componentes de Cliente en Next.js**: El archivo `ClientShell.tsx` contiene hooks interactivos como `useState` para colapsar la barra lateral. Si se sobrescribe el archivo en una actualización de diseño, es **CRÍTICO** añadir la directiva `"use client";` en la línea 1; de lo contrario, Next.js arrojará error de compilación al intentar renderizarlo como Server Component.
- Al utilizar `loginRedirect()`, el contexto de React se reinicia (se pierde el estado de la memoria local debido a la navegación completa del navegador). Es por ello que la llamada a la API (`fetch /api/onboard`) debe hacerse obligatoriamente interceptando el Evento Global de MSAL en un `useEffect` durante el ciclo de inicialización en el Provider.
