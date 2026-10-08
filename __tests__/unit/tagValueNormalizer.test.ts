import { describe, it, expect } from "vitest";
import {
    editDistance,
    findInvalidTagValues,
    normalizeTagValue,
    parseAllowedValues,
    tagValueKey,
    type TagValueAlias,
} from "@/lib/tagValueNormalizer";

const ENV = ["prod", "stg", "dev", "qa", "sandbox"];
const ROLE = ["database", "api", "frontend", "backup", "orchestrator", "network", "storage", "worker"];
const ALIAS_ENV: TagValueAlias[] = [
    { alias: "production", canonicalValue: "prod" },
    { alias: "produccion", canonicalValue: "prod" },
    { alias: "staging", canonicalValue: "stg" },
    { alias: "preprod", canonicalValue: "stg" },
    { alias: "test", canonicalValue: "qa" },
    { alias: "teste", canonicalValue: "qa" },
];

describe("tagValueKey", () => {
    it("pasa a minúsculas y saca acentos y separadores", () => {
        expect(tagValueKey("Producción")).toBe("produccion");
        expect(tagValueKey("Pre-Prod")).toBe("preprod");
        expect(tagValueKey(" pre_prod ")).toBe("preprod");
        expect(tagValueKey("Pre Producción")).toBe("preproduccion");
        expect(tagValueKey("homologação")).toBe("homologacao");
        expect(tagValueKey("Diseño.Web/UI")).toBe("disenowebui");
    });

    it("conserva los dígitos", () => {
        expect(tagValueKey("CC-1001")).toBe("cc1001");
    });

    it("con valores vacíos o sólo separadores devuelve vacío", () => {
        expect(tagValueKey("")).toBe("");
        expect(tagValueKey("  -_. ")).toBe("");
        expect(tagValueKey(undefined as unknown as string)).toBe("");
    });
});

describe("parseAllowedValues", () => {
    it("acepta el arreglo que devuelve mysql2 ya parseado", () => {
        expect(parseAllowedValues(["prod", "dev"])).toEqual(["prod", "dev"]);
    });

    it("acepta el JSON como string", () => {
        expect(parseAllowedValues('["prod","dev"]')).toEqual(["prod", "dev"]);
    });

    it("recorta, saca vacíos, no-strings y duplicados", () => {
        expect(parseAllowedValues([" prod ", "", "dev", 3, null, "prod"])).toEqual(["prod", "dev"]);
    });

    it("null, arreglo vacío, JSON inválido o no-arreglo = valor libre", () => {
        expect(parseAllowedValues(null)).toBeNull();
        expect(parseAllowedValues(undefined)).toBeNull();
        expect(parseAllowedValues([])).toBeNull();
        expect(parseAllowedValues(["", "  "])).toBeNull();
        expect(parseAllowedValues("no-es-json")).toBeNull();
        expect(parseAllowedValues('{"a":1}')).toBeNull();
        expect(parseAllowedValues(42)).toBeNull();
    });
});

describe("editDistance", () => {
    it.each([
        ["prod", "prod", 0],
        ["prod", "prd", 1],
        ["prod", "prods", 1],
        ["prod", "prid", 1],
        ["prdo", "prod", 1],
        ["frntendd", "frontend", 2],
        ["", "abc", 3],
        ["abc", "", 3],
        ["kitten", "sitting", 3],
    ])("%s -> %s = %i", (a, b, d) => {
        expect(editDistance(a, b)).toBe(d);
        expect(editDistance(b, a)).toBe(d);
    });
});

describe("normalizeTagValue", () => {
    describe("sin nada que sugerir", () => {
        it("tag de valor libre (sin permitidos)", () => {
            expect(normalizeTagValue("cualquiera", null)).toEqual({ normalized: null, method: null, confidence: 0 });
            expect(normalizeTagValue("cualquiera", undefined)).toEqual({ normalized: null, method: null, confidence: 0 });
            expect(normalizeTagValue("cualquiera", [])).toEqual({ normalized: null, method: null, confidence: 0 });
        });

        it("valor vacío o sólo separadores", () => {
            expect(normalizeTagValue("", ENV)).toEqual({ normalized: null, method: null, confidence: 0 });
            expect(normalizeTagValue("   ", ENV)).toEqual({ normalized: null, method: null, confidence: 0 });
            expect(normalizeTagValue("--", ENV)).toEqual({ normalized: null, method: null, confidence: 0 });
        });

        it("valor que no se parece a nada", () => {
            expect(normalizeTagValue("marketing", ENV, ALIAS_ENV)).toEqual({ normalized: null, method: null, confidence: 0 });
        });
    });

    describe("exact", () => {
        it("un valor ya permitido es exacto", () => {
            expect(normalizeTagValue("prod", ENV)).toEqual({ normalized: "prod", method: "exact", confidence: 1 });
        });

        it("ignora mayúsculas, espacios, acentos y separadores", () => {
            expect(normalizeTagValue("Prod", ENV).normalized).toBe("prod");
            expect(normalizeTagValue("PROD", ENV).method).toBe("exact");
            expect(normalizeTagValue("dev ", ENV)).toEqual({ normalized: "dev", method: "exact", confidence: 1 });
            expect(normalizeTagValue("Q.A.", ENV).normalized).toBe("qa");
            expect(normalizeTagValue("Data Base", ROLE)).toEqual({ normalized: "database", method: "exact", confidence: 1 });
            expect(normalizeTagValue("FRONT-END", ROLE).normalized).toBe("frontend");
        });

        it("devuelve el permitido tal como está escrito en la política", () => {
            expect(normalizeTagValue("production", ["Production", "Dev"])).toEqual({
                normalized: "Production",
                method: "exact",
                confidence: 1,
            });
        });

        it("si dos permitidos tienen la misma forma, prefiere el idéntico y si no el primero", () => {
            expect(normalizeTagValue("prod", ["Prod", "prod"]).normalized).toBe("prod");
            expect(normalizeTagValue("PROD", ["Prod", "prod"]).normalized).toBe("Prod");
        });

        it("gana sobre un alias con la misma forma", () => {
            const r = normalizeTagValue("Dev", ENV, [{ alias: "dev", canonicalValue: "qa" }]);
            expect(r).toEqual({ normalized: "dev", method: "exact", confidence: 1 });
        });
    });

    describe("alias", () => {
        it("resuelve por alias con confianza 0.95", () => {
            expect(normalizeTagValue("production", ENV, ALIAS_ENV)).toEqual({
                normalized: "prod",
                method: "alias",
                confidence: 0.95,
            });
        });

        it("compara el alias por su forma comparable", () => {
            expect(normalizeTagValue("Producción", ENV, ALIAS_ENV).normalized).toBe("prod");
            expect(normalizeTagValue("PRE-PROD", ENV, ALIAS_ENV)).toEqual({ normalized: "stg", method: "alias", confidence: 0.95 });
            expect(normalizeTagValue("prod", ["prod"], [{ alias: "Pre Prod", canonicalValue: "prod" }]).normalized).toBe("prod");
            expect(normalizeTagValue("PreProd", ["prod"], [{ alias: "Pre Prod", canonicalValue: "prod" }]).method).toBe("alias");
        });

        it("ubica el canónico entre los permitidos por su forma comparable", () => {
            const r = normalizeTagValue("production", ["Prod", "Dev"], [{ alias: "production", canonicalValue: "prod" }]);
            expect(r).toEqual({ normalized: "Prod", method: "alias", confidence: 0.95 });
        });

        it("el primer alias que resuelve gana (los del tenant van antes que los globales)", () => {
            const tenant = { alias: "test", canonicalValue: "stg" };
            const global = { alias: "test", canonicalValue: "qa" };
            expect(normalizeTagValue("test", ENV, [tenant, global]).normalized).toBe("stg");
            expect(normalizeTagValue("test", ENV, [global, tenant]).normalized).toBe("qa");
        });

        it("ignora un alias cuyo canónico ya no es un valor permitido y sigue con el próximo", () => {
            const viejo = { alias: "test", canonicalValue: "testing" };
            const global = { alias: "test", canonicalValue: "qa" };
            expect(normalizeTagValue("test", ENV, [viejo]).normalized).toBeNull();
            expect(normalizeTagValue("test", ENV, [viejo, global]).normalized).toBe("qa");
        });
    });

    describe("fuzzy", () => {
        it("corrige un error de tipeo contra un permitido", () => {
            expect(normalizeTagValue("sandbx", ENV)).toEqual({ normalized: "sandbox", method: "fuzzy", confidence: 0.86 });
            expect(normalizeTagValue("prodd", ENV)).toEqual({ normalized: "prod", method: "fuzzy", confidence: 0.8 });
            expect(normalizeTagValue("databse", ROLE)).toEqual({ normalized: "database", method: "fuzzy", confidence: 0.88 });
        });

        it("también compara contra los alias y sugiere su canónico", () => {
            expect(normalizeTagValue("stagin", ENV, ALIAS_ENV)).toEqual({ normalized: "stg", method: "fuzzy", confidence: 0.86 });
            expect(normalizeTagValue("prodution", ENV, ALIAS_ENV)).toEqual({ normalized: "prod", method: "fuzzy", confidence: 0.9 });
        });

        it("cuenta una transposición como una sola edición", () => {
            expect(normalizeTagValue("sandobx", ENV)).toMatchObject({ normalized: "sandbox", method: "fuzzy" });
            expect(normalizeTagValue("frontedn", ROLE)).toEqual({ normalized: "frontend", method: "fuzzy", confidence: 0.88 });
        });

        it("con 8 o más caracteres admite hasta 2 ediciones", () => {
            expect(normalizeTagValue("frntendd", ROLE)).toEqual({ normalized: "frontend", method: "fuzzy", confidence: 0.75 });
            expect(normalizeTagValue("orchestrtr", ROLE)).toEqual({ normalized: "orchestrator", method: "fuzzy", confidence: 0.83 });
            expect(normalizeTagValue("frntenddd", ROLE).normalized).toBeNull();
        });

        it("con 5 a 7 caracteres admite sólo 1 edición", () => {
            expect(normalizeTagValue("sndbox", ENV).normalized).toBe("sandbox");
            expect(normalizeTagValue("sndbx", ENV).normalized).toBeNull();
            expect(normalizeTagValue("stroge", ROLE).normalized).toBeNull();
        });

        it("no prueba distancia con valores cortos (menos de 5 caracteres)", () => {
            expect(normalizeTagValue("prdo", ENV).normalized).toBeNull();
            expect(normalizeTagValue("dve", ENV).normalized).toBeNull();
            expect(normalizeTagValue("qas", ENV).normalized).toBeNull();
        });

        it("si dos canónicos distintos empatan, no sugiere", () => {
            expect(normalizeTagValue("alpha3", ["alpha1", "alpha2"])).toEqual({ normalized: null, method: null, confidence: 0 });
        });

        it("dos candidatos del mismo canónico no son un empate", () => {
            expect(normalizeTagValue("tests", ENV, ALIAS_ENV)).toEqual({ normalized: "qa", method: "fuzzy", confidence: 0.8 });
        });

        it("el candidato más cercano gana aunque antes hubiera un empate más lejano", () => {
            const r = normalizeTagValue("abcdefgh", ["abcdefxy", "abcdefzw", "abcdefgx"]);
            expect(r).toEqual({ normalized: "abcdefgx", method: "fuzzy", confidence: 0.88 });
        });

        it("no usa alias cuyo canónico no está permitido", () => {
            expect(normalizeTagValue("stagin", ["prod", "dev"], ALIAS_ENV).normalized).toBeNull();
        });
    });
});

describe("findInvalidTagValues", () => {
    const POLS = [
        { tagName: "Environment", allowedValues: ENV },
        { tagName: "Role", allowedValues: ROLE },
        { tagName: "CostCenter" },
        { tagName: "Owner", allowedValues: [] },
    ];

    it("sólo marca tags presentes con un valor fuera de la lista", () => {
        const r = findInvalidTagValues(
            { Environment: "Production", Role: "api", CostCenter: "lo-que-sea", Owner: "ana" },
            POLS,
            new Map([["environment", ALIAS_ENV]]),
        );
        expect(r).toEqual([
            {
                tagName: "Environment",
                tagKey: "Environment",
                value: "Production",
                suggestion: { normalized: "prod", method: "alias", confidence: 0.95 },
            },
        ]);
    });

    it("busca la clave sin importar mayúsculas y conserva la escrita en el recurso", () => {
        const r = findInvalidTagValues({ environment: "PROD", ROLE: "Data Base" }, POLS);
        expect(r.map((i) => [i.tagName, i.tagKey, i.suggestion.normalized])).toEqual([
            ["Environment", "environment", "prod"],
            ["Role", "ROLE", "database"],
        ]);
    });

    it("un tag ausente o vacío es faltante, no valor no permitido", () => {
        expect(findInvalidTagValues({}, POLS)).toEqual([]);
        expect(findInvalidTagValues({ Environment: "  ", Role: "" }, POLS)).toEqual([]);
    });

    it("la comparación con los permitidos es exacta: 'Prod' no cumple aunque se sugiera 'prod'", () => {
        expect(findInvalidTagValues({ Environment: "prod" }, POLS)).toEqual([]);
        expect(findInvalidTagValues({ Environment: "Prod" }, POLS)).toHaveLength(1);
        expect(findInvalidTagValues({ Environment: "prod " }, POLS)[0].suggestion.normalized).toBe("prod");
    });

    it("sin sugerencia posible igual lo marca, con normalized null", () => {
        const [i] = findInvalidTagValues({ Role: "k8s-cluster" }, POLS);
        expect(i).toMatchObject({ value: "k8s-cluster", suggestion: { normalized: null, method: null, confidence: 0 } });
    });
});
