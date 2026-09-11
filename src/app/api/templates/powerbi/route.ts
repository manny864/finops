import { NextResponse } from "next/server";
import { POWERBI_TEMPLATES } from "@/lib/powerbiTemplates";

export async function GET() {
    return NextResponse.json({
        success: true,
        count: POWERBI_TEMPLATES.length,
        templates: POWERBI_TEMPLATES.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            // Las claves viajan con el listado: sin esto la tarjeta solo
            // recibia el texto en castellano y no habia nada que traducir.
            descriptionKey: t.descriptionKey,
            category: t.category,
            categoryDisplayName: t.categoryDisplayName,
            categoryDisplayNameKey: t.categoryDisplayNameKey,
            feedType: t.feedType,
            sampleVisualizations: t.sampleVisualizations,
            visualizationKeys: t.visualizationKeys,
            downloadUrl: `/api/templates/powerbi/${t.id}`,
        })),
    });
}
