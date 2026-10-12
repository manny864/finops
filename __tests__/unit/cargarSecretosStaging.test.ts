import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * infra/scripts/cargar-secretos-staging.sh carga al Key Vault de staging la clave del sandbox de Paddle, el secreto del
 * webhook y el secreto de la app registration. Se ejecuta contra un `az` y un `curl` simulados, para cuidar lo que no se
 * nota hasta que cuesta: que no toque un vault de prod, que no acepte una clave de Paddle en vivo, que los valores no
 * salgan ni por pantalla ni por la línea de comandos, y que el firewall se cierre aunque algo falle.
 */
const SCRIPT = join(process.cwd(), "infra/scripts/cargar-secretos-staging.sh");
const API_KEY = "pdl_sdbx_apikey_01aaaaaaaaaaaaaaaaaaaaaaaa_valor-secreto-uno";
const WEBHOOK = "pdl_ntfset_01bbbbbbbbbbbbbbbbbbbbbbbb_valor-secreto-dos";
const CLIENTE = "secreto~de~la~app~registration~tres";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function entorno(extra: Record<string, string> = {}) {
  const base = mkdtempSync(join(tmpdir(), "secretos-staging-test-"));
  dirs.push(base);
  const bin = join(base, "bin");
  const estado = join(base, "estado");
  const tmp = join(base, "tmp");
  for (const d of [bin, estado, tmp]) mkdirSync(d);
  const log = join(base, "az.log");
  writeFileSync(log, "");
  // `az` simulado: registra los argumentos, guarda el largo de lo que se sube por --file y lo devuelve en `show`.
  writeFileSync(
    join(bin, "az"),
    `#!/usr/bin/env bash
echo "$*" >> "$AZ_LOG"
case "$1 $2 $3" in
  "keyvault secret set")
    [ -n "\${AZ_FALLA_SET:-}" ] && { echo "boom" >&2; exit 1; }
    while [ $# -gt 0 ]; do case "$1" in --name) N=$2;; --file) F=$2;; esac; shift; done
    wc -c < "$F" | tr -d ' ' > "$AZ_ESTADO/$N.largo" ;;
  "keyvault secret show")
    while [ $# -gt 0 ]; do case "$1" in --name) N=$2;; esac; shift; done
    if [ -n "\${AZ_LARGO_MAL:-}" ]; then echo 1; else cat "$AZ_ESTADO/$N.largo"; fi ;;
esac
exit 0
`,
  );
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash\necho 203.0.113.7\n`);
  writeFileSync(join(bin, "sleep"), `#!/usr/bin/env bash\nexit 0\n`);
  for (const f of ["az", "curl", "sleep"]) chmodSync(join(bin, f), 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: base, TMPDIR: tmp, AZ_LOG: log, AZ_ESTADO: estado, ...extra };
  return { env, log, tmp };
}

const correr = (entrada: string, extra: Record<string, string> = {}) => {
  const e = entorno(extra);
  const r = spawnSync("bash", [SCRIPT, "--stdin"], { input: entrada, encoding: "utf8", env: e.env });
  const salida = `${r.stdout}${r.stderr}`;
  return { ...r, salida, log: readFileSync(e.log, "utf8"), tmp: e.tmp };
};

const tres = `${API_KEY}\n${WEBHOOK}\n${CLIENTE}\n`;

describe("cargar-secretos-staging.sh", () => {
  it("se niega a tocar un vault que parece de prod, sin llamar a Azure", () => {
    const r = correr(tres, { VAULT: "cscs-finops-prod-wus2-kv" });
    expect(r.status).not.toBe(0);
    expect(r.salida).toMatch(/sólo para staging/);
    expect(r.log).toBe("");
  });

  it("rechaza una clave de Paddle en vivo antes de tocar Azure, sin repetir el valor", () => {
    const viva = "pdl_live_apikey_01cccccccccccccccccccccccc_no-debe-aparecer";
    const r = correr(`${viva}\n${WEBHOOK}\n${CLIENTE}\n`);
    expect(r.status).not.toBe(0);
    expect(r.salida).toMatch(/infra-paddle-api-key.*no empieza con pdl_sdbx_apikey_/);
    expect(r.salida).not.toContain(viva);
    expect(r.log).toBe("");
  });

  it("rechaza un secreto de webhook con otro prefijo", () => {
    const r = correr(`${API_KEY}\nwhsec_otra-cosa\n${CLIENTE}\n`);
    expect(r.status).not.toBe(0);
    expect(r.salida).toMatch(/infra-paddle-webhook-secret/);
    expect(r.log).toBe("");
  });

  it("carga los tres con --file, comprueba el largo, y ni la pantalla ni la línea de comandos llevan los valores", () => {
    const r = correr(tres);
    expect(r.status).toBe(0);
    const sets = r.log.split("\n").filter((l) => l.startsWith("keyvault secret set"));
    expect(sets.map((l) => l.match(/--name (\S+)/)?.[1])).toEqual(["infra-paddle-api-key", "infra-paddle-webhook-secret", "infra-azure-client-secret"]);
    expect(sets.every((l) => l.includes("--file") && !l.includes("--value"))).toBe(true);
    for (const valor of [API_KEY, WEBHOOK, CLIENTE]) {
      expect(r.salida).not.toContain(valor);
      expect(r.log).not.toContain(valor);
    }
    expect(r.salida).toMatch(new RegExp(`infra-paddle-api-key: ok \\(${API_KEY.length} caracteres\\)`));
  });

  it("abre el firewall primero y lo cierra al final", () => {
    const lineas = correr(tres).log.split("\n").filter(Boolean);
    expect(lineas[0]).toMatch(/^keyvault network-rule add .*--ip-address 203\.0\.113\.7/);
    expect(lineas.at(-1)).toMatch(/^keyvault network-rule remove .*--ip-address 203\.0\.113\.7/);
  });

  it("no deja archivos temporales con los valores", () => {
    const r = correr(tres);
    expect(r.status).toBe(0);
    expect(readdirSync(r.tmp)).toEqual([]);
  });

  it("con Enter se saltea un secreto y carga sólo los demás", () => {
    const r = correr(`\n\n${CLIENTE}\n`);
    expect(r.status).toBe(0);
    const sets = r.log.split("\n").filter((l) => l.startsWith("keyvault secret set"));
    expect(sets).toHaveLength(1);
    expect(sets[0]).toContain("infra-azure-client-secret");
    expect(r.salida).toMatch(/Salteado: infra-paddle-api-key/);
  });

  it("sin ningún valor no abre el firewall", () => {
    const r = correr("\n\n\n");
    expect(r.status).toBe(0);
    expect(r.salida).toMatch(/No había nada/);
    expect(r.log).toBe("");
  });

  it("si una carga falla igual cierra el firewall y sale con error", () => {
    const r = correr(tres, { AZ_FALLA_SET: "1" });
    expect(r.status).not.toBe(0);
    expect(r.log.split("\n").filter(Boolean).at(-1)).toMatch(/^keyvault network-rule remove/);
    expect(r.salida).toMatch(/Firewall de .* cerrado/);
  });

  it("si el largo guardado no coincide con el enviado, falla en vez de dar por buena la carga", () => {
    const r = correr(tres, { AZ_LARGO_MAL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.salida).toMatch(/LARGO DISTINTO/);
  });

  it("el script existe, es ejecutable y tiene sintaxis válida", () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
  });
});
