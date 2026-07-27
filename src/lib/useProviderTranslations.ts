"use client";

import { useTranslations } from "next-intl";

/**
 * Traducciones sensibles al proveedor de nube activo.
 *
 * Antes resolvía variantes `<clave>_aws` cuando el proveedor activo era AWS.
 * El producto es Azure-only, así que queda como un alias directo de
 * `useTranslations` para no tener que tocar cada caller que lo usa.
 */
export function useProviderTranslations(namespace: string) {
    return useTranslations(namespace);
}
