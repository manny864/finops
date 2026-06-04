# Directiva: Manejo de Entornos Híbridos y Selector de Suscripciones

## Objetivo
Garantizar tolerancia a fallos en la capa de identidad (`keyvault.ts`) para entornos locales o despliegues ligeros, e implementar un componente dinámico de filtrado de suscripciones para el Dashboard FinOps.

## Lógica de Tolerancia a Fallos (Fallback)
- En `keyvault.ts`, si `KEYVAULT_NAME` no está configurado, o si `DefaultAzureCredential` lanza una excepción (típico en localhost), el código DEBE ser capaz de interceptar el error y retroceder a leer el secreto quemado en la variable `process.env.AZURE_CLIENT_SECRET`.

## Arquitectura de API de Suscripciones
- Se expone `/api/subscriptions` utilizando `SubscriptionClient` de `@azure/arm-subscriptions`.
- Esta ruta está protegida por la misma lógica Zero-Trust (Bearer Token) que la API de recomendaciones.
