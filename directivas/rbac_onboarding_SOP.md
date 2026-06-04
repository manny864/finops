# Directiva: Onboarding RBAC Cero-Fricción

## Objetivo
Detectar cuando la aplicación ha sido consentida (Admin Consent) pero carece de permisos sobre los recursos (Suscripciones / Resource Graph), y proporcionar una experiencia automatizada al cliente.

## Lógica
- Si la API de Azure devuelve un error 403 (AccessDenied) o `AuthorizationFailed`, el backend interceptará este error y devolverá un HTTP 403 con el código `MISSING_RBAC_ROLE`.
- El Frontend (React) atrapará este código y renderizará `<RoleAssignmentBanner />` en lugar de una tabla vacía o un error genérico.
- El Banner proporciona el script `az role assignment create` usando el Client ID nativo, permitiendo al cliente ejecutarlo directamente en Cloud Shell.
