/**
 * Almacenamiento local de adjuntos del sistema de soporte.
 *
 * - Tipos permitidos: jpg/jpeg/png (validados por magic bytes), txt y json.
 * - Tamaño máximo: 5 MB por archivo. Máximo 10 adjuntos por ticket.
 * - Los archivos se guardan como `<uuid>.<ext>` bajo SUPPORT_UPLOAD_DIR
 *   (default: ./data/support-attachments, montado como volumen en Docker) —
 *   nunca con el nombre original (evita path traversal / colisiones).
 * - Retención: 60 días. Limpieza vía cron + oportunista en cada upload.
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const SUPPORT_ATTACHMENT_MAX_PER_TICKET = 10;
export const SUPPORT_ATTACHMENT_RETENTION_DAYS = 60;

const ALLOWED: Record<string, { mime: string; magic?: number[][] }> = {
    jpg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
    jpeg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
    png: { mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
    txt: { mime: "text/plain" },
    json: { mime: "application/json" },
};

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

/** Guarda el buffer como <uuid>.<ext> y devuelve el stored_name. */
export async function saveAttachment(bytes: Buffer, ext: string): Promise<string> {
    const dir = getSupportUploadDir();
    await fs.mkdir(dir, { recursive: true });
    const storedName = `${crypto.randomUUID()}.${ext}`;
    await fs.writeFile(path.join(dir, storedName), bytes, { mode: 0o600 });
    return storedName;
}

export async function readAttachment(storedName: string): Promise<Buffer | null> {
    // stored_name viene de la DB (UUID generado por nosotros), pero igual se
    // valida el formato para que nunca pueda escapar del directorio.
    if (!/^[0-9a-f-]{36}\.(jpg|jpeg|png|txt|json)$/i.test(storedName)) return null;
    try {
        return await fs.readFile(path.join(getSupportUploadDir(), storedName));
    } catch {
        return null;
    }
}

export async function deleteAttachmentFile(storedName: string): Promise<void> {
    if (!/^[0-9a-f-]{36}\.(jpg|jpeg|png|txt|json)$/i.test(storedName)) return;
    try {
        await fs.unlink(path.join(getSupportUploadDir(), storedName));
    } catch {
        // Ya no existe: la fila DB se borra igual (el cron es idempotente).
    }
}
