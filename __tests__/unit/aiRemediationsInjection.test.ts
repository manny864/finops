// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as rem from "@/lib/aiRemediations";
import { UNSAFE_SCRIPT } from "@/lib/shellSafe";

// AISEC-01: ningún nombre hostil llega a los scripts az / PowerShell.
const EVIL = [
  `x"; calc; "`,
  "x$(calc)",
  "x`calc`",
  "x'; calc; '",
  "x\nwhoami",
  "x|iex",
  "x&&id",
  "x\u202Eevil",
  "x\u201Dcalc",
  "--query=x",
  "x%PATH%",
];

const builders = Object.entries(rem).filter(([n]) => /^build\w+RemediationCommand$/.test(n)) as [string, (a: any) => { cli: string; powershell: string }][];

const action = (name: string, category: string) => ({
  category,
  resourceId: `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/${name}/providers/Microsoft.X/y/${name}`,
  resourceName: name,
  vaultName: name,
  targetId: name,
  policyName: name,
  affectedPrincipals: [name],
  recommendedCapacity: 1,
});

describe("builders de remediación — inyección de comandos", () => {
  it("hay builders que probar", () => expect(builders.length).toBeGreaterThan(20));

  it.each(builders)("%s rechaza nombres hostiles", (_n, fn) => {
    for (const evil of EVIL) {
      for (const category of ["DELETE", "RIGHTSIZING", "PURGE_ORPHAN", "X"]) {
        const out = fn(action(evil, category));
        expect(out).toEqual(UNSAFE_SCRIPT);
      }
    }
  });

  it("nombres legítimos siguen generando script", () => {
    for (const ok of ["rg-prod-01", "vm (copia)", "Árbol_1"]) {
      const out = rem.buildApimRemediationCommand(action(ok, "RIGHTSIZING") as any);
      expect(out.cli).not.toEqual(UNSAFE_SCRIPT.cli);
      expect(out.cli).toContain(ok);
    }
  });

  it("recommendedQuery va entre comillas simples", () => {
    const out = rem.buildAzureMonitorRemediationCommand({
      ...action("alert-1", "KQL_OPTIMIZE"),
      recommendedQuery: `traces | where x == "a" | where y == '$(calc)'`,
    } as any);
    expect(out.cli).toContain(`--query 'traces | where x == "a" | where y == '\\''$(calc)'\\'''`);
  });
});
