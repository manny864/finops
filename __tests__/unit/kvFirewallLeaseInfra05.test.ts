import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * INFRA-05 — El cierre del firewall del Key Vault no depende del runner.
 *
 * infra/scripts/kv-firewall-lease.sh corre contra un `az` simulado que guarda en disco las IP rules de cada vault y
 * los blobs de lease. Se prueban fallos antes, durante y después de la apertura, la pérdida del runner (abre y
 * nunca cierra), referencias concurrentes a la misma IP y que un cierre fallido termine en error.
 */
const SCRIPT = join(process.cwd(), "infra/scripts/kv-firewall-lease.sh");
const IP = "203.0.113.7";
const OTRA = "198.51.100.9";
const V1 = "cscs-finops-prod-kv";
const V2 = "cscs-finops-prod-kv2";
const PREFIX = "kv-firewall-leases";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const FAKE_AZ = `#!/usr/bin/env bash
echo "$*" >> "$AZ_LOG"
arg() { local k="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$k" ] && { echo "$2"; return; }; shift; done; }
case "$1 $2 $3" in
  "storage blob upload")
    [ -n "\${AZ_FALLA_UPLOAD:-}" ] && { echo "AuthorizationPermissionMismatch" >&2; exit 1; }
    N=$(arg --name "$@"); F=$(arg --file "$@"); M=$(arg --metadata "$@")
    mkdir -p "$AZ_BLOBS/$(dirname "$N")"; cp "$F" "$AZ_BLOBS/$N"; echo "\${M#expires=}" > "$AZ_BLOBS/$N.exp" ;;
  "storage blob list")
    [ -n "\${AZ_FALLA_LIST:-}" ] && { echo "boom" >&2; exit 1; }
    P=$(arg --prefix "$@")
    [ -d "$AZ_BLOBS/$P" ] || exit 0
    (cd "$AZ_BLOBS" && find "$P" -type f ! -name '*.exp' | while read -r n; do printf '%s\\t%s\\n' "$n" "$(cat "$n.exp")"; done) ;;
  "storage blob delete")
    N=$(arg --name "$@"); rm -f "$AZ_BLOBS/$N" "$AZ_BLOBS/$N.exp" ;;
  "keyvault network-rule add")
    V=$(arg --name "$@"); I=$(arg --ip-address "$@")
    [ "\${AZ_FALLA_ADD:-}" = "$V" ] && { echo "boom" >&2; exit 1; }
    touch "$AZ_RULES/$V"; grep -qxF "$I/32" "$AZ_RULES/$V" || echo "$I/32" >> "$AZ_RULES/$V" ;;
  "keyvault network-rule remove")
    V=$(arg --name "$@"); I=$(arg --ip-address "$@")
    [ -n "\${AZ_FALLA_REMOVE:-}" ] && { echo "Conflict" >&2; exit 1; }
    touch "$AZ_RULES/$V"; grep -vxF "$I/32" "$AZ_RULES/$V" | grep -vxF "$I" > "$AZ_RULES/$V.tmp"; mv "$AZ_RULES/$V.tmp" "$AZ_RULES/$V" ;;
  "keyvault show --name")
    V=$(arg --name "$@"); [ -f "$AZ_RULES/$V" ] && cat "$AZ_RULES/$V" ;;
esac
exit 0
`;

function entorno() {
  const base = mkdtempSync(join(tmpdir(), "kv-fw-lease-test-"));
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
  const perm = join(base, "permanent");
  writeFileSync(perm, "");

  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: base,
    AZ_LOG: log,
    AZ_RULES: rules,
    AZ_BLOBS: blobs,
    LEASE_ACCOUNT: "tfstateacct",
    LEASE_CONTAINER: "tfstate",
    KV_FW_RETRIES: "3",
  };
  const run = (cmd: string, extra: Record<string, string> = {}) => {
    const r = spawnSync("bash", [SCRIPT, cmd], { encoding: "utf8", env: { ...env, ...extra } });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const reglas = (v: string) => (existsSync(join(rules, v)) ? readFileSync(join(rules, v), "utf8").split("\n").filter(Boolean) : []);
  const setReglas = (v: string, rs: string[]) => writeFileSync(join(rules, v), rs.map((r) => `${r}\n`).join(""));
  const leasePath = (v: string, ip: string, id: string) => join(blobs, PREFIX, v, ip, id);
  const lease = (v: string, ip: string, id: string) => (existsSync(leasePath(v, ip, id)) ? JSON.parse(readFileSync(leasePath(v, ip, id), "utf8")) : null);
  const setLease = (v: string, ip: string, id: string, expiresEpoch: number) => {
    const p = leasePath(v, ip, id);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "{}");
    writeFileSync(`${p}.exp`, `${expiresEpoch}\n`);
  };
  const vencer = (v: string, ip: string, id: string) => writeFileSync(`${leasePath(v, ip, id)}.exp`, `${Math.floor(Date.now() / 1000) - 60}\n`);
  const azLog = () => readFileSync(log, "utf8");
  return { run, reglas, setReglas, lease, setLease, vencer, azLog, perm };
}

const now = () => Math.floor(Date.now() / 1000);
const abrir = { VAULTS: `${V1} ${V2}`, RUNNER_IP: IP, LEASE_ID: "123-1-plan-apply", TTL_MINUTES: "70", LEASE_OWNER: "terraform/plan-apply (workflow_dispatch, manny)", LEASE_RUN_URL: "https://github.com/x/y/actions/runs/123" };
const cerrar = { VAULTS: `${V1} ${V2}`, RUNNER_IP: IP, LEASE_ID: "123-1-plan-apply" };

describe("INFRA-05 — open", () => {
  it("registra el lease (vault, IP, job, dueño, vencimiento) ANTES de agregar la regla", () => {
    const e = entorno();
    const r = e.run("open", abrir);
    expect(r.status).toBe(0);
    for (const v of [V1, V2]) {
      expect(e.reglas(v)).toEqual([`${IP}/32`]);
      const l = e.lease(v, IP, "123-1-plan-apply");
      expect(l).toMatchObject({ vault: v, ip: IP, job: "123-1-plan-apply", owner: abrir.LEASE_OWNER, run_url: abrir.LEASE_RUN_URL });
      const exp = Date.parse(l.expires_at) / 1000;
      expect(exp).toBeGreaterThan(now() + 69 * 60);
      expect(exp).toBeLessThan(now() + 71 * 60);
    }
    const lines = e.azLog().split("\n");
    const lastUpload = lines.map((l, i) => (l.startsWith("storage blob upload") ? i : -1)).reduce((a, b) => Math.max(a, b));
    const firstAdd = lines.findIndex((l) => l.startsWith("keyvault network-rule add"));
    expect(lastUpload).toBeLessThan(firstAdd);
  });

  it("fallo ANTES de abrir: si el lease no se puede escribir, no se abre ningún vault", () => {
    const e = entorno();
    const r = e.run("open", { ...abrir, AZ_FALLA_UPLOAD: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/::error::No se pudo registrar el lease/);
    expect(e.azLog()).not.toContain("network-rule add");
    expect(e.reglas(V1)).toEqual([]);
  });

  it("rechaza IP, vault, id o TTL inválidos sin tocar Azure", () => {
    for (const bad of [
      { RUNNER_IP: "<html>" },
      { VAULTS: "kv;rm -rf" },
      { LEASE_ID: "../otro" },
      { TTL_MINUTES: "0" },
    ]) {
      const e = entorno();
      const r = e.run("open", { ...abrir, ...bad });
      expect(r.status).not.toBe(0);
      expect(e.azLog()).toBe("");
    }
  });

  it("fallo DURANTE la apertura: el cierre (always) limpia lo abierto y el reconciliador cubre si el cierre no corre", () => {
    const e = entorno();
    const r = e.run("open", { ...abrir, AZ_FALLA_ADD: V2 });
    expect(r.status).not.toBe(0);
    expect(e.reglas(V1)).toEqual([`${IP}/32`]);

    const c = e.run("close", cerrar);
    expect(c.status).toBe(0);
    expect(e.reglas(V1)).toEqual([]);
    expect(e.lease(V1, IP, "123-1-plan-apply")).toBeNull();
    expect(e.lease(V2, IP, "123-1-plan-apply")).toBeNull();

    // Mismo fallo, pero el cierre no corre (runner perdido): el reconciliador quita la regla al vencer el lease.
    const e2 = entorno();
    e2.run("open", { ...abrir, AZ_FALLA_ADD: V2 });
    e2.vencer(V1, IP, "123-1-plan-apply");
    e2.vencer(V2, IP, "123-1-plan-apply");
    expect(e2.run("reconcile", { VAULTS: `${V1} ${V2}`, PERMANENT_KNOWN: "1", PERMANENT_FILE: e2.perm }).status).toBe(0);
    expect(e2.reglas(V1)).toEqual([]);
    expect(e2.lease(V2, IP, "123-1-plan-apply")).toBeNull();
  });
});

describe("INFRA-05 — close", () => {
  it("fallo DESPUÉS de abrir: quita regla y lease de cada vault; repetirlo no falla", () => {
    const e = entorno();
    e.run("open", abrir);
    expect(e.run("close", cerrar).status).toBe(0);
    expect(e.reglas(V1)).toEqual([]);
    expect(e.reglas(V2)).toEqual([]);
    expect(e.lease(V1, IP, "123-1-plan-apply")).toBeNull();
    expect(e.run("close", cerrar).status).toBe(0);
  });

  it("no quita la regla si otro job tiene un lease vigente sobre la misma IP", () => {
    const e = entorno();
    e.run("open", abrir);
    e.run("open", { ...abrir, LEASE_ID: "456-1-drift" });
    const r = e.run("close", cerrar);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/otro job vigente/);
    expect(e.reglas(V1)).toEqual([`${IP}/32`]);
    expect(e.run("close", { ...cerrar, LEASE_ID: "456-1-drift" }).status).toBe(0);
    expect(e.reglas(V1)).toEqual([]);
  });

  it("si no puede cerrar tras los reintentos sale con error, no con éxito silencioso", () => {
    const e = entorno();
    e.run("open", abrir);
    const r = e.run("close", { ...cerrar, AZ_FALLA_REMOVE: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/::error::No se pudo cerrar la regla temporal/);
    expect(e.azLog().match(/network-rule remove --name cscs-finops-prod-kv /g)).toHaveLength(3);
  });

  it("si no puede leer los leases, cierra igual", () => {
    const e = entorno();
    e.run("open", abrir);
    const r = e.run("close", { ...cerrar, AZ_FALLA_LIST: "1" });
    expect(r.status).toBe(0);
    expect(e.reglas(V1)).toEqual([]);
  });
});

describe("INFRA-05 — reconcile (runner perdido o cancelación forzada)", () => {
  const rec = { VAULTS: `${V1} ${V2}`, PERMANENT_KNOWN: "1" };

  it("con el lease vigente no toca la regla; vencido, la quita, borra el lease y avisa", () => {
    const e = entorno();
    e.run("open", abrir); // el runner se pierde: nunca corre close
    let r = e.run("reconcile", { ...rec, PERMANENT_FILE: e.perm });
    expect(r.status).toBe(0);
    expect(e.reglas(V1)).toEqual([`${IP}/32`]);

    e.vencer(V1, IP, "123-1-plan-apply");
    e.vencer(V2, IP, "123-1-plan-apply");
    r = e.run("reconcile", { ...rec, PERMANENT_FILE: e.perm });
    expect(r.status).toBe(0);
    expect(e.reglas(V1)).toEqual([]);
    expect(e.reglas(V2)).toEqual([]);
    expect(e.lease(V1, IP, "123-1-plan-apply")).toBeNull();
    expect(r.out).toMatch(/::warning title=Key Vault firewall::.*lease vencido/);
  });

  it("no borra reglas permanentes (con o sin /32), CIDR más anchos ni IPs con lease vigente de otro job", () => {
    const e = entorno();
    writeFileSync(e.perm, `${V1} 192.0.2.10\n${V1} 192.0.2.11/32\n`);
    e.setReglas(V1, ["192.0.2.10/32", "192.0.2.11/32", "10.20.0.0/24", `${IP}/32`, `${OTRA}/32`]);
    e.setLease(V1, IP, "viejo", now() - 600);
    e.setLease(V1, IP, "vigente", now() + 600);
    const r = e.run("reconcile", { ...rec, VAULTS: V1, PERMANENT_FILE: e.perm });
    expect(r.status).toBe(0);
    expect(e.reglas(V1)).toEqual(["192.0.2.10/32", "192.0.2.11/32", "10.20.0.0/24", `${IP}/32`]);
    expect(r.out).toMatch(/huérfana sin lease/);
    expect(e.lease(V1, IP, "vigente")).not.toBeNull();
  });

  it("sin lista de permanentes confiable, una /32 sin lease se deja (podría ser permanente)", () => {
    const e = entorno();
    e.setReglas(V1, [`${OTRA}/32`]);
    const r = e.run("reconcile", { VAULTS: V1, PERMANENT_FILE: e.perm });
    expect(r.status).toBe(0);
    expect(e.reglas(V1)).toEqual([`${OTRA}/32`]);
    expect(r.out).toMatch(/Lista de reglas permanentes desconocida/);
  });

  it("si no puede quitar una regla vencida falla (alerta) y conserva el lease para reintentar", () => {
    const e = entorno();
    e.run("open", { ...abrir, VAULTS: V1 });
    e.vencer(V1, IP, "123-1-plan-apply");
    const r = e.run("reconcile", { ...rec, VAULTS: V1, PERMANENT_FILE: e.perm, AZ_FALLA_REMOVE: "1" });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/::error::No se pudo quitar una regla vencida/);
    expect(e.reglas(V1)).toEqual([`${IP}/32`]);
    expect(e.lease(V1, IP, "123-1-plan-apply")).not.toBeNull();
  });

  it("si no puede leer reglas o leases falla en vez de dar por bueno", () => {
    const e = entorno();
    e.run("open", { ...abrir, VAULTS: V1 });
    const r = e.run("reconcile", { ...rec, VAULTS: V1, PERMANENT_FILE: e.perm, AZ_FALLA_LIST: "1" });
    expect(r.status).not.toBe(0);
    expect(e.reglas(V1)).toEqual([`${IP}/32`]);
  });
});

describe("INFRA-05 — contrato de los workflows", () => {
  const tf = readFileSync(join(process.cwd(), ".github/workflows/terraform.yml"), "utf8");
  const rc = readFileSync(join(process.cwd(), ".github/workflows/kv-firewall-reconcile.yml"), "utf8");
  // Bloque de un job (indentación 2) y de un paso (indentación 6) por texto: no hay parser YAML entre las deps.
  const job = (name: string) => {
    const start = tf.indexOf(`\n  ${name}:\n`);
    const rest = tf.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  };
  const step = (block: string, marker: string) => {
    const at = block.indexOf(marker);
    const start = block.lastIndexOf("\n      - ", at);
    const next = block.indexOf("\n      - ", at);
    return block.slice(start, next === -1 ? undefined : next);
  };
  const num = (txt: string, re: RegExp) => Number(txt.match(re)?.[1]);

  for (const name of ["plan-apply", "drift"]) {
    it(`${name}: lease antes de abrir, TTL > timeout del job, cierre con timeout y vía script`, () => {
      const j = job(name);
      const timeout = num(j, /^ {4}timeout-minutes: (\d+)$/m);
      expect(timeout).toBeGreaterThan(0);
      const open = step(j, "id: kv_firewall");
      expect(num(open, /TTL_MINUTES: '(\d+)'/)).toBeGreaterThan(timeout);
      expect(open).toMatch(/LEASE_ID: \$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}-\$\{\{ github\.job \}\}/);
      expect(open).not.toMatch(/network-rule add/);
      const idxOut = open.indexOf('"$GITHUB_OUTPUT"');
      expect(idxOut).toBeGreaterThan(-1);
      expect(idxOut).toBeLessThan(open.indexOf('kv-firewall-lease.sh" open'));
      const close = step(j, "name: Cerrar el Key Vault");
      expect(close).toMatch(/if: always\(\) && steps\.kv_firewall\.outputs\.runner_ip != ''/);
      expect(close).toMatch(/timeout-minutes: \d+/);
      expect(close).toMatch(/kv-firewall-lease\.sh" close/);
      expect(close).not.toMatch(/network-rule remove/);
      const container = (t: string) => t.match(/LEASE_CONTAINER: (.+)/)?.[1];
      expect(container(close)).toBe(container(open));
      expect(close).toContain("LEASE_ID: ${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}");
    });
  }

  it("el reconciliador corre por cron, al terminar terraform y a mano, en un runner propio", () => {
    expect(rc).toContain("- cron: '*/15 * * * *'");
    expect(rc).toMatch(/workflow_run:\n\s+workflows: \[terraform\]\n\s+types: \[completed\]/);
    expect(rc).toMatch(/kv-firewall-lease\.sh" reconcile/);
    expect(rc).toMatch(/s\.keyvault_allowed_ip_rules/);
    // Sin backend: no toma el lock del state que puede tener un apply en curso.
    expect(rc).toMatch(/terraform init -input=false -backend=false/);
    expect(rc).toMatch(/environment: \[prod, staging\]/);
    expect(rc).toMatch(/fail-fast: false/);
  });

  it("el mapeo stamp→vault y stamp→reglas produce las líneas que lee el script", () => {
    const step = rc.slice(rc.indexOf("name: Quitar reglas temporales"));
    const filtro = step.match(/'(to_entries\[\][^']+)'/)?.[1];
    expect(filtro).toBeTruthy();
    const base = mkdtempSync(join(tmpdir(), "kv-fw-jq-"));
    dirs.push(base);
    const perm = join(base, "perm.json");
    writeFileSync(perm, JSON.stringify({ us: ["192.0.2.10", "192.0.2.0/28"], eu: [] }));
    const r = spawnSync("jq", ["-r", "--slurpfile", "perm", perm, filtro!], {
      input: JSON.stringify({ us: "kv-us", eu: "kv-eu", ap: "kv-ap" }),
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toEqual(["kv-us 192.0.2.10", "kv-us 192.0.2.0/28"]);
  });
});
