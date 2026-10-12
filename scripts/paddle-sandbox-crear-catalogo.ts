/**
 * Crea en el SANDBOX de Paddle los productos y precios que le faltan a staging (decisión D5 de
 * docs/security/ejecucion-staging-copilot.md) y completa los archivos de price IDs de staging.
 *
 * Qué crea, a partir del catálogo de la app (src/lib/addonCatalog.ts, la misma fuente que usa prod):
 *  - un producto "FINOPS - <módulo>" por cada familia de add-ons que todavía no tenga sus seis precios
 *    en infra/terraform/environments/staging/paddle-price-ids.json, con la convención de siempre:
 *    MONTHLY recurrente mensual, 1M/3M/6M/9M pago único y YEARLY recurrente anual (docs/paddle-modulos-a-crear.md);
 *  - el producto "FINOPS - Tenant Adicional" con un precio mensual por tier (Professional y Business), que la
 *    app lee de PADDLE_ADDON_TENANT_PRICE_ID_*; esos IDs van a infra/terraform/environments/staging/paddle-capacidad-ids.json.
 *
 * Es seguro de repetir: lo que ya figura en los JSON se salta, y un producto que ya existe en el sandbox con el mismo
 * nombre se reutiliza. Cada precio se guarda en el JSON apenas se crea, así que una corrida cortada se retoma sola.
 *
 * Uso, desde la raíz del repo (la clave se pide sin eco, no queda en el historial y el script nunca la imprime):
 *
 *   npx tsx scripts/paddle-sandbox-crear-catalogo.ts            # simulacro: no usa la red ni pide clave
 *   read -s PADDLE_SANDBOX_API_KEY && export PADDLE_SANDBOX_API_KEY
 *   npx tsx scripts/paddle-sandbox-crear-catalogo.ts --apply    # crea de verdad, sólo en el sandbox
 *
 * Contrato verificado en la documentación de Paddle el 2026-10-12: POST /products (name y tax_category obligatorios)
 * y POST /prices (description, product_id y unit_price con amount en la unidad menor como string); billing_cycle
 * ausente o null = pago único; permisos product.write y price.write; 240 pedidos por minuto, con Retry-After en el 429.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADDON_CATALOG } from "../src/lib/addonCatalog";
import { ADDON_PRICE_USD } from "../src/lib/pricing";

export const API_SANDBOX = "https://sandbox-api.paddle.com";
const ENV_STAGING = "infra/terraform/environments/staging";
const ENV_PROD = "infra/terraform/environments/prod";

type Ciclo = { interval: "month" | "year"; frequency: number } | null;

export const PERIODOS = [
  { sufijo: "MONTHLY", campo: "monthly", ciclo: { interval: "month", frequency: 1 } as Ciclo, nombre: "Mensual" },
  { sufijo: "1M", campo: "pass1m", ciclo: null as Ciclo, nombre: "1 mes (pago único)" },
  { sufijo: "3M", campo: "pass3m", ciclo: null as Ciclo, nombre: "3 meses (pago único)" },
  { sufijo: "6M", campo: "pass6m", ciclo: null as Ciclo, nombre: "6 meses (pago único)" },
  { sufijo: "9M", campo: "pass9m", ciclo: null as Ciclo, nombre: "9 meses (pago único)" },
  { sufijo: "YEARLY", campo: "pass12m", ciclo: { interval: "year", frequency: 1 } as Ciclo, nombre: "Anual" },
] as const;

export interface PrecioPlan {
  variable: string;
  nombre: string;
  descripcion: string;
  centavos: number;
  moneda: string;
  ciclo: Ciclo;
}

export interface ProductoPlan {
  clave: string;
  nombre: string;
  descripcion: string;
  /** Archivo donde se guardan los IDs: el de los price IDs del catálogo o el de capacidad. */
  destino: "catalogo" | "capacidad";
  precios: PrecioPlan[];
}

type Catalogo = Record<string, { name: string; description: string; fulfilledBy?: string; currency?: string; prices: { monthly?: string }; basePriceUSD: Record<string, number> }>;

const aCentavos = (usd: number) => Math.round(usd * 100);

/**
 * Qué falta crear. La familia (PADDLE_PRICE_<FAMILIA>_*) sale de buscar el price ID mensual en vivo del catálogo en el
 * JSON de prod: es sólo una tabla de nombres, nada se escribe ni se llama en vivo.
 */
export function planificar(
  catalogo: Catalogo,
  idAClave: Map<string, string>,
  existentes: Record<string, string>,
  capacidadExistente: Record<string, string>,
): ProductoPlan[] {
  const plan: ProductoPlan[] = [];
  for (const [clave, p] of Object.entries(catalogo)) {
    if (p.fulfilledBy || !p.prices.monthly) continue;
    const variableMensual = idAClave.get(p.prices.monthly);
    const familia = variableMensual?.replace(/^PADDLE_PRICE_/, "").replace(/_MONTHLY$/, "");
    if (!familia) throw new Error(`El módulo ${clave} no tiene familia de price IDs: ¿cambió el catálogo o el JSON de prod?`);
    const precios: PrecioPlan[] = [];
    for (const per of PERIODOS) {
      const variable = `PADDLE_PRICE_${familia}_${per.sufijo}`;
      if (existentes[variable]) continue;
      precios.push({
        variable,
        nombre: per.nombre,
        descripcion: `${p.name} ${per.nombre} (staging, sandbox)`,
        centavos: aCentavos(p.basePriceUSD[per.campo]),
        moneda: p.currency ?? "USD",
        ciclo: per.ciclo,
      });
    }
    if (precios.length) plan.push({ clave, nombre: `FINOPS - ${p.name}`, descripcion: p.description, destino: "catalogo", precios });
  }

  const tenant = catalogo["quota_tenant"];
  const porTier = (["Professional", "Business"] as const)
    .map((tier) => ({ tier, variable: `PADDLE_ADDON_TENANT_PRICE_ID_${tier.toUpperCase()}`, usd: ADDON_PRICE_USD.extraTenant[tier] }))
    .filter((t) => t.usd && !capacidadExistente[t.variable]);
  if (tenant && porTier.length) {
    plan.push({
      clave: "quota_tenant",
      nombre: `FINOPS - ${tenant.name}`,
      descripcion: tenant.description,
      destino: "capacidad",
      precios: porTier.map((t) => ({
        variable: t.variable,
        nombre: `Mensual ${t.tier}`,
        descripcion: `${tenant.name} para el plan ${t.tier} (staging, sandbox)`,
        centavos: aCentavos(t.usd as number),
        moneda: "USD",
        ciclo: { interval: "month", frequency: 1 },
      })),
    });
  }
  return plan;
}

export function validarClave(clave: string | undefined): string {
  if (!clave) throw new Error("Falta PADDLE_SANDBOX_API_KEY. Pedila sin eco: read -s PADDLE_SANDBOX_API_KEY && export PADDLE_SANDBOX_API_KEY");
  if (!clave.startsWith("pdl_sdbx_")) throw new Error("La clave no es de sandbox (tiene que empezar con pdl_sdbx_). Este script nunca toca el Paddle en vivo.");
  return clave;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; headers: { get(n: string): string | null }; json(): Promise<any> }>;

export interface Opciones {
  fetch: Fetch;
  apiKey: string;
  esperaMs?: number;
  dormir?: (ms: number) => Promise<void>;
  /** Se llama apenas se crea (o se reencuentra) cada precio, para guardarlo sin esperar al final. */
  alCrearPrecio: (producto: ProductoPlan, precio: PrecioPlan, id: string) => void;
  log?: (linea: string) => void;
}

export async function crearEnSandbox(plan: ProductoPlan[], o: Opciones): Promise<void> {
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = o.log ?? (() => {});
  const espera = o.esperaMs ?? 300;

  async function llamar(metodo: string, ruta: string, cuerpo?: unknown): Promise<any> {
    for (let intento = 1; ; intento++) {
      const r = await o.fetch(`${API_SANDBOX}${ruta}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json", "Paddle-Version": "1" },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });
      if (r.status === 429 && intento <= 5) {
        await dormir(Math.max(0, Number(r.headers.get("retry-after") ?? "1")) * 1000);
        continue;
      }
      if (r.status >= 500 && intento <= 3) {
        await dormir(1000 * intento);
        continue;
      }
      const json = await r.json().catch(() => ({}));
      if (r.status >= 400) {
        const e = json?.error ?? {};
        throw new Error(`Paddle ${metodo} ${ruta} -> ${r.status} ${e.code ?? ""} ${e.detail ?? ""}`.trim());
      }
      await dormir(espera);
      return json;
    }
  }

  // Productos que ya existen en el sandbox, por nombre exacto: si una corrida anterior se cortó, se reutilizan.
  const porNombre = new Map<string, string>();
  for (let despues = ""; ; ) {
    const pagina = await llamar("GET", `/products?per_page=200&status=active${despues ? `&after=${despues}` : ""}`);
    for (const pr of pagina.data ?? []) porNombre.set(pr.name, pr.id);
    const hay = pagina.meta?.pagination?.has_more;
    const ultimo = (pagina.data ?? []).at(-1)?.id;
    if (!hay || !ultimo) break;
    despues = ultimo;
  }

  for (const producto of plan) {
    let productoId = porNombre.get(producto.nombre);
    if (productoId) {
      log(`  producto existente: ${producto.nombre} (${productoId})`);
    } else {
      const creado = await llamar("POST", "/products", {
        name: producto.nombre,
        description: producto.descripcion.slice(0, 2048),
        type: "standard",
        tax_category: "saas",
        custom_data: { entorno: "staging", origen: "paddle-sandbox-crear-catalogo", clave: producto.clave },
      });
      productoId = creado.data.id as string;
      log(`  producto creado: ${producto.nombre} (${productoId})`);
    }
    for (const precio of producto.precios) {
      const creado = await llamar("POST", "/prices", {
        description: precio.descripcion,
        name: precio.nombre,
        product_id: productoId,
        unit_price: { amount: String(precio.centavos), currency_code: precio.moneda },
        billing_cycle: precio.ciclo,
      });
      const id = creado.data.id as string;
      if (!/^pri_[a-z0-9]{26}$/.test(id)) throw new Error(`Paddle devolvió un ID de precio con forma inesperada para ${precio.variable}`);
      o.alCrearPrecio(producto, precio, id);
      log(`    ${precio.variable} = ${id}`);
    }
  }
}

const leerJson = (ruta: string): Record<string, string> => (existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : {});

function ordenarPorFamilia(obj: Record<string, string>): Record<string, string> {
  const orden = PERIODOS.map((p) => p.sufijo as string);
  const clave = (k: string) => {
    const m = k.match(/^(.*)_(MONTHLY|1M|3M|6M|9M|YEARLY)$/);
    return m ? [m[1], orden.indexOf(m[2])] : [k, 0];
  };
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => {
      const [fa, pa] = clave(a) as [string, number];
      const [fb, pb] = clave(b) as [string, number];
      return fa === fb ? pa - pb : fa < fb ? -1 : 1;
    }),
  );
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, raiz: string, fetchReal: Fetch, opciones: { esperaMs?: number } = {}): Promise<number> {
  const aplicar = argv.includes("--apply");
  if (Object.keys(env).some((k) => k.startsWith("PADDLE_PRICE_"))) {
    console.error("Hay variables PADDLE_PRICE_* en el entorno: pueden tapar los IDs del catálogo. Abrí una terminal sin ellas.");
    return 1;
  }
  const rutaCatalogo = join(raiz, ENV_STAGING, "paddle-price-ids.json");
  const rutaCapacidad = join(raiz, ENV_STAGING, "paddle-capacidad-ids.json");
  const prod = leerJson(join(raiz, ENV_PROD, "paddle-price-ids.json"));
  const idAClave = new Map(Object.entries(prod).map(([k, v]) => [v, k]));
  const catalogoIds = leerJson(rutaCatalogo);
  const capacidadIds = leerJson(rutaCapacidad);

  const plan = planificar(ADDON_CATALOG as unknown as Catalogo, idAClave, catalogoIds, capacidadIds);
  const totalPrecios = plan.reduce((n, p) => n + p.precios.length, 0);
  console.log(`Falta crear en el sandbox: ${plan.length} producto(s) y ${totalPrecios} precio(s).`);
  for (const p of plan) console.log(`  ${p.nombre}: ${p.precios.map((x) => `${x.variable.split("_").slice(-1)[0]} ${(x.centavos / 100).toFixed(0)} USD${x.ciclo ? "/" + x.ciclo.interval : ""}`).join(", ")}`);
  if (!plan.length) return 0;
  if (!aplicar) {
    console.log("\nSimulacro: no se llamó a Paddle. Para crear de verdad: --apply, con PADDLE_SANDBOX_API_KEY.");
    return 0;
  }

  const apiKey = validarClave(env.PADDLE_SANDBOX_API_KEY);
  await crearEnSandbox(plan, {
    fetch: fetchReal,
    apiKey,
    esperaMs: opciones.esperaMs,
    log: (l) => console.log(l),
    alCrearPrecio: (producto, precio, id) => {
      if (producto.destino === "capacidad") {
        capacidadIds[precio.variable] = id;
        writeFileSync(rutaCapacidad, JSON.stringify(capacidadIds, null, 2) + "\n");
      } else {
        catalogoIds[precio.variable] = id;
        writeFileSync(rutaCatalogo, JSON.stringify(ordenarPorFamilia(catalogoIds), null, 2) + "\n");
      }
    },
  });
  console.log(`\nListo. IDs guardados en ${ENV_STAGING}/paddle-price-ids.json y paddle-capacidad-ids.json (no son secretos).`);
  return 0;
}

const esEjecucionDirecta = typeof process !== "undefined" && /paddle-sandbox-crear-catalogo\.ts$/.test(process.argv[1] ?? "");
if (esEjecucionDirecta) {
  main(process.argv.slice(2), process.env, process.cwd(), (url, init) => fetch(url, init) as any).then(
    (codigo) => process.exit(codigo),
    (e) => {
      console.error(String(e?.message ?? e));
      process.exit(1);
    },
  );
}
