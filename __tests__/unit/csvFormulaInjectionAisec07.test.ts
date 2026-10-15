// @vitest-environment node
/**
 * AISEC-07 — CSV/formula injection (CWE-1236). Un texto que empieza con = + - @ TAB CR
 * sale con `'` delante en todos los exports; los números legítimos no se tocan.
 */
import { describe, it, expect } from "vitest";
import { csvEscape, csvQuote, neutralizeCsvFormula, toCsvText, buildCsv } from "@/lib/csvExport";
import { buildFocusCsvRow } from "@/lib/focus/csv";
import { emptyFocusRecord } from "@/lib/focus/columns";
import { serializeAuditTrailCsv } from "@/services/auditTrail.service";
import { toCsv } from "@/services/azureGovernanceReporting.service";
import { serializeBillingCsv } from "@/services/billingReport.service";
import { buildLifecycleCsv } from "@/lib/tenantLifecycleReport";

const PAYLOADS = ['=HYPERLINK("http://evil","x")', "+cmd|' /C calc'!A0", "@SUM(1+1)", "-2+3", "\t=1+1", "\r=1+1"];

/** La celda parseada (sin comillas RFC 4180) arranca con `'`. */
const unquote = (c: string) => (c.startsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c);

describe("neutralizeCsvFormula / csvEscape", () => {
    it.each(PAYLOADS)("%j sale precedido por '", (p) => {
        expect(neutralizeCsvFormula(p)).toBe(`'${p}`);
        expect(unquote(csvEscape(p)).startsWith("'")).toBe(true);
        expect(unquote(csvQuote(p)).startsWith("'")).toBe(true);
    });

    it.each([-12.5, 0, 3, "-12.5", "+3", "-0,5", "1e-3", "-1.2E+5"])("número legítimo %j no se prefija", (n) => {
        expect(csvEscape(n)).not.toContain("'");
    });

    it("texto normal intacto; comas, ; y comillas entrecomilladas", () => {
        expect(csvEscape("vm-prod")).toBe("vm-prod");
        expect(csvEscape("a,b")).toBe('"a,b"');
        expect(csvEscape("a;b")).toBe('"a;b"');
        expect(csvEscape('di "hola"')).toBe('"di ""hola"""');
        expect(csvEscape(null)).toBe("");
    });

    it("toCsvText aplica a encabezados y celdas", () => {
        expect(toCsvText(["=h"], [["@x", -1]])).toBe("'=h\n'@x,-1");
    });
});

describe("exports del servidor", () => {
    const evil = '=HYPERLINK("http://evil","x")';

    it("auditoría legacy (buildCsv): resource_id y user_email", () => {
        const csv = buildCsv([{ id: 1, timestamp: "t", user_email: "@a", action_type: "x", resource_id: evil, status: "ok" }]);
        expect(csv).toContain(`'@a`);
        expect(csv).toContain(`"'=HYPERLINK`);
    });

    it("FOCUS: texto prefijado, montos negativos intactos", () => {
        const rec = { ...emptyFocusRecord(), ResourceName: evil, BilledCost: -12.5 } as never;
        const row = buildFocusCsvRow(rec);
        expect(row).toContain(`"'=HYPERLINK`);
        expect(row).toContain(",-12.5");
        expect(row).not.toContain("'-12.5");
    });

    it("audit trail", () => {
        const csv = serializeAuditTrailCsv([
            { id: 1, createdAtIso: "t", userEmail: "+x@y", userName: "", actionType: "a", resourceTargetName: evil, status: "SUCCESS", ipAddress: "" } as never,
        ]);
        expect(csv).toContain(`"'+x@y"`);
        expect(csv).toContain(`"'=HYPERLINK`);
    });

    it("gobernanza (toCsv)", () => {
        expect(toCsv([["@SUM(1)", "-2+3"]])).toBe(`"'@SUM(1)","'-2+3"`);
    });

    it("facturación (serializeBillingCsv): cliente prefijado, costo negativo no", () => {
        const csv = serializeBillingCsv([
            { dateIso: "2026-01-01", customerId: "c", customerName: evil, serviceName: "s", resourceGroup: "-rg", originalCostUSD: -1, adjustedCostUSD: -1 } as never,
        ]);
        expect(csv).toContain(`"'=HYPERLINK`);
        expect(csv).toContain(`"'-rg"`);
        expect(csv).toContain(`"-1.00"`);
    });

    it("ciclo de vida de tenants", () => {
        const csv = buildLifecycleCsv([{ tenantId: "t", organizationName: evil, subscriptionStatus: "ACTIVE", planTier: "Business", cancellationReason: "@x" } as never]);
        expect(csv).toContain(`"'=HYPERLINK`);
        expect(csv).toContain(`'@x`);
    });

    it("ningún export del servidor arma celdas con un escape propio sin neutralizar", async () => {
        const { execSync } = await import("child_process");
        const out = execSync(`git grep -n -E "replace\\(/\\"/g, '\\"\\"'\\)" -- src/app/api src/services src/lib`, { encoding: "utf8" })
            .trim()
            .split("\n")
            .filter((l) => l && !l.startsWith("src/lib/csvExport.ts"));
        expect(out).toEqual([]);
    });
});
