import type { RowDataPacket } from "mysql2";
import pool from "@/modules/storage/db";
import rateLimiter from "@/lib/rateLimiter";
import { hasAccess, normalizeTier } from "@/lib/tierLogic";
import { logAiEvent } from "@/lib/aiTelemetry";
import { getAiFeatureSwitch, isAiGloballyEnabled } from "@/services/aiService";

/**
 * Gate único de las funciones de IA de la propuesta (Fase 0.1): interruptor
 * global, interruptor de la feature, interruptor del tenant, tier, rate limit
 * y cuota mensual en un solo lugar. El Copilot conserva el suyo
 * (`copilotConfig.ts`).
 *
 * Un denegado no es un error: la ruta sigue con la versión determinista y
 * devuelve el motivo.
 */
export type AiFeature =
    | "anomaly-explanation"
    | "billing-csv-column-mapping"
    | "billing-upload-assessment"
    | "support-ticket-triage"
    | "support-reply-draft"
    | "document-intelligence";

export type AiGateDenyReason =
    | "global_disabled"
    | "feature_disabled"
    | "tenant_disabled"
    | "tier"
    | "quota"
    | "rate_limited";

export type AiGateResult = { allowed: true } | { allowed: false; reason: AiGateDenyReason };

interface AiFeatureConfig {
    /**
     * Estado mientras el superadmin no toque el interruptor de la feature. Las
     * que todavía tienen precondiciones de negocio (sección 6.9 de la
     * propuesta) arrancan apagadas.
     */
    defaultEnabled: boolean;
    minTier: string;
    /** Llamadas por mes que paga la plataforma; null = sin límite. BYOK no consume cuota. */
    monthlyQuota: Record<string, number | null>;
    perMinute: number;
    maxOutputTokens: number;
    /**
     * La llamada va siempre a un recurso de la plataforma, sin BYOK posible: la
     * cuota corre aunque el tenant tenga su propia clave de OpenAI.
     */
    platformOnly?: boolean;
}

// Mismas cuotas que el Copilot, pero contadas por feature.
const QUOTA = { Professional: 50, Business: 150, Enterprise: null };
// Funciones internas de la plataforma: no consumen la cuota del tenant.
const NO_QUOTA = { Professional: null, Business: null, Enterprise: null };

export const AI_FEATURES: Record<AiFeature, AiFeatureConfig> = {
    "anomaly-explanation": {
        defaultEnabled: true,
        // Enterprise, como la pantalla de anomalías (routeTiers y pricing). Desde
        // Professional se venden sólo las alertas, que no llevan IA.
        minTier: "Enterprise",
        monthlyQuota: QUOTA,
        perMinute: 10,
        maxOutputTokens: 600,
    },
    // Business, como la página de upload (routeTiers).
    "billing-csv-column-mapping": {
        defaultEnabled: true,
        minTier: "Business",
        monthlyQuota: QUOTA,
        perMinute: 5,
        maxOutputTokens: 800,
    },
    // El reporte que sigue a la carga (getAssessment). Ya corría en cada carga:
    // arranca prendido para no quitarle nada a quien lo usa.
    "billing-upload-assessment": {
        defaultEnabled: true,
        minTier: "Business",
        monthlyQuota: QUOTA,
        perMinute: 5,
        // Seis secciones con tablas; sin tope corría hasta el máximo del modelo.
        maxOutputTokens: 4000,
    },
    // Soporte (Fase 3): todos los tenants abren tickets y la IA la paga la
    // plataforma. Apagadas hasta medir el volumen de tickets (sección 6.6).
    "support-ticket-triage": {
        defaultEnabled: false,
        minTier: "Professional",
        monthlyQuota: NO_QUOTA,
        perMinute: 10,
        maxOutputTokens: 300,
    },
    "support-reply-draft": {
        defaultEnabled: false,
        minTier: "Professional",
        monthlyQuota: NO_QUOTA,
        perMinute: 5,
        maxOutputTokens: 800,
    },
    // Apagada hasta validar demanda y ponerle precio de add-on (sección 6.7 de
    // la propuesta). Business, como la página de upload. La cuota cuenta
    // documentos analizados; las páginas por documento las topa
    // `EXTERNAL_SPEND_MAX_PAGES` (externalSpend.types.ts). Enterprise también tiene
    // techo: cada página cuesta y no hay add-on que lo pague.
    "document-intelligence": {
        defaultEnabled: false,
        minTier: "Business",
        monthlyQuota: { Business: 150, Enterprise: 500 },
        perMinute: 5,
        // No es un LLM: no hay tokens de salida que topar.
        maxOutputTokens: 0,
        platformOnly: true,
    },
};

export const isAiFeature = (value: string): value is AiFeature => Object.hasOwn(AI_FEATURES, value);

const deny = (reason: AiGateDenyReason): AiGateResult => ({ allowed: false, reason });

/**
 * La ruta tiene que haber validado antes el acceso al tenant: el gate decide si
 * se puede gastar IA, no quién es el usuario. `userKey` sólo arma la clave del
 * rate limit.
 */
export async function checkAiFeature(tenantId: string, feature: AiFeature, userKey: string): Promise<AiGateResult> {
    const result = await decide(tenantId, feature, userKey);
    logAiEvent(feature, { stage: "gate", outcome: result.allowed ? "allowed" : result.reason });
    return result;
}

/**
 * El mismo veredicto sin gastar rate limit ni registrar telemetría: para que
 * una pantalla avise antes de que el usuario intente algo que se va a negar.
 */
export const peekAiFeature = (tenantId: string, feature: AiFeature): Promise<AiGateResult> =>
    decide(tenantId, feature, null);

async function decide(tenantId: string, feature: AiFeature, userKey: string | null): Promise<AiGateResult> {
    if (!(await isAiGloballyEnabled())) return deny("global_disabled");

    const cfg = AI_FEATURES[feature];
    if (!((await getAiFeatureSwitch(feature)) ?? cfg.defaultEnabled)) return deny("feature_disabled");

    const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT tier, ai_enabled, ai_provider, ai_api_key FROM Tenants WHERE tenant_id = ? LIMIT 1",
        [tenantId]
    );
    const row = rows[0];
    // Sin fila no hay a quién cobrarle la cuota: se niega. El Copilot la deja
    // pasar por los tenants demo, que acá ni llegan al gate.
    if (!row?.ai_enabled) return deny("tenant_disabled");

    const tier = normalizeTier(row.tier || "Professional");
    if (!tier || !hasAccess(tier, cfg.minTier)) return deny("tier");

    if (userKey !== null) {
        const rl = await rateLimiter.checkByKeyDistributed(`ai:${feature}:${tenantId}:${userKey}`, cfg.perMinute, 60_000);
        if (!rl.allowed) return deny("rate_limited");
    }

    const byok = !cfg.platformOnly && Boolean(row.ai_provider && row.ai_provider !== "system" && row.ai_api_key);
    const quota = byok ? null : (cfg.monthlyQuota[tier] ?? null);
    if (quota !== null) {
        // Sólo lo que pagó la plataforma este mes calendario (UTC), como el Copilot.
        const [used] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS c FROM PlatformAiUsage
              WHERE tenant_id = ? AND feature = ? AND source = 'platform'
                AND created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')`,
            [tenantId, feature]
        );
        if (Number(used[0]?.c || 0) >= quota) return deny("quota");
    }
    return { allowed: true };
}
