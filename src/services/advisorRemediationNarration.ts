import crypto from "crypto";
import { generateText } from "ai";
import pool, { insertPlatformAiUsage } from "@/modules/storage/db";
import { AIProviderFactory, aiQueue, withExponentialBackoff } from "@/modules/core/aiProvider";
import { interpolate } from "@/lib/advisorRemediation";
import type { AdvisorRecommendation } from "@/types/azureAdvisor.types";
import type { RowDataPacket } from "mysql2";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Reescribe con IA la `actionDescription` de cada recomendacion (MEJ-06).
 * `actionTitle`/`actionType`/`targetSku`/`estimatedMonthlySavingsUSD` no se
 * tocan: siguen siendo los que decidio el motor deterministico
 * (advisorRemediation.ts) -- la IA solo reescribe prosa, nunca decide la
 * accion ni el SKU.
 *
 * Best-effort: si el tenant no tiene IA configurada, o la llamada falla, cada
 * recomendacion conserva el texto determinista que `generateAdvisorRemediationAction`
 * ya le habia puesto. No hay downgrade visible ni error hacia el caller.
 *
 * Cachea por `ruleKey + locale`, no por recomendacion ni por tenant: el
 * prompt que se manda a la IA es la plantilla generica con placeholders
 * {name}/{skuText}/{cpuText}, NUNCA los valores concretos del recurso, asi
 * que no hay dato de un tenant que pueda filtrarse a otro y compartir la
 * cache entre tenants es seguro. Con ~9 reglas posibles en total, esto baja
 * el costo de "decenas de llamadas por tenant" (estimado en la propuesta) a
 * "unidades por dia, para toda la plataforma".
 */
export async function narrateAdvisorRecommendations(
  recs: AdvisorRecommendation[],
  tenantId: string,
  locale: string
): Promise<void> {
  const withTemplate = recs.filter(
    (r) => r.aiSuggestedAction?.ruleKey && r.aiSuggestedAction.descriptionTemplate
  );
  if (withTemplate.length === 0) return;

  // Una llamada por ruleKey unico (a lo sumo 9 hoy), no una por recomendacion.
  const templatesByRuleKey = new Map<string, string>();
  for (const r of withTemplate) {
    const a = r.aiSuggestedAction!;
    if (!templatesByRuleKey.has(a.ruleKey!)) templatesByRuleKey.set(a.ruleKey!, a.descriptionTemplate!);
  }

  let model, modelName, config;
  try {
    ({ model, modelName, config } = await AIProviderFactory.getGeminiModel(tenantId));
  } catch {
    return; // Tenant sin IA configurada: se conserva el texto determinista.
  }

  const rewritten = new Map<string, string>();
  await Promise.all(
    Array.from(templatesByRuleKey.entries()).map(async ([ruleKey, template]) => {
      const hash = crypto
        .createHash("sha256")
        .update(`advisor-remediation:v1:${ruleKey}:${locale}`)
        .digest("hex");
      try {
        const [rows] = await pool.query<RowDataPacket[]>(
          "SELECT response_text, created_at FROM AiCache WHERE hash_prompt = ?",
          [hash]
        );
        if (rows[0] && Date.now() - new Date(rows[0].created_at).getTime() < CACHE_TTL_MS) {
          rewritten.set(ruleKey, rows[0].response_text);
          return;
        }

        const { text, usage } = await aiQueue.add(() =>
          withExponentialBackoff(() =>
            generateText({
              model: model as any,
              system: `Reescribis una frase de una recomendacion de FinOps para Azure, en el idioma "${locale}".
Reglas estrictas:
- Devolves SOLO la frase reescrita, sin comillas ni explicacion.
- Preservas EXACTAMENTE los placeholders entre llaves que aparezcan en el texto (ej: {name}, {skuText}, {cpuText}) -- mismo texto, mismas llaves, en un lugar gramaticalmente sensato. No inventes placeholders nuevos ni elimines los que te dieron.
- Tono profesional y conciso, 1 o 2 oraciones. No agregues datos ni cifras que no esten en el texto original.`,
              prompt: template,
            })
          )
        );

        // Salvaguarda: si el modelo rompe o inventa un placeholder, el texto
        // interpola mal (ej. "{name" queda literal en pantalla) -- peor que
        // el determinista. Se compara el CONJUNTO de placeholders, no el orden
        // (la reescritura puede reordenar la oracion).
        const origTokens = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[0]).sort();
        const newTokens = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[0]).sort();
        const intact =
          origTokens.length === newTokens.length && origTokens.every((t, i) => t === newTokens[i]);
        const finalText = intact ? text.trim() : template;

        rewritten.set(ruleKey, finalText);

        insertPlatformAiUsage({
          tenantId,
          source: config.source,
          provider: config.provider,
          modelName,
          feature: "advisor-remediation-narration",
          inputTokens: usage.inputTokens || 0,
          outputTokens: usage.outputTokens || 0,
        });

        // Cache COMPARTIDA entre tenants a proposito (ver doc de la funcion):
        // sin tenantId en el hash.
        await pool.query(
          "REPLACE INTO AiCache (hash_prompt, response_text, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
          [hash, finalText]
        );
      } catch (err) {
        console.error(`[AdvisorNarration] Fallo reescribiendo ruleKey=${ruleKey}:`, err);
        // Sin entrada en `rewritten`: el caller conserva el texto determinista.
      }
    })
  );

  if (rewritten.size === 0) return;

  for (const r of withTemplate) {
    const a = r.aiSuggestedAction!;
    const rewrittenTemplate = rewritten.get(a.ruleKey!);
    if (!rewrittenTemplate) continue;
    a.actionDescription = interpolate(rewrittenTemplate, a.descriptionVars || {});
  }
}
