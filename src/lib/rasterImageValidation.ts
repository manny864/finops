/**
 * Reglas de validación compartidas para uploads de imagen raster (avatar de
 * usuario, logo de tenant): solo png/jpg/jpeg/webp, chequeadas por magic
 * bytes además de extensión — deliberadamente sin SVG, ver tenantLogo.ts.
 *
 * Antes duplicado íntegramente en userAvatar.ts y tenantLogo.ts.
 */
const ALLOWED: Record<string, { mime: string; magic: number[][] }> = {
    png: { mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
    jpg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
    jpeg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
    webp: { mime: "image/webp", magic: [[0x52, 0x49, 0x46, 0x46]] }, // 'RIFF'
};

export const RASTER_STORED_NAME_RE = /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i;

export interface RasterImageValidation {
    ok: boolean;
    error?: string;
    ext?: string;
    mime?: string;
}

export function mimeForExt(ext: string): string {
    const e = ext.toLowerCase().replace(/^\./, "");
    return ALLOWED[e]?.mime || "application/octet-stream";
}

export function validateRasterImage(fileName: string, bytes: Buffer, maxBytes: number): RasterImageValidation {
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    const spec = ALLOWED[ext];
    if (!spec) {
        return { ok: false, error: "Formato no permitido. Solo PNG, JPG o WEBP." };
    }
    if (bytes.length === 0) {
        return { ok: false, error: "El archivo está vacío." };
    }
    if (bytes.length > maxBytes) {
        return { ok: false, error: `El archivo supera el máximo de ${Math.round(maxBytes / (1024 * 1024))} MB.` };
    }
    const matches = spec.magic.some((sig) => sig.every((b, i) => bytes[i] === b));
    if (!matches) {
        return { ok: false, error: "El contenido del archivo no coincide con su extensión." };
    }
    return { ok: true, ext, mime: spec.mime };
}
