# Freemium Teaser SOP

## Objetivo
Implementar la lógica "Freemium Teaser" para optimizar ingresos mediante la táctica de enmascarar los IDs de los recursos a eliminar, motivando al usuario a hacer un Upgrade a la versión Profesional.

## Lógica y Pasos a seguir

1. **Lógica de Tier del Tenant**: Añadir el campo `tier` ('Free', 'Pro', 'Enterprise') al modelo/interfaz de `Tenant` (ej. en `src/lib/tenants.ts`).
2. **Enmascaramiento Seguro en la API**: Al devolver la lista de recursos Zombies en `/api/cleanup/zombies/route.ts`, verificar el tier del usuario. Si es 'Free', iterar por los recursos y reemplazar el `name`, `resourceId` y `resourceGroup` con `"**********"`, y añadir `isLocked: true`. `monthlyCost` y `savings` deben permanecer legibles.
3. **Desenfoque Visual y Llamada a la Acción (CTA)**: Modificar `ZombieResourcesTable.tsx` para aplicar clases de desenfoque de Tailwind (`filter blur-sm select-none`) en las columnas relevantes si el item está bloqueado (`isLocked: true`).
4. **Overlay de CTA**: Añadir un cuadro opaco superpuesto en la tabla (usando `absolute inset-0 z-10 ... backdrop-blur-[1px]`) con el botón "Upgrade to Professional to unlock exact resource names and start saving", redirigiendo a `/upgrade`.

## Trampas y Restricciones
- No enmascarar el `monthlyCost`, el objetivo es que vean exactamente cuánto van a ahorrar.
- El enmascaramiento debe hacerse siempre del lado del backend (API) para evitar que el usuario acceda a los nombres completos usando DevTools del navegador.
- El objeto alterado no debe romper la estructura de las tablas de TypeScript. Asegurar que los tipos sean compatibles.
