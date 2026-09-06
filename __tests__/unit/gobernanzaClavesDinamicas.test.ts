/**
 * Las claves que el panel arma en runtime — `col_${c.id}`, `issue_${cat}`,
 * `severity_${lvl}`, `pillar_${p}` y los `noteKey`/`detailKey` que viajan en el
 * payload — no las ve el test de integridad, que solo busca `t("literal")`.
 * Sin esto, agregar una columna y olvidar la traduccion se ve en pantalla como
 * el nombre crudo de la clave y ningun test falla.
 */
import { describe, it, expect } from "vitest";
import es from "@/../messages/es.json";
import en from "@/../messages/en.json";
import pt from "@/../messages/pt-BR.json";
import { HA_COLUMNS, REMEDIATION_COST_HINTS } from "@/types/azureHighAvailability.types";
import { NON_COMPLIANT_COLUMNS, RBAC_COLUMNS, PILLAR_WEIGHTS } from "@/types/azureGovernanceReporting.types";
import { buildPillarInputs } from "@/services/azureGovernanceReporting.service";
import { APPROVAL_ACTION_TYPES, APPROVAL_STATUSES, HISTORY_COLUMNS } from "@/types/azureRemediationApprovals.types";

const catalogos = { es, en, "pt-BR": pt } as unknown as Record<string, Record<string, Record<string, string>>>;

function esperar(ns: string, claves: string[]) {
    const faltan: string[] = [];
    for (const [loc, cat] of Object.entries(catalogos)) {
        for (const k of claves) if (cat[ns]?.[k] === undefined) faltan.push(`${loc}.${ns}.${k}`);
    }
    expect(faltan, `claves dinamicas sin traduccion:\n  ${faltan.join("\n  ")}`).toEqual([]);
}

describe("gobernanza — claves armadas en runtime", () => {
    it("cada columna de HA tiene su col_<id> en los tres idiomas", () => {
        esperar("GovernanceHa", HA_COLUMNS.map((c) => `col_${c.id}`));
    });

    it("cada categoria de problema de HA tiene issue_<cat> y su costNote", () => {
        const cats = Object.keys(REMEDIATION_COST_HINTS);
        esperar("GovernanceHa", [
            ...cats.map((c) => `issue_${c}`),
            ...Object.values(REMEDIATION_COST_HINTS).map((h) => h.noteKey),
        ]);
    });

    it("cada nivel de severidad de HA tiene severity_<nivel>", () => {
        esperar("GovernanceHa", ["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => `severity_${s}`));
    });

    it("cada columna del reporting tiene su col_<id>", () => {
        esperar("GovernanceReporting", [...NON_COMPLIANT_COLUMNS, ...RBAC_COLUMNS].map((c) => `col_${c.id}`));
    });

    it("cada pilar del score tiene pillar_<nombre>", () => {
        esperar("GovernanceReporting", Object.keys(PILLAR_WEIGHTS).map((p) => `pillar_${p}`));
    });

    it("cada columna, accion y estado de aprobaciones tiene su clave", () => {
        esperar("RemediationApprovals", [
            ...HISTORY_COLUMNS.map((c) => `col_${c.id}`),
            ...APPROVAL_ACTION_TYPES.map((a) => `action_${a}`),
            ...APPROVAL_STATUSES.map((s) => `status_${s}`),
        ]);
    });

    it("los detailKey que emite buildPillarInputs existen, con y sin datos", () => {
        const conDatos = buildPillarInputs({
            compliantResources: 90, nonCompliantResources: 10, policyDataAvailable: true,
            taggedResources: 80, totalResources: 100, totalRbacAssignments: 50, orphanedSids: 2, zombieResources: 4,
        });
        const sinDatos = buildPillarInputs({
            compliantResources: 0, nonCompliantResources: 0, policyDataAvailable: false,
            taggedResources: 0, totalResources: 0, totalRbacAssignments: 0, orphanedSids: 0, zombieResources: 0,
        });
        esperar("GovernanceReporting", [
            ...Object.values(conDatos).map((p) => p.detailKey),
            ...Object.values(sinDatos).map((p) => p.detailKey),
            "pillarNoData",
        ]);
    });
});
