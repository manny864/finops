// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { accessMock, queryMock, downloadMock, AuthError } = vi.hoisted(() => {
    class AuthError extends Error {
        status: number;
        constructor(message: string, status = 401) { super(message); this.status = status; }
    }
    return { accessMock: vi.fn(), queryMock: vi.fn(), downloadMock: vi.fn(), AuthError };
});
vi.mock("@/lib/requestAuth", () => ({ requireTenantAccess: accessMock, AuthError }));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock } }));
vi.mock("@/lib/azureBlobStorage", () => ({
    isBlobStorageEnabled: () => true,
    downloadBlob: downloadMock,
    uploadBlob: vi.fn(),
    deleteBlob: vi.fn(),
}));

import { GET } from "@/app/api/support/attachments/[id]/route";
import { asciiFileName, attachmentDownloadHeaders, contentDisposition } from "@/lib/attachmentDownload";
import { tenantBlobPrefix } from "@/lib/tenantBlobPath";

const STORED = (ext: string) => `${tenantBlobPrefix("t1")}/123e4567-e89b-12d3-a456-426614174000.${ext}`;
let row: { original_name: string; stored_name: string; mime_type?: string };

beforeEach(() => {
    accessMock.mockReset().mockResolvedValue({ email: "ana@x.com" });
    row = { original_name: "captura.png", stored_name: STORED("png"), mime_type: "text/html" };
    queryMock.mockReset().mockImplementation(async () => [[row]]);
    downloadMock.mockReset().mockResolvedValue(Buffer.from("bytes"));
});

const get = () => GET(
    new NextRequest("http://localhost/api/support/attachments/5?tenantId=t1"),
    { params: Promise.resolve({ id: "5" }) },
);

describe("cabeceras de descarga (AISEC-09)", () => {
    it("manda las 6 cabeceras", () => {
        const h = attachmentDownloadHeaders("a.png", "image/png");
        expect(h).toEqual({
            "Content-Type": "image/png",
            "Content-Disposition": `attachment; filename="a.png"; filename*=UTF-8''a.png`,
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Cache-Control": "private, no-store",
        });
    });

    it("filename ASCII sin `.`/espacios iniciales ni comillas; filename* conserva el nombre UTF-8", () => {
        expect(asciiFileName("..  .htaccess")).toBe("htaccess");
        expect(asciiFileName("informe año ñ.txt")).toBe("informe ano n.txt");
        expect(asciiFileName("...")).toBe("adjunto");
        const cd = contentDisposition('a"b\r\nSet-Cookie: x=1;.png');
        expect(cd).not.toMatch(/[\r\n]/);
        expect(cd.split(";")[1]).toBe(' filename="a_bSet-Cookie_ x_1_.png"');
        expect(contentDisposition("reporte (año)'s.txt")).toContain(
            "filename*=UTF-8''reporte%20%28a%C3%B1o%29%27s.txt",
        );
    });
});

describe("GET /api/support/attachments/[id] (AISEC-09)", () => {
    it("toma el Content-Type de la extensión en disco, no de la BD", async () => {
        const res = await get();
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
        expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
        expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="captura\.png"; filename\*=UTF-8''captura\.png$/);
    });

    it("texto se sirve como text/plain con charset", async () => {
        row = { original_name: "log.txt", stored_name: STORED("txt") };
        const res = await get();
        expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    });

    it("Blob niega la lectura (escaneo pendiente o malware) → 409 con Retry-After", async () => {
        downloadMock.mockRejectedValue(Object.assign(new Error("AuthorizationPermissionMismatch"), { statusCode: 403 }));
        const res = await get();
        expect(res.status).toBe(409);
        expect(res.headers.get("retry-after")).toBe("60");
    });

    it("otro fallo de storage sigue siendo 410 (no disponible)", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        downloadMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
        expect((await get()).status).toBe(410);
        spy.mockRestore();
    });
});

describe("Terraform: Defender for Storage + lectura condicionada (AISEC-09)", () => {
    const leer = (p: string) => readFileSync(p, "utf8");
    const stamp = leer("infra/terraform/modules/stamp/main.tf");
    const storage = leer("infra/terraform/modules/storage/main.tf");
    const rootMain = leer("infra/terraform/environments/prod/main.tf");

    it("escaneo al subir con resultado en etiquetas de índice, por cuenta y con tope de costo", () => {
        const res = stamp.slice(stamp.indexOf('resource "azapi_resource" "storage_malware_scanning"'));
        expect(res).toContain('type      = "Microsoft.Security/defenderForStorageSettings@2025-06-01"');
        expect(res).toContain("parent_id = module.storage.id");
        expect(res).toMatch(/blobScanResultsOptions\s*=\s*"BlobIndexTags"/);
        expect(res).toMatch(/capGBPerMonth\s*=\s*var\.storage_malware_scan_cap_gb_per_month/);
        expect(res).toMatch(/excludeBlobsWithPrefix\s*=\s*\[[^\]]*"db-backups\/"/);
        expect(res).not.toMatch(/excludeBlobsWithPrefix\s*=\s*\[[^\]]*support-attachments/);
    });

    it("la condición ABAC se activa junto con el escaneo, y sólo para support-attachments", () => {
        expect(stamp).toMatch(/require_clean_scan_containers\s*=\s*var\.storage_malware_scanning_enabled \? \["support-attachments"\] : \[\]/);
        expect(storage).toMatch(/condition\s*=\s*local\.app_blob_read_condition/);
        expect(rootMain).toMatch(/storage_malware_scanning_enabled\s*=\s*var\.storage_malware_scanning_enabled/);
    });

    it("staging y prod lo activan (en los .tfvars.example versionados; terraform.tfvars está en .gitignore)", () => {
        for (const env of ["prod", "staging"]) {
            expect(leer(`infra/terraform/environments/${env}/terraform.tfvars.example`), env).toMatch(/^storage_malware_scanning_enabled\s*=\s*true/m);
        }
    });

    const hayTerraform = spawnSync("terraform", ["version"], { encoding: "utf8" }).error === undefined;
    it.skipIf(!hayTerraform)("la condición renderizada: sin containers es null; con uno exige 'No threats found'", () => {
        const start = storage.indexOf("locals {\n  clean_scan_container_clause");
        const locals = storage.slice(start, storage.indexOf("\n}\n", start) + 3);
        const evaluar = (containers: string[]) => {
            const dir = mkdtempSync(join(tmpdir(), "tf-aisec09-"));
            try {
                writeFileSync(join(dir, "main.tf"), `variable "require_clean_scan_containers" {\n  type = list(string)\n}\n${locals}`);
                const r = spawnSync("terraform", [`-chdir=${dir}`, "console"], {
                    encoding: "utf8",
                    input: "jsonencode(local.app_blob_read_condition)\n",
                    env: { ...process.env, TF_VAR_require_clean_scan_containers: JSON.stringify(containers) },
                });
                expect(r.status, r.stderr).toBe(0);
                return JSON.parse(JSON.parse(r.stdout.trim()));
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        };
        expect(evaluar([])).toBeNull();
        const cond: string = evaluar(["support-attachments"]);
        expect(cond).toContain("!(ActionMatches{'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'} AND NOT SubOperationMatches{'Blob.List'})");
        expect(cond).toContain("@Resource[Microsoft.Storage/storageAccounts/blobServices/containers:name] StringNotEquals 'support-attachments'");
        expect(cond).toContain("@Resource[Microsoft.Storage/storageAccounts/blobServices/containers/blobs/tags:Malware Scanning scan result<$key_case_sensitive$>] StringEquals 'No threats found'");
        expect(cond.match(/\(/g)?.length).toBe(cond.match(/\)/g)?.length);
    }, 30_000);
});
