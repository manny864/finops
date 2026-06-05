import { NextRequest, NextResponse } from "next/server";
import { ResourceManagementClient } from "@azure/arm-resources";
import { getAzureCredential } from "@/lib/azure";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        const subscriptionId = request.nextUrl.searchParams.get('subscriptionId');

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Falta tenantId o subscriptionId" }, { status: 400 });
        }

        const credential = await getAzureCredential(tenantId);
        const client = new ResourceManagementClient(credential, subscriptionId);

        const rgs = [];
        for await (const rg of client.resourceGroups.list()) {
            rgs.push({ name: rg.name, location: rg.location });
        }

        return NextResponse.json({ success: true, resourceGroups: rgs });
    } catch (error: any) {
        console.error("ResourceGroups API Error:", error);
        return NextResponse.json({ error: "Fallo al obtener Resource Groups" }, { status: 500 });
    }
}
