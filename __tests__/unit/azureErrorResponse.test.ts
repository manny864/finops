import { describe, it, expect, vi } from "vitest";
import { azureErrorResponse, azureErrorText } from "@/lib/apiErrors";

// Los errores de Azure se loguean server-side; no ensuciar la salida del test.
vi.spyOn(console, "error").mockImplementation(() => {});

/** RestError del SDK de Azure tal como llega en un catch. */
function restError(statusCode: number, code: string, message: string) {
    const e: any = new Error(`${code}: ${message}`);
    e.statusCode = statusCode;
    e.code = code;
    e.details = { error: { code, message } };
    return e;
}

describe("azureErrorResponse", () => {
    it("devuelve el motivo real de Azure en un 4xx, no un 500 opaco", async () => {
        const res = azureErrorResponse(
            restError(409, "OperationNotAllowed", "The VM size Standard_D2s_v3 is not available in the current cluster."),
            "test",
        );
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toContain("Standard_D2s_v3");
        expect(body.code).toBe("OperationNotAllowed");
    });

    it("mantiene el contrato MISSING_CONTRIBUTOR_ROLE del 403 que ya consume la UI", async () => {
        const res = azureErrorResponse(restError(403, "AuthorizationFailed", "does not have authorization"), "test");
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe("MISSING_CONTRIBUTOR_ROLE");
    });

    it("un 5xx o un error propio sigue siendo genérico, sin filtrar internals", async () => {
        const res = azureErrorResponse(new Error("connect ECONNREFUSED 10.0.0.1:3306"), "test");
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe("Internal server error");
    });

    it("prefiere details.error.message al message serializado del SDK", () => {
        const e = restError(400, "InvalidParameter", "The value of parameter vmSize is invalid.");
        expect(azureErrorText(e)).toBe("The value of parameter vmSize is invalid.");
    });
});
