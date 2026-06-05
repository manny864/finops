import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    # 1. Update kqlCatalog.ts
    print("Actualizando kqlCatalog.ts...")
    kql_path = os.path.join(base_dir, "src/lib/kqlCatalog.ts")
    with open(kql_path, "r") as f:
        kql_content = f.read()

    if "allVirtualMachines" not in kql_content:
        kql_content = kql_content.replace(
            "export const kqlCatalog: Record<string, string> = {",
            "export const kqlCatalog: Record<string, string> = {\\n  allVirtualMachines: `Resources | where type =~ 'microsoft.compute/virtualmachines' | project id, name, location, resourceGroup, subscriptionId, tags, powerState = tostring(properties.extended.instanceView.powerState.code)`,",
            1
        )
        with open(kql_path, "w") as f:
            f.write(kql_content)

    # 2. Update PowerSchedules.tsx
    print("Actualizando PowerSchedules.tsx...")
    page_path = os.path.join(base_dir, "src/components/dashboard/PowerSchedules.tsx")
    with open(page_path, "r") as f:
        content = f.read()

    # Change fetch from devVirtualMachines to allVirtualMachines
    content = content.replace("json.auditResults.devVirtualMachines", "json.auditResults.allVirtualMachines")
    content = content.replace("No se encontraron VMs etiquetadas como Dev o Test.", "No se encontraron máquinas virtuales en el tenant.")

    # Update the input to a select
    old_input_box = """<input 
                        type="text" 
                        value={scheduleVmName}
                        onChange={(e) => setScheduleVmName(e.target.value)}
                        placeholder="ej. vm-dev-linux-01" 
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />"""
    
    new_select_box = """<select
                        value={scheduleVmName}
                        onChange={(e) => setScheduleVmName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                        <option value="">-- Seleccionar Máquina --</option>
                        {vms.map(vm => (
                            <option key={vm.id} value={vm.name}>{vm.name} ({vm.resourceGroup})</option>
                        ))}
                    </select>"""
    
    content = content.replace(old_input_box, new_select_box)

    # Update GMT offsets
    old_gmt_select = """<select 
                        value={gmtOffset}
                        onChange={(e) => setGmtOffset(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                        <option value="-08:00">GMT-08:00 (PST)</option>
                        <option value="-07:00">GMT-07:00 (MST)</option>
                        <option value="-06:00">GMT-06:00 (CST)</option>
                        <option value="-05:00">GMT-05:00 (EST/COT)</option>
                        <option value="-04:00">GMT-04:00 (AST/BOT)</option>
                        <option value="-03:00">GMT-03:00 (ART)</option>
                        <option value="+00:00">GMT+00:00 (UTC)</option>
                        <option value="+01:00">GMT+01:00 (CET)</option>
                    </select>"""
                    
    new_gmt_select = """<select 
                        value={gmtOffset}
                        onChange={(e) => setGmtOffset(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                        <option value="-12:00">GMT-12:00</option>
                        <option value="-11:00">GMT-11:00</option>
                        <option value="-10:00">GMT-10:00</option>
                        <option value="-09:00">GMT-09:00</option>
                        <option value="-08:00">GMT-08:00 (PST)</option>
                        <option value="-07:00">GMT-07:00 (MST)</option>
                        <option value="-06:00">GMT-06:00 (CST)</option>
                        <option value="-05:00">GMT-05:00 (EST/COT)</option>
                        <option value="-04:00">GMT-04:00 (AST)</option>
                        <option value="-03:30">GMT-03:30</option>
                        <option value="-03:00">GMT-03:00 (ART/BRT)</option>
                        <option value="-02:00">GMT-02:00</option>
                        <option value="-01:00">GMT-01:00</option>
                        <option value="+00:00">GMT+00:00 (UTC)</option>
                        <option value="+01:00">GMT+01:00 (CET)</option>
                        <option value="+02:00">GMT+02:00</option>
                        <option value="+03:00">GMT+03:00</option>
                        <option value="+03:30">GMT+03:30</option>
                        <option value="+04:00">GMT+04:00</option>
                        <option value="+04:30">GMT+04:30</option>
                        <option value="+05:00">GMT+05:00</option>
                        <option value="+05:30">GMT+05:30</option>
                        <option value="+05:45">GMT+05:45</option>
                        <option value="+06:00">GMT+06:00</option>
                        <option value="+06:30">GMT+06:30</option>
                        <option value="+07:00">GMT+07:00</option>
                        <option value="+08:00">GMT+08:00</option>
                        <option value="+08:45">GMT+08:45</option>
                        <option value="+09:00">GMT+09:00 (JST)</option>
                        <option value="+09:30">GMT+09:30</option>
                        <option value="+10:00">GMT+10:00 (AEST)</option>
                        <option value="+10:30">GMT+10:30</option>
                        <option value="+11:00">GMT+11:00</option>
                        <option value="+12:00">GMT+12:00</option>
                        <option value="+13:00">GMT+13:00</option>
                        <option value="+14:00">GMT+14:00</option>
                    </select>"""
    
    content = content.replace(old_gmt_select, new_gmt_select)

    with open(page_path, "w") as f:
        f.write(content)

    print("Deploy completed.")

if __name__ == "__main__":
    deploy()
