import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, targetSystem, resourceId, resourceName, issueTitle, issueBody, estimatedSavings } = body;

        if (!tenantId || !targetSystem) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId, targetSystem" }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        // Fetch tenant settings to get Jira/ADO credentials (Mock logic for safety)
        const [tenants] = await pool.query('SELECT tenant_id FROM Tenants WHERE tenant_id = ?', [tenantId]);
        if (!Array.isArray(tenants) || tenants.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }
        
        let ticketUrl = "";
        const referenceId = crypto.randomUUID().split("-")[0].toUpperCase();
        
        // Jira Integration Logic (Simulated for this implementation)
        if (targetSystem === 'jira') {
            const jiraUrl = process.env.JIRA_BASE_URL || 'https://mock-jira.atlassian.net';
            ticketUrl = `${jiraUrl}/browse/FINOPS-${referenceId}`;
            console.log(`[ITSM] Creado ticket en Jira para ${resourceName}`);
        } 
        // Azure DevOps Integration Logic (Simulated)
        else if (targetSystem === 'ado') {
            const adoOrg = process.env.ADO_ORG || 'mock-org';
            const adoProject = process.env.ADO_PROJECT || 'mock-project';
            ticketUrl = `https://dev.azure.com/${adoOrg}/${adoProject}/_workitems/edit/${Date.now()}`;
            console.log(`[ITSM] Creado Work Item en Azure DevOps para ${resourceName}`);
        } else {
            return NextResponse.json({ error: "Sistema destino no soportado." }, { status: 400 });
        }

        // Log action
        await pool.query(
            `INSERT INTO ActionLogs (tenant_id, action_type, resource_id, resource_type, status, details, user_email) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [tenantId, 'CreateTicket', resourceId, 'ITSM', 'Success', JSON.stringify({ targetSystem, ticketUrl, estimatedSavings }), 'system@itsm']
        );

        return NextResponse.json({ 
            success: true, 
            ticketUrl,
            message: `Ticket creado exitosamente en ${targetSystem.toUpperCase()}`
        });

    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("ITSM Integration Error:", error);
        return NextResponse.json({ error: "Fallo al crear ticket en ITSM." }, { status: 500 });
    }
}
