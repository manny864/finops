import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { AIProviderFactory } from "@/modules/core/aiProvider";
import { isMockTenant } from "@/lib/mockData";
import { requireRequestIdentity, requireTenantAccess, AuthError } from "@/lib/requestAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
    try {
        const identity = await requireRequestIdentity(request);
        const { prompt, pageContext, dataPayload, tenantId, locale = 'es' } = await request.json();

        const isDemoTenant = tenantId && isMockTenant(tenantId);

        if (tenantId && !isDemoTenant) {
            await requireTenantAccess(request, tenantId);
        }

        const effectiveTenantId = isDemoTenant ? identity.tenantId : (tenantId || identity.tenantId);
        const model = await AIProviderFactory.getGeminiModel(effectiveTenantId);

        let dataString = "";
        try {
            // El cliente puede mandar el payload ya compactado (string) o un
            // objeto. Si es string lo usamos tal cual; si es objeto lo
            // serializamos y recortamos. 2KB es suficiente con el compactor.
            if (typeof dataPayload === "string") {
                dataString = dataPayload.slice(0, 8000);
            } else {
                dataString = JSON.stringify(dataPayload || {}).slice(0, 8000);
            }
        } catch(e) {}
        const systemPrompt = `You are a strict Azure FinOps Copilot. You MUST ONLY answer questions related to Azure billing, cloud optimization, governance, high-availability, security cost impact, or the provided [Context payload]. If unrelated, refuse with: "Lo siento, como asistente FinOps, solo puedo ayudarte a analizar y optimizar tu entorno de Azure."

Rules:
- Default replies: concise (≤200 palabras). Pero si el usuario pide un "reporte ejecutivo", "análisis detallado", "informe completo" o similar → respondé EXTENSO y estructurado (hasta ~900 palabras), con secciones claras.
- Markdown estructurado con headings (### / ####), bullets y tablas cuando aporten. Sin relleno ni disclaimers genéricos.
- Cifrá toda afirmación con números concretos del payload (USD, %, conteos). NO inventes datos.
- Cuando recomiendes acciones: priorizá por impacto económico (USD/mes ahorrado) y esfuerzo (bajo/medio/alto).
- Incluí riesgos, supuestos y limitaciones cuando sea relevante para decisión.
- Si el payload está vacío o no es suficiente, decílo en una línea y sugerí qué datos faltan.
- Idioma de respuesta: ${locale === 'es' ? 'Español' : locale === 'pt-BR' ? 'Portugués (Brasil)' : 'Inglés'}.

Current page (module): ${pageContext}
Context payload (summarized): ${dataString}`;

        const result = streamText({
            model,
            system: systemPrompt,
            prompt: prompt,
            temperature: 0.2,
            maxOutputTokens: 2500,
        });

        // Stream de texto plano (text/plain). El cliente lo lee con
        // response.body.getReader() y va appendeando tokens en tiempo real.
        return result.toTextStreamResponse();
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[Copilot] Error:", error instanceof Error ? error.message : error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
