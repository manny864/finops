import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { priceIdToTier, tierToPriceId, getPaddleEnvironment, getPaddleBaseUrl } from "@/lib/paddleTierMap";

describe("paddleTierMap", () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("priceIdToTier", () => {
    it("returns Professional for NEXT_PUBLIC_PADDLE_PRO_YEARLY", () => {
      process.env.NEXT_PUBLIC_PADDLE_PRO_YEARLY = "pri_456";
      expect(priceIdToTier("pri_456")).toBe("Professional");
    });

    it("returns Business for NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY", () => {
      process.env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY = "pri_789";
      expect(priceIdToTier("pri_789")).toBe("Business");
    });

    it("returns null for unknown price ID", () => {
      expect(priceIdToTier("unknown_id")).toBeNull();
    });

    it("handles multiple tiers with same month", () => {
      process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY = "pri_pro_m";
      process.env.NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY = "pri_bus_m";
      
      expect(priceIdToTier("pri_pro_m")).toBe("Professional");
      expect(priceIdToTier("pri_bus_m")).toBe("Business");
    });
  });

  describe("tierToPriceId", () => {
    it("returns price ID for Professional monthly", () => {
      process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY = "pri_pro_m";
      expect(tierToPriceId("Professional", "monthly")).toBe("pri_pro_m");
    });

    it("returns price ID for Professional yearly", () => {
      process.env.NEXT_PUBLIC_PADDLE_PRO_YEARLY = "pri_pro_y";
      expect(tierToPriceId("Professional", "yearly")).toBe("pri_pro_y");
    });

    it("returns null for Enterprise tier", () => {
      expect(tierToPriceId("Enterprise", "monthly")).toBeNull();
    });

    it("returns null when env var not set", () => {
      const empty: NodeJS.ProcessEnv = {};
      process.env = empty;
      expect(tierToPriceId("Essential", "monthly")).toBeNull();
    });

    it("round-trip conversion works", () => {
      process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY = "pri_pro_m";
      const priceId = tierToPriceId("Professional", "monthly");
      expect(priceId).toBe("pri_pro_m");
      expect(priceIdToTier(priceId!)).toBe("Professional");
    });
  });

  describe("getPaddleEnvironment", () => {
    it("returns sandbox when API key starts with pdl_sdbx_", () => {
      process.env.PADDLE_API_KEY = "pdl_sdbx_test123";
      expect(getPaddleEnvironment()).toBe("sandbox");
    });

    it("returns production when API key doesn't start with pdl_sdbx_", () => {
      process.env.PADDLE_API_KEY = "pdl_live_key123";
      expect(getPaddleEnvironment()).toBe("production");
    });

    it("returns sandbox when PADDLE_API_KEY not set", () => {
      delete process.env.PADDLE_API_KEY;
      expect(getPaddleEnvironment()).toBe("sandbox");
    });
  });

  describe("getPaddleBaseUrl", () => {
    it("returns sandbox URL for sandbox environment", () => {
      process.env.PADDLE_API_KEY = "pdl_sdbx_test";
      expect(getPaddleBaseUrl()).toBe("https://sandbox-api.paddle.com");
    });

    it("returns production URL for production environment", () => {
      process.env.PADDLE_API_KEY = "pdl_live_prod";
      expect(getPaddleBaseUrl()).toBe("https://api.paddle.com");
    });

    it("defaults to sandbox when no API key", () => {
      delete process.env.PADDLE_API_KEY;
      expect(getPaddleBaseUrl()).toBe("https://sandbox-api.paddle.com");
    });
  });
});

/**
 * Next.js sustituye `process.env.NEXT_PUBLIC_X` en tiempo de build, pero SÓLO
 * si la referencia es literal. Con clave dinámica (`process.env[key]`) o con el
 * objeto aliaseado (`const env = process.env; env.X`) no hay sustitución: en el
 * servidor la lectura va al env de runtime, donde estas cuatro variables no
 * existen — viven como variables de repositorio de GitHub y entran como build
 * args.
 *
 * Ese fue el bug del 2026-09-03: `/api/pricing/plans` respondía
 * `source: "catalog"` en producción y las rutas de checkout y cambio de plan se
 * quedaban sin price ID, mientras en el cliente todo andaba porque ahí el
 * acceso sí era estático.
 *
 * Los tests de arriba NO lo detectan: setean `process.env` y llaman, y las dos
 * formas funcionan igual en Node. La diferencia sólo aparece después del build,
 * en producción. Por eso este chequeo mira el código fuente.
 */
describe("paddleTierMap: los price IDs se leen con acceso estático", () => {
  // Sin comentarios: el archivo CITA las dos formas prohibidas para explicar
  // por qué lo son, y buscarlas sobre el texto crudo haría fallar el test por
  // su propia documentación.
  const src = readFileSync(join(__dirname, "..", "..", "src", "lib", "paddleTierMap.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("no usa process.env con clave dinámica", () => {
    expect(
      src.match(/process\.env\s*\[/g) || [],
      "process.env[clave] no se inlinea en build: en el servidor lee el env de runtime, donde los NEXT_PUBLIC_PADDLE_* no están"
    ).toEqual([]);
  });

  it("no aliasea process.env a una variable", () => {
    expect(
      src.match(/(?:const|let|var)\s+\w+\s*=\s*process\.env\s*[;\n]/g) || [],
      "aliasear process.env rompe la sustitución de build igual que la clave dinámica"
    ).toEqual([]);
  });

  it("las cuatro variables aparecen con acceso literal", () => {
    for (const v of [
      "NEXT_PUBLIC_PADDLE_PRO_MONTHLY",
      "NEXT_PUBLIC_PADDLE_PRO_YEARLY",
      "NEXT_PUBLIC_PADDLE_BUSINESS_MONTHLY",
      "NEXT_PUBLIC_PADDLE_BUSINESS_YEARLY",
    ]) {
      expect(src, `${v} tiene que leerse como process.env.${v}`).toContain(`process.env.${v}`);
    }
  });
});
