import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { AIProviderFactory } from "@/modules/core/aiProvider";

export async function POST(request: NextRequest) {
    try {
        const { prompt, pageContext, dataPayload, tenantId } = await request.json();

        const model = await AIProviderFactory.getGeminiModel();
        
        let dataString = "";
        try {
            dataString = JSON.stringify(dataPayload || {}).slice(0, 5000); // Prevent token overflow
        } catch(e) {}

        const systemPrompt = `You are a strict Azure FinOps Copilot. You MUST ONLY answer questions directly related to Azure billing, cloud optimization, or the provided [dataPayload]. If the user query is unrelated to FinOps, cloud infrastructure, or the current page context, you MUST refuse to answer and explicitly reply with: "Lo siento, como asistente FinOps, solo puedo ayudarte a analizar y optimizar tu entorno de Azure."
The user is currently viewing the ${pageContext} module. 
Analyze the provided payload and answer the user's query concisely and accurately.
Context payload: ${dataString}`;

        const { text } = await generateText({
            model,
            system: systemPrompt,
            prompt: prompt,
            temperature: 0.1
        });

        return NextResponse.json({ reply: text });
    } catch (error: any) {
        return NextResponse.json({ error: "Copilot failed to respond.", details: error.message }, { status: 500 });
    }
}
