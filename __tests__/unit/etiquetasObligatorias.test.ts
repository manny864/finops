// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
    GLOBAL_MANDATORY_TAGS,
    TAG_SUGGESTED_VALUES,
    kqlFaltanEtiquetasObligatorias,
} from "@/lib/tagConfig";
import { kqlCatalog } from "@/modules/core/kqlCatalog";

const RAIZ = join(__dirname, "..", "..");
const sinComentarios = (ruta: string) =>
    readFileSync(join(RAIZ, ruta), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "");

/**
 * Una sola definición de "etiquetas FinOps obligatorias".
 *
 * Había tres y no coincidían (2026-09-04):
 *   - `GLOBAL_MANDATORY_TAGS` → Environment, Role, CostCenter, Department
 *   - el KQL del detector     → CostCenter, Owner, Environment
 *   - el modal de remediación → CostCenter, Environment, Owner
 *
 * Un recurso con las cuatro de la política pero sin `Owner` --que no es
 * obligatoria en ninguna-- salía "100% Compliant" en governance/tags y
 * "Sin Etiquetas FinOps" en financial-leaks al mismo tiempo. Y remediarlo desde
 * el modal no lo arreglaba: escribía justamente las tres que no eran.
 */
describe("etiquetas obligatorias: una sola definición", () => {
    it("el KQL del detector se arma con TODAS las obligatorias y sólo con ésas", () => {
        const kql = kqlFaltanEtiquetasObligatorias();
        for (const tag of GLOBAL_MANDATORY_TAGS) {
            expect(kql, `${tag} es obligatoria y el detector no la mira`).toContain(`['${tag.toLowerCase()}']`);
        }
        // El bug al revés: exigir una que la política no pide marca como
        // incumplidor a un recurso que governance/tags da por conforme.
        expect(kql.toLowerCase(), "el detector exige 'owner', que no está en la política").not.toContain("owner");
    });

    it("compara sin distinguir mayúsculas", () => {
        // El acceso dinámico de Resource Graph SÍ distingue, y las etiquetas de
        // Azure no: `environment=prod` daba isnull(tags.Environment) y salía
        // como incumplidor. La auditoría de governance/tags ya normalizaba.
        expect(kqlFaltanEtiquetasObligatorias()).toContain("tolower(tostring(tags))");
    });

    it("una etiqueta presente pero vacía no cumple", () => {
        expect(kqlFaltanEtiquetasObligatorias()).toContain("isempty(");
    });

    it("el catálogo KQL usa el predicado compartido, no uno propio", () => {
        const kql = kqlCatalog.taggingNonCompliance;
        expect(kql).toContain("etiquetas = todynamic(tolower(tostring(tags)))");
        expect(kql).toContain("| project id, name, type, location, resourceGroup, subscriptionId");
    });

    it("toda obligatoria tiene vocabulario sugerido para el modal", () => {
        for (const tag of GLOBAL_MANDATORY_TAGS) {
            expect(TAG_SUGGESTED_VALUES[tag]?.length, `${tag} sin valores sugeridos`).toBeGreaterThan(0);
        }
    });
});

describe("remediación de etiquetas desde el tablero de fugas", () => {
    const tabla = sinComentarios("src/components/ZombieResourcesTable.tsx");

    it("el botón aparece para las DOS claves que muestran el mismo badge", () => {
        // `completelyUntaggedResources` --un recurso sin NINGUNA etiqueta--
        // mostraba "Sin Etiquetas FinOps" con Delete y Eximir como únicas
        // acciones: el único problema del listado que tiene arreglo real era
        // justo el que no ofrecía cómo arreglarlo.
        for (const clave of ["taggingNonCompliance", "completelyUntaggedResources"]) {
            expect(
                tabla,
                `el gate del botón de etiquetar no contempla ${clave}`
            ).toMatch(new RegExp(`isTagCompliance[\\s\\S]{0,200}${clave}`));
        }
    });

    it("el modal se arma sobre la lista compartida, no con campos a mano", () => {
        expect(tabla).toContain("GLOBAL_MANDATORY_TAGS.map");
        expect(
            tabla,
            "volvieron los campos hardcodeados: aplicarlos deja al recurso incumplidor igual"
        ).not.toMatch(/tagValues\.(CostCenter|Owner|Environment)/);
    });

    it("no se autocompletan valores inventados", () => {
        // La versión anterior rellenaba Owner con "CloudOps@company.com" y
        // CostCenter con "Core-Infrastructure": valores que no existen en
        // ninguna política del cliente, aplicados sobre recursos reales.
        expect(tabla).not.toContain("@company.com");
        expect(tabla).not.toContain("Core-Infrastructure");
    });
});
