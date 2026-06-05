import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    # 1. Create SOP
    print("Creando directiva...")
    os.makedirs(os.path.join(base_dir, "directivas"), exist_ok=True)
    sop_path = os.path.join(base_dir, "directivas/vm_restart_and_rbac_SOP.md")
    with open(sop_path, "w") as f:
        f.write("# VM Restart y Least Privilege RBAC SOP\\n\\n")
        f.write("## Objetivo\\nIntegrar la función de reinicio de VMs y ajustar el RBAC para seguir el principio de Least Privilege.\\n\\n")
        f.write("## Restricciones/Casos Borde\\n- Usar `beginRestartAndWait` del cliente arm-compute.\\n- Payload del script de RBAC debe incluir los 7 permisos estrictamente necesarios, ni uno más.\\n")

    # 2. Update Remediation Service
    print("Actualizando Remediation Service...")
    service_path = os.path.join(base_dir, "src/services/remediationService.ts")
    with open(service_path, "r") as f:
        content = f.read()
    
    if "restartVirtualMachine" not in content:
        content += """
export async function restartVirtualMachine(tenantId: string, subscriptionId: string, resourceGroup: string, vmName: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new ComputeManagementClient(credential, subscriptionId);
    return await client.virtualMachines.beginRestartAndWait(resourceGroup, vmName);
}
"""
        with open(service_path, "w") as f:
            f.write(content)

    # 3. Update API Route
    print("Actualizando API Route...")
    api_path = os.path.join(base_dir, "src/app/api/power/route.ts")
    with open(api_path, "r") as f:
        api_content = f.read()

    if "restartVirtualMachine" not in api_content:
        api_content = api_content.replace(
            "import { deallocateVirtualMachine, startVirtualMachine } from \\\"@/services/remediationService\\\";",
            "import { deallocateVirtualMachine, startVirtualMachine, restartVirtualMachine } from \\\"@/services/remediationService\\\";"
        )
        api_content = api_content.replace(
            "} else if (action === 'start') {\\n                    await startVirtualMachine(tenantId, vm.subscriptionId, vm.resourceGroup, vm.resourceName);\\n                }",
            "} else if (action === 'start') {\\n                    await startVirtualMachine(tenantId, vm.subscriptionId, vm.resourceGroup, vm.resourceName);\\n                } else if (action === 'restart') {\\n                    await restartVirtualMachine(tenantId, vm.subscriptionId, vm.resourceGroup, vm.resourceName);\\n                }"
        )
        with open(api_path, "w") as f:
            f.write(api_content)

    # 4. Update PowerSchedules UI
    print("Actualizando UI...")
    ui_path = os.path.join(base_dir, "src/components/dashboard/PowerSchedules.tsx")
    with open(ui_path, "r") as f:
        ui_content = f.read()

    # Change alert() to toast if Sonner toast is missing, import toast
    if "import { toast } from 'sonner';" not in ui_content:
        ui_content = ui_content.replace(
            "import React, { useState, useEffect } from 'react';",
            "import React, { useState, useEffect } from 'react';\\nimport { toast } from 'sonner';"
        )
    
    # Replace alert success
    ui_content = ui_content.replace(
        "alert(`Comando ${action === 'start' ? 'Encender' : 'Apagar'} enviado exitosamente a ${targetVms.length} VMs.`);",
        "toast.success(`Comando ${action === 'start' ? 'Encender' : action === 'restart' ? 'Reiniciar' : 'Apagar'} enviado exitosamente a ${targetVms.length} VMs.`);"
    )
    
    # Replace alert error
    ui_content = ui_content.replace(
        "alert(\\\"Error al ejecutar la acción.\\\");",
        "toast.error(\\\"Error al ejecutar la acción.\\\");"
    )

    # Replace specific old alerts (if they still exist)
    ui_content = ui_content.replace(
        "alert(\\\"Por favor selecciona al menos una VM\\\");",
        "toast.error(\\\"Por favor selecciona al menos una VM\\\");"
    )

    # Add the Restart button to UI
    restart_button = """                            <button 
                                onClick={() => handleAction('restart')}
                                disabled={selectedVmIds.length === 0 || actionLoading !== null}
                                className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-md shadow-sm text-sm font-semibold transition-colors flex items-center disabled:opacity-50"
                            >
                                {actionLoading === 'restart' ? <span className="animate-spin mr-1">⏳</span> : <RefreshCw className="w-4 h-4 mr-1" />}
                                Reiniciar
                            </button>"""
    
    if "handleAction('restart')" not in ui_content:
        # Import RefreshCw
        if "RefreshCw" not in ui_content:
            ui_content = ui_content.replace(
                "import { Power, Play, Search, AlertCircle, Clock } from 'lucide-react';",
                "import { Power, Play, Search, AlertCircle, Clock, RefreshCw } from 'lucide-react';"
            )

        # Inject button next to start button
        ui_content = ui_content.replace(
            """                            <button 
                                onClick={() => handleAction('start')}""",
            restart_button + """\\n                            <button 
                                onClick={() => handleAction('start')}"""
        )
        
        with open(ui_path, "w") as f:
            f.write(ui_content)


    # 5. Update Onboarding Script
    print("Actualizando Script de Onboarding...")
    script_path = os.path.join(base_dir, "src/lib/onboardingScriptTemplate.ts")
    with open(script_path, "r") as f:
        script_content = f.read()

    old_actions = """$roleDef.Actions.Clear()
$roleDef.Actions.Add("Microsoft.Compute/virtualMachines/deallocate/action")
$roleDef.Actions.Add("Microsoft.Compute/virtualMachines/start/action")
$roleDef.Actions.Add("Microsoft.Resources/tags/write")"""
    
    new_actions = """$roleDef.Actions.Clear()
$roleDef.Actions.Add("Microsoft.Compute/virtualMachines/deallocate/action")
$roleDef.Actions.Add("Microsoft.Compute/virtualMachines/start/action")
$roleDef.Actions.Add("Microsoft.Compute/virtualMachines/restart/action")
$roleDef.Actions.Add("Microsoft.Resources/tags/write")
$roleDef.Actions.Add("Microsoft.Compute/disks/delete")
$roleDef.Actions.Add("Microsoft.Network/networkInterfaces/delete")
$roleDef.Actions.Add("Microsoft.Network/publicIPAddresses/delete")"""

    if "Microsoft.Compute/disks/delete" not in script_content:
        script_content = script_content.replace(old_actions, new_actions)
        with open(script_path, "w") as f:
            f.write(script_content)

    print("Deploy completed.")

if __name__ == "__main__":
    deploy()
