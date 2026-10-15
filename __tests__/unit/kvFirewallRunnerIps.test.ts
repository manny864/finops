import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * El runner de GitHub sale por más de una IP (SNAT). Abrir sólo la de ipify hacía fallar el
 * plan con 403 ForbiddenByFirewall de forma intermitente (run 38714617769: ipify vio .196 y
 * Terraform salió por .198). infra/scripts/kv-firewall-runner.sh aprende las IPs del
 * "Client address" del 403 y las abre con lease vía kv-firewall-lease.sh.
 *
 * El `az` simulado reparte cada llamada al data plane entre las IPs de AZ_EGRESS (rotando),
 * y responde 403 de firewall si esa IP no está en las reglas del vault.
 */
const SCRIPT = join(process.cwd(), "infra/scripts/kv-firewall-runner.sh");
const A = "68.220.61.196";
const B = "68.220.61.198";
const C = "68.220.61.200";
const V = "cscs-finops-stg-wus2-kv";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const FAKE_AZ = `#!/usr/bin/env bash
echo "$*" >> "$AZ_LOG"
arg() { local k="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$k" ] && { echo "$2"; return; }; shift; done; }
case "$1 $2 $3" in
  "storage blob upload")
    N=$(arg --name "$@"); F=$(arg --file "$@"); M=$(arg --metadata "$@")
    mkdir -p "$AZ_BLOBS/$(dirname "$N")"; cp "$F" "$AZ_BLOBS/$N"; echo "\${M#expires=}" > "$AZ_BLOBS/$N.exp" ;;
  "storage blob list")
    P=$(arg --prefix "$@")
    [ -d "$AZ_BLOBS/$P" ] || exit 0
    (cd "$AZ_BLOBS" && find "$P" -type f ! -name '*.exp' | while read -r n; do printf '%s\\t%s\\n' "$n" "$(cat "$n.exp")"; done) ;;
  "storage blob delete")
    N=$(arg --name "$@"); rm -f "$AZ_BLOBS/$N" "$AZ_BLOBS/$N.exp" ;;
  "keyvault network-rule add")
    VA=$(arg --name "$@"); I=$(arg --ip-address "$@")
    touch "$AZ_RULES/$VA"; grep -qxF "$I/32" "$AZ_RULES/$VA" || echo "$I/32" >> "$AZ_RULES/$VA" ;;
  "keyvault network-rule remove")
    VA=$(arg --name "$@"); I=$(arg --ip-address "$@")
    touch "$AZ_RULES/$VA"; grep -vxF "$I/32" "$AZ_RULES/$VA" > "$AZ_RULES/$VA.tmp"; mv "$AZ_RULES/$VA.tmp" "$AZ_RULES/$VA" ;;
  "keyvault secret list")
    [ -n "\${AZ_RBAC_403:-}" ] && { echo "(Forbidden) Caller is not authorized to perform action. Code: Forbidden" >&2; exit 1; }
    VA=$(arg --vault-name "$@")
    read -r -a POOL <<< "$AZ_EGRESS"
    N=$(cat "$AZ_COUNTER" 2>/dev/null || echo 0); echo $((N + 1)) > "$AZ_COUNTER"
    IP="\${POOL[$((N % \${#POOL[@]}))]}"
    if [ -f "$AZ_RULES/$VA" ] && grep -qxF "$IP/32" "$AZ_RULES/$VA"; then echo "[]"; exit 0; fi
    echo "(Forbidden) Client address is not authorized and caller is not a trusted service.
Client address: $IP
Caller: appid=x
Vault: $VA;location=westus2
Code: ForbiddenByFirewall" >&2
    exit 1 ;;
esac
exit 0
`;

function entorno(egress: string[]) {
  const base = mkdtempSync(join(tmpdir(), "kv-fw-runner-test-"));
  dirs.push(base);
  const bin = join(base, "bin");
  const rules = join(base, "rules");
  const blobs = join(base, "blobs");
  for (const d of [bin, rules, blobs]) mkdirSync(d);
  const log = join(base, "az.log");
  writeFileSync(log, "");
  writeFileSync(join(bin, "az"), FAKE_AZ);
  writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  for (const f of ["az", "sleep"]) chmodSync(join(bin, f), 0o755);
  const ipsFile = join(base, "ips");
  const env: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: base,
    AZ_LOG: log,
    AZ_RULES: rules,
    AZ_BLOBS: blobs,
    AZ_EGRESS: egress.join(" "),
    AZ_COUNTER: join(base, "counter"),
    LEASE_ACCOUNT: "tfstateacct",
    LEASE_CONTAINER: "tfstate",
    LEASE_ID: "123-1-plan-apply",
    TTL_MINUTES: "70",
    KV_FW_RETRIES: "2",
    VAULTS: V,
    IPS_FILE: ipsFile,
  };
  const run = (args: string[], extra: Record<string, string> = {}) => {
    const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env: { ...env, ...extra } });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const reglas = () => (existsSync(join(rules, V)) ? readFileSync(join(rules, V), "utf8").split("\n").filter(Boolean) : []);
  const ips = () => (existsSync(ipsFile) ? readFileSync(ipsFile, "utf8").split("\n").filter(Boolean) : []);
  const lease = (ip: string) => existsSync(join(blobs, "kv-firewall-leases", V, ip, "123-1-plan-apply"));
  const archivo = (nombre: string, contenido: string) => {
    const p = join(base, nombre);
    writeFileSync(p, contenido);
    return p;
  };
  const azLog = () => readFileSync(log, "utf8");
  return { run, reglas, ips, lease, archivo, azLog };
}

describe("kv-firewall-runner.sh — open", () => {
  it("abre la IP de ipify Y las demás IPs de salida que reporta el 403, cada una con lease", () => {
    const e = entorno([A, B]);
    const r = e.run(["open"], { RUNNER_IP: A });
    expect(r.status).toBe(0);
    expect(e.reglas().sort()).toEqual([`${A}/32`, `${B}/32`]);
    expect(e.ips().sort()).toEqual([A, B]);
    expect(e.lease(A)).toBe(true);
    expect(e.lease(B)).toBe(true);
    expect(r.out).toMatch(/accesible \(3 respuestas seguidas/);
  });

  it("aprende durante la espera una IP que no apareció en los sondeos iniciales", () => {
    const e = entorno([A, A, C]);
    const r = e.run(["open"], { RUNNER_IP: A, KV_FW_PROBES: "1" });
    expect(r.status).toBe(0);
    expect(e.ips().sort()).toEqual([A, C]);
  });

  it("un 403 que no es del firewall (RBAC) no abre nada más ni espera de balde", () => {
    const e = entorno([A, B]);
    const r = e.run(["open"], { RUNNER_IP: A, AZ_RBAC_403: "1" });
    expect(r.status).toBe(0);
    expect(e.ips()).toEqual([A]);
    expect(r.out).toMatch(/no es el firewall/);
    expect(e.azLog().match(/keyvault secret list/g)?.length).toBeLessThanOrEqual(7);
  });

  it("tiene un tope de IPs: lo que entra al firewall sale de mensajes de error", () => {
    const e = entorno([A, B, C]);
    const r = e.run(["open"], { RUNNER_IP: A, KV_FW_MAX_IPS: "2" });
    expect(r.status).not.toBe(0);
    expect(e.ips().length).toBe(2);
    expect(r.out).toMatch(/no se abren más/);
  });

  it("rechaza una RUNNER_IP que no es IPv4 sin tocar el firewall", () => {
    const e = entorno([A]);
    const r = e.run(["open"], { RUNNER_IP: "1.2.3.4; rm -rf /" });
    expect(r.status).not.toBe(0);
    expect(e.reglas()).toEqual([]);
  });
});

describe("kv-firewall-runner.sh — learn (403 durante plan/apply)", () => {
  it("abre la IP nueva del log y sale 0 para que el workflow reintente", () => {
    // Los sondeos sólo ven A; B aparece recién en el 403 de Terraform.
    const e = entorno([A]);
    e.run(["open"], { RUNNER_IP: A });
    expect(e.ips()).toEqual([A]);
    const log = e.archivo("plan.err", `Error: making Read request on Azure KeyVault Secret infra-db-password: StatusCode=403 Code="ForbiddenByFirewall" Message="Client address is not authorized and caller is not a trusted service.\\r\\nClient address: ${B}\\r\\nCaller: appid=x"`);
    const r = e.run(["learn", log]);
    expect(r.status).toBe(0);
    expect(e.reglas().sort()).toEqual([`${A}/32`, `${B}/32`]);
    expect(e.lease(B)).toBe(true);
  });

  it("sale 1 (no reintentar) si el 403 es de una IP ya abierta o si el error no es del firewall", () => {
    const e = entorno([A]);
    e.run(["open"], { RUNNER_IP: A });
    expect(e.run(["learn", e.archivo("a.err", `Code="ForbiddenByFirewall" Client address: ${A}`)]).status).toBe(1);
    const antes = e.azLog();
    expect(e.run(["learn", e.archivo("b.err", "Error: Invalid value for variable")]).status).toBe(1);
    expect(e.azLog()).toBe(antes);
  });
});

describe("kv-firewall-runner.sh — close", () => {
  it("cierra todas las IPs del job, incluida la de ipify aunque falte en el registro", () => {
    const e = entorno([A, B]);
    e.run(["open"], { RUNNER_IP: A });
    expect(e.reglas().length).toBe(2);
    const r = e.run(["close"], { RUNNER_IP: A });
    expect(r.status).toBe(0);
    expect(e.reglas()).toEqual([]);
    expect(e.lease(A)).toBe(false);
    expect(e.lease(B)).toBe(false);
  });

  it("si el job murió antes de registrar la IP de ipify, el cierre la quita igual (viene del output)", () => {
    const e = entorno([A]);
    e.run(["open"], { RUNNER_IP: A });
    writeFileSync(e.archivo("ips", ""), "");
    expect(e.run(["close"], { RUNNER_IP: A }).status).toBe(0);
    expect(e.reglas()).toEqual([]);
  });
});

describe("workflow terraform: IPs de salida del runner", () => {
  const tf = readFileSync(join(process.cwd(), ".github/workflows/terraform.yml"), "utf8");
  const paso = (nombre: string, desde = 0) => {
    const at = tf.indexOf(`- name: ${nombre}`, desde);
    const next = tf.indexOf("\n      - ", at + 1);
    return { at, txt: tf.slice(at, next === -1 ? undefined : next) };
  };

  it("plan, apply y drift aprenden la IP del 403 y reintentan; abrir y cerrar usan el mismo registro", () => {
    const ipsFile = "IPS_FILE: ${{ runner.temp }}/kv-firewall-ips";
    for (const nombre of ["Terraform plan", "Terraform apply", "Detectar drift"]) {
      const { at, txt } = paso(nombre);
      expect(at, nombre).toBeGreaterThan(-1);
      expect(txt, nombre).toContain('kv-firewall-runner.sh" learn "$ERR"');
      expect(txt, nombre).toContain(ipsFile);
      expect(txt, nombre).toContain("VAULTS: ${{ steps.kv_firewall.outputs.vaults }}");
    }
    for (const nombre of ["Abrir el Key Vault para este runner", "Cerrar el Key Vault"]) {
      let desde = 0;
      for (let i = 0; i < 2; i++) {
        const { at, txt } = paso(nombre, desde);
        expect(at, `${nombre} #${i + 1}`).toBeGreaterThan(-1);
        expect(txt).toContain(ipsFile);
        desde = at + 1;
      }
    }
    expect(tf).not.toMatch(/kv-firewall-lease\.sh" (open|close)/);
  });

  it("drift no reintenta un exit 2 (hay drift) y no muere antes de leer el código con bash -e", () => {
    const { txt } = paso("Detectar drift");
    expect(txt).toContain("-detailed-exitcode 2>\"$ERR\" || RC=$?");
    expect(txt).toContain('[ "$RC" -eq 1 ] || exit "$RC"');
  });
});

describe("flow log: sin diff perpetuo (TAUserDoesNotHavePermissions en staging)", () => {
  const stamp = readFileSync(join(process.cwd(), "infra/terraform/modules/stamp/main.tf"), "utf8");
  const at = stamp.indexOf('resource "azapi_resource" "network_flow_log"');
  const bloque = stamp.slice(at, stamp.indexOf("\n}\n", at));

  it("la identidad va en el bloque identity, no en body", () => {
    expect(bloque).toMatch(/\n {2}identity \{\n {4}type {9}= "UserAssigned"\n {4}identity_ids = \[azurerm_user_assigned_identity\.network_flow_logs\[0\]\.id\]/);
    const body = bloque.slice(bloque.indexOf("body = {"));
    expect(body).not.toMatch(/identity\s*=/);
  });

  it("declara los campos vacíos que devuelve la API", () => {
    expect(bloque).toMatch(/enabledFilteringCriteria = ""/);
    expect(bloque).toMatch(/recordTypes {14}= ""/);
  });

  it("no fija schema_validation_enabled (cambiarlo también dispara un PUT)", () => {
    const codigo = bloque.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(codigo).not.toMatch(/schema_validation_enabled/);
  });
});
