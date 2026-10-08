import pool from "@/modules/storage/db";
import { tagValueKey } from "@/lib/tagValueNormalizer";

/** De dónde salió la sugerencia: el normalizador determinista o la IA. */
export type TagSuggestionSource = "rule" | "ai";

export interface TagNormalizationDecisionInput {
    tagName: string;
    /** Valor que tenía el recurso; vacío si la etiqueta faltaba (relleno de CostCenter/Department). */
    originalValue: string;
    suggestedValue?: string | null;
    suggestionSource?: TagSuggestionSource | null;
    suggestedMethod?: string | null;
    suggestedConfidence?: number | null;
    /** Valor que se aplicó en Azure; null = sugerencia descartada. */
    appliedValue?: string | null;
    resourceCount?: number;
    /** Guardar la corrección como alias del tenant (original → aplicado). */
    saveAlias?: boolean;
}

export interface TagNormalizationKpis {
    periodDays: number;
    /** Recursos corregidos, según quién propuso el valor que se aplicó. */
    resolvedResources: { rule: number; ai: number; manual: number };
    suggestionsDecided: number;
    suggestionsAccepted: number;
    /** Aceptadas sobre decididas (0–100); null si todavía no se decidió ninguna. */
    acceptanceRatePct: number | null;
}

export const KPI_PERIOD_DAYS = 90;

/**
 * Registra qué se hizo con un valor no conforme y, si se pidió, guarda la
 * corrección como alias del tenant para que el normalizador la resuelva solo
 * la próxima vez. `accepted` se calcula acá y no lo manda el cliente.
 */
export async function recordTagNormalizationDecision(
    tenantId: string,
    input: TagNormalizationDecisionInput,
    decidedBy: string | null,
): Promise<{ aliasSaved: boolean }> {
    const suggested = input.suggestedValue || null;
    const applied = input.appliedValue || null;
    const accepted = suggested ? (applied === suggested ? 1 : 0) : null;

    await pool.query(
        `INSERT INTO TagNormalizationDecisions
           (tenant_id, tag_name, original_value, suggested_value, suggestion_source, suggested_method,
            suggested_confidence, applied_value, accepted, resource_count, decided_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            tenantId,
            input.tagName,
            input.originalValue,
            suggested,
            suggested ? input.suggestionSource || null : null,
            suggested ? input.suggestedMethod || null : null,
            suggested && typeof input.suggestedConfidence === "number" ? input.suggestedConfidence : null,
            applied,
            accepted,
            input.resourceCount || 0,
            decidedBy,
        ],
    );

    // Si el original ya se resuelve por forma comparable ("PROD" → "prod"), el
    // alias no agrega nada.
    const key = tagValueKey(input.originalValue);
    if (!input.saveAlias || !applied || !key || key === tagValueKey(applied)) {
        return { aliasSaved: false };
    }
    await pool.query(
        `INSERT INTO TagValueAliases (tenant_id, tag_name, alias, canonical_value, created_by)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE canonical_value = VALUES(canonical_value), created_by = VALUES(created_by)`,
        [tenantId, input.tagName, key, applied, decidedBy],
    );
    return { aliasSaved: true };
}

export async function getTagNormalizationKpis(tenantId: string): Promise<TagNormalizationKpis> {
    const [rows] = await pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN applied_value IS NOT NULL AND accepted = 1 AND suggestion_source = 'rule' THEN resource_count END), 0) AS by_rule,
           COALESCE(SUM(CASE WHEN applied_value IS NOT NULL AND accepted = 1 AND suggestion_source = 'ai' THEN resource_count END), 0) AS by_ai,
           COALESCE(SUM(CASE WHEN applied_value IS NOT NULL AND (accepted IS NULL OR accepted = 0) THEN resource_count END), 0) AS manual,
           COALESCE(SUM(accepted = 1), 0) AS accepted_count,
           COALESCE(SUM(accepted IS NOT NULL), 0) AS decided_count
         FROM TagNormalizationDecisions
         WHERE tenant_id = ? AND created_at >= NOW() - INTERVAL ? DAY`,
        [tenantId, KPI_PERIOD_DAYS],
    );
    const r = ((rows as Record<string, unknown>[])[0] || {}) as Record<string, unknown>;
    const decided = Number(r.decided_count) || 0;
    const acceptedCount = Number(r.accepted_count) || 0;
    return {
        periodDays: KPI_PERIOD_DAYS,
        resolvedResources: {
            rule: Number(r.by_rule) || 0,
            ai: Number(r.by_ai) || 0,
            manual: Number(r.manual) || 0,
        },
        suggestionsDecided: decided,
        suggestionsAccepted: acceptedCount,
        acceptanceRatePct: decided > 0 ? Math.round((acceptedCount / decided) * 1000) / 10 : null,
    };
}

export function getMockTagNormalizationKpis(): TagNormalizationKpis {
    return {
        periodDays: KPI_PERIOD_DAYS,
        resolvedResources: { rule: 46, ai: 9, manual: 5 },
        suggestionsDecided: 23,
        suggestionsAccepted: 20,
        acceptanceRatePct: 87,
    };
}
