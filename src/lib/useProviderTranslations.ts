"use client";

import { useTranslations } from "next-intl";

/**
 * Traducciones sensibles al proveedor de nube activo.
 *
 * Antes resolvía variantes de clave por proveedor cuando había más de una nube.
 * El producto es Azure-only, así que queda como un alias directo de
 * `useTranslations` para no tener que tocar cada caller que lo usa.
 */
export function useProviderTranslations(namespace: string) {
    return useTranslations(namespace);
}
