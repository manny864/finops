# License Optimization SOP

## Objetivo
Implementar el módulo de "License Optimization" para extraer suscripciones activas y en uso de Microsoft 365 y Azure a través de la API de Microsoft Graph.

## Componentes y Pasos
1. **licenseService.ts**: Conectarse a Graph API (`https://graph.microsoft.com/v1.0/subscribedSkus`) usando `ClientSecretCredential`. Map de `skuPartNumber`, `prepaidUnits.enabled` y `consumedUnits`.
2. **API Route**: Endpoint seguro en `/api/intelligence/licenses` para proveer los datos.
3. **Frontend Dashboard**: KPIs superiores y tabla de react-table detallando las licencias subutilizadas.

## Casos Borde y Trampas
- Graph API requiere el scope `https://graph.microsoft.com/.default` para autenticación Server-to-Server.
- Si no hay licencias, devolver array vacío.
