# Directiva: Onboarding RBAC Cero-Fricción

## Objetivo
Detectar cuando la aplicación ha sido consentida (Admin Consent) pero carece de permisos sobre los recursos (Suscripciones / Resource Graph), y proporcionar una experiencia automatizada al cliente.

## Lógica
- Si la API de Azure devuelve un error 403 (AccessDenied) o `AuthorizationFailed`, el backend interceptará este error y devolverá un HTTP 403 con el código `MISSING_RBAC_ROLE`.
- El Frontend (React) atrapará este código y renderizará `<RoleAssignmentBanner />` en lugar de una tabla vacía o un error genérico.
- El Banner proporciona el script `az role assignment create` usando el Client ID nativo, permitiendo al cliente ejecutarlo directamente en Cloud Shell.

## Restricciones/Casos Borde
- **Falta de Admin Consent (AADSTS7000229)**: Cuando un cliente agrega un nuevo Tenant, la aplicación Multi-Tenant no existe en su directorio hasta que se consiente. El SDK de Azure arrojará `AuthenticationRequiredError` con el código `AADSTS7000229`. El backend DEBE interceptar esta subcadena en `e.message` y devolver un HTTP 403 con el código `MISSING_ADMIN_CONSENT`. El Frontend debe atrapar esto y mostrar un mensaje pidiendo que se cree el Service Principal mediante `az ad sp create --id <Client_ID>` o usando la URL de Admin Consent, en lugar de intentar mostrar datos o fallar con 401/500.
