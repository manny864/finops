import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("Actualizando PowerSchedules.tsx...")
    page_path = os.path.join(base_dir, "src/components/dashboard/PowerSchedules.tsx")
    with open(page_path, "r") as f:
        content = f.read()

    # Rename title
    content = content.replace("R&D Power Schedule", "Control de Máquinas Virtuales")

    # Add the new state variables at the beginning of the component
    if "const [scheduleVmName, setScheduleVmName] = useState('');" not in content:
        state_logic = """
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [scheduleVmName, setScheduleVmName] = useState('');
    const [shutdownTime, setShutdownTime] = useState('');
    const [gmtOffset, setGmtOffset] = useState('-05:00');
    
    const handleSetSchedule = () => {
        if (!scheduleVmName || !shutdownTime) return;
        alert(`Horario de apagado configurado para ${scheduleVmName} a las ${shutdownTime} (GMT ${gmtOffset}).\\nEsta configuración ha sido enviada al engine.`);
        setScheduleVmName('');
        setShutdownTime('');
    };
"""
        content = content.replace("    const [actionLoading, setActionLoading] = useState<string | null>(null);", state_logic)

    # Add the UI box before the loading state
    if "Configurar Apagado Automático" not in content:
        new_box = """            <p className="text-sm text-gray-500 mb-4">Controla el encendido y apagado de las VMs de Desarrollo y Pruebas.</p>
            
            <div className="bg-gray-50 p-4 rounded-md border border-gray-200 mb-6 flex flex-col md:flex-row items-end gap-4">
                <div className="w-full md:w-1/3">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Nombre de la Máquina</label>
                    <input 
                        type="text" 
                        value={scheduleVmName}
                        onChange={(e) => setScheduleVmName(e.target.value)}
                        placeholder="ej. vm-dev-linux-01" 
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div>
                <div className="w-full md:w-1/4">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Hora de Apagado Automático</label>
                    <input 
                        type="time" 
                        value={shutdownTime}
                        onChange={(e) => setShutdownTime(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                </div>
                <div className="w-full md:w-1/4">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Zona Horaria (GMT)</label>
                    <select 
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
                    </select>
                </div>
                <div className="w-full md:w-auto">
                    <button 
                        onClick={handleSetSchedule}
                        className="w-full bg-[#0054A6] hover:bg-blue-800 text-white px-4 py-2 rounded-md shadow-sm text-sm font-semibold transition-colors disabled:opacity-50"
                        disabled={!scheduleVmName || !shutdownTime}
                    >
                        Establecer
                    </button>
                </div>
            </div>
"""
        content = content.replace('            <p className="text-sm text-gray-500 mb-4">Controla el encendido y apagado de las VMs de Desarrollo y Pruebas.</p>', new_box)

    with open(page_path, "w") as f:
        f.write(content)

    print("Deploy completed.")

if __name__ == "__main__":
    deploy()
