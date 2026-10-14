import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { descargarArchivoConSesion } from "@/lib/downloadFile";

const fetchMock = vi.fn();

beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:pdf");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
    fetchMock.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("descargarArchivoConSesion", () => {
    // El bug: «Descargar PDF» hacía window.open(url), que no manda el Bearer de MSAL; la ruta contestaba 401 «No autorizado».
    it("pide el archivo con la sesión y lo baja con el nombre indicado", async () => {
        fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(["%PDF-"]) });
        let nombre = "";
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            nombre = this.download;
        });

        await descargarArchivoConSesion("/api/billing/invoices/7/pdf?tenantId=t", { Authorization: "Bearer abc" }, "CSCloudSolutions-txn_1.pdf");

        expect(fetchMock).toHaveBeenCalledWith("/api/billing/invoices/7/pdf?tenantId=t", { headers: { Authorization: "Bearer abc" } });
        expect(nombre).toBe("CSCloudSolutions-txn_1.pdf");
        expect(document.querySelector("a[download]")).toBeNull();
    });

    it("si la ruta falla, lanza con el mensaje de la ruta (no abre un JSON pelado)", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "No autorizado." }) });
        await expect(descargarArchivoConSesion("/x", {}, "a.pdf")).rejects.toThrow("No autorizado.");
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it("si el error no es JSON, usa el código HTTP", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error("no json"); } });
        await expect(descargarArchivoConSesion("/x", {}, "a.pdf")).rejects.toThrow("HTTP 502");
    });
});
