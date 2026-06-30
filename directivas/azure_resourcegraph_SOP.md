# Directiva: Azure Resource Graph Optimization

## Objetivo
Refactorizar la API de recomendaciones (`src/app/api/recommendations/route.ts`) para sustituir los clientes individuales y lentos (Compute/Network) por `@azure/arm-resourcegraph`. Esto permite realizar consultas KQL globales y concurrentes, lo cual reduce el tiempo de escaneo de recursos huérfanos drásticamente y evita los Rate Limits del Azure Service Management API.

## Lógica y Pasos
1. Instalar `@azure/arm-resourcegraph`.
2. Crear la función `getResourceGraphClient(tenantId)` en `src/lib/azure.ts`.
3. Reemplazar la lógica de `route.ts`.
4. Utilizar `client.resources({ query, subscriptions: [subscriptionId] })` para restringir la consulta al scope preciso, evitando costos extra en Azure.
5. Agrupar la respuesta en la estructura JSON `{ unattachedDisks, unusedIps }`.

## Trampas Conocidas / Restricciones
- El SDK de Resource Graph devuelve el payload crudo en la propiedad `response.data`. 
- Es fundamental no quebrar el validador de JWT; se debe interceptar y verificar la identidad antes de delegar la consulta asíncrona a Azure.
- **Nota (KQL ≠ JavaScript):** NUNCA usar `?.` (optional chaining) en queries KQL. Eso es sintaxis de JavaScript/TypeScript, no de Kusto. El operador correcto para acceder a propiedades anidadas en KQL es el punto simple: `connection.properties.privateLinkServiceConnectionState.status`. Usar `?.` causa un error del tipo "Please provide below info when asking for support" en Azure Resource Graph.


### Actualización Fase 4: Multi-Suscripción
- `subscriptionId` ahora es un parámetro opcional.
- Si NO se proporciona, el backend omitirá el atributo `subscriptions` en la llamada de Azure SDK, lo que le instruye nativamente a Resource Graph a escanear **todas las suscripciones** del Tenant.
