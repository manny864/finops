/**
 * Endpoint de exportación en streaming (CSV / JSON / NDJSON) de registros de auditoría.
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { getAuditTrailLogs, serializeAuditTrailCsv } from "@/services/auditTrail.service";
import { getTranslations } from "next-intl/server";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        const format = (searchParams.get("format") || "csv").toLowerCase();
        const userEmail = searchParams.get("userEmail") || undefined;
        const actionType = searchParams.get("actionType") || undefined;
        const status = searchParams.get("status") || undefined;
        const fromDate = searchParams.get("from") || undefined;
        const toDate = searchParams.get("to") || undefined;
        const page = parseInt(searchParams.get("page") || "1", 10);
        const pageSize = parseInt(searchParams.get("pageSize") || "1000", 10);

        if (!isMockTenant(tenantId) && searchParams.get("mock") !== "true") {
            await requireTenantRole(request, tenantId, ["Admin", "ADMIN", "Owner", "FinOps Manager", "Reader"]);
        }

        const data = await getAuditTrailLogs({
            tenantId,
            userEmail,
            actionType,
            status,
            fromDate,
            toDate,
            page,
            pageSize,
        });

        const items = data.items;
        const dateStr = new Date().toISOString().split("T")[0];

        if (format === "json") {
            return new NextResponse(JSON.stringify(items, null, 2), {
                status: 200,
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "Content-Disposition": `attachment; filename="audit-trail-${tenantId}-${dateStr}.json"`,
                },
            });
        }

        if (format === "ndjson") {
            const ndjson = items.map((i) => JSON.stringify(i)).join("\n");
            return new NextResponse(ndjson, {
                status: 200,
                headers: {
                    "Content-Type": "application/x-ndjson; charset=utf-8",
                    "Content-Disposition": `attachment; filename="audit-trail-${tenantId}-${dateStr}.ndjson"`,
                },
            });
        }

        // CSV por defecto, en el idioma que manda el cliente: el archivo se
        // descarga y se lee fuera de la plataforma, sin el contexto de la UI.
        const localeParam = searchParams.get("locale") || "es";
        const locale = ["es", "en", "pt-BR"].includes(localeParam) ? localeParam : "es";
        const t = await getTranslations({ locale, namespace: "AdminAudit" });
        const csv = serializeAuditTrailCsv(items, (k) => t(k as never));
        return new NextResponse(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="audit-trail-${tenantId}-${dateStr}.csv"`,
            },
        });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
