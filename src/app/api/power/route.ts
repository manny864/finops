import { NextRequest, NextResponse } from "next/server";
import { deallocateVirtualMachine, startVirtualMachine, restartVirtualMachine } from "@/services/remediationService";
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
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517";

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: "El token no coincide con el tenant." }, { status: 403 });
        }

        // Ejecutar las acciones asíncronamente (sin await individual bloqueante)
        const errors: any[] = [];
        const promises = vms.map(async (vm: any) => {
            try {
                if (action === 'stop') {
                    await deallocateVirtualMachine(tenantId, email, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                } else if (action === 'start') {
                    await startVirtualMachine(tenantId, email, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                } else if (action === 'restart') {
                    await restartVirtualMachine(tenantId, email, vm.subscriptionId, vm.resourceGroup, vm.resourceName);
                }
            } catch (err: any) {
                console.error(`Fallo al ${action} VM ${vm.resourceName}:`, err);
                errors.push({ vm: vm.resourceName, error: err.message || err.code || "Unknown error" });
            }
        });

        // Esperamos a que los comandos 'begin' se disparen, no esperamos a que termine el apagado físico.
        await Promise.all(promises);

        if (errors.length > 0) {
            return NextResponse.json({ error: "Fallo de permisos o ejecución", details: errors }, { status: 403 });
        }

        return NextResponse.json({ success: true, message: `Comando ${action} enviado a ${vms.length} VMs.` });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}
