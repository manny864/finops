# Directiva: Refactor Multi-Tenant y Service Principal Auth

## Objetivo
Transicionar el sistema de autenticación de Azure de un modelo local/default a un modelo Multi-Tenant dinámico basado en un Service Principal explícito (`ClientSecretCredential`).

## Lógica y Pasos
1. `azure.ts`: Eliminar `DefaultAzureCredential`. Crear `getAzureCredential(tenantId)` que lea `AZURE_CLIENT_ID` y `AZURE_CLIENT_SECRET` desde el entorno.
2. `azure.ts`: Actualizar los instanciadores `getComputeClient` y `getNetworkClient` para recibir `tenantId` y pasarlo a la credencial dinámicamente.
3. `route.ts` (Recomendaciones y Consumo): Reemplazar la lógica de extracción de URLs. Extraer estrictamente `tenantId` y `subscriptionId`.
4. `route.ts` (Recomendaciones y Consumo): Validar si faltan parámetros, devolviendo 400 Bad Request si es el caso.

## Trampas Conocidas / Restricciones
- Las llamadas a la credencial fallarán con error si las variables `AZURE_CLIENT_ID` y `AZURE_CLIENT_SECRET` no están configuradas en `.env` (esto generará un error 500 controlado o un crash en la inicialización si se usa en top-level. Por eso la inicialización DEBE ser encapsulada en una función dentro del bloque try/catch de las rutas).
