/**
 * Originales de gasto externo (facturas y contratos), con el mismo enfoque que
 * los adjuntos de soporte (`supportAttachments.ts`):
 *
 * - Tipos: PDF, JPEG, PNG y TIFF, los que analiza Document Intelligence,
 *   reconocidos por magic bytes. Nunca se confía en el Content-Type ni en la
 *   extensión que manda el cliente.
 * - Hasta 10 MB por archivo.
 * - Se guardan como `<uuid>.<ext>` en el container privado
 *   AZURE_STORAGE_CONTAINER_EXTERNAL_SPEND (default
 *   "external-spend-documents") si hay Blob Storage; si no, en disco bajo
 *   EXTERNAL_SPEND_UPLOAD_DIR (default ./data/external-spend).
 * - Retención del original: 365 días. Después lo borra el cron de gasto
 *   externo y queda lo extraído y lo revisado.
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { isBlobStorageEnabled, uploadBlob, downloadBlobOrNull, deleteBlob } from "@/lib/azureBlobStorage";
import { EXTERNAL_SPEND_MAX_BYTES } from "@/types/externalSpend.types";

export const EXTERNAL_SPEND_RETENTION_DAYS = 365;
export const EXTERNAL_SPEND_CONTAINER = process.env.AZURE_STORAGE_CONTAINER_EXTERNAL_SPEND || "external-spend-documents";

const TYPES = [
    { ext: "pdf", mime: "application/pdf", magic: [[0x25, 0x50, 0x44, 0x46]] },
    { ext: "jpg", mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
    { ext: "png", mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
    { ext: "tiff", mime: "image/tiff", magic: [[0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a]] },
];

const STORED_NAME_RE = /^[0-9a-f-]{36}\.(pdf|jpg|png|tiff)$/;

export type ExternalSpendFileCheck =
    | { ok: true; ext: string; mime: string }
    | { ok: false; reason: "empty_file" | "file_too_large" | "file_type" };

export function checkExternalSpendFile(bytes: Buffer): ExternalSpendFileCheck {
    if (bytes.length === 0) return { ok: false, reason: "empty_file" };
    if (bytes.length > EXTERNAL_SPEND_MAX_BYTES) return { ok: false, reason: "file_too_large" };
    const type = TYPES.find((t) => t.magic.some((sig) => sig.every((b, i) => bytes[i] === b)));
    return type ? { ok: true, ext: type.ext, mime: type.mime } : { ok: false, reason: "file_type" };
}

export const mimeForStoredName = (storedName: string): string =>
    TYPES.find((t) => storedName.endsWith(`.${t.ext}`))?.mime || "application/octet-stream";

function uploadDir(): string {
    return process.env.EXTERNAL_SPEND_UPLOAD_DIR || path.join(process.cwd(), "data", "external-spend");
}

/** Guarda el original como `<uuid>.<ext>` y devuelve ese nombre. */
export async function saveExternalSpendFile(bytes: Buffer, ext: string): Promise<string> {
    const storedName = `${crypto.randomUUID()}.${ext}`;
    if (isBlobStorageEnabled()) {
        await uploadBlob(EXTERNAL_SPEND_CONTAINER, storedName, bytes, mimeForStoredName(storedName));
        return storedName;
    }
    await fs.mkdir(uploadDir(), { recursive: true });
    await fs.writeFile(path.join(uploadDir(), storedName), bytes, { mode: 0o600 });
    return storedName;
}

export async function readExternalSpendFile(storedName: string): Promise<Buffer | null> {
    // El nombre viene de la base, pero igual se valida: nunca sale del container ni del directorio.
    if (!STORED_NAME_RE.test(storedName)) return null;
    if (isBlobStorageEnabled()) return downloadBlobOrNull(EXTERNAL_SPEND_CONTAINER, storedName, "readExternalSpendFile");
    try {
        return await fs.readFile(path.join(uploadDir(), storedName));
    } catch {
        return null;
    }
}

export async function deleteExternalSpendFile(storedName: string): Promise<void> {
    if (!STORED_NAME_RE.test(storedName)) return;
    try {
        if (isBlobStorageEnabled()) await deleteBlob(EXTERNAL_SPEND_CONTAINER, storedName);
        else await fs.unlink(path.join(uploadDir(), storedName));
    } catch {
        // Ya no existe: la fila se actualiza igual.
    }
}
