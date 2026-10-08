/**
 * Normalización determinista de valores de etiquetas (propuesta de IA, 6.5).
 *
 * Dado un valor que no está en los permitidos de su política, sugiere el
 * canónico sin IA: misma forma comparable ("Prod " -> "prod"), alias
 * ("producción" -> "prod") o distancia de edición acotada ("stagin" -> "stg").
 * Lo que queda sin resolver es el residuo que puede ir a la IA. Puro: sin DB ni
 * red, lo usan el escáner de Tag Governance, la ruta de sugerencias y el
 * servicio de IA.
 */
import type { InvalidTagValue, TagPolicyRule } from "@/types/azureTagGovernance.types";

export type TagNormalizationMethod = "exact" | "alias" | "fuzzy";

export interface TagValueAlias {
    alias: string;
    canonicalValue: string;
}

export interface TagNormalizationResult {
    normalized: string | null;
    method: TagNormalizationMethod | null;
    confidence: number;
}

/** Por debajo de este largo (de la forma comparable) no se prueba distancia de edición: "dev"/"qa" quedan a 1-2 ediciones de cualquier cosa. */
export const FUZZY_MIN_LENGTH = 5;
export const ALIAS_CONFIDENCE = 0.95;

const SIN_SUGERENCIA: TagNormalizationResult = { normalized: null, method: null, confidence: 0 };

/** Forma comparable: sin acentos, en minúsculas y sin separadores ("Pre-Producción " -> "preproduccion"). */
export function tagValueKey(value: string): string {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Valores permitidos tal como vienen de `TaggingPolicies.allowed_values` (mysql2
 * devuelve el JSON ya parseado o como string, según el driver). null = valor
 * libre: sólo se exige presencia.
 */
export function parseAllowedValues(raw: unknown): string[] | null {
    let v = raw;
    if (typeof v === "string") {
        try {
            v = JSON.parse(v);
        } catch {
            return null;
        }
    }
    if (!Array.isArray(v)) return null;
    const out = Array.from(
        new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)),
    );
    return out.length > 0 ? out : null;
}

/** Distancia de edición con transposiciones adyacentes (OSA): "prdo" -> "prod" cuesta 1. */
export function editDistance(a: string, b: string): number {
    const n = a.length;
    const m = b.length;
    if (n === 0) return m;
    if (m === 0) return n;
    const d: number[][] = Array.from({ length: n + 1 }, (_, i) => {
        const row = new Array<number>(m + 1).fill(0);
        row[0] = i;
        return row;
    });
    for (let j = 0; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }
    return d[n][m];
}

/**
 * Sugiere el valor canónico de `value` dentro de `allowedValues`.
 *
 * - `exact`: misma forma comparable que un permitido (confianza 1).
 * - `alias`: la forma comparable es un alias cuyo canónico es un permitido
 *   (0.95). Pasá primero los alias del tenant: el primero que resuelve gana.
 * - `fuzzy`: distancia de edición contra permitidos y alias, sólo si la forma
 *   comparable tiene al menos 5 caracteres; hasta 1 edición (5-7 caracteres) o
 *   2 (8 o más). Si dos canónicos distintos empatan, no hay sugerencia.
 *
 * Sin permitidos (valor libre) o con un valor vacío no hay nada que sugerir.
 */
export function normalizeTagValue(
    value: string,
    allowedValues: readonly string[] | null | undefined,
    aliases: readonly TagValueAlias[] = [],
): TagNormalizationResult {
    if (!allowedValues || allowedValues.length === 0) return SIN_SUGERENCIA;
    const key = tagValueKey(value);
    if (!key) return SIN_SUGERENCIA;

    if (allowedValues.includes(value)) return { normalized: value, method: "exact", confidence: 1 };
    const porClave = (k: string) => allowedValues.find((a) => tagValueKey(a) === k);

    const exacto = porClave(key);
    if (exacto) return { normalized: exacto, method: "exact", confidence: 1 };

    // Un alias puede apuntar a un valor que el tenant ya no permite: se ignora.
    const canonicoDe = (a: TagValueAlias) =>
        allowedValues.includes(a.canonicalValue) ? a.canonicalValue : porClave(tagValueKey(a.canonicalValue));

    for (const a of aliases) {
        if (tagValueKey(a.alias) !== key) continue;
        const canonico = canonicoDe(a);
        if (canonico) return { normalized: canonico, method: "alias", confidence: ALIAS_CONFIDENCE };
    }

    if (key.length < FUZZY_MIN_LENGTH) return SIN_SUGERENCIA;
    const maxDist = key.length >= 8 ? 2 : 1;
    const candidatos: Array<[string, string | undefined]> = [
        ...allowedValues.map((a): [string, string] => [tagValueKey(a), a]),
        ...aliases.map((a): [string, string | undefined] => [tagValueKey(a.alias), canonicoDe(a)]),
    ];

    let mejor: { canonico: string; dist: number; largo: number } | null = null;
    let empate = false;
    for (const [clave, canonico] of candidatos) {
        if (!clave || !canonico || Math.abs(clave.length - key.length) > maxDist) continue;
        const dist = editDistance(key, clave);
        if (dist > maxDist) continue;
        if (!mejor || dist < mejor.dist) {
            mejor = { canonico, dist, largo: Math.max(key.length, clave.length) };
            empate = false;
        } else if (dist === mejor.dist && canonico !== mejor.canonico) {
            empate = true;
        }
    }
    if (!mejor || empate) return SIN_SUGERENCIA;
    return {
        normalized: mejor.canonico,
        method: "fuzzy",
        confidence: Math.round((1 - mejor.dist / mejor.largo) * 100) / 100,
    };
}

/**
 * Tags presentes cuyo valor no es exactamente uno de los permitidos de su
 * política, con el canónico sugerido. Un tag ausente o vacío no entra: eso es
 * "faltante" (evaluateResourceMissingTags), no "valor no permitido".
 * `aliasesByTag` va indexado por nombre de tag en minúsculas.
 */
export function findInvalidTagValues(
    currentTags: Record<string, string>,
    policies: ReadonlyArray<Pick<TagPolicyRule, "tagName" | "allowedValues">>,
    aliasesByTag: ReadonlyMap<string, TagValueAlias[]> = new Map(),
): InvalidTagValue[] {
    const keys = Object.keys(currentTags || {});
    const out: InvalidTagValue[] = [];
    for (const pol of policies) {
        if (!pol.allowedValues?.length) continue;
        const tagKey = keys.find((k) => k.toLowerCase() === pol.tagName.toLowerCase());
        if (!tagKey) continue;
        const value = currentTags[tagKey];
        if (typeof value !== "string" || !value.trim() || pol.allowedValues.includes(value)) continue;
        out.push({
            tagName: pol.tagName,
            tagKey,
            value,
            suggestion: normalizeTagValue(value, pol.allowedValues, aliasesByTag.get(pol.tagName.toLowerCase()) || []),
        });
    }
    return out;
}
