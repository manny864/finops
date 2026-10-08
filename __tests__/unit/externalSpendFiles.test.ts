// @vitest-environment node
/**
 * Fase 4 de IA (gasto externo): leer el original. null sólo cuando no existe;
 * un error del storage (red, DNS, permisos) se relanza, así el cron reintenta
 * y la descarga responde 503 en vez de dar el documento por perdido.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ blobEnabled: vi.fn(), download: vi.fn(), readFile: vi.fn() }));
vi.mock("@/lib/azureBlobStorage", () => ({
    isBlobStorageEnabled: m.blobEnabled, downloadBlob: m.download, uploadBlob: vi.fn(), deleteBlob: vi.fn(),
}));
vi.mock("fs", async (importActual) => {
    const actual = await importActual<typeof import("fs")>();
    return { ...actual, default: actual, promises: { ...actual.promises, readFile: m.readFile } };
});

import { EXTERNAL_SPEND_CONTAINER, readExternalSpendFile } from "@/lib/externalSpendFiles";

const NAME = "0b6f0c52-3c1e-4d4e-9a55-0b9d8f0e7a11.pdf";
const fsError = (code: string) => Object.assign(new Error(`${code}: falló`), { code });

beforeEach(() => {
    vi.clearAllMocks();
});

describe("readExternalSpendFile", () => {
    it("un nombre que no es <uuid>.<ext> no se lee", async () => {
        m.blobEnabled.mockReturnValue(false);
        await expect(readExternalSpendFile("../../etc/passwd")).resolves.toBeNull();
        expect(m.readFile).not.toHaveBeenCalled();
    });

    describe("en Blob Storage", () => {
        beforeEach(() => m.blobEnabled.mockReturnValue(true));

        it("devuelve el contenido, o null si el blob no existe (404)", async () => {
            m.download.mockResolvedValueOnce(Buffer.from("%PDF-1.7")).mockResolvedValueOnce(null);
            await expect(readExternalSpendFile(NAME)).resolves.toEqual(Buffer.from("%PDF-1.7"));
            await expect(readExternalSpendFile(NAME)).resolves.toBeNull();
            expect(m.download).toHaveBeenCalledWith(EXTERNAL_SPEND_CONTAINER, NAME);
        });

        it("un error del storage se relanza: no es que falte el original", async () => {
            m.download.mockRejectedValue(new Error("getaddrinfo ENOTFOUND cuenta.blob.core.windows.net"));
            await expect(readExternalSpendFile(NAME)).rejects.toThrow("ENOTFOUND");
        });
    });

    describe("en disco", () => {
        beforeEach(() => m.blobEnabled.mockReturnValue(false));

        it("null sólo si el archivo no existe (ENOENT)", async () => {
            m.readFile.mockRejectedValue(fsError("ENOENT"));
            await expect(readExternalSpendFile(NAME)).resolves.toBeNull();
        });

        it("otro error (permisos, disco) se relanza", async () => {
            m.readFile.mockRejectedValue(fsError("EACCES"));
            await expect(readExternalSpendFile(NAME)).rejects.toMatchObject({ code: "EACCES" });
        });
    });
});
