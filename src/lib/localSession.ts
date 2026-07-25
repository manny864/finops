"use client";

/**
 * Sesión de los usuarios con identidad propia (email+contraseña, tenants AWS).
 *
 * El token va en `sessionStorage`, no en `localStorage`, ni en una cookie
 * httpOnly:
 *  - `localStorage` persiste hasta que alguien lo borra; sessionStorage muere
 *    al cerrar la pestaña, así que la ventana de exposición ante un XSS es
 *    mucho más chica. Es además donde MSAL guarda sus propios tokens por
 *    defecto, así que no empeora el modelo de amenaza existente.
 *  - Una cookie httpOnly sería más segura, pero el backend lee la identidad de
 *    `Authorization: Bearer` (ver getBearerToken en requestAuth.ts) y las 244
 *    rutas dependen de eso. Cambiarlo es una refactorización de otra escala.
 *
 * ponytail: sessionStorage. Si aparece un requisito de "recordarme" o de
 * sesión compartida entre pestañas, mover a cookie httpOnly + lectura de
 * cookie en getBearerToken — no a localStorage.
 */

const TOKEN_KEY = "finops_local_token";
const EMAIL_KEY = "finops_local_email";

export type LocalSession = { token: string; email: string; tenantId: string };

export function saveLocalSession(session: LocalSession): void {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(TOKEN_KEY, session.token);
    sessionStorage.setItem(EMAIL_KEY, session.email);
}

export function getLocalToken(): string | null {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(TOKEN_KEY);
}

export function getLocalEmail(): string | null {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(EMAIL_KEY);
}

export function clearLocalSession(): void {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
}

export function hasLocalSession(): boolean {
    return Boolean(getLocalToken());
}
