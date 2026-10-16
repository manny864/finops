/**
 * Base URL para self-fetches server-side: un route handler llamando por HTTP a
 * OTRO endpoint del MISMO servidor Next.
 *
 * NUNCA usar la origin pública (`request.nextUrl.origin`, `NEXT_PUBLIC_APP_URL`)
 * para estos fetch internos. Detrás del reverse proxy, la origin es el dominio
 * público (ej. https://finops.cscloudsolutions.com.ar). Desde dentro del
 * contenedor, pegarle a su propio dominio público hace NAT hairpin y termina
 * fallando con "fetch failed" (undici ECONNREFUSED/EAI). Eso degradaba el
 * dashboard (audit/forecast) y rompía el prewarm y el reporte ejecutivo.
 *
 * En su lugar hablamos por loopback al puerto en el que el server ya escucha
 * (Docker: PORT=3000, HOSTNAME=0.0.0.0 → 127.0.0.1:3000 es alcanzable).
 *
 * Override opcional con INTERNAL_BASE_URL si el server escucha en otro host/puerto.
 */
export function getInternalBaseUrl(): string {
    const override = process.env.INTERNAL_BASE_URL;
    if (override) {
        const url = new URL(override);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
            || url.search || url.hash || url.pathname !== "/") {
            throw new Error("INTERNAL_BASE_URL must be a trusted HTTP(S) origin without credentials, path, query or fragment.");
        }
        return url.origin;
    }
    const port = process.env.PORT || "3000";
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
        throw new Error("PORT must be an integer between 1 and 65535.");
    }
    return `http://127.0.0.1:${port}`;
}
