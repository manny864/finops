import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { AIProviderFactory } from "@/modules/core/aiProvider";
import jwt from "jsonwebtoken";

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

        if (tenantId && decoded.tid !== tenantId && !isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
        }

        const effectiveTenantId = tenantId || decoded.tid;
        const model = await AIProviderFactory.getGeminiModel(effectiveTenantId);
        
        let dataString = "";
        try {
            dataString = JSON.stringify(dataPayload || {}).slice(0, 5000); // Prevent token overflow
        } catch(e) {}
        const systemPrompt = `You are a strict Azure FinOps Copilot. You MUST ONLY answer questions directly related to Azure billing, cloud optimization, or the provided [dataPayload]. If the user query is unrelated to FinOps, cloud infrastructure, or the current page context, you MUST refuse to answer and explicitly reply with: "Lo siento, como asistente FinOps, solo puedo ayudarte a analizar y optimizar tu entorno de Azure."
The user is currently viewing the ${pageContext} module. 
Analyze the provided payload and answer the user's query concisely and accurately.
Responde completamente en ${locale === 'es' ? 'Español' : locale === 'pt-BR' ? 'Portugués (Brasil)' : 'Inglés'}.
Context payload: ${dataString}`;

        const { text } = await generateText({
            model,
            system: systemPrompt,
            prompt: prompt,
            temperature: 0.1
        });

        return NextResponse.json({ reply: text });
    } catch (error: any) {
        console.error("[Copilot] Error:", error.message);
        return NextResponse.json({ error: "Copilot failed to respond.", details: error.message }, { status: 500 });
    }
}
