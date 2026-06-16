# Lemon Squeezy Integration SOP

## Objetivo
Implementar pagos recurrentes, subscripciones y control de acceso Premium (SaaS) mediante Lemon Squeezy como Merchant of Record (MoR).

## Lógica y Flujo
1. **Modelado de Datos (`src/lib/tenants.ts`)**:
   - `subscriptionId`: ID único de Lemon Squeezy.
   - `subscriptionStatus`: Estado (`active`, `past_due`, `canceled`, etc.).
   - `planTier`: Nivel (`Free`, `Pro`, `Enterprise`).
   - `trialEndsAt`: Fecha límite (si aplica).
2. **Generación de Checkout (`/api/checkout/route.ts`)**:
   - Usar la API de Lemon Squeezy (`v1/checkouts`) o la SDK `@lemonsqueezy/lemonsqueezy.js`.
   - Pasar el `tenantId` en los campos `custom_data` del checkout para poder identificar qué tenant pagó al recibir el webhook.
3. **Recepción de Webhooks (`/api/webhooks/lemon/route.ts`)**:
   - Validar la firma criptográfica usando `LEMON_SQUEEZY_WEBHOOK_SECRET` y HMAC SHA256.
   - Escuchar eventos `subscription_created`, `subscription_updated`.
   - Extraer el `tenantId` de `meta.custom_data.tenant_id`.
   - Actualizar el estado del Tenant en la DB/Memoria.
4. **Página de Upgrade (`/upgrade`)**:
   - Para los usuarios autenticados que estén en el plan Free, mostrar los planes Premium y un botón que llama a `/api/checkout`.

## Trampas y Restricciones
- NUNCA confiar en llamadas del frontend para dar por pagado un plan. Siempre depender del Webhook firmado y procesado asíncronamente.
- El Webhook de Lemon Squeezy firma el body crudo (raw body), por lo que en Next.js App Router se debe leer mediante `request.text()` o un buffer, y no mediante `request.json()` antes de verificar la firma.
- Asegurar que las variables en `.env` (API KEY, Store ID, Variant IDs) no se expongan al frontend (sin prefijo `NEXT_PUBLIC_`).
