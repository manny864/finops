import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadPqFile } from "@/lib/export/downloadPqFile";

describe("downloadPqFile utility", () => {
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;

    beforeEach(() => {
        originalCreateObjectURL = URL.createObjectURL;
        originalRevokeObjectURL = URL.revokeObjectURL;
        URL.createObjectURL = vi.fn(() => "blob:http://localhost:3000/mock-blob");
        URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        vi.restoreAllMocks();
    });

    it("creates a blob and clicks a temporary link with .pq extension", () => {
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
        const appendChildSpy = vi.spyOn(document.body, "appendChild");
        const removeChildSpy = vi.spyOn(document.body, "removeChild");

        downloadPqFile("cost-overview", "let\n  Source = ...\nin\n  Source");

        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(appendChildSpy).toHaveBeenCalled();
        expect(removeChildSpy).toHaveBeenCalled();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost:3000/mock-blob");
    });

    it("appends .pq extension if not present in filename", () => {
        let lastDownloadedName = "";
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            lastDownloadedName = this.download;
        });

        downloadPqFile("sustainability", "let\n  Source = ...\nin\n  Source");
        expect(lastDownloadedName).toBe("sustainability.pq");

        downloadPqFile("budgets.pq", "let\n  Source = ...\nin\n  Source");
        expect(lastDownloadedName).toBe("budgets.pq");
    });
});
