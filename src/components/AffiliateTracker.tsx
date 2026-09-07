"use client";

import { useEffect } from "react";

export const AFFILIATE_COOKIE = "affiliate_ref";
/** Ventana de atribución: 60 días desde el clic en el link del afiliado. */
const DIAS_ATRIBUCION = 60;

/**
 * Captura el código de afiliado de un link `?ref=` (o `?via=`) y lo deja en una
 * cookie para que `/api/onboard` lo lea cuando el visitante se dé de alta.
 *
 * Lee `window.location.search` en vez de `useSearchParams()` a propósito: el
 * hook obliga a envolver el componente en un `<Suspense>` y, montado en el
 * layout, saca del prerender estático a todas las rutas que cuelgan de él. Acá
 * sólo hace falta el valor una vez, en el montaje, que es cuando el visitante
 * aterriza desde el link — y en ese momento `location.search` ya lo tiene.
 *
 * La cookie NO es httpOnly porque la escribe el browser; el valor es una pista
 * de atribución, no una credencial. Lo que impide que alguien se atribuya a sí
 * mismo está del otro lado, en `atribuirReferido`, contra el mail que MSAL
 * verificó. Y de todos modos un afiliado puede hacer que le firmen con su
 * código simplemente compartiendo el link, así que endurecer la cookie no
 * cerraría nada que no esté abierto por diseño.
 */
export default function AffiliateTracker() {
    useEffect(() => {
        try {
            const params = new URLSearchParams(window.location.search);
            const crudo = params.get("ref") || params.get("via");
            if (!crudo) return;

            const codigo = crudo.trim().toLowerCase();
            // Mismo alfabeto que `normalizarCodigo` en el servidor: si no matchea,
            // no se guarda nada en vez de mandar basura al onboarding.
            if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(codigo)) return;

            const maxAge = 60 * 60 * 24 * DIAS_ATRIBUCION;
            const seguro = window.location.protocol === "https:" ? "; Secure" : "";
            document.cookie = `${AFFILIATE_COOKIE}=${encodeURIComponent(codigo)}; path=/; max-age=${maxAge}; SameSite=Lax${seguro}`;
        } catch {
            // Cookies deshabilitadas o storage bloqueado: la visita simplemente
            // no queda atribuida. Nunca romper la navegación por esto.
        }
    }, []);

    return null;
}
