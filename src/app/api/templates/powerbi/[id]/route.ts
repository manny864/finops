import { NextRequest, NextResponse } from "next/server";
import { getTemplate } from "@/lib/powerbiTemplates";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const t = getTemplate(id);
    if (!t) return NextResponse.json({ success: false, error: "Template no encontrado" }, { status: 404 });

    const format = new URL(request.url).searchParams.get("format") || "json";

    if (format === "pq") {
        // Power Query M file plain text
        return new NextResponse(t.powerQueryM, {
            status: 200,
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Disposition": `attachment; filename="${t.id}.pq"`,
            },
        });
    }

    return NextResponse.json({
        success: true,
        template: t,
        usage: {
            step1: "En Power BI Desktop: Get Data → Blank Query → Advanced Editor",
            step2: "Pegar el script `powerQueryM`",
            step3: "Reemplazar <YOUR_BASE_URL> y <YOUR_MCP_KEY>",
            step4: "Done → Refresh → armar visualizaciones",
            downloadPq: `/api/templates/powerbi/${t.id}?format=pq`,
        },
    });
}
