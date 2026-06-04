# Directiva: Manejo de Entornos Híbridos y Selector de Suscripciones

## Objetivo
Garantizar tolerancia a fallos en la capa de identidad (`keyvault.ts`) para entornos locales o despliegues ligeros, e implementar un componente dinámico de filtrado de suscripciones para el Dashboard FinOps.

## Lógica de Tolerancia a Fallos (Fallback)
- En `keyvault.ts`, si `KEYVAULT_NAME` no está configurado, o si `DefaultAzureCredential` lanza una excepción (típico en localhost), el código DEBE ser capaz de interceptar el error y retroceder a leer el secreto quemado en la variable `process.env.AZURE_CLIENT_SECRET`.

## Arquitectura de API de Suscripciones
- Se expone `/api/subscriptions` utilizando `SubscriptionClient` de `@azure/arm-subscriptions`.
- Esta ruta está protegida por la misma lógica Zero-Trust (Bearer Token) que la API de recomendaciones.

## Restricciones / Casos Borde (Aprendidos)

### 1. Catch seguro contra `error.message` undefined
- **Nota:** NUNCA hacer `error.message.includes(...)` directamente en un catch. Si el error no tiene propiedad `.message`, esto lanza un `TypeError` secundario que enmascara el error original.
- **Solución:** Siempre extraer primero: `const errorMessage = error?.message || String(error) || "Error desconocido";` y luego usar `errorMessage.includes(...)`.

### 2. Error AADSTS7000215 — Client Secret Inválido
- **Síntoma:** Todos los endpoints fallan con `AuthenticationRequiredError: invalid_client` + `AADSTS7000215`.
- **Causa:** El `AZURE_CLIENT_SECRET` en `.env.local` (o en producción) ha expirado o se copió el Secret ID en lugar del Secret Value.
- **Detección en código:** Los catch blocks deben buscar `AADSTS7000215`, `invalid_client` o `Invalid client secret` en el mensaje de error y devolver un código de error específico `INVALID_CLIENT_SECRET` con status 401.
- **Solución:** Ir a Azure Portal > App Registrations > app `876D8A5B-...` > Certificates & secrets > New client secret. Copiar el **Value** (no el ID) y actualizar `AZURE_CLIENT_SECRET` en el servidor.

### 3. Logging estructurado en endpoints
- Todo endpoint API debe loguear paso a paso (credencial, token, fetch) para facilitar diagnóstico en producción donde los stack traces están minificados.
