# Directiva: Rightsizing P95 y Network API Fix

## Objetivo
Mejorar el motor de rightsizing usando métricas reales (P95/Max en 14 días). Solucionar error 500 en Network aislando tenants y capturando fallos de SDK.

## Restricciones/Casos Borde
- **Azure Monitor API**: El parámetro `aggregation` requiere especificar `Maximum,Average` (o los soportados explícitamente). No asumas que la API devuelve P95 nativamente si no lo pides, o en su defecto, calcula el P95 basado en las métricas listadas.
- **Network SDK (AuthorizationFailed)**: Siempre envuelve `networkClient` y `getNetworkEgressCosts` en try/catch. Un error 403 del SDK (`AuthorizationFailed` o `ScopeNotFound`) significa que el SPN no tiene permiso en esa Subscripción. No se debe petar con 500.
- **DefaultAzureCredential / ClientSecretCredential**: Instanciar SIEMPRE usando `getAzureCredential(tenantId)` para garantizar que el token esté scoped al directorio del cliente.
