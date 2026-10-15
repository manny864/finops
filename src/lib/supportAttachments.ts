/**
 * Almacenamiento de adjuntos del sistema de soporte.
 *
 * - Tipos permitidos: jpg/jpeg/png (firma completa + marcador de fin, sin datos
 *   extra al final: AISEC-08 anti-polyglot; además se re-codifican con sharp), txt y
 *   json (UTF-8 sin NUL; json parseable).
 * - Tamaño máximo: 5 MB por archivo. Máximo 10 adjuntos por ticket.
 * - Los archivos se guardan como `<prefijo-tenant>/<uuid>.<ext>` (AISEC-05; nunca
 *   con el nombre original, evita path traversal / colisiones) en el container
 *   "support-attachments" de Azure Blob Storage (ver
 *   src/lib/azureBlobStorage.ts) si AZURE_STORAGE_CONNECTION_STRING está
 *   configurado; si no, cae a filesystem local bajo SUPPORT_UPLOAD_DIR
 *   (default: ./data/support-attachments, montado como volumen en Docker).
 * - Retención: 60 días. Limpieza vía cron + oportunista en cada upload.
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { resolveTenantStoredName, tenantBlobPrefix, tenantStoredName } from "@/lib/tenantBlobPath";
import { isBlobStorageEnabled, uploadBlob, downloadBlobOrNull, deleteBlob } from "@/lib/azureBlobStorage";

export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const SUPPORT_ATTACHMENT_MAX_PER_TICKET = 10;
export const SUPPORT_ATTACHMENT_RETENTION_DAYS = 60;
export const SUPPORT_ATTACHMENT_CONTAINER = process.env.AZURE_STORAGE_CONTAINER_SUPPORT_ATTACHMENTS || "support-attachments";

// Margen para el envoltorio multipart (boundary, cabeceras de las partes, tenantId, messageId).
export const SUPPORT_ATTACHMENT_MULTIPART_OVERHEAD = 64 * 1024;

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Chunk IEND completo: largo 0, tipo "IEND", CRC fijo.
const PNG_IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
const JPEG_SOI = [0xff, 0xd8, 0xff];
const JPEG_EOI = [0xff, 0xd9];

function hasAt(bytes: Buffer, sig: number[], at: number): boolean {
    return at >= 0 && sig.every((b, i) => bytes[at + i] === b);
}

// Firma al inicio y marcador de fin exactamente al final: rechaza imágenes con
// HTML/script/ZIP pegado detrás (polyglots).
function isCleanImage(kind: "png" | "jpeg", bytes: Buffer): boolean {
    if (kind === "png") {
        return bytes.length > PNG_SIG.length + PNG_IEND.length
            && hasAt(bytes, PNG_SIG, 0)
            && hasAt(bytes, PNG_IEND, bytes.length - PNG_IEND.length);
    }
    return bytes.length > JPEG_SOI.length + JPEG_EOI.length
        && hasAt(bytes, JPEG_SOI, 0)
        && hasAt(bytes, JPEG_EOI, bytes.length - JPEG_EOI.length);
}

const ALLOWED: Record<string, { mime: string; image?: "png" | "jpeg" }> = {
    jpg: { mime: "image/jpeg", image: "jpeg" },
    jpeg: { mime: "image/jpeg", image: "jpeg" },
    png: { mime: "image/png", image: "png" },
    txt: { mime: "text/plain" },
    json: { mime: "application/json" },
};

const STORED_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|txt|json)$/i;

export function getSupportUploadDir(): string {
    return process.env.SUPPORT_UPLOAD_DIR || path.join(process.cwd(), "data", "support-attachments");
}

export interface AttachmentValidation {
    ok: boolean;
    error?: string;
    ext?: string;
    mime?: string;
}

/**
 * Valida extensión, tamaño y contenido (firma + fin de archivo para imágenes;
 * UTF-8 sin NUL para txt/json, y JSON parseable para json). Devuelve el mime canónico a persistir —
 * nunca confiamos en el Content-Type que declara el cliente.
 */
export function validateAttachment(fileName: string, bytes: Buffer): AttachmentValidation {
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    const spec = ALLOWED[ext];
    if (!spec) {
        return { ok: false, error: "Tipo de archivo no permitido. Solo jpg, jpeg, png, txt o json." };
    }
    if (bytes.length === 0) {
        return { ok: false, error: "El archivo está vacío." };
    }
    if (bytes.length > SUPPORT_ATTACHMENT_MAX_BYTES) {
        return { ok: false, error: "El archivo supera el máximo de 5 MB." };
    }
    if (spec.image) {
        if (!isCleanImage(spec.image, bytes)) {
            return { ok: false, error: "El contenido del archivo no coincide con su extensión o tiene datos extra al final." };
        }
    } else {
        // txt/json: texto UTF-8 decodificable y sin NUL (rechaza binarios renombrados).
        let text: string;
        try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
            return { ok: false, error: "El archivo de texto no es UTF-8 válido." };
        }
        if (bytes.includes(0)) {
            return { ok: false, error: "El archivo de texto contiene bytes nulos." };
        }
        if (ext === "json") {
            try {
                JSON.parse(text.replace(/^\uFEFF/, ""));
            } catch {
                return { ok: false, error: "El archivo JSON no es válido." };
            }
        }
    }
    return { ok: true, ext, mime: spec.mime };
}

// Tope de píxeles al decodificar (anti decompression bomb): ~40 MP sobra para capturas.
const REENCODE_MAX_PIXELS = 40_000_000;

/**
 * AISEC-08 (defensa adicional): decodifica la imagen y la vuelve a codificar con
 * sharp. Lo que se guarda son sólo los píxeles: se descartan EXIF/XMP/ICC, chunks
 * de texto y cualquier payload incrustado. Aplica la orientación EXIF antes de
 * perderla. Si sharp no puede decodificarla, el archivo se rechaza.
 */
export async function reencodeImage(ext: string, bytes: Buffer): Promise<AttachmentValidation & { bytes?: Buffer }> {
    const kind = ALLOWED[ext.toLowerCase()]?.image;
    if (!kind) return { ok: true, bytes };
    const { default: sharp } = await import("sharp");
    let out: Buffer;
    try {
        const img = sharp(bytes, { failOn: "error", limitInputPixels: REENCODE_MAX_PIXELS }).rotate();
        out = kind === "png"
            ? await img.png({ compressionLevel: 9 }).toBuffer()
            : await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    } catch {
        return { ok: false, error: "La imagen está dañada o no se pudo procesar." };
    }
    if (out.length > SUPPORT_ATTACHMENT_MAX_BYTES) {
        return { ok: false, error: "El archivo supera el máximo de 5 MB." };
    }
    return { ok: true, bytes: out };
}

function mimeForExt(ext: string): string {
    return ALLOWED[ext.toLowerCase()]?.mime || "application/octet-stream";
}

/** Guarda el buffer como <prefijo-tenant>/<uuid>.<ext> y devuelve el stored_name. */
export async function saveAttachment(tenantId: string, bytes: Buffer, ext: string): Promise<string> {
    const storedName = tenantStoredName(tenantId, `${crypto.randomUUID()}.${ext}`);
    if (isBlobStorageEnabled()) {
        await uploadBlob(SUPPORT_ATTACHMENT_CONTAINER, storedName, bytes, mimeForExt(ext));
        return storedName;
    }
    const dir = getSupportUploadDir();
    await fs.mkdir(path.join(dir, tenantBlobPrefix(tenantId)), { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(dir, storedName), bytes, { mode: 0o600 });
    return storedName;
}

export async function readAttachment(tenantId: string, rawName: string): Promise<Buffer | null> {
    // stored_name viene de la DB (UUID generado por nosotros), pero igual se
    // valida el formato para que nunca pueda escapar del directorio/container
    // ni apuntar a la carpeta de otro tenant (AISEC-05).
    const storedName = resolveTenantStoredName(tenantId, rawName, STORED_NAME_RE);
    if (!storedName) return null;
    if (isBlobStorageEnabled()) {
        return downloadBlobOrNull(SUPPORT_ATTACHMENT_CONTAINER, storedName, "readAttachment");
    }
    try {
        return await fs.readFile(path.join(getSupportUploadDir(), storedName));
    } catch {
        return null;
    }
}

export async function deleteAttachmentFile(tenantId: string, rawName: string): Promise<void> {
    const storedName = resolveTenantStoredName(tenantId, rawName, STORED_NAME_RE);
    if (!storedName) return;
    if (isBlobStorageEnabled()) {
        try {
            await deleteBlob(SUPPORT_ATTACHMENT_CONTAINER, storedName);
        } catch {
            // Ya no existe o falló best-effort; la fila DB se borra igual.
        }
        return;
    }
    try {
        await fs.unlink(path.join(getSupportUploadDir(), storedName));
    } catch {
        // Ya no existe: la fila DB se borra igual (el cron es idempotente).
    }
}
