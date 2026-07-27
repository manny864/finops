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
import { validateRasterImage, RASTER_STORED_NAME_RE, mimeForExt, type RasterImageValidation } from "@/lib/rasterImageValidation";

export const USER_AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const USER_AVATAR_CONTAINER = process.env.AZURE_STORAGE_CONTAINER_AVATARS || "user-avatars";

const STORED_NAME_RE = RASTER_STORED_NAME_RE;

export function getUserAvatarUploadDir(): string {
    return process.env.USER_AVATAR_UPLOAD_DIR || path.join(process.cwd(), "data", "user-avatars");
}

export type AvatarValidation = RasterImageValidation;

export function validateUserAvatar(fileName: string, bytes: Buffer): AvatarValidation {
    return validateRasterImage(fileName, bytes, USER_AVATAR_MAX_BYTES);
}

export { mimeForExt };

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
