import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La CSP de un build de producción permitía los dominios sandbox de Paddle sólo fuera de producción, y staging corre un build
 * de producción: su checkout sandbox quedaba bloqueado (D5, docs/security/ejecucion-staging-copilot.md). Ahora se permiten en
 * dev y cuando el token de cliente del build es de sandbox (`test_`). Estos tests cuidan las dos mitades: que staging pueda
 * cobrar en sandbox y que un build de prod, con token `live_`, NUNCA los incluya (menor privilegio).
 */
const archivos = { "next.config.ts": readFileSync("next.config.ts", "utf8"), "src/proxy.ts": readFileSync("src/proxy.ts", "utf8") };

const condicion = (fuente: string) => fuente.match(/const usaPaddleSandbox = (.+);/)?.[1] ?? "";
const esDev = (fuente: string) => fuente.match(/const isDev = (.+);/)?.[1] ?? "";
const evaluar = (fuente: string, NODE_ENV: string, token?: string) =>
  new Function("process", `const isDev = ${esDev(fuente)}; return ${condicion(fuente)};`)({ env: { NODE_ENV, NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: token } }) as boolean;

describe.each(Object.entries(archivos))("CSP de %s", (_nombre, fuente) => {
  it("define la condición y la usa para los tres grupos de dominios sandbox", () => {
    expect(condicion(fuente)).not.toBe("");
    expect(fuente.match(/usaPaddleSandbox \? ' https:\/\/(sandbox-cdn|sandbox-api|sandbox-buy)/g)).toHaveLength(3);
  });

  it("ningún dominio sandbox queda atado sólo a isDev", () => {
    expect(fuente).not.toMatch(/isDev \? ' https:\/\/sandbox-/);
  });

  it("lee el token con acceso literal a NEXT_PUBLIC_PADDLE_CLIENT_TOKEN, para que Next lo inlinee al compilar", () => {
    expect(condicion(fuente)).toContain("process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN");
  });

  it.each([
    ["producción", "production", "live_abc123", false],
    ["producción sin token", "production", undefined, false],
    ["producción con token vacío", "production", "", false],
    ["producción con token de sandbox (staging)", "production", "test_abc123", true],
    ["desarrollo", "development", undefined, true],
  ])("%s => sandbox permitido: %s", (_caso, entorno, token, esperado) => {
    expect(evaluar(fuente, entorno as string, token as string | undefined)).toBe(esperado);
  });
});

describe("las dos CSP usan el mismo criterio", () => {
  it("la condición es idéntica en next.config.ts y en proxy.ts", () => {
    expect(condicion(archivos["next.config.ts"])).toBe(condicion(archivos["src/proxy.ts"]));
  });

  it("el criterio coincide con el que usa el navegador para elegir el entorno de Paddle.js", () => {
    const pagina = readFileSync("src/components/PricingPage.tsx", "utf8");
    expect(pagina).toContain("token.startsWith('test_') ? 'sandbox' : 'production'");
  });
});
