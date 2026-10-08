import type { AiGateDenyReason } from "@/lib/aiFeatureGate";

/**
 * Observabilidad de las funciones de IA (sección 6.8 de la propuesta):
 * latencia, errores y tasa de fallback por feature.
 *
 * Son líneas JSON en stdout y no spans: la app no tiene exporter de
 * OpenTelemetry, y la consola del contenedor ya llega a Log Analytics
 * (ContainerAppConsoleLogs_CL), donde se agregan con KQL. Si se suma un
 * exporter, éste es el único lugar que cambia.
 *
 * - gate: lo registra `checkAiFeature`, una vez por decisión.
 * - model: lo registra `timeAiCall` alrededor de la llamada al modelo.
 * - output: la feature, cuando descarta una salida que no pasó su validación.
 */
export type AiTelemetryEvent =
    | { stage: "gate"; outcome: "allowed" | AiGateDenyReason }
    | { stage: "model"; outcome: "ok" | "error"; ms: number }
    | { stage: "output"; outcome: "rejected" };

export function logAiEvent(feature: string, event: AiTelemetryEvent): void {
    console.info(JSON.stringify({ evt: "ai_feature", feature, ...event }));
}

/** Mide la llamada al modelo. El error se registra y se propaga igual. */
export async function timeAiCall<T>(feature: string, call: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
        const result = await call();
        logAiEvent(feature, { stage: "model", outcome: "ok", ms: Date.now() - start });
        return result;
    } catch (e) {
        logAiEvent(feature, { stage: "model", outcome: "error", ms: Date.now() - start });
        throw e;
    }
}
