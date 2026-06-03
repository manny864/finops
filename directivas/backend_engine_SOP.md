# Directiva: Construcción del Motor Backend de FinOps y Configuración Global

## Objetivo
Configurar el backend para comunicación segura con Azure Resource Manager (ARM), extrayendo "Recursos Zombie" e inyectar al mismo tiempo la identidad de marca (colores y tipografías).

## Entradas
- `subscriptionId` a través del parámetro de búsqueda de la URL o variable de entorno (`AZURE_SUBSCRIPTION_ID`).

## Salidas
- `src/lib/azure.ts`: Configuración segura de autenticación con `DefaultAzureCredential`.
- `src/app/api/recommendations/route.ts`: Endpoint REST GET con manejo de errores robusto (500) para escaneo de recursos huérfanos.
- `src/app/layout.tsx` y `src/app/globals.css`: Configuración global de la marca basada en `colores.txt` integrando Tailwind v4.

## Lógica y Pasos (Ejecutados vía script Python)
1. Instalar `@azure/identity`, `@azure/arm-compute`, `@azure/arm-network`.
2. Actualizar la paleta de colores y variables CSS de Tailwind v4 en `globals.css` (`--color-primary`, `--color-secondary`, etc).
3. Configurar fuentes de Google (`Montserrat`, `Open Sans`) en el layout raíz de Next.js.
4. Desarrollar la lógica iterativa de los clientes de Azure en el backend devolviendo `zombieResources`.

## Trampas Conocidas / Restricciones
- **CRÍTICO:** Tailwind CSS v4 ya no utiliza el archivo `tailwind.config.ts`. Todas las variables del tema de Tailwind deben configurarse inyectando código en la regla `@theme inline` dentro de `globals.css`.
- Para iterar sobre el paginador de Azure SDKs (ej. `.list()`), siempre se debe utilizar un ciclo `for await (const item of items)`. Mapearlo directamente con un array method fallará de manera silenciosa o arrojará un error de sintaxis en TypeScript.
