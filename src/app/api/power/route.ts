import { NextRequest, NextResponse } from "next/server";
import { deallocateVirtualMachine, startVirtualMachine } from "@/services/remediationService";
import jwt from "jsonwebtoken";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, action, vms } = body;

        if (!tenantId || !action || !vms || !Array.isArray(vms)) {
            return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
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

        // Ejecutar las acciones asíncronamente (sin await individual bloqueante)
        const promises = vms.map(async (vm: any) => {
            try {
                if (action === 'stop') {
                    await deallocateVirtualMachine(tenantId, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                } else if (action === 'start') {
                    await startVirtualMachine(tenantId, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                }
            } catch (err) {
                console.error(`Fallo al ${action} VM ${vm.resourceName}:`, err);
            }
        });

        // Esperamos a que los comandos 'begin' se disparen, no esperamos a que termine el apagado físico.
        await Promise.all(promises);

        return NextResponse.json({ success: true, message: `Comando ${action} enviado a ${vms.length} VMs.` });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}
