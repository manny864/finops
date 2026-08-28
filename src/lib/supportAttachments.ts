/**
 * Almacenamiento de adjuntos del sistema de soporte.
 *
 * - Tipos permitidos: jpg/jpeg/png (validados por magic bytes), txt y json.
 * - Tamaño máximo: 5 MB por archivo. Máximo 10 adjuntos por ticket.
 * - Los archivos se guardan como `<uuid>.<ext>` (nunca con el nombre
 *   original, evita path traversal / colisiones) en el container
 *   "support-attachments" de Azure Blob Storage (ver
 *   src/lib/azureBlobStorage.ts) si AZURE_STORAGE_CONNECTION_STRING está
 *   configurado; si no, cae a filesystem local bajo SUPPORT_UPLOAD_DIR
 *   (default: ./data/support-attachments, montado como volumen en Docker).
 * - Retención: 60 días. Limpieza vía cron + oportunista en cada upload.
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { isBlobStorageEnabled, uploadBlob, downloadBlobOrNull, deleteBlob } from "@/lib/azureBlobStorage";

export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const SUPPORT_ATTACHMENT_MAX_PER_TICKET = 10;
export const SUPPORT_ATTACHMENT_RETENTION_DAYS = 60;
export const SUPPORT_ATTACHMENT_CONTAINER = process.env.AZURE_STORAGE_CONTAINER_SUPPORT_ATTACHMENTS || "support-attachments";

const ALLOWED: Record<string, { mime: string; magic?: number[][] }> = {
    jpg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
    jpeg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
    png: { mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
    txt: { mime: "text/plain" },
    json: { mime: "application/json" },
};

const STORED_NAME_RE = /^[0-9a-f-]{36}\.(jpg|jpeg|png|txt|json)$/i;

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
 * Valida extensión, tamaño y contenido (magic bytes para imágenes; UTF-8
 * decodificable para txt/json). Devuelve el mime canónico a persistir —
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
    if (spec.magic) {
        const matches = spec.magic.some((sig) => sig.every((b, i) => bytes[i] === b));
        if (!matches) {
            return { ok: false, error: "El contenido del archivo no coincide con su extensión." };
        }
    } else {
        // txt/json: debe ser texto UTF-8 decodificable (rechaza binarios renombrados).
        try {
            new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
            return { ok: false, error: "El archivo de texto no es UTF-8 válido." };
        }
    }
    return { ok: true, ext, mime: spec.mime };
}

function mimeForExt(ext: string): string {
    return ALLOWED[ext.toLowerCase()]?.mime || "application/octet-stream";
}

/** Guarda el buffer como <uuid>.<ext> y devuelve el stored_name. */
export async function saveAttachment(bytes: Buffer, ext: string): Promise<string> {
    const storedName = `${crypto.randomUUID()}.${ext}`;
    if (isBlobStorageEnabled()) {
        await uploadBlob(SUPPORT_ATTACHMENT_CONTAINER, storedName, bytes, mimeForExt(ext));
        return storedName;
    }
    const dir = getSupportUploadDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, storedName), bytes, { mode: 0o600 });
    return storedName;
}

export async function readAttachment(storedName: string): Promise<Buffer | null> {
    // stored_name viene de la DB (UUID generado por nosotros), pero igual se
    // valida el formato para que nunca pueda escapar del directorio/container.
    if (!STORED_NAME_RE.test(storedName)) return null;
    if (isBlobStorageEnabled()) {
        return downloadBlobOrNull(SUPPORT_ATTACHMENT_CONTAINER, storedName, "readAttachment");
    }
    try {
        return await fs.readFile(path.join(getSupportUploadDir(), storedName));
    } catch {
        return null;
    }
}

export async function deleteAttachmentFile(storedName: string): Promise<void> {
    if (!STORED_NAME_RE.test(storedName)) return;
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
