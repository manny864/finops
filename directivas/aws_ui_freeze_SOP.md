# Directiva: Desactivación Visual de AWS en UI

## Objetivo
Ocultar y desactivar cualquier elemento visual, selector de proveedor, tarjeta de onboarding o pestaña que haga referencia a AWS en la interfaz de usuario del SaaS, para que la plataforma opere exclusivamente en modo **Azure FinOps**. Todo el backend, APIs y lógica de AWS se conservan inactivos en código para reactivación futura.

## Entradas
- Preferencias de proveedor de nube en `src/context/ProviderContext.tsx`.
- Componentes de navegación (`Navbar`, `Sidebar`, `CloudAccountManager`).
- Páginas de admin (`/admin/cloud-accounts`, `/onboarding`).

## Salidas
- Proveedor de nube forzado visualmente a `'azure'`.
- Selectores de proveedor AWS ocultados en la UI.
- Pestañas y formularios de onboarding de AWS invisibles en el cliente.

## Lógica y Pasos
1. En `src/context/ProviderContext.tsx`, asegurar que `activeProvider` sea por defecto `'azure'` y deshabilitar el cambio a `'aws'` mediante UI guards.
2. En `src/app/[locale]/admin/cloud-accounts/page.tsx`, ocultar las tarjetas/pestañas de AWS.
3. En `src/app/[locale]/onboarding/page.tsx`, omitir o desactivar visualmente la opción de selección de nube AWS.

## Trampas Conocidas / Restricciones
- **Nota**: No borrar código de backend en `src/lib/aws/` ni endpoints `/api/aws/*` ni los tipos en DB; solo ocultar los puntos de entrada en los componentes cliente (`'use client'`).
