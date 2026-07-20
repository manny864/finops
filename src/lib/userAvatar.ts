/**
 * Almacenamiento del avatar personalizado de un usuario (foto de perfil).
 *
 * Solo se ofrece como alternativa cuando Microsoft Graph (Entra ID) no
 * devuelve foto para la cuenta (ver UserProfileMenu.tsx) — si el tenant ya
 * trae foto, esta no se usa ni se muestra.
 *
 * Mismo patrón que tenantLogo.ts: `<uuid>.<ext>` (nunca el nombre original)
 * en el container "user-avatars" de Azure Blob Storage si
 * AZURE_STORAGE_CONNECTION_STRING está configurado; si no, filesystem local
 * bajo USER_AVATAR_UPLOAD_DIR (default: ./data/user-avatars, volumen
 * Docker). Solo raster (png/jpg/jpeg/webp) — sin SVG, mismo motivo de
 * seguridad que tenantLogo.ts (se sirve inline desde nuestro propio origen).
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { isBlobStorageEnabled, uploadBlob, downloadBlob, deleteBlob } from "@/lib/azureBlobStorage";

export const USER_AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const USER_AVATAR_CONTAINER = process.env.AZURE_STORAGE_CONTAINER_AVATARS || "user-avatars";

const ALLOWED: Record<string, { mime: string; magic: number[][] }> = {
    png: { mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
    jpg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
    jpeg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
    webp: { mime: "image/webp", magic: [[0x52, 0x49, 0x46, 0x46]] }, // 'RIFF'
};

const STORED_NAME_RE = /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i;

export function getUserAvatarUploadDir(): string {
    return process.env.USER_AVATAR_UPLOAD_DIR || path.join(process.cwd(), "data", "user-avatars");
}

export interface AvatarValidation {
    ok: boolean;
    error?: string;
    ext?: string;
    mime?: string;
}

export function validateUserAvatar(fileName: string, bytes: Buffer): AvatarValidation {
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    const spec = ALLOWED[ext];
    if (!spec) {
        return { ok: false, error: "Formato no permitido. Solo PNG, JPG o WEBP." };
    }
    if (bytes.length === 0) {
        return { ok: false, error: "El archivo está vacío." };
    }
    if (bytes.length > USER_AVATAR_MAX_BYTES) {
        return { ok: false, error: "La imagen supera el máximo de 2 MB." };
    }
    const matches = spec.magic.some((sig) => sig.every((b, i) => bytes[i] === b));
    if (!matches) {
        return { ok: false, error: "El contenido del archivo no coincide con su extensión." };
    }
    return { ok: true, ext, mime: spec.mime };
}

export function mimeForExt(ext: string): string {
    const e = ext.toLowerCase().replace(/^\./, "");
    return ALLOWED[e]?.mime || "application/octet-stream";
}

export async function saveUserAvatar(bytes: Buffer, ext: string): Promise<string> {
    const storedName = `${crypto.randomUUID()}.${ext}`;
    if (isBlobStorageEnabled()) {
        await uploadBlob(USER_AVATAR_CONTAINER, storedName, bytes, mimeForExt(ext));
        return storedName;
    }
    const dir = getUserAvatarUploadDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, storedName), bytes, { mode: 0o644 });
    return storedName;
}

export async function readUserAvatar(storedName: string): Promise<Buffer | null> {
    if (!STORED_NAME_RE.test(storedName)) return null;
    if (isBlobStorageEnabled()) {
        return downloadBlob(USER_AVATAR_CONTAINER, storedName);
    }
    try {
        return await fs.readFile(path.join(getUserAvatarUploadDir(), storedName));
    } catch {
        return null;
    }
}

export async function deleteUserAvatarFile(storedName: string): Promise<void> {
    if (!STORED_NAME_RE.test(storedName)) return;
    if (isBlobStorageEnabled()) {
        try {
            await deleteBlob(USER_AVATAR_CONTAINER, storedName);
        } catch {
            // Ya no existe o falló best-effort; no-op.
        }
        return;
    }
    try {
        await fs.unlink(path.join(getUserAvatarUploadDir(), storedName));
    } catch {
        // Ya no existe; no-op.
    }
}
