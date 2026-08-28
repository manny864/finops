// @vitest-environment node
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Regresión: `GET /api/tenant-logo/...` devolvía 500 en CADA carga de página.
 *
 * Causa: `downloadBlob` sólo tolera 404 y relanza todo lo demás (correcto — la
 * ingesta de costos no debe confundir "storage caído" con "sin datos"). Pero
 * los lectores de assets opcionales declaran `Promise<Buffer | null>` y ya
 * tragaban los errores de filesystem: la rama de blob rompía ese contrato, así
 * que un storage account que no resolvía por DNS
 * (`getaddrinfo ENOTFOUND cscsfinopsimgbk.blob.core.windows.net`) escapaba
 * hasta la ruta, que no tenía try/catch.
 */

const mocks = vi.hoisted(() => ({
    downloadToBuffer: vi.fn(),
    createIfNotExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@azure/storage-blob", () => ({
    BlobServiceClient: {
        fromConnectionString: () => ({
            getContainerClient: () => ({
                createIfNotExists: mocks.createIfNotExists,
                getBlockBlobClient: () => ({ downloadToBuffer: mocks.downloadToBuffer }),
            }),
        }),
    },
    ContainerClient: class {},
}));

const CONN = "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y;EndpointSuffix=core.windows.net";
const VALID_STORED_NAME = "1db9c9b0-b40d-41f7-a3b7-3a42fdc1daf0.png";

describe("assets opcionales en blob storage", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        process.env.AZURE_STORAGE_CONNECTION_STRING = CONN;
    });

    afterEach(() => {
        delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    });

    it("downloadBlob relanza un fallo de infraestructura (contrato para la ingesta de costos)", async () => {
        const { downloadBlob } = await import("@/lib/azureBlobStorage");
        mocks.downloadToBuffer.mockRejectedValue(
            new Error("getaddrinfo ENOTFOUND cscsfinopsimgbk.blob.core.windows.net")
        );

        await expect(downloadBlob("tenant-logos", VALID_STORED_NAME)).rejects.toThrow(/ENOTFOUND/);
    });

    it("downloadBlobOrNull devuelve null ante el mismo fallo, sin lanzar", async () => {
        const { downloadBlobOrNull } = await import("@/lib/azureBlobStorage");
        mocks.downloadToBuffer.mockRejectedValue(
            new Error("getaddrinfo ENOTFOUND cscsfinopsimgbk.blob.core.windows.net")
        );
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(downloadBlobOrNull("tenant-logos", VALID_STORED_NAME, "test")).resolves.toBeNull();
        // No debe fallar en silencio: una mala configuración tiene que dejar rastro.
        expect(spy).toHaveBeenCalledOnce();
        spy.mockRestore();
    });

    it("downloadBlobOrNull devuelve los bytes cuando el blob existe", async () => {
        const { downloadBlobOrNull } = await import("@/lib/azureBlobStorage");
        mocks.downloadToBuffer.mockResolvedValue(Buffer.from("PNGDATA"));

        const out = await downloadBlobOrNull("tenant-logos", VALID_STORED_NAME, "test");
        expect(out?.toString()).toBe("PNGDATA");
    });

    // El punto del arreglo: los tres lectores de assets opcionales honran
    // `Promise<Buffer | null>` también en la rama de blob.
    it.each([
        ["readTenantLogo", () => import("@/lib/tenantLogo").then((m) => m.readTenantLogo)],
        ["readUserAvatar", () => import("@/lib/userAvatar").then((m) => m.readUserAvatar)],
        ["readAttachment", () => import("@/lib/supportAttachments").then((m) => m.readAttachment)],
    ] as const)("%s devuelve null en vez de lanzar si el storage no responde", async (_name, load) => {
        const read = await load();
        mocks.downloadToBuffer.mockRejectedValue(
            new Error("getaddrinfo ENOTFOUND cscsfinopsimgbk.blob.core.windows.net")
        );
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(read(VALID_STORED_NAME)).resolves.toBeNull();

        spy.mockRestore();
    });
});
