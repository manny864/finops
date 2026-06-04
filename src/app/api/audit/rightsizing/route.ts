import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getVmUtilization } from "@/services/metricsService";
import { evaluateRightsizing } from "@/lib/rightsizingEngine";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }
        
        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        const credential = await getAzureCredential(tenantId);
        const client = new ResourceGraphClient(credential);

        const query = `
            Resources
            | where type =~ 'microsoft.compute/virtualmachines'
            | project id, name, subscriptionId, sku = sku.name
            | limit 50
        `;

        const res = await client.resources({ query });
        const vms = res.data as any[];

        if (!vms || vms.length === 0) {
            return NextResponse.json({ recommendations: [] });
        }

        const recommendations = [];

        // Concurrencia limitada a 5 para no sobrecargar Azure Monitor
        for (let i = 0; i < vms.length; i += 5) {
            const batch = vms.slice(i, i + 5);
            const batchResults = await Promise.all(batch.map(async (vm) => {
                const util = await getVmUtilization(tenantId, vm.subscriptionId, vm.id);
                const recommendation = evaluateRightsizing(util.maxCpu, vm.sku);
                
                if (recommendation) {
                    return {
                        vmName: vm.name,
                        subscriptionId: vm.subscriptionId,
                        currentSku: vm.sku,
                        maxCpuPeak: util.maxCpu,
                        suggestedSku: recommendation
                    };
                }
                return null;
            }));
            
            recommendations.push(...batchResults.filter(r => r !== null));
        }

        return NextResponse.json({ recommendations });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
