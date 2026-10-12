import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADDON_CATALOG } from "../../src/lib/addonCatalog";
import { API_SANDBOX, crearEnSandbox, main, planificar, validarClave, type ProductoPlan } from "../../scripts/paddle-sandbox-crear-catalogo";

/**
 * scripts/paddle-sandbox-crear-catalogo.ts crea en el sandbox de Paddle lo que le falta a staging (D5). Estos tests cuidan lo
 * que no se nota hasta que cuesta: que los nombres de variable sean exactamente los del JSON de prod (si no, la app lee un
 * precio y el JSON dice otro), que MONTHLY/YEARLY sean recurrentes y 1M..9M pago único (un precio mal tipado cobra mal), que
 * una clave que no es de sandbox no llegue nunca a la red, y que la clave no aparezca en ninguna salida.
 */
const RAIZ = process.cwd();
const prod: Record<string, string> = JSON.parse(readFileSync(join(RAIZ, "infra/terraform/environments/prod/paddle-price-ids.json"), "utf8"));
const idAClave = new Map(Object.entries(prod).map(([k, v]) => [v, k]));
const catalogo = ADDON_CATALOG as any;
const CLAVE = "pdl_sdbx_apikey_clave-de-prueba-que-no-debe-salir";

const de = (familias: string[]) => Object.fromEntries(Object.entries(prod).filter(([k]) => familias.some((f) => k.startsWith(`PADDLE_PRICE_${f}_`))));

describe("planificar", () => {
  it("sin nada creado: 24 productos y 144 precios con exactamente los nombres de variable de prod", () => {
    const plan = planificar(catalogo, idAClave, {}, {}).filter((p) => p.destino === "catalogo");
    const variables = plan.flatMap((p) => p.precios.map((x) => x.variable));
    expect(plan).toHaveLength(24);
    expect(variables.sort()).toEqual(Object.keys(prod).sort());
  });

  it("MONTHLY y YEARLY son recurrentes, 1M a 9M son pago único, y los montos salen del catálogo en la unidad menor", () => {
    const plan = planificar(catalogo, idAClave, {}, {});
    const precios = Object.fromEntries(plan.flatMap((p) => p.precios).map((x) => [x.variable, x]));
    expect(precios.PADDLE_PRICE_MONITORING_MONTHLY).toMatchObject({ centavos: 12900, ciclo: { interval: "month", frequency: 1 }, moneda: "USD" });
    expect(precios.PADDLE_PRICE_MONITORING_1M).toMatchObject({ centavos: 12900, ciclo: null });
    expect(precios.PADDLE_PRICE_MONITORING_3M).toMatchObject({ centavos: 34100, ciclo: null });
    expect(precios.PADDLE_PRICE_MONITORING_9M).toMatchObject({ centavos: 87100, ciclo: null });
    expect(precios.PADDLE_PRICE_MONITORING_YEARLY).toMatchObject({ centavos: 109900, ciclo: { interval: "year", frequency: 1 } });
  });

  it("con cuatro familias ya creadas faltan 20 productos del catálogo y el Tenant Adicional: 122 precios", () => {
    const yaCreadas = de(["MONITORING", "GOVREPORTING", "POLICIES", "ANALYTICS"]);
    const plan = planificar(catalogo, idAClave, yaCreadas, {});
    expect(plan).toHaveLength(21);
    expect(plan.reduce((n, p) => n + p.precios.length, 0)).toBe(122);
    expect(plan.map((p) => p.nombre)).not.toContain("FINOPS - Monitoreo");
  });

  it("una familia a medias sólo pide los períodos que faltan", () => {
    const plan = planificar(catalogo, idAClave, { PADDLE_PRICE_MONITORING_MONTHLY: "pri_x" }, {}).find((p) => p.nombre === "FINOPS - Monitoreo");
    expect(plan?.precios.map((x) => x.variable)).toEqual(["PADDLE_PRICE_MONITORING_1M", "PADDLE_PRICE_MONITORING_3M", "PADDLE_PRICE_MONITORING_6M", "PADDLE_PRICE_MONITORING_9M", "PADDLE_PRICE_MONITORING_YEARLY"]);
  });

  it("el Tenant Adicional va a capacidad: un precio mensual por tier, con el monto de pricing.ts", () => {
    const tenant = planificar(catalogo, idAClave, prod, {}).filter((p) => p.destino === "capacidad");
    expect(tenant).toHaveLength(1);
    expect(tenant[0].precios.map((x) => [x.variable, x.centavos, x.ciclo])).toEqual([
      ["PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL", 9000, { interval: "month", frequency: 1 }],
      ["PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS", 24000, { interval: "month", frequency: 1 }],
    ]);
    expect(planificar(catalogo, idAClave, prod, { PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL: "a", PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS: "b" })).toHaveLength(0);
  });
});

describe("validarClave: este script nunca toca el Paddle en vivo", () => {
  it("rechaza una clave ausente o que no es de sandbox, sin repetirla en el error", () => {
    expect(() => validarClave(undefined)).toThrow(/PADDLE_SANDBOX_API_KEY/);
    const viva = "pdl_live_apikey_secreta-que-no-se-debe-mostrar";
    expect(() => validarClave(viva)).toThrow(/sandbox/);
    try {
      validarClave(viva);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(viva);
    }
  });

  it("acepta una clave de sandbox", () => {
    expect(validarClave(CLAVE)).toBe(CLAVE);
  });
});

/** Un Paddle falso: lleva la cuenta de lo que se le pide y devuelve IDs con la forma real. */
function paddleFalso(opciones: { productos?: Array<{ id: string; name: string }>; fallos429?: number; falla400?: boolean } = {}) {
  const llamadas: Array<{ metodo: string; url: string; headers: Record<string, string>; cuerpo?: any }> = [];
  let contador = 0;
  let pendientes429 = opciones.fallos429 ?? 0;
  const id = (prefijo: string) => `${prefijo}_${String(++contador).padStart(26, "0")}`;
  const fetch = vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const cuerpo = init.body ? JSON.parse(init.body) : undefined;
    llamadas.push({ metodo: init.method, url, headers: init.headers, cuerpo });
    const resp = (status: number, json: unknown, headers: Record<string, string> = {}) => ({ status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, json: async () => json });
    if (init.method === "GET") return resp(200, { data: opciones.productos ?? [], meta: { pagination: { has_more: false } } });
    if (url.endsWith("/prices") && pendientes429 > 0) {
      pendientes429--;
      return resp(429, {}, { "retry-after": "0" });
    }
    if (url.endsWith("/prices") && opciones.falla400) return resp(400, { error: { code: "invalid_field", detail: "tax category no habilitada" } });
    return resp(201, { data: { id: url.endsWith("/products") ? id("pro") : id("pri") } });
  });
  return { fetch, llamadas };
}

const productoPrueba: ProductoPlan = {
  clave: "mod_prueba",
  nombre: "FINOPS - Prueba",
  descripcion: "Módulo de prueba",
  destino: "catalogo",
  precios: [
    { variable: "PADDLE_PRICE_PRUEBA_MONTHLY", nombre: "Mensual", descripcion: "Prueba Mensual", centavos: 12900, moneda: "USD", ciclo: { interval: "month", frequency: 1 } },
    { variable: "PADDLE_PRICE_PRUEBA_1M", nombre: "1 mes (pago único)", descripcion: "Prueba 1M", centavos: 12900, moneda: "USD", ciclo: null },
  ],
};

describe("crearEnSandbox", () => {
  const dormir = async () => {};

  it("sólo habla con el sandbox, con la clave en el encabezado, y manda cada precio con su tipo y su monto como texto", async () => {
    const falso = paddleFalso();
    const guardados: Array<[string, string]> = [];
    const salida: string[] = [];
    await crearEnSandbox([productoPrueba], { fetch: falso.fetch, apiKey: CLAVE, dormir, log: (l) => salida.push(l), alCrearPrecio: (_p, precio, id) => guardados.push([precio.variable, id]) });

    expect(API_SANDBOX).toBe("https://sandbox-api.paddle.com");
    expect(falso.llamadas.every((c) => c.url.startsWith("https://sandbox-api.paddle.com/"))).toBe(true);
    expect(falso.llamadas.every((c) => c.headers.Authorization === `Bearer ${CLAVE}` && c.headers["Paddle-Version"] === "1")).toBe(true);
    const producto = falso.llamadas.find((c) => c.metodo === "POST" && c.url.endsWith("/products"));
    expect(producto?.cuerpo).toMatchObject({ name: "FINOPS - Prueba", tax_category: "saas", type: "standard" });
    const precios = falso.llamadas.filter((c) => c.url.endsWith("/prices")).map((c) => c.cuerpo);
    expect(precios[0]).toMatchObject({ unit_price: { amount: "12900", currency_code: "USD" }, billing_cycle: { interval: "month", frequency: 1 } });
    expect(precios[1]).toMatchObject({ unit_price: { amount: "12900", currency_code: "USD" }, billing_cycle: null });
    expect(precios.every((p) => /^pro_[0-9]{26}$/.test(p.product_id))).toBe(true);
    expect(guardados.map(([v]) => v)).toEqual(["PADDLE_PRICE_PRUEBA_MONTHLY", "PADDLE_PRICE_PRUEBA_1M"]);
    expect(guardados.every(([, id]) => /^pri_[a-z0-9]{26}$/.test(id))).toBe(true);
    expect(salida.join("\n")).not.toContain(CLAVE);
  });

  it("reutiliza un producto que ya existe con ese nombre en vez de duplicarlo", async () => {
    const falso = paddleFalso({ productos: [{ id: "pro_00000000000000000000000001", name: "FINOPS - Prueba" }] });
    await crearEnSandbox([productoPrueba], { fetch: falso.fetch, apiKey: CLAVE, dormir, alCrearPrecio: () => {} });
    expect(falso.llamadas.some((c) => c.metodo === "POST" && c.url.endsWith("/products"))).toBe(false);
    expect(falso.llamadas.filter((c) => c.url.endsWith("/prices")).every((c) => c.cuerpo.product_id === "pro_00000000000000000000000001")).toBe(true);
  });

  it("ante un 429 espera el Retry-After y reintenta, sin duplicar el precio", async () => {
    const falso = paddleFalso({ fallos429: 2 });
    const guardados: string[] = [];
    await crearEnSandbox([productoPrueba], { fetch: falso.fetch, apiKey: CLAVE, dormir, alCrearPrecio: (_p, precio) => guardados.push(precio.variable) });
    expect(guardados).toEqual(["PADDLE_PRICE_PRUEBA_MONTHLY", "PADDLE_PRICE_PRUEBA_1M"]);
  });

  it("un error de Paddle corta con su código y detalle, sin la clave", async () => {
    const falso = paddleFalso({ falla400: true });
    const intento = crearEnSandbox([productoPrueba], { fetch: falso.fetch, apiKey: CLAVE, dormir, alCrearPrecio: () => {} });
    await expect(intento).rejects.toThrow(/invalid_field.*tax category no habilitada/);
    await intento.catch((e) => expect(String(e.message)).not.toContain(CLAVE));
  });
});

describe("main", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });

  function raizTemporal(): string {
    const raiz = mkdtempSync(join(tmpdir(), "paddle-sandbox-test-"));
    dirs.push(raiz);
    mkdirSync(join(raiz, "infra/terraform/environments/prod"), { recursive: true });
    mkdirSync(join(raiz, "infra/terraform/environments/staging"), { recursive: true });
    cpSync(join(RAIZ, "infra/terraform/environments/prod/paddle-price-ids.json"), join(raiz, "infra/terraform/environments/prod/paddle-price-ids.json"));
    writeFileSync(join(raiz, "infra/terraform/environments/staging/paddle-price-ids.json"), JSON.stringify(de(["MONITORING"]), null, 2));
    return raiz;
  }

  it("el simulacro no pide clave ni llama a la red, y no imprime nada secreto", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const falso = paddleFalso();
    expect(await main([], {}, raizTemporal(), falso.fetch)).toBe(0);
    expect(falso.fetch).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toMatch(/Simulacro/);
  });

  it("--apply con una clave en vivo se detiene antes de la red", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const falso = paddleFalso();
    await expect(main(["--apply"], { PADDLE_SANDBOX_API_KEY: "pdl_live_apikey_x" }, raizTemporal(), falso.fetch)).rejects.toThrow(/sandbox/);
    expect(falso.fetch).not.toHaveBeenCalled();
  });

  it("variables PADDLE_PRICE_* en el entorno frenan el script: taparían los IDs del catálogo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main([], { PADDLE_PRICE_X_MONTHLY: "pri_x" }, raizTemporal(), paddleFalso().fetch)).toBe(1);
  });

  it("--apply completa el JSON de staging con los 144 precios y el de capacidad con 2, y repetirlo no crea nada más", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const raiz = raizTemporal();
    const falso = paddleFalso();
    expect(await main(["--apply"], { PADDLE_SANDBOX_API_KEY: CLAVE }, raiz, falso.fetch, { esperaMs: 0 })).toBe(0);

    const catalogoIds = JSON.parse(readFileSync(join(raiz, "infra/terraform/environments/staging/paddle-price-ids.json"), "utf8"));
    const capacidad = JSON.parse(readFileSync(join(raiz, "infra/terraform/environments/staging/paddle-capacidad-ids.json"), "utf8"));
    expect(Object.keys(catalogoIds).sort()).toEqual(Object.keys(prod).sort());
    expect(Object.keys(capacidad).sort()).toEqual(["PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS", "PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL"]);
    // lo que ya existía de Monitoreo se conservó y nada coincide con un ID de prod
    expect(catalogoIds.PADDLE_PRICE_MONITORING_MONTHLY).toBe(prod.PADDLE_PRICE_MONITORING_MONTHLY);
    const nuevos = Object.entries(catalogoIds).filter(([k]) => !k.startsWith("PADDLE_PRICE_MONITORING_")).map(([, v]) => v as string);
    expect(nuevos.some((v) => Object.values(prod).includes(v))).toBe(false);
    expect(new Set(nuevos).size).toBe(nuevos.length);
    expect(log.mock.calls.flat().join("\n")).not.toContain(CLAVE);

    const llamadasPrimera = falso.fetch.mock.calls.length;
    expect(await main(["--apply"], { PADDLE_SANDBOX_API_KEY: CLAVE }, raiz, falso.fetch, { esperaMs: 0 })).toBe(0);
    expect(falso.fetch.mock.calls.length).toBe(llamadasPrimera);
  });
});
