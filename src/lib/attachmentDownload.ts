/**
 * AISEC-09: cabeceras para servir archivos subidos por usuarios. Siempre como
 * descarga, sin sniffing, en sandbox (si el navegador lo abriera igual no puede
 * ejecutar scripts ni leer el origen) y sin embeberse desde otros sitios.
 */

/** Nombre ASCII seguro para `filename=`: sin comillas, barras ni `.`/espacios iniciales. */
export function asciiFileName(name: string, fallback = "adjunto"): string {
    const ascii = String(name ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w.\- ]/g, "_")
        .replace(/^[. ]+/, "")
        .replace(/[. ]+$/, "")
        .slice(0, 150);
    return ascii || fallback;
}

/** RFC 5987: `encodeURIComponent` deja `'()*` sin codificar y no valen en attr-char. */
function rfc5987(value: string): string {
    return encodeURIComponent(value).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export function contentDisposition(name: string): string {
    const original = String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
    const ascii = asciiFileName(original);
    return `attachment; filename="${ascii}"; filename*=UTF-8''${rfc5987(original.replace(/^[. ]+/, "") || ascii)}`;
}

export function attachmentDownloadHeaders(name: string, mime: string): Record<string, string> {
    return {
        "Content-Type": mime,
        "Content-Disposition": contentDisposition(name),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": "private, no-store",
    };
}
