import { NextRequest, NextResponse } from "next/server";
import { streamText } from "ai";
import { AIProviderFactory } from "@/modules/core/aiProvider";
import { isMockTenant } from "@/lib/mockData";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
    try {
        // Auth validation
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        }
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }
        const { prompt, pageContext, dataPayload, tenantId, locale = 'es' } = await request.json();

        // SuperAdmin check for cross-tenant access
        const email = decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "";
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") ;

        // Permitimos tenants DEMO (mock) aunque el `tid` del token no coincida:
        // el dataPayload viene del cliente, los datos son sintéticos y la AI no
        // accede a ningún recurso real del cloud. Esto permite que las cuentas
        // de prueba experimenten el Copilot sobre el dataset DEMO.
        const isDemoTenant = tenantId && isMockTenant(tenantId);

        if (tenantId && decoded.tid !== tenantId && !isSuperAdmin && !isDemoTenant) {
            return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
        }

        // Para tenants DEMO usamos el `tid` real del token al resolver la
        // config de AI (provider + apiKey), ya que el ID demo no existe en la
        // tabla Tenants.
        const effectiveTenantId = isDemoTenant ? decoded.tid : (tenantId || decoded.tid);
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
    } catch (error: any) {
        console.error("[Copilot] Error:", error.message);
        return NextResponse.json({ error: "Copilot failed to respond.", details: error.message }, { status: 500 });
    }
}
