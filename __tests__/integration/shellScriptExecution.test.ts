// @vitest-environment node
// AISEC-01: verificación empírica de que los nombres que pasan los guards no alteran la
// estructura de los scripts. Shells POSIX: se EJECUTA con PATH vacío y todo comando cae en
// un handler que sólo registra argv (nada externo corre). PowerShell: sólo se PARSEA
// (Az puede estar instalado) y se compara la secuencia de tokens. Invariante en ambos:
// script(V) == script("zzz") con V -> "zzz". Un control negativo prueba que el harness
// detecta inyección.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import * as rem from "@/lib/aiRemediations";
import { guardScripts, isSafeAction, UNSAFE_SCRIPT } from "@/lib/shellSafe";
import { generateMockEventHubsData } from "@/services/azureEventHubs.service";
import { generateMockServiceBusData } from "@/services/azureServiceBus.service";
import { generateMockApimData } from "@/services/azureApim.service";
import { getMockAlertsPayload } from "@/services/azureAlertsRules.service";
import { getMockActionGroupsPayload } from "@/services/azureActionGroups.service";
import { getMockLoadBalancingData } from "@/services/azureLoadBalancing.service";
import { getMockBasicNetworkingResponse } from "@/services/azureBasicNetworking.service";
import { getMockInternetAccessData } from "@/services/azureInternetAccess.service";
import { getMockHybridConnectivityData } from "@/services/azureHybridConnectivity.service";
import { generateMockLogicAppsData } from "@/services/azureLogicApps.service";
import { generateMockDatabricksData } from "@/services/azureDatabricks.service";
import { generateMockAppInsightsData } from "@/services/azureAppInsights.service";

const has = (bin: string, args: string[]) => spawnSync(bin, args, { encoding: "utf8" }).status === 0;
const BASH4 = ["/usr/bin/bash", "/bin/bash", "/opt/homebrew/bin/bash", "/usr/local/bin/bash"].find(
  (b) => has(b, ["-c", "[ ${BASH_VERSINFO[0]} -ge 4 ]"]),
);
const SHELLS: [string, string][] = [
  ...(has("/bin/zsh", ["-c", "true"]) ? [["zsh", "/bin/zsh"] as [string, string]] : []),
  ...(BASH4 ? [["bash", BASH4] as [string, string]] : []),
];
const PWSH = has("pwsh", ["-NoProfile", "-c", "exit 0"]);

const PRELUDE = [
  "exec 3>&1 1>/dev/null 2>/dev/null",
  "rec() { printf '%s\\001' \"$@\" >&3; printf '\\002' >&3; return 0; }",
  "command_not_found_handle() { rec \"$@\"; }",
  "command_not_found_handler() { rec \"$@\"; }",
  "PATH=/nonexistent-aisec01",
].join("\n");

/** argv de cada comando que el script intentó ejecutar. */
function runPosix(shell: string, script: string): string {
  const r = spawnSync(shell, ["-c", `${PRELUDE}\n${script}`], {
    encoding: "utf8",
    env: { PATH: "/nonexistent-aisec01", HOME: "/nonexistent-aisec01" },
    timeout: 10_000,
  });
  return r.stdout;
}

/** Tokens de PowerShell (Kind + Text) por script, sin ejecutar. */
function pwshTokens(scripts: string[]): string[][] {
  const ps = `
$in = [Console]::In.ReadToEnd() | ConvertFrom-Json
$out = foreach ($s in $in) {
  $t = $null; $e = $null
  [void][System.Management.Automation.Language.Parser]::ParseInput([string]$s, [ref]$t, [ref]$e)
  ,@($t | ForEach-Object { "$($_.Kind)|$($_.Text)" })
}
ConvertTo-Json -InputObject @($out) -Depth 4 -Compress`;
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-c", ps], {
    input: JSON.stringify(scripts),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

const NEUTRAL = "zzz";
const swap = (s: string, v: string) => s.split(v).join(NEUTRAL);

// Borde de cada guard: todo lo que el guard deja pasar, junto. Sin "/": es el separador del
// resourceId (los builders derivan nombres con split("/")) y ARM no lo admite en nombres.
const STRICT_EDGE = "Ñandú vm_01.(eu):a@b+c-e";
const LOOSE_EDGE = "R&D; Ops | a<b>c (O'Brien) #1 %PATH% *?[x]{y}~^=,&& ñ";
const HOSTILE = `x"; touch PWNED; echo "`;

type Case = { label: string; script: string; neutral: string; value: string; posix: boolean };

function builderCases(value: string): Case[] {
  const out: Case[] = [];
  const builders = Object.entries(rem).filter(([n]) => /^build\w+RemediationCommand$/.test(n)) as [
    string,
    (a: unknown) => { cli: string; powershell: string },
  ][];
  const mk = (name: string, category: string) => ({
    category,
    resourceId: `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/${name}/providers/Microsoft.X/y/${name}`,
    resourceName: name,
    vaultName: name,
    targetId: name,
    policyName: name,
    affectedPrincipals: [name],
    recommendedCapacity: 1,
  });
  for (const [n, fn] of builders) {
    for (const category of ["DELETE", "RIGHTSIZING", "PURGE_ORPHAN", "X"]) {
      let a, z;
      try {
        a = fn(mk(value, category));
        z = fn(mk(NEUTRAL, category));
      } catch {
        continue; // el builder necesita campos de su dominio que este fixture genérico no trae
      }
      if (a.cli === UNSAFE_SCRIPT.cli) continue;
      out.push({ label: `${n}/${category}/cli`, script: a.cli, neutral: z.cli, value, posix: true });
      out.push({ label: `${n}/${category}/ps`, script: a.powershell, neutral: z.powershell, value, posix: false });
    }
  }
  return out;
}

const MOCKS: Record<string, () => unknown> = {
  eventHubs: generateMockEventHubsData,
  serviceBus: generateMockServiceBusData,
  apim: generateMockApimData,
  alerts: () => getMockAlertsPayload("t"),
  actionGroups: () => getMockActionGroupsPayload("t"),
  loadBalancing: () => getMockLoadBalancingData("t"),
  basicNetworking: () => getMockBasicNetworkingResponse("t"),
  internetAccess: () => getMockInternetAccessData("t"),
  hybrid: () => getMockHybridConnectivityData("t"),
  logicApps: generateMockLogicAppsData,
  databricks: generateMockDatabricksData,
  appInsights: generateMockAppInsightsData,
};
const NAME_KEYS = ["resourceName", "name", "diskName", "vaultName", "namespaceName", "workspaceName"];

/** Templates reales de servicios: se reemplaza el nombre del recurso de la acción por `value`. */
function serviceCases(value: string): Case[] {
  const out: Case[] = [];
  const visit = (o: unknown, where: string) => {
    if (Array.isArray(o)) return o.forEach((x, i) => visit(x, `${where}[${i}]`));
    if (!o || typeof o !== "object") return;
    const obj = o as Record<string, unknown>;
    const cp = obj.commandPayload;
    const name = NAME_KEYS.map((k) => obj[k]).find((v) => typeof v === "string" && v.length >= 4) as string | undefined;
    if (cp != null && name) {
      const scripts: [string, string, boolean][] =
        typeof cp === "string"
          ? [["", cp, true], ["", cp, false]]
          : Object.entries(cp as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k, v as string, !/power/i.test(k)]);
      for (const [k, s, posix] of scripts) {
        if (!s.includes(name)) continue;
        out.push({ label: `${where}.${k}`, script: s.split(name).join(value), neutral: s.split(name).join(NEUTRAL), value, posix });
      }
    }
    for (const [k, v] of Object.entries(obj)) if (k !== "commandPayload") visit(v, `${where}.${k}`);
  };
  for (const [n, g] of Object.entries(MOCKS)) visit(g(), n);
  return out;
}

function posixInjected(shell: string, c: Case) {
  return swap(runPosix(shell, c.script), c.value) !== runPosix(shell, c.neutral);
}

function pwshInjected(cases: Case[]): string[] {
  const toks = pwshTokens(cases.flatMap((c) => [c.script, c.neutral]));
  return cases
    .filter((c, i) => JSON.stringify(toks[2 * i].map((t) => swap(t, c.value))) !== JSON.stringify(toks[2 * i + 1]))
    .map((c) => c.label);
}

describe("AISEC-01 — ejecución real de scripts generados", () => {
  const builders = builderCases(STRICT_EDGE);
  const services = serviceCases(LOOSE_EDGE);

  it("los valores de borde pasan los guards y hay casos que probar", () => {
    expect(isSafeAction({ resourceName: STRICT_EDGE })).toBe(true);
    expect(guardScripts({ resourceName: LOOSE_EDGE, commandPayload: "x" }).commandPayload).toBe("x");
    expect(builders.length).toBeGreaterThan(40);
    expect(services.length).toBeGreaterThan(20);
  });

  describe.each(SHELLS)("%s", (_n, shell) => {
    it("control negativo: sin guard, un nombre hostil sí inyecta", () => {
      const s = (v: string) => `az vm delete --name "${v}" --yes`;
      expect(posixInjected(shell, { label: "neg", script: s(HOSTILE), neutral: s(NEUTRAL), value: HOSTILE, posix: true })).toBe(true);
    });

    it("builders (allowlist estricta): ningún script cambia de estructura", () => {
      const bad = builders.filter((c) => c.posix && posixInjected(shell, c)).map((c) => c.label);
      expect(bad).toEqual([]);
    });

    it("templates de servicios (blocklist de guardScripts): ningún script cambia de estructura", () => {
      const bad = services.filter((c) => c.posix && posixInjected(shell, c)).map((c) => c.label);
      expect(bad).toEqual([]);
    });
  });

  describe.runIf(PWSH)("pwsh (parser de PowerShell 7)", () => {
    it("control negativo: sin guard, un nombre hostil sí inyecta", () => {
      const s = (v: string) => `az vm delete --name "${v}" --yes`;
      expect(pwshInjected([{ label: "neg", script: s(HOSTILE), neutral: s(NEUTRAL), value: HOSTILE, posix: false }])).toEqual(["neg"]);
      const q = (v: string) => `Remove-AzDisk -DiskName "${v}"`;
      const smart = "x\u201D; calc; \u201Cy";
      expect(pwshInjected([{ label: "smart", script: q(smart), neutral: q(NEUTRAL), value: smart, posix: false }])).toEqual(["smart"]);
    });

    it("builders y templates de servicios: ningún script cambia de estructura", () => {
      expect(pwshInjected([...builders, ...services])).toEqual([]);
    });
  });

  it("al menos un intérprete disponible", () => {
    expect(SHELLS.length + (PWSH ? 1 : 0)).toBeGreaterThan(0);
  });
});
