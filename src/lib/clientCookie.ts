"use client";

/**
 * Helpers mínimos de cookie client-side (sin dependencia externa). Uso
 * previsto: preferencias de UI no sensibles (ej. layout de tarjetas) que
 * deben sobrevivir a un `localStorage.clear()` y, a diferencia de
 * localStorage, viajan en cada request — útil si en el futuro se necesita
 * leer la preferencia server-side (SSR) sin esperar al primer render client.
 */
export function getCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&")}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

export function setCookie(name: string, value: string, days = 365): void {
    if (typeof document === "undefined") return;
    const maxAge = days * 24 * 60 * 60;
    // SameSite=Lax + sin Secure explícito: debe funcionar también en
    // localhost/HTTP durante desarrollo. Path=/ para que aplique a toda la app.
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}
