import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import pool from "@/modules/storage/db";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const tenantId = searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });

        // Get active policies
        const [rows] = await pool.query("SELECT * FROM TaggingPolicies WHERE tenant_id = ? AND required = 1", [tenantId]);
        const policies = rows as any[];

        const credential = await getAzureCredential(tenantId);
        const client = new ResourceGraphClient(credential);

        let totalResources = 0;
        let nonCompliant: any[] = [];

        // Get total resources count
        const totalRes = await client.resources({ query: "Resources | summarize count()" });
        if (totalRes.data && Array.isArray(totalRes.data) && totalRes.data.length > 0) {
            totalResources = totalRes.data[0].count_ || 0;
        }

        if (policies.length > 0) {
            // Build KQL where clause dynamically
            const conditions = policies.map(p => `isnull(tags['${p.tag_key}'])`).join(" or ");
            const nonCompliantQuery = `Resources | where ${conditions} | project id, name, type, tags, resourceGroup, subscriptionId | limit 500`;
            
            const ncRes = await client.resources({ query: nonCompliantQuery });
            nonCompliant = ncRes.data as any[] || [];
            
            // Format missing tags for the frontend
            nonCompliant = nonCompliant.map(r => {
                const itemTags = r.tags || {};
                const itemTagKeys = Object.keys(itemTags).map(k => k.toLowerCase());
                const missingTags = policies
                    .filter(p => !itemTagKeys.includes(p.tag_key.toLowerCase()))
                    .map(p => p.tag_key);
                
                return {
                    ...r,
                    missingTags
                };
            });
        }

        return NextResponse.json({
            total: totalResources,
            nonCompliant
        });

    } catch (e: any) {
        console.error("Tag Compliance API Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
