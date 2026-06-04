import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_kql():
    path = os.path.join(base_dir, "src/lib/kqlCatalog.ts")
    with open(path, "r") as f:
        content = f.read()

    old_kql = "subscriptionId, tags`"
    new_kql = "subscriptionId, tags, powerState = tostring(properties.extended.instanceView.powerState.code)`"
    
    if "powerState = tostring" not in content:
        content = content.replace(old_kql, new_kql)
        with open(path, "w") as f:
            f.write(content)

def update_ui():
    path = os.path.join(base_dir, "src/components/dashboard/PowerSchedules.tsx")
    with open(path, "r") as f:
        content = f.read()
    
    old_logic = """                                    if (vm.properties?.extended?.instanceView?.powerState?.code) {
                                        const code = vm.properties.extended.instanceView.powerState.code;
                                        if (code === 'PowerState/running') {
                                            stateLabel = 'Encendida';
                                            isRunning = true;
                                        } else if (code === 'PowerState/deallocated' || code === 'PowerState/stopped') {
                                            stateLabel = 'Apagada';
                                        } else {
                                            stateLabel = code.split('/')[1] || code;
                                        }
                                    }"""
    
    new_logic = """                                    if (vm.powerState) {
                                        const code = vm.powerState;
                                        if (code === 'PowerState/running') {
                                            stateLabel = 'Encendida';
                                            isRunning = true;
                                        } else if (code === 'PowerState/deallocated' || code === 'PowerState/stopped') {
                                            stateLabel = 'Apagada';
                                        } else {
                                            stateLabel = code.replace('PowerState/', '');
                                        }
                                    } else {
                                        stateLabel = 'Sin reportar';
                                    }"""
                                    
    if "vm.powerState" not in content:
        content = content.replace(old_logic, new_logic)
        with open(path, "w") as f:
            f.write(content)

def update_sop():
    path = os.path.join(base_dir, "directivas/power_schedules_SOP.md")
    with open(path, "a") as f:
        f.write("- **Estado de VM**: El query `devVirtualMachines` exporta `powerState` mapeado desde `properties.extended.instanceView.powerState.code`. Este valor es usado en la tabla para marcar gráficamente si está Encendida o Apagada.\\n")

if __name__ == "__main__":
    update_kql()
    update_ui()
    update_sop()
    print("PowerState deploy completado.")
