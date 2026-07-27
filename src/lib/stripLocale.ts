/**
 * Quita el segmento de locale (`/es`, `/en`, `/pt-BR`) de un pathname.
 * Ej: `/es/intelligence/rates` → `/intelligence/rates`.
 *
 * Único punto de esta lógica — antes duplicada en pageRegistry.ts y
 * routeTiers.ts con regexes ligeramente distintos.
 */
export function stripLocale(pathname: string): string {
    const match = pathname.match(/^\/(en|es|pt-BR|pt)(\/.*)?$/i);
    if (match) return match[2] || "/";
    return pathname;
}
