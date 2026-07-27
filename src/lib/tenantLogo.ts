/**
 * Almacenamiento del logo de marca de un tenant (branding del header).
 *
 * Se guarda como `<uuid>.<ext>` (nunca con el nombre original) en el
 * container "tenant-logos" de Azure Blob Storage (ver
 * src/lib/azureBlobStorage.ts) si AZURE_STORAGE_CONNECTION_STRING está
 * configurado; si no, cae a filesystem local bajo TENANT_LOGO_UPLOAD_DIR
 * (default: ./data/tenant-logos, montado como volumen en Docker) — mismo
 * patrón híbrido que el resto del código (Key Vault -> env, etc.), para no
 * requerir un Storage Account real en cada entorno de desarrollo.
 *
 * Solo raster (png/jpg/jpeg/webp) — deliberadamente SIN soporte de SVG: un
 * SVG puede embeber <script>, y como el logo se sirve inline desde nuestro
 * propio origen (para poder usarlo directo en un <img src>), un SVG
 * malicioso subido por un Admin comprometido de un tenant se ejecutaría en
 * el contexto de nuestro dominio.
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { isBlobStorageEnabled, uploadBlob, downloadBlob, deleteBlob } from "@/lib/azureBlobStorage";
import { validateRasterImage, RASTER_STORED_NAME_RE, mimeForExt, type RasterImageValidation } from "@/lib/rasterImageValidation";

export const TENANT_LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const TENANT_LOGO_CONTAINER = process.env.AZURE_STORAGE_CONTAINER_LOGOS || "tenant-logos";

const STORED_NAME_RE = RASTER_STORED_NAME_RE;

export function getTenantLogoUploadDir(): string {
    return process.env.TENANT_LOGO_UPLOAD_DIR || path.join(process.cwd(), "data", "tenant-logos");
}

export type LogoValidation = RasterImageValidation;

export function validateTenantLogo(fileName: string, bytes: Buffer): LogoValidation {
    return validateRasterImage(fileName, bytes, TENANT_LOGO_MAX_BYTES);
}

export async function saveTenantLogo(bytes: Buffer, ext: string): Promise<string> {
    const storedName = `${crypto.randomUUID()}.${ext}`;
    if (isBlobStorageEnabled()) {
        await uploadBlob(TENANT_LOGO_CONTAINER, storedName, bytes, mimeForExt(ext));
        return storedName;
    }
    const dir = getTenantLogoUploadDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, storedName), bytes, { mode: 0o644 });
    return storedName;
}

export async function readTenantLogo(storedName: string): Promise<Buffer | null> {
    if (!STORED_NAME_RE.test(storedName)) return null;
    if (isBlobStorageEnabled()) {
        return downloadBlob(TENANT_LOGO_CONTAINER, storedName);
    }
    try {
        return await fs.readFile(path.join(getTenantLogoUploadDir(), storedName));
    } catch {
        return null;
    }
}

export async function deleteTenantLogoFile(storedName: string): Promise<void> {
    if (!STORED_NAME_RE.test(storedName)) return;
    if (isBlobStorageEnabled()) {
        try {
            await deleteBlob(TENANT_LOGO_CONTAINER, storedName);
        } catch {
            // Ya no existe o falló best-effort; no-op.
        }
        return;
    }
    try {
        await fs.unlink(path.join(getTenantLogoUploadDir(), storedName));
    } catch {
        // Ya no existe; no-op.
    }
}

export { mimeForExt };
