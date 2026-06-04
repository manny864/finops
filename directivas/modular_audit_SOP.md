# Directiva: Motor de Auditoría Modular (Fase 7)

## Reglas de Arquitectura
1. **Catálogo Central**: Todas las consultas KQL deben escribirse exclusivamente en `src/lib/kqlCatalog.ts`. Ningún archivo de ruta debe contener strings de Kusto quemados en el código.
2. **Servicios Desacoplados**: La interacción con los SDKs (`@azure/arm-resourcegraph`, `@azure/arm-monitor`) se realiza en `src/services/`.
3. **Cero-Trust en la API**: Cualquier nueva ruta (como `/api/audit/full`) debe validar obligatoriamente la congruencia entre `tenantId` del query parameter y el reclamo `tid` del Bearer token decodificado de MSAL.
