import { describe, it, expect } from "vitest";
import { errorMessage, errorStatus, errorCode } from "@/lib/apiErrors";
import { AuthError } from "@/lib/requestAuth";

describe("apiErrors — narrowing de errores capturados", () => {
  it("errorMessage extrae el mensaje de las formas que se capturan en el repo", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(new AuthError("sin acceso", 403))).toBe("sin acceso");
    expect(errorMessage("string suelto")).toBe("string suelto");
    expect(errorMessage({ message: "objeto tipo error" })).toBe("objeto tipo error");
    expect(errorMessage(null)).toBe("Unknown error");
    expect(errorMessage(undefined, "fallback propio")).toBe("fallback propio");
    // message no-string no debe filtrarse como si lo fuera
    expect(errorMessage({ message: 42 })).toBe("Unknown error");
  });

  it("errorStatus lee status, statusCode y code numerico", () => {
    expect(errorStatus(new AuthError("no", 403))).toBe(403);
    expect(errorStatus({ statusCode: 429 })).toBe(429);
    expect(errorStatus({ code: "404" })).toBe(404);
    expect(errorStatus({ status: 500 })).toBe(500);
    expect(errorStatus(new Error("sin status"))).toBeUndefined();
    expect(errorStatus(null)).toBeUndefined();
  });

  it("errorStatus descarta valores fuera del rango HTTP para no romper NextResponse", () => {
    // errno de driver MySQL: devolverlo haria que NextResponse lance RangeError
    expect(errorStatus({ code: 1045 })).toBeUndefined();
    expect(errorStatus({ code: "ECONNREFUSED" })).toBeUndefined();
    expect(errorStatus({ status: 0 })).toBeUndefined();
    expect(errorStatus({ status: 999 })).toBeUndefined();
    // pero sigue prefiriendo un status valido aunque code sea basura
    expect(errorStatus({ status: 401, code: 1045 })).toBe(401);
  });

  it("errorCode devuelve solo codigos string", () => {
    expect(errorCode({ code: "ETIMEDOUT" })).toBe("ETIMEDOUT");
    expect(errorCode({ code: 500 })).toBeUndefined();
    expect(errorCode(new Error("x"))).toBeUndefined();
  });
});
