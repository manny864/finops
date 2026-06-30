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
            category: t.category,
            feedType: t.feedType,
            sampleVisualizations: t.sampleVisualizations,
            downloadUrl: `/api/templates/powerbi/${t.id}`,
        })),
    });
}
